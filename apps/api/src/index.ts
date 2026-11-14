import { buildApp } from './app.js';
import { attachRedis } from './bus.js';
import { makeConfig } from './config.js';
import { decryptString } from './crypto.js';
import { MemoryAdapter } from './store/memory.js';
import { createPostgresAdapter } from './store/postgres.js';
import { seedIfEmpty } from './store/seed.js';
import { runBirthdays } from './services/messaging.js';
import { zonedParts } from './time.js';
import type { WabaSettings } from './types.js';

const config = makeConfig();
const adapter = config.databaseUrl ? await createPostgresAdapter(config.databaseUrl) : new MemoryAdapter();
const seeded = await seedIfEmpty(adapter, config);
const stored = await adapter.get<WabaSettings>('settings', 'waba');
if (!config.metaAccessToken && stored?.tokenCipher) {
  config.metaAccessToken = decryptString(stored.tokenCipher, config.secretsKey);
}
if (!config.metaPhoneNumberId && stored?.phoneNumberId) {
  config.metaPhoneNumberId = stored.phoneNumberId;
}
if (config.redisUrl) {
  try {
    await attachRedis(config.redisUrl);
  } catch (error) {
    console.warn('Redis não conectado. O painel segue com barramento local.', error);
  }
}

const app = await buildApp({ adapter, config, logger: true });
await app.listen({ host: config.host, port: config.port });

if (config.birthdayAutorun) {
  const tick = async () => {
    if (zonedParts().hour < 8) return;
    await runBirthdays({ adapter, config }, { id: 'scheduler', role: 'system' }).catch((error: unknown) => {
      app.log.error(error);
    });
  };
  setTimeout(() => void tick(), 3000);
  setInterval(() => void tick(), 15 * 60 * 1000);
}

if (config.demoMode) {
  // A senha e o segredo TOTP só vão para o log quando as dicas de demonstração estão ligadas (uso local).
  app.log.info(
    {
      seeded: seeded.seeded,
      metaMode: config.metaMode,
      admin: 'admin@pompeu.mg.gov.br',
      lancador: 'lancador@pompeu.mg.gov.br',
      atendente: 'atendente@pompeu.mg.gov.br',
      ...(config.demoHints ? { password: config.demoPassword, totpSecret: config.demoTotpSecret } : {}),
    },
    config.demoHints
      ? 'Modo demonstração ativo, com as dicas de acesso na tela de login. Em endereço público use DEMO_HINTS=false e segredos próprios.'
      : 'Modo demonstração ativo, sem dicas de acesso na tela de login.',
  );
}
