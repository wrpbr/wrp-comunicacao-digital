import { makeConfig } from './config.js';
import { hashPassword } from './crypto.js';
import { MemoryAdapter } from './store/memory.js';
import { createPostgresAdapter } from './store/postgres.js';
import type { DocAdapter } from './store/types.js';
import { randomTotpSecret } from './totp.js';
import { encryptString } from './crypto.js';
import type { UserRecord } from './types.js';

const email = argument('--email') ?? 'admin@pompeu.mg.gov.br';
const name = argument('--name') ?? 'Administrador';
const password = argument('--password');
if (!password || password.length < 10) {
  console.error('Informe --password com pelo menos 10 caracteres.');
  process.exit(1);
}

const config = makeConfig(process.env, { demoMode: false, secretsKey: process.env.SECRETS_KEY, webhookSecret: process.env.WEBHOOK_SECRET });
const adapter: DocAdapter = config.databaseUrl ? await createPostgresAdapter(config.databaseUrl) : new MemoryAdapter();
const secret = randomTotpSecret();
const user: UserRecord = {
  id: `usr_${crypto.randomUUID()}`,
  name,
  email,
  role: 'admin',
  passwordHash: await hashPassword(password, config.passwordCost),
  totpEnabled: true,
  totpSecretCipher: encryptString(secret, config.secretsKey),
  active: true,
  createdAt: new Date().toISOString(),
};
await adapter.put('users', user.id, user);
console.log(`Admin criado: ${email}`);
console.log(`Segredo TOTP (guarde agora): ${secret}`);

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
