import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { roleLabel } from '@/lib/labels';

type Hints = { password: string; accounts: { email: string; role: string; name: string; totp: boolean }[] };
type Demo = { secret: string; currentCode: string; qrDataUrl: string; note: string };

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [hints, setHints] = useState<Hints | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    api<Hints>('/api/v1/auth/demo-hints')
      .then((data) => {
        setHints(data);
        setPassword(data.password);
        setEmail(data.accounts[0]?.email ?? '');
      })
      .catch(() => setHints(null));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await auth.login(email, password);
      if (result.totpRequired && result.challengeToken) {
        setChallenge(result.challengeToken);
        setDemo(result.demo ?? null);
        setCode(result.demo?.currentCode ?? '');
      } else navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setBusy(false);
    }
  }

  async function onTotp(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError('');
    try {
      await auth.confirmTotp(challenge, code);
      navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código recusado');
    } finally {
      setBusy(false);
    }
  }

  async function refreshCode() {
    if (!challenge) return;
    const data = await api<{ currentCode: string }>('/api/v1/auth/demo-totp', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: challenge }),
    });
    setCode(data.currentCode);
    setDemo((current) => (current ? { ...current, currentCode: data.currentCode } : current));
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden bg-[#102033] p-10 text-[#f6f1e8] md:block">
        <p className="text-xs uppercase tracking-[0.2em] text-[#c4a46a]">Pompéu/MG · Processo 243/2026</p>
        <h1 className="display mt-4 text-5xl">Sala de despacho</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-white/75">
          Administrador e gestor confirmam o acesso com o código do aplicativo autenticador (TOTP).
          Atendente, lançador de fila e auditor entram com senha.
          {hints && ' O modo demonstração mostra o código só depois da senha correta.'}
        </p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={challenge ? onTotp : onSubmit} className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h2 className="display text-3xl">{challenge ? 'Confirme o 2FA' : 'Entrar'}</h2>
            <p className="text-sm text-muted-foreground">WRP Comunicação Digital</p>
          </div>
          {hints && !challenge && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-accent">Contas de demonstração</p>
              <div className="flex flex-wrap gap-2">
                {hints.accounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs ${account.email === email ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
                    aria-pressed={account.email === email}
                    onClick={() => setEmail(account.email)}
                  >
                    {roleLabel(account.role)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!challenge && (
            <>
              <div className="space-y-1">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
              </div>
            </>
          )}
          {challenge && (
            <>
              <div className="space-y-1">
                <Label htmlFor="code">Código de 6 dígitos</Label>
                <Input id="code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} />
              </div>
              {demo && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium">Modo demonstração</p>
                  <p className="mt-1">{demo.note}</p>
                  <p className="mt-2">Segredo: <code>{demo.secret}</code></p>
                  <p>Código atual: <strong>{demo.currentCode}</strong></p>
                  <img src={demo.qrDataUrl} alt="QR Code do autenticador de demonstração" className="mt-2 h-36 w-36 bg-white p-1" />
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void refreshCode()}>Atualizar código</Button>
                </div>
              )}
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Aguarde…' : challenge ? 'Confirmar' : 'Continuar'}</Button>
          <Link to="/" className="block text-center text-sm text-muted-foreground">Voltar</Link>
        </form>
      </section>
    </div>
  );
}
