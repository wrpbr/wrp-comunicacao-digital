import type { AppConfig } from '../config.js';
import { encryptString, hashPassword, randomToken } from '../crypto.js';
import { demoDisplayToken } from '../domain.js';
import { businessHourSlots } from '../sla.js';
import type { DocAdapter } from './types.js';
import { shiftDateKey } from '../time.js';
import type {
  BusinessHours,
  CannedReply,
  Citizen,
  Heartbeat,
  MediaAsset,
  PlaylistItem,
  Role,
  Unit,
  UserRecord,
} from '../types.js';

const HOURS: BusinessHours = {
  timezone: 'America/Sao_Paulo',
  days: [1, 2, 3, 4, 5],
  start: '08:00',
  end: '17:00',
};

function playlistSaude(): PlaylistItem[] {
  return [
    {
      id: 'pls-1',
      type: 'text',
      title: 'Vacinação',
      durationSec: 12,
      text: 'Traga documento com foto e a caderneta de vacinação.',
      subtitle: 'UBS Centro · Pompéu/MG',
    },
    {
      id: 'pls-2',
      type: 'image',
      title: 'Horário da UBS',
      durationSec: 12,
      imageUrl: '/institucional/horario-ubs.svg',
    },
    {
      id: 'pls-3',
      // Vídeo de 30 s do canal oficial do Ministério da Saúde no YouTube (@MinSaudeBR),
      // exibido pelo player incorporado do próprio YouTube. O município troca pelo seu no painel.
      type: 'youtube',
      title: 'Viaje com a vacinação em dia',
      durationSec: 30,
      youtubeId: 'qjK2DQ8zTvY',
      subtitle: 'Ministério da Saúde',
    },
    {
      id: 'pls-4',
      type: 'image',
      title: 'Campanha institucional',
      durationSec: 12,
      imageUrl: '/institucional/pompeu-institucional.svg',
    },
  ];
}

function playlistGeral(): PlaylistItem[] {
  return [
    {
      id: 'plg-1',
      type: 'text',
      title: 'Atendimento',
      durationSec: 12,
      text: 'Retire sua senha e aguarde a chamada pelo nome.',
      subtitle: 'Atendimento Geral · Prefeitura de Pompéu',
    },
    {
      id: 'plg-2',
      type: 'image',
      title: 'IPTU',
      durationSec: 14,
      imageUrl: '/institucional/iptu.svg',
    },
    {
      id: 'plg-3',
      type: 'image',
      title: 'Vacinação',
      durationSec: 12,
      imageUrl: '/institucional/vacinacao.svg',
    },
  ];
}

function playlistSede(): PlaylistItem[] {
  return [
    {
      id: 'ple-1',
      type: 'text',
      title: 'Prefeitura',
      durationSec: 14,
      text: 'Pregão Eletrônico 089/2026 — comunicação oficial com o cidadão.',
      subtitle: 'Processo 243/2026',
    },
    {
      id: 'ple-2',
      type: 'image',
      title: 'Institucional',
      durationSec: 14,
      imageUrl: '/institucional/pompeu-institucional.svg',
    },
  ];
}

/**
 * Chave que a TV de cada unidade usa para ler a própria fila. Com as dicas de demonstração ligadas
 * ela é fixa e está no roteiro; sem elas cada unidade recebe uma chave aleatória, lida pelo admin no painel.
 */
function displayTokenCipher(config: AppConfig, slug: string): string {
  return encryptString(config.demoHints ? demoDisplayToken(slug) : randomToken(18), config.secretsKey);
}

