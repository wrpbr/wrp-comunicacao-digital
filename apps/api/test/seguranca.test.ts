import { describe, expect, it } from 'vitest';
import { LoginThrottle, waitInWords } from '../src/attempts.js';
import { DEMO_TOTP_SECRET } from '../src/config.js';
import { HttpError } from '../src/http.js';
import { currentTotp } from '../src/totp.js';
import { auth, createTestApp, login } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'Pompeu#089';

/** Segundos de espera que o freio impõe agora, ou 0 quando a tentativa é admitida (e passa a contar como falha). */
function waitOf(throttle: LoginThrottle, userId: string, ip: string): number {
  try {
    throttle.begin('senha', userId, ip);
    return 0;
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return error.retryAfter ?? 0;
    throw error;
  }
}

describe('freio de tentativas por conta', () => {
  it('libera quatro falhas e, da quinta em diante, dobra a espera de 30 segundos até 1 hora', () => {
    let now = 1_700_000_000_000;
    const throttle = new LoginThrottle(() => now);
    for (let failure = 1; failure <= 4; failure += 1) expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(0);
    const waits: number[] = [];
    for (let failure = 5; failure <= 13; failure += 1) {
      expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(0);
      const wait = waitOf(throttle, 'u1', '198.51.100.1');
      waits.push(wait);
      // Um segundo antes do fim da espera a conta ainda recusa.
      now += (wait - 1) * 1000;
      expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(1);
      now += 1000;
    }
    expect(waits).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600]);
    // Outra conta não herda a espera.
    expect(waitOf(throttle, 'u2', '198.51.100.1')).toBe(0);
    // Falha com mais de 24 horas deixa de contar.
    now += DAY + 1000;
    for (let failure = 1; failure <= 4; failure += 1) expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(0);
    expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(0);
    expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(30);
  });

  it('o acerto zera a contagem, e a senha e o código contam em separado', () => {
    const throttle = new LoginThrottle(() => 1_700_000_000_000);
    for (let failure = 1; failure <= 4; failure += 1) throttle.begin('senha', 'u1', '198.51.100.1');
    throttle.begin('senha', 'u1', '198.51.100.1').succeeded();
    for (let failure = 1; failure <= 4; failure += 1) expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(0);
    // A quinta falha de senha já impôs espera; o código TOTP da mesma conta segue livre.
    expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(0);
    expect(waitOf(throttle, 'u1', '198.51.100.1')).toBe(30);
    expect(() => throttle.begin('totp', 'u1', '198.51.100.1')).not.toThrow();
  });

  it('quem erra de fora não faz esperar o endereço que já entrou na conta', () => {
    const throttle = new LoginThrottle(() => 1_700_000_000_000);
    throttle.trust('u1', '203.0.113.10');
    for (let failure = 1; failure <= 5; failure += 1) expect(waitOf(throttle, 'u1', '198.51.100.66')).toBe(0);
    expect(waitOf(throttle, 'u1', '198.51.100.66')).toBe(30);
    // Outro endereço desconhecido cai na mesma contagem da conta.
    expect(waitOf(throttle, 'u1', '198.51.100.67')).toBe(30);
    // O endereço conhecido tem contagem própria, com o mesmo freio.
    for (let failure = 1; failure <= 5; failure += 1) expect(waitOf(throttle, 'u1', '203.0.113.10')).toBe(0);
    expect(waitOf(throttle, 'u1', '203.0.113.10')).toBe(30);
  });

  it('escreve a espera em segundos, minutos ou 1 hora', () => {
    expect([1, 30, 60, 61, 1920, 3600].map(waitInWords)).toEqual([
      '1 segundo',
      '30 segundos',
      '1 minuto',
      '2 minutos',
      '32 minutos',
      '1 hora',
    ]);
  });
});

