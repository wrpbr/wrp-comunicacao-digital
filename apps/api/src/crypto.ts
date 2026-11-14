import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function scryptAsync(password: string, salt: string, keylen: number, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { cost }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function masterKey(secret: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, 'hex');
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptString(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptString(payload: string, secret: string): string {
  const [ivB, tagB, dataB] = payload.split('.');
  if (!ivB || !tagB || !dataB) throw new Error('ciphertext inválido');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(secret), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]);
  return plain.toString('utf8');
}

export async function hashPassword(password: string, cost = 16384): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64, cost);
  return `scrypt$${cost}$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, costRaw, salt, hex] = stored.split('$');
  if (algo !== 'scrypt' || !costRaw || !salt || !hex) return false;
  const cost = Number(costRaw);
  const key = await scryptAsync(password, salt, 64, cost);
  const expected = Buffer.from(hex, 'hex');
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, Buffer.alloc(ba.length));
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function signChallenge(userId: string, exp: number, secret: string): string {
  const data = `${userId}.${exp}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function readChallenge(token: string, secret: string, now = Date.now()): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expRaw, sig] = parts;
  if (!userId || !expRaw || !sig) return null;
  const data = `${userId}.${expRaw}`;
  const expected = createHmac('sha256', secret).update(data).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  if (Number(expRaw) < now) return null;
  return userId;
}

export function metaSignature(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/**
 * Assinatura que o Chatwoot envia em `X-Chatwoot-Signature`: HMAC-SHA256 do segredo do webhook
 * sobre `<X-Chatwoot-Timestamp>.<corpo bruto>`.
 */
export function chatwootSignature(timestamp: string, rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}
