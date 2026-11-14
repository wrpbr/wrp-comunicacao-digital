import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeConfig } from '../src/config.js';
import { chatwootSignature, metaSignature } from '../src/crypto.js';
import { phoneKey, samePhone } from '../src/domain.js';
import { buildMetaPayload } from '../src/meta.js';
import { auth, createTestApp, login } from './helpers.js';

const WEBHOOK = { 'x-wrp-webhook-secret': 'demo-webhook-pompeu' };

function signedChatwoot(payload: unknown, secret = 'demo-webhook-pompeu') {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-chatwoot-timestamp': timestamp,
      'x-chatwoot-signature': chatwootSignature(timestamp, body, secret),
    },
  };
}

describe('telefone brasileiro com e sem o nono dígito', () => {
  it('trata como o mesmo assinante', () => {
    expect(phoneKey('5537990001002')).toBe('553790001002');
    expect(phoneKey('553790001002')).toBe('553790001002');
    expect(samePhone('+55 (37) 99000-1002', '553790001002')).toBe(true);
    expect(samePhone('5537990001002', '5537990001003')).toBe(false);
    expect(samePhone('5531990001002', '5537990001002')).toBe(false);
  });

  it('PARAR vindo sem o nono dígito bloqueia o telefone do cadastro', async () => {
    const { app } = await createTestApp();
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const hook = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      headers: WEBHOOK,
      payload: { from: '553790001002', text: 'PARAR' },
    });
    expect(hook.statusCode).toBe(200);
    const optOuts = await app.inject({ method: 'GET', url: '/api/v1/opt-out', headers: auth(admin) });
    const row = (optOuts.json().optOuts as { phone: string; active: boolean }[]).find((item) => item.phone === '5537990001002');
    expect(row?.active).toBe(true);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: auth(admin),
      payload: { to: '5537990001002', body: 'Comunicado institucional de Pompéu.', kind: 'campaign' },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toBe('opt_out');
    await app.close();
  });
});

describe('webhooks', () => {
  it('no simulador o webhook da Meta recusa visitante anônimo e aceita a sessão do painel', async () => {
    const { app } = await createTestApp();
    const payload = { from: '5537990001003', text: 'Bom dia' };
    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload });
    expect(anonymous.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: { 'x-wrp-webhook-secret': 'errado' }, payload });
    expect(wrong.statusCode).toBe(401);
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const logged = await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: auth(admin), payload });
    expect(logged.statusCode).toBe(200);
    await app.close();
  });

  it('no modo real o webhook da Meta exige a assinatura do App Secret', async () => {
    const { app } = await createTestApp({ metaMode: 'live', metaAppSecret: 'segredo-do-app', metaVerifyToken: 'token-de-verificacao' });
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '553790001003', text: { body: 'SAIR' } }] } }] }],
    });
    const headers = { 'content-type': 'application/json' };
    const unsigned = await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: { ...headers, ...WEBHOOK }, payload: body });
    expect(unsigned.statusCode).toBe(401);
    const signed = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      headers: { ...headers, 'x-hub-signature-256': metaSignature(body, 'segredo-do-app') },
      payload: body,
    });
    expect(signed.statusCode).toBe(200);
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const optOuts = await app.inject({ method: 'GET', url: '/api/v1/opt-out', headers: auth(admin) });
    expect((optOuts.json().optOuts as { phone: string; active: boolean }[]).some((item) => item.phone === '5537990001003' && item.active)).toBe(true);
    const challenge = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=1158201444',
    });
    expect(challenge.statusCode).toBe(200);
    expect(challenge.body).toBe('1158201444');
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=1158201444',
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it('aceita o webhook assinado pelo Chatwoot e recusa assinatura de outro segredo', async () => {
    const { app } = await createTestApp();
    const event = {
      event: 'message_created',
      id: 9001,
      message_type: 'incoming',
      private: false,
      content: 'PARAR',
      sender: { phone_number: '+5537990001006' },
    };
    const forged = signedChatwoot(event, 'outro-segredo');
    const refused = await app.inject({ method: 'POST', url: '/api/v1/webhooks/chatwoot', headers: forged.headers, payload: forged.body });
    expect(refused.statusCode).toBe(401);
    const good = signedChatwoot(event);
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/webhooks/chatwoot', headers: good.headers, payload: good.body });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().optedOut).toBe(true);
    await app.close();
  });

  it('ignora nota interna e atividade do Chatwoot e só avisa o cidadão em transferência de verdade', async () => {
    const { app } = await createTestApp();
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const post = async (event: unknown) => {
      const signed = signedChatwoot(event);
      return app.inject({ method: 'POST', url: '/api/v1/webhooks/chatwoot', headers: signed.headers, payload: signed.body });
    };
    const contact = { phone_number: '+5537990001007' };
    const note = await post({ event: 'message_created', id: 1, message_type: 'outgoing', private: true, content: 'Nota interna', conversation: { meta: { sender: contact } } });
    expect(note.json().ignored).toBe(true);
    const activity = await post({ event: 'message_created', id: 2, message_type: 'activity', private: false, content: 'Conversa atribuída', conversation: { meta: { sender: contact } } });
    expect(activity.json().ignored).toBe(true);
    const firstAssignment = await post({
      event: 'conversation_updated',
      id: 3,
      changed_attributes: [{ team_id: { previous_value: null, current_value: 2 } }],
      meta: { sender: contact, team: { name: 'ubs centro' } },
    });
    expect(firstAssignment.json().ignored).toBe(true);
    await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers: auth(admin), payload: { from: '5537990001007', text: 'Preciso falar com a UBS.' } });
    const transfer = await post({
      event: 'conversation_updated',
      id: 3,
      changed_attributes: [{ team_id: { previous_value: 2, current_value: 1 } }],
      meta: { sender: contact, team: { name: 'ubs centro' } },
    });
    expect(transfer.json().notified).toBe(true);
    expect(transfer.json().billable).toBe(false);
    const audit = await app.inject({ method: 'GET', url: '/api/v1/audit-logs?q=5537990001007', headers: auth(admin) });
    expect(JSON.stringify(audit.json())).toContain('transfer_notice');
    await app.close();
  });
});