describe('login com freio por conta', () => {
  it('recusa a senha certa durante a espera e volta a aceitar depois dela', async () => {
    let now = 1_700_000_000_000;
    const { app } = await createTestApp({}, { now: () => now });
    const attempt = (password: string, remoteAddress = '198.51.100.20') =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress,
        payload: { email: 'atendente@pompeu.mg.gov.br', password },
      });
    for (let failure = 1; failure <= 5; failure += 1) expect((await attempt('senha-errada')).statusCode).toBe(401);
    const blocked = await attempt(PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('30');
    expect(blocked.json()).toEqual({
      error: 'muitas_tentativas',
      message: 'Muitas tentativas nesta conta. Aguarde 30 segundos e tente de novo.',
    });
    // A mesma conta, de outro endereço desconhecido, espera igual: o freio é da conta, não do endereço.
    expect((await attempt(PASSWORD, '198.51.100.21')).statusCode).toBe(429);
    // Conta que não errou segue entrando.
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '198.51.100.20',
      payload: { email: 'auditor@pompeu.mg.gov.br', password: PASSWORD },
    });
    expect(other.statusCode).toBe(200);
    now += 30_000;
    const entered = await attempt(PASSWORD);
    expect(entered.statusCode).toBe(200);
    expect(entered.json().token).toBeTruthy();
    // O acerto zerou a contagem: quatro falhas novas não impõem espera.
    for (let failure = 1; failure <= 4; failure += 1) expect((await attempt('senha-errada')).statusCode).toBe(401);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
    await app.close();
  });

  it('quem erra a senha de fora não tranca o endereço que já entrou', async () => {
    const { app } = await createTestApp({}, { now: () => 1_700_000_000_000 });
    const attempt = (password: string, remoteAddress: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress,
        payload: { email: 'atendente@pompeu.mg.gov.br', password },
      });
    expect((await attempt(PASSWORD, '203.0.113.10')).statusCode).toBe(200);
    for (let failure = 1; failure <= 5; failure += 1) {
      expect((await attempt('senha-errada', '198.51.100.66')).statusCode).toBe(401);
    }
    expect((await attempt(PASSWORD, '198.51.100.66')).statusCode).toBe(429);
    expect((await attempt(PASSWORD, '203.0.113.10')).statusCode).toBe(200);
    await app.close();
  });

  it('freia o código TOTP por conta, mesmo com desafio novo a cada tentativa', async () => {
    let now = 1_700_000_000_000;
    const { app } = await createTestApp({}, { now: () => now });
    const challenge = async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '198.51.100.30',
        payload: { email: 'admin@pompeu.mg.gov.br', password: PASSWORD },
      });
      expect(first.statusCode).toBe(200);
      return first.json().challengeToken as string;
    };
    const code = async (value: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/totp',
        remoteAddress: '198.51.100.30',
        payload: { challengeToken: await challenge(), code: value },
      });
    for (let failure = 1; failure <= 5; failure += 1) expect((await code('000000')).statusCode).toBe(401);
    const blocked = await code(currentTotp(DEMO_TOTP_SECRET));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('30');
    expect(blocked.json().error).toBe('muitas_tentativas');
    now += 30_000;
    const entered = await code(currentTotp(DEMO_TOTP_SECRET));
    expect(entered.statusCode).toBe(200);
    expect(entered.json().user.role).toBe('admin');
    await app.close();
  });
});

describe('opt-out pela API', () => {
  it('exige sessão de quem atende o cidadão; reverter é só de administrador e gestor', async () => {
    const { app } = await createTestApp();
    const phone = '5537990001002';
    const post = (headers: Record<string, string>, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/v1/opt-out', headers, payload });
    const anonymous = await post({}, { phone });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error).toBe('nao_autenticado');
    const admin = await login(app, 'admin@pompeu.mg.gov.br');
    const listed = async () =>
      (await app.inject({ method: 'GET', url: '/api/v1/opt-out', headers: auth(admin) })).json().optOuts as {
        phone: string;
        active: boolean;
        source: string;
      }[];
    // A chamada sem sessão não gravou nada.
    expect((await listed()).some((row) => row.phone === phone)).toBe(false);
    for (const email of ['lancador@pompeu.mg.gov.br', 'auditor@pompeu.mg.gov.br']) {
      const refused = await post(auth(await login(app, email)), { phone });
      expect(refused.statusCode).toBe(403);
    }
    expect((await listed()).some((row) => row.phone === phone)).toBe(false);
    const atendente = auth(await login(app, 'atendente@pompeu.mg.gov.br'));
    const registered = await post(atendente, { phone, reason: 'Pedido no balcão' });
    expect(registered.statusCode).toBe(200);
    expect(registered.json().optOut).toMatchObject({ phone, active: true, source: 'admin' });
    expect((await post(atendente, { phone, active: false })).statusCode).toBe(403);
    expect((await listed()).find((row) => row.phone === phone)?.active).toBe(true);
    const gestor = auth(await login(app, 'gestor@pompeu.mg.gov.br'));
    const reverted = await post(gestor, { phone, active: false });
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json().optOut.active).toBe(false);
    await app.close();
  });
});
