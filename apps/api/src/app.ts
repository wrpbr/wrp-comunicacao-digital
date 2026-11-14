import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ZodError, type ZodType } from 'zod';
import { openApiYaml } from './openapi.js';
import { LoginThrottle } from './attempts.js';
import type { AppConfig } from './config.js';
import { decryptString, encryptString, metaSignature, randomToken, readChallenge, safeEqual, sha256Hex, signChallenge, verifyPassword } from './crypto.js';
import { demoDisplayToken } from './domain.js';
import { HttpError } from './http.js';
import type { DocAdapter } from './store/types.js';
import { currentTotp, totpQrDataUrl, verifyTotp } from './totp.js';
import type { AuthUser, Citizen, DeliveryStatus, Role, SessionRecord, Unit, UserRecord, WabaSettings } from './types.js';
import { registerRoutes } from './routes.js';

const require = createRequire(import.meta.url);
const swaggerRoot = path.dirname(require.resolve('swagger-ui-dist/package.json'));

export type AppDeps = {
  adapter: DocAdapter;
  config: AppConfig;
  logger?: boolean;
  /** Relógio do freio de tentativas de login; os testes informam um relógio que eles controlam. */
  now?: () => number;
};

const actorBag = new WeakMap<FastifyRequest, AuthUser | null>();

export function getActor(request: FastifyRequest): AuthUser | null {
  return actorBag.get(request) ?? null;
}

export function requireActor(request: FastifyRequest, roles?: Role[]): AuthUser {
  const actor = getActor(request);
  if (!actor) throw new HttpError(401, 'Autenticação necessária.', 'nao_autenticado');
  if (roles && !roles.includes(actor.role)) throw new HttpError(403, 'Perfil sem permissão para esta ação.', 'proibido');
  return actor;
}

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'corpo'}: ${issue.message}`).join('; ');
    throw new HttpError(400, message || 'Dados inválidos.', 'validacao');
  }
  return parsed.data;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { adapter, config } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    (request as FastifyRequest & { rawBody?: string }).rawBody = text;
    if (!text) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text) as unknown);
    } catch {
      const error = new Error('JSON inválido.') as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: config.corsOrigin.split(',').map((item) => item.trim()),
    allowedHeaders: ['Content-Type', 'Authorization', 'X-WRP-Webhook-Secret', 'X-Display-Token'],
  });
  if (config.rateLimit) {
    await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  }
  await app.register(websocket);
  await app.register(fastifyStatic, {
    root: swaggerRoot,
    prefix: '/docs/assets/',
    decorateReply: false,
  });

  app.addHook('onRequest', async (request) => {
    actorBag.set(request, null);
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return;
    const session = await adapter.get<SessionRecord>('sessions', sha256Hex(token));
    if (!session || session.expiresAt < new Date().toISOString()) return;
    const user = await adapter.get<UserRecord>('users', session.userId);
    if (!user?.active) return;
    actorBag.set(request, { id: user.id, name: user.name, email: user.email, role: user.role });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      if (error.retryAfter) reply.header('Retry-After', String(error.retryAfter));
      return reply.status(error.status).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'validacao', message: 'Dados inválidos.' });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : 'Requisição inválida.';
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'requisicao_invalida', message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'interno', message: 'Erro interno.' });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: 'nao_encontrado', message: 'Recurso não encontrado.' });
  });

  app.get('/openapi.yaml', async (_request, reply) => {
    reply.type('application/yaml; charset=utf-8').send(openApiYaml);
  });
  app.get('/docs', async (_request, reply) => reply.redirect('/docs/'));
  app.get('/docs/', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(DOCS_HTML);
  });

  await registerRoutes(app, { adapter, config, issueSession, rawBody, throttle: new LoginThrottle(deps.now) });
  return app;

  async function issueSession(user: UserRecord): Promise<string> {
    const token = randomToken();
    const now = new Date();
    const session: SessionRecord = {
      id: sha256Hex(token),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
    };
    await adapter.put('sessions', session.id, session);
    return token;
  }

  function rawBody(request: FastifyRequest): string {
    return (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';
  }
}

export function sendFile(reply: FastifyReply, file: { body: Buffer | string; contentType: string; filename: string }): FastifyReply {
  const buffer = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body);
  const checksum = sha256Hex(buffer);
  return reply
    .header('Content-Disposition', `attachment; filename="${file.filename}"`)
    .header('X-Export-Checksum', checksum)
    .header('X-Content-SHA256', checksum)
    .type(file.contentType)
    .send(buffer);
}

export async function loadUserSecret(adapter: DocAdapter, config: AppConfig, user: UserRecord): Promise<string | null> {
  if (!user.totpSecretCipher) return null;
  return decryptString(user.totpSecretCipher, config.secretsKey);
}

export { safeEqual, signChallenge, readChallenge, verifyPassword, verifyTotp, currentTotp, totpQrDataUrl, encryptString, metaSignature, demoDisplayToken };

const DOCS_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>WRP Comunicação Digital — API</title>
  <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
  <style>body { margin: 0; } .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="/docs/assets/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.yaml',
      dom_id: '#swagger',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis]
    });
  </script>
</body>
</html>`;
