import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DEMO_TOTP_SECRET, makeConfig, type ConfigOverrides } from '../src/config.js';
import { MemoryAdapter } from '../src/store/memory.js';
import { seedIfEmpty } from '../src/store/seed.js';
import { currentTotp } from '../src/totp.js';

export async function createTestApp(overrides: ConfigOverrides = {}) {
  const config = makeConfig(
    { NODE_ENV: 'test', RATE_LIMIT: 'false' },
    {
      demoMode: true,
      rateLimit: false,
      passwordCost: 1024,
      franchiseMonthly: 5000,
      technicalReserve: 20,
      simulatorPattern: 'pattern',
      birthdayAutorun: false,
      secretsKey: 'test-secret-key-not-production',
      demoPassword: 'Pompeu#089',
      demoTotpSecret: DEMO_TOTP_SECRET,
      webhookSecret: 'demo-webhook-pompeu',
      ...overrides,
    },
  );
  const adapter = new MemoryAdapter();
  await seedIfEmpty(adapter, config);
  const app = await buildApp({ adapter, config, logger: false });
  return { app, adapter, config };
}

export async function login(app: FastifyInstance, email: string, password = 'Pompeu#089'): Promise<string> {
  const first = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const body = first.json() as { token?: string; totpRequired?: boolean; challengeToken?: string; demo?: { currentCode?: string } };
  if (first.statusCode !== 200) throw new Error(first.body);
  if (!body.totpRequired) return body.token ?? '';
  const code = body.demo?.currentCode ?? currentTotp(DEMO_TOTP_SECRET);
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/totp',
    payload: { challengeToken: body.challengeToken, code },
  });
  if (second.statusCode !== 200) throw new Error(second.body);
  return (second.json() as { token: string }).token;
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
