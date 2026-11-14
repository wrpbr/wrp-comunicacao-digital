import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { alertLevelLabel, formatCount } from '@/lib/labels';

type Franchise = {
  used: number;
  capacity: number;
  ratio: number;
  blocked: boolean;
  remaining: number;
  reserveUsed: number;
  reserveSize: number;
  packsAuthorized: number;
  contractualMonthly: number;
  allowanceOverride?: number;
  allowanceOverrideReason?: string;
};
type Alert = { id: string; level: string; message: string; createdAt: string };

export function FranchisePage() {
  const [franchise, setFranchise] = useState<Franchise | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function load() {
    const data = await api<{ franchise: Franchise; alerts: Alert[] }>('/api/v1/franchise');
    setFranchise(data.franchise);
    setAlerts(data.alerts);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Falha na franquia.'));
  }, []);

  async function act(path: string, body: unknown) {
    setError('');
    setInfo('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      setInfo('Registrado na auditoria.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ação recusada.');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Franquia e reserva</h1>
      {!franchise && !error && <p className="text-sm">Carregando contador…</p>}
      {franchise && (
        <section className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm">Cota contratual: {formatCount(franchise.contractualMonthly)} · pacotes autorizados: {franchise.packsAuthorized} × 100 · capacidade deste mês: {formatCount(franchise.capacity)}</p>
          <p className="display mt-2 text-4xl">{formatCount(franchise.used)} <span className="text-xl">/ {formatCount(franchise.capacity)}</span></p>
          <p className="mt-2 text-sm">{franchise.blocked ? 'Campanhas regulares bloqueadas até um pacote de 100.' : `${formatCount(franchise.remaining)} mensagens regulares ainda cabem.`}</p>
          <p className="text-sm">Reserva técnica: {formatCount(franchise.reserveUsed)}/{formatCount(franchise.reserveSize)}. Urgência não consome a cota de campanha.</p>
          {franchise.allowanceOverride && <p className="mt-2 text-sm text-amber-800">Cota de demonstração: {formatCount(franchise.allowanceOverride)}. {franchise.allowanceOverrideReason}</p>}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void act('/api/v1/franchise/packs', { count: 1 })}>Autorizar pacote de 100</Button>
        <Button variant="outline" onClick={() => void act('/api/v1/franchise/demo-scenario', { preset: 'eighty' })}>Simular 80%</Button>
        <Button variant="outline" onClick={() => void act('/api/v1/franchise/demo-scenario', { preset: 'full' })}>Simular 100%</Button>
        <Button variant="secondary" onClick={() => void act('/api/v1/franchise/demo-scenario', { preset: 'reset' })}>Restaurar cota de 5.000</Button>
      </div>
      <p className="text-xs text-muted-foreground">Os cenários de 80% e 100% só existem com DEMO_MODE e ficam marcados na auditoria. A cota do contrato continua 5.000.</p>
      {info && <p className="text-sm">{info}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <section>
        <h2 className="display text-2xl">Alertas</h2>
        {alerts.length === 0 && <p className="text-sm text-muted-foreground">Nenhum alerta de franquia neste mês.</p>}
        <ul className="mt-2 space-y-2">
          {alerts.map((alert) => (
            <li key={alert.id} className="rounded-md border border-border bg-card p-3 text-sm">
              <strong>{alertLevelLabel(alert.level)}</strong> · {new Date(alert.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
              <div>{alert.message}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