async function putUnits(adapter: DocAdapter, config: AppConfig): Promise<void> {
  const units: Unit[] = [
    {
      slug: 'unidade-centro-saude',
      name: 'UBS Centro',
      prefix: 'SAU',
      sequence: 13,
      callNameMode: 'reduced',
      displayMode: 'split',
      serviceLabel: 'Saúde',
      businessHours: HOURS,
      oohMessage:
        'A UBS Centro de Pompéu recebeu sua mensagem. O atendimento humano funciona de segunda a sexta, das 8h às 17h. Retornaremos no próximo expediente. Em urgência de saúde, procure a unidade ou ligue 192.',
      playlist: playlistSaude(),
      displayTokenCipher: displayTokenCipher(config, 'unidade-centro-saude'),
      desk: 'Guichê 1',
    },
    {
      slug: 'unidade-atendimento-geral',
      name: 'Atendimento Geral',
      prefix: 'ATG',
      sequence: 40,
      callNameMode: 'full',
      displayMode: 'split',
      serviceLabel: 'Atendimento',
      businessHours: HOURS,
      oohMessage:
        'A Prefeitura de Pompéu recebeu sua mensagem no Atendimento Geral. O expediente humano é de segunda a sexta, das 8h às 17h. Esta é uma resposta automática de horário, sem robô de atendimento.',
      playlist: playlistGeral(),
      displayTokenCipher: displayTokenCipher(config, 'unidade-atendimento-geral'),
      desk: 'Guichê 2',
    },
    {
      slug: 'unidade-prefeitura-sede',
      name: 'Prefeitura Sede',
      prefix: 'PRE',
      sequence: 7,
      callNameMode: 'reduced',
      displayMode: 'media',
      serviceLabel: 'Sede',
      businessHours: HOURS,
      oohMessage:
        'O gabinete de atendimento da Prefeitura de Pompéu funciona de segunda a sexta, das 8h às 17h. Sua mensagem foi registrada para um servidor público.',
      playlist: playlistSede(),
      displayTokenCipher: displayTokenCipher(config, 'unidade-prefeitura-sede'),
      desk: 'Protocolo',
    },
  ];
  for (const unit of units) await adapter.put('units', unit.slug, unit);
}

