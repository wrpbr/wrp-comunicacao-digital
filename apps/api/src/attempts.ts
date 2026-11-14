import { HttpError } from './http.js';

/**
 * Freio de tentativas de login por conta, para a senha e para o código TOTP. Soma-se ao limite por endereço da
 * borda, que não segura quem tenta a mesma conta a partir de muitos endereços.
 *
 * Regra, pela NIST SP 800-63B-4, seção 3.2.2 (espera que cresce a cada falha, de 30 segundos a 1 hora; o acerto
 * zera a contagem): as quatro primeiras falhas em 24 horas não impõem espera; a quinta impõe 30 segundos, e cada
 * falha seguinte dobra a espera, até 1 hora. Durante a espera a conta recusa toda tentativa com 429, inclusive a
 * certa.
 *
 * O endereço que já concluiu um login na conta passa a ter contagem própria nela (a seção 3.2.2 cita o endereço
 * do usuário entre os sinais de risco). Assim, quem erra a senha de fora faz esperar os endereços desconhecidos,
 * e não o servidor que entra sempre da mesma rede.
 *
 * O estado fica na memória do processo: só existe para conta cadastrada e para endereço que já entrou nela, então
 * não cresce com as tentativas de um visitante. Reiniciar a API zera as contagens.
 */
export type AttemptKind = 'senha' | 'totp';

export type AttemptTicket = {
  /** A tentativa deu certo: zera a contagem em que ela entrou. */
  succeeded(): void;
};

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const WINDOW = 24 * HOUR;
const FREE_FAILURES = 4;
const FIRST_WAIT = 30 * SECOND;
const MAX_WAIT = HOUR;

type Bucket = { failures: number[]; releaseAt: number };

/** A espera escrita para a pessoa: segundos abaixo de um minuto, minutos abaixo de uma hora. */
export function waitInWords(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 segundo' : `${seconds} segundos`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
  return '1 hora';
}

export class LoginThrottle {
  private buckets = new Map<string, Bucket>();
  private knownOrigins = new Map<string, Set<string>>();

  constructor(private now: () => number = Date.now) {}

  /**
   * Admite a tentativa ou recusa com 429. A tentativa admitida já conta como falha, para que várias em paralelo
   * não passem todas antes de a primeira ser conferida; quem acerta chama `succeeded()`.
   */
  begin(kind: AttemptKind, userId: string, ip: string): AttemptTicket {
    const key = this.knownOrigins.get(userId)?.has(ip) ? `${kind}:${userId}:${ip}` : `${kind}:${userId}`;
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { failures: [], releaseAt: 0 };
    if (now < bucket.releaseAt) {
      const seconds = Math.ceil((bucket.releaseAt - now) / SECOND);
      throw new HttpError(
        429,
        `Muitas tentativas nesta conta. Aguarde ${waitInWords(seconds)} e tente de novo.`,
        'muitas_tentativas',
        seconds,
      );
    }
    bucket.failures = bucket.failures.filter((at) => at > now - WINDOW);
    bucket.failures.push(now);
    const beyondFree = bucket.failures.length - FREE_FAILURES;
    if (beyondFree > 0) bucket.releaseAt = now + Math.min(FIRST_WAIT * 2 ** (beyondFree - 1), MAX_WAIT);
    this.buckets.set(key, bucket);
    return {
      succeeded: () => {
        this.buckets.delete(key);
      },
    };
  }

  /** Login concluído: daqui em diante este endereço tem contagem própria nesta conta. */
  trust(userId: string, ip: string): void {
    if (!ip) return;
    const origins = this.knownOrigins.get(userId) ?? new Set<string>();
    origins.add(ip);
    this.knownOrigins.set(userId, origins);
  }
}
