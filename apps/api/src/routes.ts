import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  currentTotp,
  demoDisplayToken,
  encryptString,
  getActor,
  metaSignature,
  parseBody,
  readChallenge,
  requireActor,
  safeEqual,
  sendFile,
  signChallenge,
  totpQrDataUrl,
  verifyPassword,
  verifyTotp,
  type AppDeps,
} from './app.js';
import type { LoginThrottle } from './attempts.js';
import { chatwootSignature, decryptString, sha256Hex } from './crypto.js';
import { isOpen } from './domain.js';
import { HttpError } from './http.js';
import { auditToCsv, filterAudit, recordAudit } from './services/audit.js';
import { applyDemoScenario, authorizePacks, getFranchise, reconcileFranchise, setReserveSize } from './services/franchise.js';
import {
  applyDeliveryStatus,
  createCampaign,
  dispatchAlertHooks,
  dispatchCampaign,
  findPersonByPhone,
  listPeople,
  previewSegment,
  recordAgentEcho,
  recordInbound,
  runBirthdays,
  runTestBatch,
  sendOutbound,
  setOptOut,
} from './services/messaging.js';
import { deliveryDocument, franchiseDocument, loadReport, slaDocument } from './services/reports.js';
import {
  callTicket,
  checkIn,
  displayAuthorized,
  heartbeatSummary,
  listUnits,
  recordHeartbeat,
  revealDisplayToken,
  unitSnapshot,
  updateUnit,
} from './services/tv.js';
import { within24h } from './time.js';
import type { AlertRecord, Citizen, MediaAsset, Message, Role, Segment, UserRecord, WabaSettings } from './types.js';

const CAMPAIGN_ROLES: Role[] = ['admin', 'gestor'];
const AUDIT_ROLES: Role[] = ['admin', 'gestor', 'auditor'];
const CHECKIN_ROLES: Role[] = ['admin', 'gestor', 'lancador_fila'];
const CALL_ROLES: Role[] = ['admin', 'gestor', 'atendente'];
/** Quem atende o cidadão registra o pedido de opt-out; reverter e marcar exceção legal é só de CAMPAIGN_ROLES. */
const OPT_OUT_ROLES: Role[] = ['admin', 'gestor', 'atendente'];

const SegmentSchema = z.object({
  match: z.enum(['AND', 'OR']),
  rules: z
    .array(z.object({ field: z.enum(['bairro', 'interesse', 'predio_publico', 'publico']), value: z.string().min(1) }))
    .max(12),
});

type Deps = AppDeps & {
  issueSession: (user: UserRecord) => Promise<string>;
  rawBody: (request: FastifyRequest) => string;
  throttle: LoginThrottle;
};

