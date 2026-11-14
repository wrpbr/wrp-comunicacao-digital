export class ApiError extends Error {
  status: number;
  payload: { error?: string; message?: string } | null;

  constructor(status: number, payload: { error?: string; message?: string } | null) {
    super(payload?.message || 'Falha na API');
    this.status = status;
    this.payload = payload;
  }
}

export function token() {
  return sessionStorage.getItem('wrp_token') ?? '';
}

export function setToken(value: string | null) {
  if (value) sessionStorage.setItem('wrp_token', value);
  else sessionStorage.removeItem('wrp_token');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const current = token();
  if (current) headers.set('Authorization', `Bearer ${current}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : (null as T);
  if (!response.ok) throw new ApiError(response.status, data as { error?: string; message?: string } | null);
  return data;
}

export async function download(path: string, filename: string) {
  const headers = new Headers();
  if (token()) headers.set('Authorization', `Bearer ${token()}`);
  const response = await fetch(path, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text ? (JSON.parse(text) as { message?: string }) : null);
  }
  const checksum = response.headers.get('X-Export-Checksum');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return checksum;
}
