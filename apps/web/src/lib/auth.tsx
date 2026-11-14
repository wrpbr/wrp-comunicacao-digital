import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, setToken, token } from '@/lib/api';

export type SessionUser = { id: string; name: string; email: string; role: string; totpEnabled?: boolean };

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ totpRequired: boolean; challengeToken?: string; demo?: DemoTotp }>;
  confirmTotp: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

type DemoTotp = { secret: string; currentCode: string; qrDataUrl: string; note: string };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token()) {
      setLoading(false);
      return;
    }
    api<{ user: SessionUser }>('/api/v1/auth/me')
      .then((data) => setUser(data.user))
      .catch((error: unknown) => {
        // Só a recusa da API encerra a sessão. Falha de rede ou limite de taxa ao abrir a página não
        // apaga o token: ao recarregar com a rede de volta, a pessoa continua dentro.
        if (error instanceof ApiError && error.status === 401) setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api<{
      totpRequired: boolean;
      token?: string;
      user?: SessionUser;
      challengeToken?: string;
      demo?: DemoTotp;
    }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!data.totpRequired && data.token && data.user) {
      setToken(data.token);
      setUser(data.user);
    }
    return { totpRequired: data.totpRequired, challengeToken: data.challengeToken, demo: data.demo };
  };

  const confirmTotp = async (challengeToken: string, code: string) => {
    const data = await api<{ token: string; user: SessionUser }>('/api/v1/auth/totp', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code }),
    });
    setToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    await api('/api/v1/auth/session', { method: 'DELETE' }).catch(() => undefined);
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, confirmTotp, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Auth ausente');
  return value;
}
