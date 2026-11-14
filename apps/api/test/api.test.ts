import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login } from './helpers.js';

const WEBHOOK = { 'x-wrp-webhook-secret': 'demo-webhook-pompeu' };

describe('API Pompéu', () => {
  const ctx = {} as Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    Object.assign(ctx, await createTestApp());
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('exige 2FA de admin e autentica atendente sem TOTP', async () => {
    const denied = await ctx.app.inject({ method: 'GET', url: '/api/v1/campaigns' });
    expect(denied.statusCode).toBe(401);
    const admin = await login(ctx.app, 'admin@pompeu.mg.gov.br');
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(admin) });
    expect(me.json().user.role).toBe('admin');
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@pompeu.mg.gov.br', password: 'Pompeu#089' },
    });
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp',
      payload: { challengeToken: bad.json().challengeToken, code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    const atendente = await login(ctx.app, 'atendente@pompeu.mg.gov.br');
    expect(atendente).toBeTruthy();
  });

  it('aplica RBAC nas campanhas, na fila e na auditoria', async () => {
    const auditor = await login(ctx.app, 'auditor@pompeu.mg.gov.br');
    const lancador = await login(ctx.app, 'lancador@pompeu.mg.gov.br');
    const atendente = await login(ctx.app, 'atendente@pompeu.mg.gov.br');
    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: auth(auditor),
      payload: { name: 'Não pode', body: 'texto institucional', segment: { match: 'AND', rules: [] } },
    });
    expect(blocked.statusCode).toBe(403);
    const checkinDenied = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/tv/unidade-centro-saude/checkin',
      headers: auth(atendente),
      payload: { citizenName: 'Maria Aparecida Silva', service: 'Vacina' },
    });
    expect(checkinDenied.statusCode).toBe(403);
    const callDenied = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/tv/unidade-centro-saude/call',
      headers: auth(lancador),
      payload: {},
    });
    expect(callDenied.statusCode).toBe(403);
    const auditDenied = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit-logs/export', headers: auth(lancador) });
    expect(auditDenied.statusCode).toBe(403);
    const audit = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit-logs/export?format=json', headers: auth(auditor) });
    expect(audit.statusCode).toBe(200);
    const checksum = audit.headers['x-export-checksum'];
    expect(checksum).toBe(createHash('sha256').update(audit.rawPayload).digest('hex'));
  });

  it('dispara campanha segmentada, respeita opt-out e exceção legal', async () => {
    const admin = await login(ctx.app, 'admin@pompeu.mg.gov.br');
    const preview = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/campaigns/preview',
      headers: auth(admin),
      payload: { segment: { match: 'AND', rules: [{ field: 'bairro', value: 'Centro' }, { field: 'interesse', value: 'saude' }] } },
    });
    expect(preview.json().total).toBe(1);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: auth(admin),
      payload: {
        name: 'Vacina no Centro',
        body: 'Olá, {{nome}}. A UBS Centro informa o horário de vacinação.',
        segment: { match: 'AND', rules: [{ field: 'bairro', value: 'Centro' }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const dispatched = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${created.json().campaign.id}/dispatch`,
      headers: auth(admin),
    });
    expect(dispatched.statusCode).toBe(200);
    const excluded = dispatched.json().excluded as { name: string }[];
    expect(excluded.some((person) => person.name.includes('Pedro'))).toBe(true);
    const legal = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: auth(admin),
      payload: {
        name: 'Obrigação legal saúde',
        body: 'Comunicado com base legal marcada no cadastro.',
        allowLegalExceptions: true,
        segment: { match: 'AND', rules: [{ field: 'bairro', value: 'São José' }, { field: 'interesse', value: 'saude' }] },
      },
    });
    const legalDispatch = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${legal.json().campaign.id}/dispatch`,
      headers: auth(admin),
    });
    const names = (legalDispatch.json().messages as { recipientName: string }[]).map((item) => item.recipientName);
    expect(names).toContain('Lúcia de Fátima Andrade');
    expect(names).not.toContain('Helena Souza Dias');
  });

  it('palavra PARAR bloqueia campanha futura e aniversário respeita opt-out', async () => {
    const admin = await login(ctx.app, 'admin@pompeu.mg.gov.br');
    const anonymous = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      payload: { from: '5537990001002', text: 'PARAR' },
    });
    expect(anonymous.statusCode).toBe(401);
    const hook = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      headers: WEBHOOK,
      payload: { from: '5537990001002', text: 'PARAR' },
    });
    expect(hook.statusCode).toBe(200);
    const birthday = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/campaigns/birthday/run',
      headers: auth(admin),
      payload: {},
    });
    expect(birthday.statusCode).toBe(200);
    expect(birthday.json().sent).toBeGreaterThanOrEqual(1);
    expect(birthday.json().excluded).toBeGreaterThanOrEqual(1);
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/campaigns/birthday/run',
      headers: auth(admin),
      payload: {},
    });
    expect(again.json().alreadyRan).toBe(true);
  });

  it('lote de 100 mensagens gera relatório PDF/CSV com sondas fora da franquia', async () => {
    const admin = await login(ctx.app, 'admin@pompeu.mg.gov.br');
    const before = await ctx.app.inject({ method: 'GET', url: '/api/v1/franchise', headers: auth(admin) });
    const batch = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/campaigns/test-batch',
      headers: auth(admin),
      payload: { pattern: 'pattern' },
    });
    expect(batch.statusCode).toBe(201);
    const report = batch.json().report;
    expect(report.attempted).toBe(100);
    const sum = Object.values(report.byStatus as Record<string, number>).reduce((total, value) => total + value, 0);
    expect(sum).toBe(100);
    expect(report.byStatus.failed).toBe(6);
    expect(report.counted).toBe(94);
    for (const probe of report.probes) {
      expect(probe.counted).toBe(false);
      expect(probe.franchiseDelta).toBe(0);
    }
    const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/franchise', headers: auth(admin) });
    expect(after.json().franchise.used - before.json().franchise.used).toBe(94);
    const pdf = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/reports/delivery?reportId=${report.id}&format=pdf`,
      headers: auth(admin),
    });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const csv = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/reports/delivery?reportId=${report.id}&format=csv`,
      headers: auth(admin),
    });
    expect(csv.body).toContain('Cidadão Teste');
    expect(csv.headers['x-export-checksum']).toHaveLength(64);
  });

  it('publica a especificação OpenAPI', async () => {
    const spec = await ctx.app.inject({ method: 'GET', url: '/openapi.yaml' });
    expect(spec.statusCode).toBe(200);
    expect(spec.body).toContain('openapi: 3.1.0');
    const docs = await ctx.app.inject({ method: 'GET', url: '/docs/' });
    expect(docs.statusCode).toBe(200);
    expect(docs.body).toContain('swagger-ui-bundle.js');
  });
});

