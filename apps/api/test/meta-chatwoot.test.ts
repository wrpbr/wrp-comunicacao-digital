import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatwootSignature, metaSignature } from '../src/crypto.js';
import { sendOutbound } from '../src/services/messaging.js';
import type { Message } from '../src/types.js';
import { auth, createTestApp, login } from './helpers.js';

const APP_SECRET = 'segredo-do-app';
const PHONE_ID = '1392056510668768';
const PHONE = '15551901372';

describe('Meta e Chatwoot no mesmo callback', () => {
  let server: Server;
  let baseUrl: string;
  let status: number;
  let received: { url?: string; headers: IncomingHttpHeaders; body: string }[];
  const apps: FastifyInstance[] = [];

  beforeEach(async () => {
    status = 200;
    received = [];
    server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      received.push({ url: request.url, headers: request.headers, body });
      response.writeHead(status).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function setup() {
    const ctx = await createTestApp({
      metaMode: 'live',
      metaAppSecret: APP_SECRET,
      metaPhoneNumberId: PHONE_ID,
      chatwootWhatsappRelay: true,
      chatwootBaseUrl: baseUrl,
      chatwootPublicUrl: 'https://atendimento.example.test',
      oohSender: 'chatwoot',
      adminAlertPhone: '',
    });
    apps.push(ctx.app);
    return ctx;
  }

  function payload(value: object) {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: PHONE_ID, display_phone_number: PHONE },
        ...value,
      } }] }],
    }, null, 2);
  }

  function post(app: FastifyInstance, body: string, secret = APP_SECRET) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': metaSignature(body, secret) },
      payload: body,
    });
  }

  it('recusa assinatura falsa antes de repassar qualquer dado', async () => {
    const { app } = await setup();
    expect((await post(app, payload({}), 'outro-segredo')).statusCode).toBe(401);
    expect(received).toHaveLength(0);
  });

  it('preserva os bytes e a assinatura e trata o cidadão somente pelo webhook do Chatwoot', async () => {
    const { app, adapter } = await setup();
    const body = payload({ messages: [{ id: 'wamid.recebida', from: '5537990001003', text: { body: 'PARAR' } }] });
    expect((await post(app, body)).statusCode).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe(`/webhooks/whatsapp/${PHONE}`);
    expect(received[0].body).toBe(body);
    expect(received[0].headers['x-hub-signature-256']).toBe(metaSignature(body, APP_SECRET));
    expect(received[0].headers['x-forwarded-proto']).toBe('https');
    expect(await adapter.list('messages')).toHaveLength(0);
    const event = JSON.stringify({
      event: 'message_created', id: 9001, message_type: 'incoming',
      private: false, content: 'PARAR', sender: { phone_number: '+5537990001003' },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await app.inject({
      method: 'POST', url: '/api/v1/webhooks/chatwoot', payload: event,
      headers: {
        'content-type': 'application/json', 'x-chatwoot-timestamp': timestamp,
        'x-chatwoot-signature': chatwootSignature(timestamp, event, 'demo-webhook-pompeu'),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().optedOut).toBe(true);
    expect(await adapter.list('messages')).toHaveLength(1);
  });

  it('preserva o recibo de campanha e pede repetição se o Chatwoot ainda não aceitou', async () => {
    const { app, adapter, config } = await setup();
    config.metaMode = 'simulator';
    const sent = await sendOutbound({ adapter, config }, {
      to: '5537990001001', body: 'Comunicado de teste.', kind: 'campaign',
      actor: { id: 'admin', role: 'admin' },
    });
    config.metaMode = 'live';
    const body = payload({ statuses: [{ id: sent.message.wamid, status: 'read' }] });
    status = 503;
    expect((await post(app, body)).statusCode).toBe(502);
    expect((await adapter.get<Message>('messages', sent.message.id))?.status).toBe(sent.message.status);
    status = 200;
    expect((await post(app, body)).statusCode).toBe(200);
    expect((await adapter.get<Message>('messages', sent.message.id))?.status).toBe('read');
  });

  it('recusa redirecionamento do destino em vez de encaminhar dados a outro endereço', async () => {
    const { app } = await setup();
    status = 302;
    expect((await post(app, payload({}))).statusCode).toBe(502);
    expect(received).toHaveLength(1);
  });

  it('recusa evento de telefone diferente do configurado', async () => {
    const { app } = await setup();
    const body = payload({ metadata: { phone_number_id: 'outro-telefone', display_phone_number: PHONE } });
    expect((await post(app, body)).statusCode).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('mantém o recebimento direto da API quando o repasse está desligado', async () => {
    const { app, adapter, config } = await setup();
    config.chatwootWhatsappRelay = false;
    const body = payload({ messages: [{ id: 'wamid.direta', from: '5537990001003', text: { body: 'Bom dia' } }] });
    expect((await post(app, body)).statusCode).toBe(200);
    expect(received).toHaveLength(0);
    expect(await adapter.list('messages')).toHaveLength(1);
  });

  it.each([true, false])('usa a janela WhatsApp do Chatwoot para contato novo: aberta=%s', async (canReply) => {
    const { app, adapter } = await setup();
    const event = JSON.stringify({
      event: 'message_created', id: 9002, message_type: 'outgoing',
      private: false, content: 'Resposta de atendimento.',
      conversation: {
        channel: 'Channel::Whatsapp', can_reply: canReply,
        meta: { sender: { phone_number: '+5537990001999' } },
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await app.inject({
      method: 'POST', url: '/api/v1/webhooks/chatwoot', payload: event,
      headers: {
        'content-type': 'application/json', 'x-chatwoot-timestamp': timestamp,
        'x-chatwoot-signature': chatwootSignature(timestamp, event, 'demo-webhook-pompeu'),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().billable).toBe(!canReply);
    const [message] = await adapter.list<Message>('messages');
    expect(message.withinServiceWindow).toBe(canReply);
  });

  it('não aceita a janela declarada por um operador sem a assinatura do Chatwoot', async () => {
    const { app } = await setup();
    const token = await login(app, 'admin@pompeu.mg.gov.br');
    const response = await app.inject({
      method: 'POST', url: '/api/v1/webhooks/chatwoot', headers: auth(token),
      payload: {
        event: 'message_created', id: 9002, message_type: 'outgoing',
        private: false, content: 'Resposta de atendimento.',
        conversation: {
          channel: 'Channel::Whatsapp', can_reply: true,
          meta: { sender: { phone_number: '+5537990001999' } },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().billable).toBe(true);
  });
});