describe('dicas de demonstração desligadas', () => {
  // Segredos próprios, como num endereço público. O segredo TOTP é Base32 de teste.
  const OWN = {
    demoHints: false,
    secretsKey: 'chave-propria-de-teste-para-endereco-publico',
    webhookSecret: 'segredo-proprio-do-webhook',
    demoPassword: 'Ensaio#Publico42',
    demoTotpSecret: 'JBSWY3DPEHPK3PXP',
  };

  it('recusa subir com os valores de demonstração do repositório', () => {
    const boot = (overrides: Record<string, unknown>) => () =>
      makeConfig({ NODE_ENV: 'test' }, { demoMode: true, ...OWN, ...overrides });
    expect(boot({ demoPassword: 'Pompeu#089' })).toThrow(/DEMO_PASSWORD/);
    expect(boot({ demoTotpSecret: 'OBQWIZLOOQZGS4DZ' })).toThrow(/DEMO_TOTP_SECRET/);
    expect(boot({ webhookSecret: 'demo-webhook-pompeu' })).toThrow(/WEBHOOK_SECRET/);
    expect(boot({ secretsKey: 'demo-poc-pompeu-nao-usar-em-producao' })).toThrow(/SECRETS_KEY/);
    expect(boot({})).not.toThrow();
  });

  it('não publica senha nem código e sorteia a chave das TVs', async () => {
    const { app } = await createTestApp(OWN);
    const hints = await app.inject({ method: 'GET', url: '/api/v1/auth/demo-hints' });
    expect(hints.statusCode).toBe(404);
    const stale = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@pompeu.mg.gov.br', password: 'Pompeu#089' } });
    expect(stale.statusCode).toBe(401);
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@pompeu.mg.gov.br', password: OWN.demoPassword } });
    expect(first.statusCode).toBe(200);
    expect(first.json().totpRequired).toBe(true);
    expect(first.json().demo).toBeUndefined();
    const code = await app.inject({ method: 'POST', url: '/api/v1/auth/demo-totp', payload: { challengeToken: first.json().challengeToken } });
    expect(code.statusCode).toBe(404);
    const fixed = await app.inject({ method: 'GET', url: '/api/v1/tv/unidade-centro-saude/state?chave=demo.unidade-centro-saude.painel' });
    expect(fixed.statusCode).toBe(401);
    await app.close();
  });
});