describe('franquia e fila segregada', () => {
  it('bloqueia em 100% e deixa a urgência usar a reserva', async () => {
    const { app } = await createTestApp({ franchiseMonthly: 2, technicalReserve: 2 });
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const send = (to: string, kind = 'campaign') =>
      app.inject({
        method: 'POST',
        url: '/api/v1/messages/send',
        headers: auth(admin),
        payload: { to, body: 'Comunicado institucional de Pompéu.', kind },
      });
    expect((await send('5537990001001')).statusCode).toBe(201);
    expect((await send('5537990001007')).statusCode).toBe(201);
    const blocked = await send('5537990001003');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('franquia_esgotada');
    const urgency = await send('5537990001003', 'urgency');
    expect(urgency.statusCode).toBe(201);
    expect(urgency.json().message.bucket).toBe('reserve');
    expect(urgency.json().message.billable).toBe(false);
    const view = await app.inject({ method: 'GET', url: '/api/v1/franchise', headers: auth(admin) });
    expect(view.json().franchise.blocked).toBe(true);
    expect(view.json().franchise.reserveUsed).toBe(1);
    const pack = await app.inject({
      method: 'POST',
      url: '/api/v1/franchise/packs',
      headers: auth(admin),
      payload: { count: 1 },
    });
    expect(pack.json().franchise.blocked).toBe(false);
    expect((await send('5537990001003')).statusCode).toBe(201);
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      headers: WEBHOOK,
      payload: {
        entry: [{ changes: [{ value: { statuses: [{ id: urgency.json().message.wamid, status: 'failed' }] } }] }],
      },
    });
    expect(rejected.statusCode).toBe(200);
    await app.close();
  });

  it('cenário de demonstração avisa uma vez em 80% e uma vez em 100%, com o alerta mais recente primeiro', async () => {
    const { app } = await createTestApp();
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const scenario = (preset: string) =>
      app.inject({ method: 'POST', url: '/api/v1/franchise/demo-scenario', headers: auth(admin), payload: { preset } });
    const levels = async () => {
      const view = await app.inject({ method: 'GET', url: '/api/v1/franchise', headers: auth(admin) });
      return (view.json().alerts as { level: string }[]).map((alert) => alert.level);
    };
    expect((await scenario('eighty')).statusCode).toBe(200);
    expect(await levels()).toEqual(['80']);
    // Os dois alertas precisam de instantes diferentes para a ordem ser observável.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const full = await scenario('full');
    expect(full.statusCode).toBe(200);
    expect(full.json().franchise.blocked).toBe(true);
    // O consumo já está no teto: só o alerta de 100% é novo, e ele vem antes do de 80%.
    expect(await levels()).toEqual(['100', '80']);
    await app.close();
  });

  it('não cobra inbound, recusa da Meta nem resposta humana na janela de 24h', async () => {
    const { app } = await createTestApp({ franchiseMonthly: 50, simulatorPattern: 'pattern' });
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const used = async () => (await app.inject({ method: 'GET', url: '/api/v1/franchise', headers: auth(admin) })).json().franchise.used as number;
    const start = await used();
    await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: WEBHOOK, payload: { from: '5537990001010', text: 'Qual o horário do protocolo?' } });
    expect(await used()).toBe(start);
    const reply = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: auth(admin),
      payload: { to: '5537990001010', body: 'Protocolo humano no expediente.', kind: 'agent_reply' },
    });
    expect(reply.json().message.billable).toBe(false);
    expect(await used()).toBe(start);
    const metaFail = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: auth(admin),
      payload: { to: '5537990000000', body: 'Esta será recusada.', kind: 'campaign' },
    });
    expect(metaFail.json().message.metaRejected).toBe(true);
    expect(metaFail.json().message.billable).toBe(false);
    expect(await used()).toBe(start);
    await app.close();
  });

  it('isola a fila e o nome reduzido entre as unidades', async () => {
    const { app } = await createTestApp();
    const lancador = await login(app, 'lancador@pompeu.mg.gov.br');
    const atendente = await login(app, 'atendente@pompeu.mg.gov.br');
    const saude = await app.inject({
      method: 'POST',
      url: '/api/v1/tv/unidade-centro-saude/checkin',
      headers: auth(lancador),
      payload: { citizenName: 'Maria Aparecida Silva', service: 'Vacina' },
    });
    expect(saude.json().ticket.number).toBe('SAU-014');
    const geral = await app.inject({
      method: 'POST',
      url: '/api/v1/tv/unidade-atendimento-geral/checkin',
      headers: auth(lancador),
      payload: { citizenName: 'João Batista Ferreira', service: 'Protocolo' },
    });
    expect(geral.json().ticket.number.startsWith('ATG-')).toBe(true);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const chave = 'demo.unidade-centro-saude.painel';
    const stream = await fetch(`http://127.0.0.1:${port}/api/v1/tv/unidade-centro-saude/stream?chave=${chave}`);
    const reader = stream.body?.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader?.read())?.value);
    expect(first).toContain('event: snapshot');
    const started = Date.now();
    const call = await app.inject({
      method: 'POST',
      url: '/api/v1/tv/unidade-centro-saude/call',
      headers: auth(atendente),
      payload: { desk: 'Guichê 1' },
    });
    expect(call.statusCode).toBe(200);
    expect(call.json().publicTicket.displayName).toBe('Maria S.');
    expect(call.json().publicTicket.number).toBe('SAU-014');
    let buffer = '';
    while (!buffer.includes('event: call') && Date.now() - started < 1000) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      buffer += decoder.decode(chunk.value);
    }
    expect(Date.now() - started).toBeLessThan(500);
    expect(buffer).toContain('SAU-014');
    expect(buffer).not.toContain('Silva');
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/tv/unidade-atendimento-geral/state?chave=demo.unidade-atendimento-geral.painel',
    });
    expect(JSON.stringify(other.json())).not.toContain('SAU-014');
    expect(other.json().waiting[0].displayName).toBe('João Batista Ferreira');
    await reader?.cancel();
    await app.close();
  });
});
