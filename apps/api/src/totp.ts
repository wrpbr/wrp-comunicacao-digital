import { authenticator } from 'otplib';
import QRCode from 'qrcode';

authenticator.options = { window: 1, step: 30 };

export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  return authenticator.verify({ token: token.replace(/\s+/g, ''), secret });
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'WRP Pompéu', secret);
}

export async function totpQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(totpUri(email, secret), { margin: 1, width: 240 });
}

export function randomTotpSecret(): string {
  return authenticator.generateSecret();
}