describe('modo real da WhatsApp Cloud API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('monta texto livre dentro da janela e modelo aprovado fora dela', () => {
    const base = { metaMode: 'live' as const, demoMode: true, secretsKey: 'chave-de-teste' };
    const semModelo = makeConfig({ NODE_ENV: 'test' }, base);
    expect(semModelo.metaGraphVersion).toBe('v26.0');
    expect(buildMetaPayload(semModelo, { to: '5537990001001', body: 'Olá' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5537990001001',
      type: 'text',
      text: { preview_url: false, body: 'Olá' },
    });
    const comModelo = makeConfig({ NODE_ENV: 'test', META_TEMPLATE_NAME: 'comunicado_municipal' }, base);
    expect(buildMetaPayload(comModelo, { to: '5537990001001', body: 'Vacinação no sábado.' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5537990001001',
      type: 'template',
      template: {
        name: 'comunicado_municipal',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Vacinação no sábado.' }] }],
      },
    });
    expect(buildMetaPayload(comModelo, { to: '5537990001001', body: 'Resposta do atendente.', withinServiceWindow: true }).type).toBe('text');
    const semVariavel = makeConfig(
      { NODE_ENV: 'test', META_TEMPLATE_NAME: 'aviso_fixo', META_TEMPLATE_LANGUAGE: 'en_US', META_TEMPLATE_BODY_PARAM: 'false' },
      base,
    );
    expect(buildMetaPayload(semVariavel, { to: '5537990001001', body: 'ignorado' })).toMatchObject({
      type: 'template',
      template: { name: 'aviso_fixo', language: { code: 'en_US' } },
    });
    expect(JSON.stringify(buildMetaPayload(semVariavel, { to: '5537990001001', body: 'ignorado' }))).not.toContain('components');
  });

  it('envia pela Graph API com o token e registra o identificador da Meta', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: '5537990001001', wa_id: '553790001001' }], messages: [{ id: 'wamid.TESTE123' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { app } = await createTestApp({
      metaMode: 'live',
      metaAccessToken: 'token-de-teste',
      metaPhoneNumberId: '106540352242922',
      metaAppSecret: 'segredo-do-app',
      metaTemplateName: 'comunicado_municipal',
      adminAlertPhone: '',
    });
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/send',
      headers: auth(admin),
      payload: { to: '5537990001001', body: 'Vacinação no sábado.', kind: 'campaign' },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().message.wamid).toBe('wamid.TESTE123');
    expect(sent.json().message.status).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v26.0/106540352242922/messages');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer token-de-teste');
    expect(JSON.parse(String(calls[0]?.init.body)).type).toBe('template');

    const statusBody = JSON.stringify({
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.TESTE123', status: 'delivered', recipient_id: '553790001001' }] } }] }],
    });
    const status = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': metaSignature(statusBody, 'segredo-do-app') },
      payload: statusBody,
    });
    expect(status.statusCode).toBe(200);
    const view = await app.inject({ method: 'GET', url: `/api/v1/messages/${sent.json().message.id}/status`, headers: auth(admin) });
    expect(view.json().status).toBe('delivered');
    await app.close();
  });

  it('recusa da Meta e falha de rede não consomem a franquia', async () => {
    let mode: 'recusa' | 'rede' = 'recusa';
    vi.stubGlobal('fetch', async () => {
      if (mode === 'rede') throw new TypeError('fetch failed');
      return new Response(
        JSON.stringify({ error: { message: '(#131030) Recipient phone number not in allowed list', type: 'OAuthException', code: 131030, error_data: { details: 'Número fora da lista de teste.' } } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    });
    const { app } = await createTestApp({ metaMode: 'live', metaAccessToken: 'token-de-teste', metaPhoneNumberId: '106540352242922', adminAlertPhone: '' });
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const used = async () => (await app.inject({ method: 'GET', url: '/api/v1/franchise', headers: auth(admin) })).json().franchise.used as number;
    const start = await used();
    const send = () =>
      app.inject({ method: 'POST', url: '/api/v1/messages/send', headers: auth(admin), payload: { to: '5537990001001', body: 'Comunicado.', kind: 'campaign' } });
    const refused = await send();
    expect(refused.statusCode).toBe(201);
    expect(refused.json().message.status).toBe('failed');
    expect(refused.json().message.billable).toBe(false);
    expect(refused.json().message.error).toContain('131030');
    expect(refused.json().message.error).toContain('Número fora da lista de teste.');
    mode = 'rede';
    const offline = await send();
    expect(offline.statusCode).toBe(201);
    expect(offline.json().message.status).toBe('failed');
    expect(offline.json().message.billable).toBe(false);
    expect(await used()).toBe(start);
    await app.close();
  });

  it('o lote de 100 destinatários sintéticos passa pelo simulador mesmo no modo real', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('O lote sintético não pode chamar a Meta.');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { app } = await createTestApp({ metaMode: 'live', metaAccessToken: 'token-de-teste', metaPhoneNumberId: '106540352242922', adminAlertPhone: '' });
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const batch = await app.inject({ method: 'POST', url: '/api/v1/campaigns/test-batch', headers: auth(admin), payload: { pattern: 'pattern' } });
    expect(batch.statusCode).toBe(201);
    expect(batch.json().report.metaMode).toBe('simulator');
    expect(batch.json().report.attempted).toBe(100);
    expect(batch.json().report.counted).toBe(94);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });
});