function ymd(dayShift: number): string {
  const parts = shiftDateKey(dayShift);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function putPeople(adapter: DocAdapter): Promise<void> {
  const now = new Date().toISOString();
  const rows: Citizen[] = [
    person('cit-maria', 'Maria Aparecida Silva', '5537990001001', '1982', 0, 'Centro', ['saude', 'educacao'], 'UBS Centro'),
    person('cit-joao', 'João Batista Ferreira', '5537990001002', '1978', 40, 'São José', ['tributos'], 'Prefeitura Sede'),
    person('cit-ana', 'Ana Lúcia Gomes', '5537990001003', '1991', 12, 'Várzea', ['educacao'], 'Escola Municipal Centro'),
    person('cit-pedro', 'Pedro Henrique Souza', '5537990001004', '1986', 20, 'Centro', ['avisos_gerais'], 'Prefeitura Sede', { optOut: true }),
    person('cit-lucia', 'Lúcia de Fátima Andrade', '5537990001005', '1974', 8, 'São José', ['saude'], 'UBS Centro', {
      optOut: true,
      legalException: true,
      legalExceptionBasis: 'Art. 7º, III, da Lei 13.709/2018 — obrigação legal do controlador municipal. Uso restrito a comunicado determinado pela Procuradoria.',
    }),
    person('cit-carlos', 'Carlos Eduardo Pinto', '5537990001006', '1995', 1, 'Várzea', ['saude'], 'UBS Centro'),
    person('cit-fernanda', 'Fernanda Cristina Lopes', '5537990001007', '1988', 60, 'Centro', ['tributos', 'avisos_gerais'], 'Prefeitura Sede'),
    person('cit-antonio', 'Antônio Marcos Ribeiro', '5537990001008', '1970', 90, 'São José', ['educacao'], 'Escola Municipal Centro'),
    person('cit-beatriz', 'Beatriz Oliveira Nunes', '5537990001009', '1999', 15, 'Várzea', ['avisos_gerais'], 'CRAS'),
    person('cit-ricardo', 'Ricardo Alves Pires', '5537990001010', '1983', 33, 'Centro', ['tributos'], 'Prefeitura Sede'),
    person('cit-helena', 'Helena Souza Dias', '5537990001011', '1968', 0, 'São José', ['saude', 'avisos_gerais'], 'UBS Centro', { optOut: true }),
    person('cit-gustavo', 'Gustavo Henrique Melo', '5537990001012', '2001', 5, 'Várzea', ['educacao', 'avisos_gerais'], 'Escola Municipal Centro'),
    person('srv-camila', 'Camila Rocha Mendes', '5537990001101', '1990', 0, 'Centro', ['saude'], 'UBS Centro', {
      publico: 'servidor',
      cargo: 'Enfermeira',
      unitSlug: 'unidade-centro-saude',
    }),
    person('srv-paulo', 'Paulo Sérgio Duarte', '5537990001102', '1979', 44, 'Centro', ['tributos'], 'Prefeitura Sede', {
      publico: 'servidor',
      cargo: 'Fiscal de tributos',
      unitSlug: 'unidade-prefeitura-sede',
    }),
    person('srv-renata', 'Renata Figueiredo', '5537990001103', '1985', 70, 'São José', ['educacao'], 'Escola Municipal Centro', {
      publico: 'servidor',
      cargo: 'Professora',
      unitSlug: 'unidade-atendimento-geral',
    }),
    person('srv-sergio', 'Sérgio Antunes', '5537990001104', '1981', 18, 'Várzea', ['avisos_gerais'], 'CRAS', {
      publico: 'servidor',
      cargo: 'Atendente',
      unitSlug: 'unidade-atendimento-geral',
    }),
  ];
  for (const row of rows) {
    row.createdAt = now;
    await adapter.put('people', row.id, row);
    if (row.optOut) {
      await adapter.put('opt_outs', `opt_${row.id}`, {
        id: `opt_${row.id}`,
        phone: row.phone,
        citizenId: row.id,
        active: true,
        source: 'seed',
        reason: row.legalException ? 'Opt-out com exceção legal marcada para demonstração.' : 'Opt-out de demonstração.',
        createdAt: now,
        updatedAt: now,
        actorUserId: 'seed',
      });
    }
  }
}

function person(
  id: string,
  name: string,
  phone: string,
  year: string,
  dayShift: number,
  bairro: string,
  interesses: string[],
  predioPublico: string,
  extra: Partial<Citizen> = {},
): Citizen {
  const date = ymd(dayShift);
  const [, month, day] = date.split('-');
  return {
    id,
    name,
    phone,
    birthDate: `${year}-${month}-${day}`,
    bairro,
    interesses,
    predioPublico,
    publico: 'cidadao',
    optOut: false,
    legalException: false,
    synthetic: false,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

async function putUsers(adapter: DocAdapter, config: AppConfig): Promise<void> {
  const specs: { id: string; name: string; email: string; role: Role; totp: boolean }[] = [
    { id: 'usr-admin', name: 'Helena Prado', email: 'admin@pompeu.mg.gov.br', role: 'admin', totp: true },
    { id: 'usr-gestor', name: 'Paulo Henrique Dutra', email: 'gestor@pompeu.mg.gov.br', role: 'gestor', totp: true },
    { id: 'usr-atendente', name: 'Ana Cláudia Moura', email: 'atendente@pompeu.mg.gov.br', role: 'atendente', totp: false },
    { id: 'usr-lancador', name: 'Diego Ferreira Lima', email: 'lancador@pompeu.mg.gov.br', role: 'lancador_fila', totp: false },
    { id: 'usr-auditor', name: 'Sônia Aparecida Reis', email: 'auditor@pompeu.mg.gov.br', role: 'auditor', totp: false },
  ];
  const passwordHash = await hashPassword(config.demoPassword, config.passwordCost);
  const now = new Date().toISOString();
  for (const spec of specs) {
    const user: UserRecord = {
      id: spec.id,
      name: spec.name,
      email: spec.email,
      role: spec.role,
      passwordHash,
      totpEnabled: spec.totp,
      totpSecretCipher: spec.totp ? encryptString(config.demoTotpSecret, config.secretsKey) : undefined,
      active: true,
      createdAt: now,
    };
    await adapter.put('users', user.id, user);
  }
}

async function putHeartbeats(adapter: DocAdapter): Promise<void> {
  const now = new Date();
  const monthStart = new Date(`${now.toISOString().slice(0, 7)}-01T03:00:00.000Z`);
  const slots = businessHourSlots(monthStart, now);
  const slugs = ['unidade-centro-saude', 'unidade-atendimento-geral', 'unidade-prefeitura-sede'];
  for (const slug of slugs) {
    for (const slot of slots) {
      if (slug === 'unidade-centro-saude' && slot.endsWith('-10T11')) continue;
      const beat: Heartbeat = {
        id: `hb_${slug}_${slot}`,
        unitSlug: slug,
        at: new Date(`${slot}:30:00-03:00`).toISOString(),
        mode: slug === 'unidade-prefeitura-sede' ? 'media' : 'split',
        playerVersion: '1.0.0',
        source: 'seed',
      };
      await adapter.put('heartbeats', beat.id, beat);
    }
  }
}

async function putCatalog(adapter: DocAdapter): Promise<void> {
  const replies: CannedReply[] = [
    { id: 'cr-1', sector: 'Saúde', shortCode: 'ubs-horario', content: 'A UBS Centro atende de segunda a sexta, das 8h às 17h. Traga documento com foto.' },
    { id: 'cr-2', sector: 'Saúde', shortCode: 'ubs-vacina', content: 'A vacinação de rotina ocorre na UBS Centro. Procure a sala de vacinas com a caderneta.' },
    { id: 'cr-3', sector: 'Tributos', shortCode: 'iptu', content: 'Para IPTU, informe o número do cadastro imobiliário. O atendimento humano segue no expediente.' },
    { id: 'cr-4', sector: 'Geral', shortCode: 'transferencia', content: 'Vou transferir seu atendimento para o setor responsável. O histórico desta conversa permanece com o próximo servidor.' },
    { id: 'cr-5', sector: 'Geral', shortCode: 'opt-out', content: 'Para deixar de receber campanhas, responda PARAR. O atendimento que você iniciou continua disponível.' },
  ];
  for (const reply of replies) await adapter.put('canned_replies', reply.id, reply);
  const media: MediaAsset[] = [
    { id: 'mid-horario', title: 'Horário da UBS Centro', kind: 'image', url: '/institucional/horario-ubs.svg', tags: ['saude'], createdAt: new Date().toISOString() },
    { id: 'mid-vacina', title: 'Vacinação', kind: 'image', url: '/institucional/vacinacao.svg', tags: ['saude'], createdAt: new Date().toISOString() },
    { id: 'mid-iptu', title: 'IPTU — orientação', kind: 'image', url: '/institucional/iptu.svg', tags: ['tributos'], createdAt: new Date().toISOString() },
    { id: 'mid-inst', title: 'Comunicado institucional', kind: 'image', url: '/institucional/pompeu-institucional.svg', tags: ['avisos_gerais'], createdAt: new Date().toISOString() },
  ];
  for (const asset of media) await adapter.put('media', asset.id, asset);
}

export async function seedIfEmpty(adapter: DocAdapter, config: AppConfig): Promise<{ seeded: boolean }> {
  const users = await adapter.list<UserRecord>('users');
  const units = await adapter.list<Unit>('units');
  if (users.length || units.length) return { seeded: false };
  await putUnits(adapter, config);
  await putCatalog(adapter);
  if (!config.demoMode) return { seeded: true };
  await putPeople(adapter);
  await putUsers(adapter, config);
  await putHeartbeats(adapter);
  return { seeded: true };
}
