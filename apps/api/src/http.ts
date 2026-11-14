export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    /** Espera em segundos, enviada no cabeçalho `Retry-After`. */
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function assert(condition: unknown, status: number, message: string, code: string): asserts condition {
  if (!condition) throw new HttpError(status, message, code);
}