export async function registerRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { adapter, config, throttle } = deps;
  const ctx = { adapter, config };
  const ipOf = (request: FastifyRequest) => request.ip || '';
  const flush = (alerts: AlertRecord[]) => dispatchAlertHooks(ctx, alerts);
  const hasWebhookSecret = (request: FastifyRequest) => {
    const secret = request.headers['x-wrp-webhook-secret'];
    return typeof secret === 'string' && safeEqual(secret, config.webhookSecret);
  };
  // O Chatwoot assina cada entrega com o segredo do webhook, sobre `<timestamp>.<corpo bruto>`.
  const chatwootSigned = (request: FastifyRequest) => {
    const signature = request.headers['x-chatwoot-signature'];
    const timestamp = request.headers['x-chatwoot-timestamp'];
    if (typeof signature !== 'string' || typeof timestamp !== 'string') return false;
    return safeEqual(signature, chatwootSignature(timestamp, deps.rawBody(request), config.webhookSecret));
  };

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'wrp-comunicacao-digital',
    metaMode: config.metaMode,
    demoMode: config.demoMode,
    graph: `https://graph.facebook.com/${config.metaGraphVersion}`,
    timeUtc: new Date().toISOString(),
  }));

  app.get('/api/v1/auth/demo-hints', async () => {
    if (!config.demoHints) throw new HttpError(404, 'Não encontrado.', 'nao_encontrado');
    const units = await listUnits(adapter);
    return {
      demo: true,
      password: config.demoPassword,
      totpSecret: config.demoTotpSecret,
      accounts: [
        { email: 'admin@pompeu.mg.gov.br', role: 'admin', name: 'Helena Prado', totp: true },
        { email: 'gestor@pompeu.mg.gov.br', role: 'gestor', name: 'Paulo Henrique Dutra', totp: true },
        { email: 'atendente@pompeu.mg.gov.br', role: 'atendente', name: 'Ana Cláudia Moura', totp: false },
        { email: 'lancador@pompeu.mg.gov.br', role: 'lancador_fila', name: 'Diego Ferreira Lima', totp: false },
        { email: 'auditor@pompeu.mg.gov.br', role: 'auditor', name: 'Sônia Aparecida Reis', totp: false },
      ],
      paineis: units.map((unit) => ({
        slug: unit.slug,
        name: unit.name,
        chave: demoDisplayToken(unit.slug),
        path: `/tv/${unit.slug}?chave=${encodeURIComponent(demoDisplayToken(unit.slug))}`,
      })),
    };
  });

  app.post('/api/v1/auth/login', async (request) => {
    const body = parseBody(z.object({ email: z.string().email(), password: z.string().min(1) }), request.body);
    const users = await adapter.list<UserRecord>('users');
    const user = users.find((item) => item.email.toLowerCase() === body.email.toLowerCase() && item.active);
    if (!user) throw new HttpError(401, 'Credenciais inválidas.', 'credenciais');
    // O freio por conta vem antes da conferência: durante a espera nem a senha certa entra.
    const attempt = throttle.begin('senha', user.id, ipOf(request));
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(401, 'Credenciais inválidas.', 'credenciais');
    }
    attempt.succeeded();
    if (user.totpEnabled) {
      if (!user.totpSecretCipher) throw new HttpError(409, '2FA ainda não configurado.', 'totp_ausente');
      const secret = decryptString(user.totpSecretCipher, config.secretsKey);
      return {
        totpRequired: true,
        challengeToken: signChallenge(user.id, Date.now() + 5 * 60 * 1000, config.secretsKey),
        demo: config.demoHints
          ? {
              secret,
              currentCode: currentTotp(secret),
              qrDataUrl: await totpQrDataUrl(user.email, secret),
              note: 'Código exibido só depois da senha correta e somente no modo demonstração com as dicas ligadas.',
            }
          : undefined,
      };
    }
    throttle.trust(user.id, ipOf(request));
    const token = await deps.issueSession(user);
    await recordAudit(adapter, {
      actorUserId: user.id,
      actorRole: user.role,
      action: 'login',
      targetEntity: 'user',
      targetId: user.id,
      ipAddress: ipOf(request),
    });
    return { totpRequired: false, token, user: publicUser(user) };
  });

  app.post('/api/v1/auth/totp', async (request) => {
    const body = parseBody(z.object({ challengeToken: z.string(), code: z.string().min(6).max(8) }), request.body);
    const userId = readChallenge(body.challengeToken, config.secretsKey);
    if (!userId) throw new HttpError(401, 'Desafio 2FA expirado. Entre novamente.', 'totp_expirado');
    const user = await adapter.get<UserRecord>('users', userId);
    if (!user?.totpSecretCipher) throw new HttpError(401, 'Usuário sem 2FA.', 'totp_ausente');
    const secret = decryptString(user.totpSecretCipher, config.secretsKey);
    // Quem tem a senha pede desafios novos à vontade: o código de 6 dígitos só fica seguro com o freio por conta.
    const attempt = throttle.begin('totp', user.id, ipOf(request));
    if (!verifyTotp(body.code, secret)) throw new HttpError(401, 'Código 2FA inválido.', 'totp_invalido');
    attempt.succeeded();
    throttle.trust(user.id, ipOf(request));
    const token = await deps.issueSession(user);
    await recordAudit(adapter, {
      actorUserId: user.id,
      actorRole: user.role,
      action: 'login_totp',
      targetEntity: 'user',
      targetId: user.id,
      ipAddress: ipOf(request),
    });
    return { token, user: publicUser(user) };
  });

  app.post('/api/v1/auth/demo-totp', async (request) => {
    if (!config.demoHints) throw new HttpError(404, 'Não encontrado.', 'nao_encontrado');
    const body = parseBody(z.object({ challengeToken: z.string() }), request.body);
    const userId = readChallenge(body.challengeToken, config.secretsKey);
    if (!userId) throw new HttpError(401, 'Desafio 2FA expirado.', 'totp_expirado');
    const user = await adapter.get<UserRecord>('users', userId);
    if (!user?.totpSecretCipher) throw new HttpError(401, 'Usuário sem 2FA.', 'totp_ausente');
    return { currentCode: currentTotp(decryptString(user.totpSecretCipher, config.secretsKey)) };
  });

  app.get('/api/v1/auth/me', async (request) => ({ user: requireActor(request) }));

  app.delete('/api/v1/auth/session', async (request) => {
    requireActor(request);
    const header = request.headers.authorization ?? '';
    const token = header.slice('Bearer '.length).trim();
    if (token) await adapter.delete('sessions', sha256Hex(token));
    return { ok: true };
  });

  app.get('/api/v1/vocab', async (request) => {
    requireActor(request);
    const people = (await listPeople(adapter)).filter((person) => !person.synthetic);
    return {
      bairros: unique(people.map((person) => person.bairro)),
      interesses: unique(people.flatMap((person) => person.interesses)),
      predios: unique(people.map((person) => person.predioPublico)),
      unidades: (await listUnits(adapter)).map((unit) => ({ slug: unit.slug, name: unit.name, prefix: unit.prefix })),
    };
  });

  app.get('/api/v1/citizens', async (request) => {
    requireActor(request);
    const query = request.query as { q?: string; bairro?: string; interesse?: string; publico?: string };
    let people = (await listPeople(adapter)).filter((person) => !person.synthetic);
    if (query.publico) people = people.filter((person) => person.publico === query.publico);
    if (query.bairro) people = people.filter((person) => person.bairro === query.bairro);
    if (query.interesse) people = people.filter((person) => person.interesses.includes(query.interesse ?? ''));
    if (query.q) {
      const q = query.q.toLowerCase();
      people = people.filter((person) => `${person.name} ${person.phone}`.toLowerCase().includes(q));
    }
    return { citizens: people };
  });

  app.post('/api/v1/citizens', async (request, reply) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(
      z.object({
        name: z.string().min(3),
        phone: z.string().min(12),
        birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        bairro: z.string().min(2),
        interesses: z.array(z.string()).default([]),
        predioPublico: z.string().default(''),
        publico: z.enum(['cidadao', 'servidor']).default('cidadao'),
        cargo: z.string().optional(),
      }),
      request.body,
    );
    const citizen: Citizen = {
      id: `cit_${crypto.randomUUID()}`,
      name: body.name,
      phone: body.phone.replace(/\D/g, ''),
      birthDate: body.birthDate,
      bairro: body.bairro,
      interesses: body.interesses ?? [],
      predioPublico: body.predioPublico ?? '',
      publico: body.publico ?? 'cidadao',
      cargo: body.cargo,
      optOut: false,
      legalException: false,
      synthetic: false,
      createdAt: new Date().toISOString(),
    };
    await adapter.put('people', citizen.id, citizen);
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'citizen_create',
      targetEntity: 'citizen',
      targetId: citizen.id,
      recipient: citizen.phone,
      ipAddress: ipOf(request),
    });
    return reply.status(201).send({ citizen });
  });

  app.post('/api/v1/opt-out', async (request) => {
    // O cidadão cancela pelo WhatsApp (PARAR, SAIR ou OPT-OUT), que prova que o número é dele. Por esta rota só
    // registra quem atende o cidadão: sem sessão, qualquer visitante tiraria o telefone de outra pessoa dos avisos.
    const actor = requireActor(request, OPT_OUT_ROLES);
    const body = parseBody(
      z.object({
        phone: z.string().min(12),
        active: z.boolean().optional(),
        reason: z.string().optional(),
        legalException: z.boolean().optional(),
        legalExceptionBasis: z.string().optional(),
      }),
      request.body,
    );
    const active = body.active ?? true;
    if ((body.legalException !== undefined || active === false) && !CAMPAIGN_ROLES.includes(actor.role)) {
      throw new HttpError(403, 'Somente admin ou gestor altera exceção legal ou reverte o opt-out.', 'proibido');
    }
    const record = await setOptOut(ctx, {
      phone: body.phone,
      active,
      source: 'admin',
      reason: body.reason,
      actor,
      ip: ipOf(request),
      legalException: body.legalException,
      legalExceptionBasis: body.legalExceptionBasis,
    });
    return { optOut: record };
  });

  app.get('/api/v1/opt-out', async (request) => {
    requireActor(request, [...AUDIT_ROLES, 'atendente']);
    return { optOuts: await adapter.list('opt_outs') };
  });

  app.get('/api/v1/campaigns', async (request) => {
    requireActor(request, [...CAMPAIGN_ROLES, 'auditor']);
    return { campaigns: await adapter.list('campaigns') };
  });

  app.post('/api/v1/campaigns/preview', async (request) => {
    requireActor(request, [...CAMPAIGN_ROLES, 'auditor']);
    const body = parseBody(z.object({ segment: SegmentSchema }), request.body);
    const people = await previewSegment(adapter, body.segment);
    return {
      total: people.length,
      sample: people.slice(0, 8).map((person) => ({
        id: person.id,
        name: person.name,
        bairro: person.bairro,
        interesses: person.interesses,
        optOut: person.optOut,
        legalException: person.legalException,
      })),
    };
  });

  app.post('/api/v1/campaigns', async (request, reply) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(
      z.object({
        name: z.string().min(3),
        body: z.string().min(3),
        segment: SegmentSchema,
        allowLegalExceptions: z.boolean().optional(),
      }),
      request.body,
    );
    const campaign = await createCampaign(ctx, { ...body, actor, ip: ipOf(request) });
    return reply.status(201).send({ campaign });
  });

  app.post('/api/v1/campaigns/:id/dispatch', async (request) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const { id } = request.params as { id: string };
    const result = await dispatchCampaign(ctx, id, actor, ipOf(request));
    await flush(result.alerts);
    return {
      campaign: result.campaign,
      sent: result.sent.length,
      excluded: result.excluded.map((person) => ({ id: person.id, name: person.name, phone: person.phone })),
      messages: result.sent,
    };
  });

  app.post('/api/v1/campaigns/birthday/run', async (request) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(z.object({ force: z.boolean().optional() }), request.body ?? {});
    const result = await runBirthdays(ctx, actor, ipOf(request), Boolean(body.force));
    await flush(result.alerts);
    return result;
  });

  app.post('/api/v1/campaigns/test-batch', async (request, reply) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(z.object({ pattern: z.enum(['random', 'pattern']).optional() }), request.body ?? {});
    const pattern = body.pattern ?? config.simulatorPattern;
    const result = await runTestBatch(ctx, actor, ipOf(request), pattern);
    await flush(result.alerts);
    return reply.status(201).send({
      report: result.report,
      downloads: {
        json: `/api/v1/reports/delivery?reportId=${result.report.id}&format=json`,
        csv: `/api/v1/reports/delivery?reportId=${result.report.id}&format=csv`,
        pdf: `/api/v1/reports/delivery?reportId=${result.report.id}&format=pdf`,
      },
    });
  });

  app.post('/api/v1/servidores/broadcast', async (request) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(z.object({ body: z.string().min(3), segment: SegmentSchema.optional() }), request.body);
    const segment: Segment = body.segment ?? { match: 'AND', rules: [{ field: 'publico', value: 'servidor' }] };
    if (!segment.rules.some((rule) => rule.field === 'publico')) {
      segment.rules = [...segment.rules, { field: 'publico', value: 'servidor' }];
    }
    const campaign = await createCampaign(ctx, {
      name: 'Canal de servidores',
      body: body.body,
      segment,
      kind: 'servidores',
      actor,
      ip: ipOf(request),
    });
    const result = await dispatchCampaign(ctx, campaign.id, actor, ipOf(request));
    await flush(result.alerts);
    return { campaign: result.campaign, sent: result.sent.length, excluded: result.excluded.length };
  });

  app.post('/api/v1/messages/send', async (request, reply) => {
    const actor = requireActor(request);
    const body = parseBody(
      z.object({
        to: z.string().min(12),
        body: z.string().min(1).max(4000),
        kind: z.enum(['campaign', 'birthday', 'servidor', 'urgency', 'agent_reply']).default('campaign'),
        honorLegalException: z.boolean().optional(),
        templateName: z.string().optional(),
      }),
      request.body,
    );
    if (body.kind === 'agent_reply' && !['admin', 'gestor', 'atendente'].includes(actor.role)) {
      throw new HttpError(403, 'Somente o atendimento humano envia resposta na janela de 24 horas.', 'proibido');
    }
    if (body.kind !== 'agent_reply' && !CAMPAIGN_ROLES.includes(actor.role)) {
      throw new HttpError(403, 'Campanhas e alertas de urgência exigem admin ou gestor.', 'proibido');
    }
    const result = await sendOutbound(ctx, {
      to: body.to,
      body: body.body,
      kind: body.kind ?? 'campaign',
      honorLegalException: body.honorLegalException,
      templateName: body.templateName,
      actor,
      ip: ipOf(request),
    });
    await flush(result.alerts);
    return reply.status(201).send({ message: result.message });
  });

  app.get('/api/v1/messages/:id/status', async (request) => {
    requireActor(request);
    const { id } = request.params as { id: string };
    const message = await adapter.get<Message>('messages', id);
    if (!message) throw new HttpError(404, 'Mensagem não encontrada.', 'nao_encontrado');
    return {
      id: message.id,
      status: message.status,
      billable: message.billable,
      bucket: message.bucket,
      exclusionReason: message.exclusionReason ?? null,
      metaRejected: message.metaRejected,
      wamid: message.wamid ?? null,
      statusHistory: message.statusHistory,
      updatedAt: message.updatedAt,
    };
  });

  app.get('/api/v1/reports/delivery', async (request, reply) => {
    requireActor(request, [...CAMPAIGN_ROLES, 'auditor']);
    const query = request.query as { format?: string; reportId?: string; campaignId?: string };
    const format = query.format === 'csv' || query.format === 'pdf' ? query.format : 'json';
    const report = await loadReport(adapter, query);
    if (!report) throw new HttpError(404, 'Nenhum relatório de entrega. Execute o lote POC primeiro.', 'relatorio_ausente');
    return sendFile(reply, await deliveryDocument(adapter, report, format));
  });

  app.get('/api/v1/reports/franchise', async (request, reply) => {
    requireActor(request, [...CAMPAIGN_ROLES, 'auditor']);
    const query = request.query as { format?: string; month?: string };
    const format = query.format === 'csv' || query.format === 'pdf' ? query.format : 'json';
    return sendFile(reply, await franchiseDocument(adapter, config, format, query.month));
  });

  app.get('/api/v1/reports/sla', async (request, reply) => {
    requireActor(request, AUDIT_ROLES);
    const query = request.query as { format?: string; month?: string };
    const format = query.format === 'csv' || query.format === 'pdf' ? query.format : 'json';
    return sendFile(reply, await slaDocument(adapter, format, query.month));
  });

  app.get('/api/v1/audit-logs', async (request) => {
    requireActor(request, AUDIT_ROLES);
    const rows = filterAudit(await adapter.listAudit(), request.query as Record<string, string | undefined>);
    return { total: rows.length, logs: rows.slice(-400).reverse() };
  });

  app.get('/api/v1/audit-logs/export', async (request, reply) => {
    requireActor(request, AUDIT_ROLES);
    const query = request.query as { format?: string; from?: string; to?: string; actor?: string; action?: string; status?: string; q?: string };
    const rows = filterAudit(await adapter.listAudit(), query);
    if (query.format === 'csv') {
      return sendFile(reply, { body: auditToCsv(rows), contentType: 'text/csv; charset=utf-8', filename: 'auditoria-pompeu.csv' });
    }
    return sendFile(reply, {
      body: JSON.stringify({ exportedAt: new Date().toISOString(), total: rows.length, logs: rows }, null, 2),
      contentType: 'application/json; charset=utf-8',
      filename: 'auditoria-pompeu.json',
    });
  });

  app.get('/api/v1/franchise', async (request) => {
    requireActor(request, [...CAMPAIGN_ROLES, 'auditor']);
    // Alerta mais recente primeiro: é o que o gestor procura ao abrir a tela.
    const alerts = (await adapter.list<AlertRecord>('alerts')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { franchise: await getFranchise(adapter, config), alerts };
  });

  app.post('/api/v1/franchise/packs', async (request) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(z.object({ count: z.number().int().min(1).max(50) }), request.body);
    return { franchise: await authorizePacks(adapter, config, body.count, actor, ipOf(request)) };
  });

  app.put('/api/v1/franchise/reserve', async (request) => {
    const actor = requireActor(request, ['admin']);
    const body = parseBody(z.object({ size: z.number().int().min(0).max(5000) }), request.body);
    return { franchise: await setReserveSize(adapter, config, body.size, actor, ipOf(request)) };
  });

  app.post('/api/v1/franchise/demo-scenario', async (request) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(z.object({ preset: z.enum(['eighty', 'full', 'reset']) }), request.body);
    return { franchise: await applyDemoScenario(adapter, config, body.preset, actor, ipOf(request)) };
  });

  app.post('/api/v1/franchise/reconcile', async (request) => {
    const actor = requireActor(request, ['admin']);
    const franchise = await reconcileFranchise(adapter, config);
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'franchise_reconcile',
      targetEntity: 'franchise',
      targetId: franchise.id,
      ipAddress: ipOf(request),
      metadata: { used: franchise.used },
    });
    return { franchise };
  });

  app.get('/api/v1/media', async (request) => {
    requireActor(request);
    return { media: await adapter.list<MediaAsset>('media') };
  });

  app.post('/api/v1/media', async (request, reply) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const body = parseBody(
      z.object({
        title: z.string().min(2),
        kind: z.enum(['image', 'text', 'youtube']),
        url: z.string().optional(),
        dataUrl: z.string().max(1_500_000).optional(),
        text: z.string().optional(),
        youtubeId: z.string().optional(),
        tags: z.array(z.string()).default([]),
      }),
      request.body,
    );
    const asset: MediaAsset = {
      id: `mid_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      title: body.title,
      kind: body.kind,
      url: body.url,
      dataUrl: body.dataUrl,
      text: body.text,
      youtubeId: body.youtubeId,
      tags: body.tags ?? [],
    };
    await adapter.put('media', asset.id, asset);
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'media_create',
      targetEntity: 'media',
      targetId: asset.id,
      ipAddress: ipOf(request),
    });
    return reply.status(201).send({ media: asset });
  });

  app.get('/api/v1/media/:id/raw', async (request, reply) => {
    const asset = await adapter.get<MediaAsset>('media', (request.params as { id: string }).id);
    const match = asset?.dataUrl?.match(/^data:(.+);base64,(.+)$/);
    if (!match?.[1] || !match[2]) throw new HttpError(404, 'Arquivo não encontrado.', 'nao_encontrado');
    return reply.type(match[1]).send(Buffer.from(match[2], 'base64'));
  });

  app.get('/api/v1/canned-replies', async (request) => {
    requireActor(request);
    return { replies: await adapter.list('canned_replies') };
  });

  app.get('/api/v1/chatwoot/status', async (request) => {
    requireActor(request);
    let online = false;
    try {
      const response = await fetch(config.chatwootBaseUrl, { signal: AbortSignal.timeout(2000) });
      online = response.status < 500;
    } catch {
      online = false;
    }
    const units = await listUnits(adapter);
    return {
      online,
      url: config.chatwootPublicUrl,
      // Página do webchat que o cidadão abre: a mesma que o site da prefeitura incorpora.
      webchatUrl: config.chatwootWebsiteToken
        ? `${config.chatwootPublicUrl.replace(/\/+$/, '')}/widget?website_token=${encodeURIComponent(config.chatwootWebsiteToken)}`
        : undefined,
      webhook: '/api/v1/webhooks/chatwoot',
      humanOnly: true,
      sectors: units.map((unit) => ({
        slug: unit.slug,
        inbox: unit.name,
        hours: unit.businessHours,
        openNow: isOpen(unit.businessHours),
      })),
    };
  });

  app.get('/api/v1/settings/waba', async (request) => {
    requireActor(request, CAMPAIGN_ROLES);
    const stored = await adapter.get<WabaSettings>('settings', 'waba');
    return {
      metaMode: config.metaMode,
      graphVersion: config.metaGraphVersion,
      phoneNumberId: config.metaPhoneNumberId ?? stored?.phoneNumberId ?? null,
      tokenConfigured: Boolean(config.metaAccessToken || stored?.tokenCipher),
      last4: stored?.last4 ?? null,
    };
  });

  app.put('/api/v1/settings/waba', async (request) => {
    const actor = requireActor(request, ['admin']);
    const body = parseBody(z.object({ token: z.string().min(10).optional(), phoneNumberId: z.string().min(4).optional() }), request.body);
    const current: WabaSettings = (await adapter.get<WabaSettings>('settings', 'waba')) ?? { id: 'waba' };
    if (body.token) {
      current.tokenCipher = encryptString(body.token, config.secretsKey);
      current.last4 = body.token.slice(-4);
      config.metaAccessToken = body.token;
    }
    if (body.phoneNumberId) {
      current.phoneNumberId = body.phoneNumberId;
      config.metaPhoneNumberId = body.phoneNumberId;
    }
    current.updatedAt = new Date().toISOString();
    await adapter.put('settings', 'waba', current);
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'waba_update',
      targetEntity: 'settings',
      targetId: 'waba',
      ipAddress: ipOf(request),
      metadata: { last4: current.last4 ?? null },
    });
    return { tokenConfigured: Boolean(current.tokenCipher || config.metaAccessToken), last4: current.last4 ?? null, phoneNumberId: current.phoneNumberId ?? null };
  });

  app.get('/api/v1/units', async (request) => {
    requireActor(request);
    const units = await listUnits(adapter);
    return {
      units: units.map((unit) => ({
        ...unit,
        displayTokenCipher: undefined,
        openNow: isOpen(unit.businessHours),
      })),
      heartbeats: await heartbeatSummary(adapter),
    };
  });

  app.put('/api/v1/units/:slug', async (request) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const { slug } = request.params as { slug: string };
    const body = parseBody(
      z.object({
        callNameMode: z.enum(['full', 'reduced']).optional(),
        displayMode: z.enum(['media', 'tickets', 'split']).optional(),
        oohMessage: z.string().min(10).optional(),
        desk: z.string().min(1).optional(),
        businessHours: z
          .object({
            timezone: z.literal('America/Sao_Paulo'),
            days: z.array(z.number().int().min(1).max(7)),
            start: z.string().regex(/^\d{2}:\d{2}$/),
            end: z.string().regex(/^\d{2}:\d{2}$/),
          })
          .optional(),
        playlist: z
          .array(
            z.object({
              id: z.string(),
              type: z.enum(['image', 'youtube', 'text']),
              title: z.string(),
              durationSec: z.number().int().min(5).max(600),
              imageUrl: z.string().optional(),
              youtubeId: z.string().optional(),
              text: z.string().optional(),
              subtitle: z.string().optional(),
            }),
          )
          .optional(),
      }),
      request.body,
    );
    return { unit: await updateUnit(adapter, slug, body, actor, ipOf(request)) };
  });

  app.get('/api/v1/tv/:unitSlug/display-token', async (request) => {
    const actor = requireActor(request, CAMPAIGN_ROLES);
    const { unitSlug } = request.params as { unitSlug: string };
    const chave = await revealDisplayToken(adapter, config, unitSlug);
    await recordAudit(adapter, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'reveal_display_token',
      targetEntity: 'unit',
      targetId: unitSlug,
      ipAddress: ipOf(request),
    });
    return { chave, path: `/tv/${unitSlug}?chave=${encodeURIComponent(chave)}` };
  });

  app.get('/api/v1/tv/:unitSlug/state', async (request) => {
    const { unitSlug } = request.params as { unitSlug: string };
    if (!(await canRead(deps, request, unitSlug))) throw new HttpError(401, 'Painel não autorizado.', 'painel_nao_autorizado');
    return unitSnapshot(adapter, unitSlug);
  });

  app.post('/api/v1/tv/:unitSlug/checkin', async (request, reply) => {
    const actor = requireActor(request, CHECKIN_ROLES);
    const { unitSlug } = request.params as { unitSlug: string };
    const body = parseBody(z.object({ citizenName: z.string().min(2), service: z.string().min(2) }), request.body);
    const result = await checkIn(adapter, {
      unitSlug,
      citizenName: body.citizenName,
      service: body.service,
      actorId: actor.id,
      actorRole: actor.role,
      ip: ipOf(request),
    });
    return reply.status(201).send(result);
  });

  app.post('/api/v1/tv/:unitSlug/call', async (request) => {
    const actor = requireActor(request, CALL_ROLES);
    const { unitSlug } = request.params as { unitSlug: string };
    const body = parseBody(z.object({ ticketId: z.string().optional(), desk: z.string().optional() }), request.body ?? {});
    return callTicket(adapter, {
      unitSlug,
      ticketId: body.ticketId,
      desk: body.desk,
      actorId: actor.id,
      actorRole: actor.role,
      ip: ipOf(request),
    });
  });

  app.post('/api/v1/tv/:unitSlug/heartbeat', async (request, reply) => {
    const { unitSlug } = request.params as { unitSlug: string };
    const body = parseBody(
      z.object({
        chave: z.string().optional(),
        mode: z.enum(['media', 'tickets', 'split']).optional(),
        playerVersion: z.string().optional(),
      }),
      request.body ?? {},
    );
    const allowed = getActor(request) || (await displayAuthorized(adapter, config, unitSlug, body.chave || headerToken(request)));
    if (!allowed) throw new HttpError(401, 'Painel não autorizado.', 'painel_nao_autorizado');
    const beat = await recordHeartbeat(adapter, {
      unitSlug,
      mode: body.mode,
      playerVersion: body.playerVersion,
      userAgent: request.headers['user-agent'],
    });
    return reply.status(201).send({ ok: true, at: beat.at });
  });

  app.get('/api/v1/tv/:unitSlug/stream', async (request, reply) => {
    const { unitSlug } = request.params as { unitSlug: string };
    if (!(await canRead(deps, request, unitSlug))) throw new HttpError(401, 'Painel não autorizado.', 'painel_nao_autorizado');
    const snapshot = await unitSnapshot(adapter, unitSlug);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    const { tvBus } = await import('./bus.js');
    const unsubscribe = tvBus.subscribe(unitSlug, (event) => {
      reply.raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
    request.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get('/api/v1/tv/:unitSlug/ws', { websocket: true }, (socket, request) => {
    const { unitSlug } = request.params as { unitSlug: string };
    void (async () => {
      if (!(await canRead(deps, request, unitSlug))) {
        socket.close(1008, 'painel_nao_autorizado');
        return;
      }
      socket.send(JSON.stringify({ event: 'snapshot', data: await unitSnapshot(adapter, unitSlug) }));
      const { tvBus } = await import('./bus.js');
      const unsubscribe = tvBus.subscribe(unitSlug, (event) => socket.send(JSON.stringify(event)));
      socket.on('close', unsubscribe);
    })();
  });

  app.get('/api/v1/webhooks/meta', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query['hub.mode'] === 'subscribe' && config.metaVerifyToken && safeEqual(query['hub.verify_token'] ?? '', config.metaVerifyToken)) {
      return reply.send(query['hub.challenge'] ?? '');
    }
    throw new HttpError(403, 'Verificação do webhook Meta recusada.', 'webhook_recusado');
  });

  app.post('/api/v1/webhooks/meta', async (request) => {
    if (config.metaMode === 'live') {
      if (!config.metaAppSecret) throw new HttpError(401, 'META_APP_SECRET ausente.', 'webhook_recusado');
      const header = request.headers['x-hub-signature-256'];
      const expected = metaSignature(deps.rawBody(request), config.metaAppSecret);
      if (typeof header !== 'string' || !safeEqual(header, expected)) {
        throw new HttpError(401, 'Assinatura Meta inválida.', 'assinatura_invalida');
      }
    } else if (!getActor(request) && !hasWebhookSecret(request)) {
      // No simulador quem faz o papel da Meta é o operador do ensaio, nunca um visitante anônimo.
      throw new HttpError(
        401,
        'No simulador, este webhook exige a sessão do painel ou o cabeçalho X-WRP-Webhook-Secret.',
        'webhook_recusado',
      );
    }
    const body = (request.body ?? {}) as MetaBody;
    const alerts: AlertRecord[] = [];
    if (body.from && body.text && config.metaMode === 'simulator') {
      const inbound = await recordInbound(ctx, { from: body.from, text: body.text, unitSlug: body.unitSlug, ip: ipOf(request) });
      alerts.push(...inbound.alerts);
    }
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (!message.from || !message.text?.body) continue;
          const inbound = await recordInbound(ctx, { from: message.from, text: message.text.body, ip: ipOf(request) });
          alerts.push(...inbound.alerts);
        }
        for (const status of change.value?.statuses ?? []) {
          if (!status.id || !isStatus(status.status)) continue;
          await applyDeliveryStatus(ctx, { wamid: status.id, status: status.status, actor: { id: 'meta', role: 'meta' }, ip: ipOf(request) });
        }
      }
    }
    await flush(alerts);
    return { ok: true };
  });

  app.post('/api/v1/webhooks/chatwoot', async (request) => {
    if (!getActor(request) && !hasWebhookSecret(request) && !chatwootSigned(request)) {
      throw new HttpError(401, 'Webhook do Chatwoot não autorizado.', 'webhook_recusado');
    }
    const parsed = readChatwoot((request.body ?? {}) as Record<string, unknown>);
    if (parsed.kind === 'incoming' && parsed.phone && parsed.text) {
      const inbound = await recordInbound(ctx, { from: parsed.phone, text: parsed.text, ip: ipOf(request) });
      await flush(inbound.alerts);
      return { ok: true, optedOut: inbound.optedOut };
    }
    if (parsed.kind === 'outgoing' && parsed.phone && parsed.text) {
      const echo = await recordAgentEcho(ctx, {
        phone: parsed.phone,
        body: parsed.text,
        externalId: parsed.externalId,
        actor: { id: 'chatwoot', role: 'atendente' },
        ip: ipOf(request),
      });
      await flush(echo.alerts);
      return { ok: true, billable: echo.message.billable };
    }
    if (parsed.kind === 'transfer' && parsed.phone) {
      const phone = parsed.phone.replace(/\D/g, '');
      const person = await findPersonByPhone(adapter, phone);
      if (person && within24h(person.lastInboundAt)) {
        // O Chatwoot guarda o nome da equipe em minúsculas; o cidadão lê o nome da unidade como está no cadastro.
        const unit = (await listUnits(adapter)).find((item) => item.name.toLowerCase() === parsed.sector?.toLowerCase());
        const sent = await sendOutbound(ctx, {
          to: person.phone,
          body: `Olá. Seu atendimento foi transferido para ${unit?.name ?? parsed.sector ?? 'outro setor'}. Um servidor público continuará por aqui e o histórico da conversa é preservado.`,
          kind: 'transfer_notice',
          actor: { id: 'chatwoot', role: 'atendente' },
          ip: ipOf(request),
          skipOptOut: true,
        });
        await flush(sent.alerts);
        return { ok: true, notified: true, billable: sent.message.billable };
      }
      await recordAudit(adapter, {
        actorUserId: 'chatwoot',
        actorRole: 'atendente',
        action: 'transfer_notice_held',
        targetEntity: 'conversation',
        targetId: parsed.externalId ?? 'sem-id',
        recipient: phone,
        ipAddress: ipOf(request),
        metadata: { reason: 'Fora da janela de 24 horas.' },
      });
      return { ok: true, notified: false };
    }
    return { ok: true, ignored: true };
  });
}

async function canRead(deps: Deps, request: FastifyRequest, slug: string): Promise<boolean> {
  if (getActor(request)) return true;
  const query = request.query as { chave?: string };
  return displayAuthorized(deps.adapter, deps.config, slug, query.chave || headerToken(request));
}

function headerToken(request: FastifyRequest): string | undefined {
  const value = request.headers['x-display-token'];
  return typeof value === 'string' ? value : undefined;
}

function publicUser(user: UserRecord) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, totpEnabled: user.totpEnabled };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

type MetaBody = {
  from?: string;
  text?: string;
  unitSlug?: string;
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; text?: { body?: string } }[];
        statuses?: { id?: string; status?: string }[];
      };
    }[];
  }[];
};

function isStatus(value: string | undefined): value is 'queued' | 'sent' | 'delivered' | 'read' | 'failed' {
  return value === 'queued' || value === 'sent' || value === 'delivered' || value === 'read' || value === 'failed';
}

function readChatwoot(body: Record<string, unknown>): {
  kind: 'incoming' | 'outgoing' | 'transfer' | 'ignore';
  phone?: string;
  text?: string;
  sector?: string;
  externalId?: string;
} {
  const event = String(body.event ?? '');
  const phone = digPhone(body);
  const text = typeof body.content === 'string' ? body.content : '';
  const externalId = body.id !== undefined ? String(body.id) : undefined;
  if (event === 'message_created') {
    // Nota interna e mensagem de atividade não chegam ao cidadão: não são resposta do atendente.
    if (body.private === true) return { kind: 'ignore' };
    if (body.message_type === 'incoming' || body.message_type === 0) return { kind: 'incoming', phone, text, externalId };
    if (body.message_type === 'outgoing' || body.message_type === 1) return { kind: 'outgoing', phone, text, externalId };
    return { kind: 'ignore' };
  }
  const meta = body.meta as { assignee?: { name?: string }; team?: { name?: string } } | undefined;
  if (event === 'assignee_changed') {
    return { kind: 'transfer', phone, sector: meta?.assignee?.name ?? 'outro setor', externalId };
  }
  if (event === 'conversation_updated') {
    // Só é transferência quando a conversa já tinha equipe ou atendente; a primeira atribuição não avisa o cidadão.
    const moved = (key: string) =>
      changedAttributes(body.changed_attributes).some(
        (change) => change[key] && change[key].previous_value != null && change[key].current_value != null,
      );
    if (moved('team_id')) return { kind: 'transfer', phone, sector: meta?.team?.name ?? 'outro setor', externalId };
    if (moved('assignee_id')) return { kind: 'transfer', phone, sector: meta?.assignee?.name ?? 'outro setor', externalId };
  }
  return { kind: 'ignore' };
}

type ChatwootChange = Record<string, { previous_value?: unknown; current_value?: unknown } | undefined>;

function changedAttributes(value: unknown): ChatwootChange[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === 'object') as ChatwootChange[]) : [];
}

function digPhone(body: Record<string, unknown>): string | undefined {
  const sender = body.sender as { phone_number?: string } | undefined;
  const contact = body.contact as { phone_number?: string } | undefined;
  const meta = body.meta as { sender?: { phone_number?: string } } | undefined;
  const conversation = body.conversation as { meta?: { sender?: { phone_number?: string } } } | undefined;
  return sender?.phone_number || contact?.phone_number || meta?.sender?.phone_number || conversation?.meta?.sender?.phone_number;
}
