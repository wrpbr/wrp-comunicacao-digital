import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCount } from '@/lib/labels';

type Franchise = { used: number; capacity: number; ratio: number; blocked: boolean; reserveUsed: number; reserveSize: number; remaining: number };
type Beat = { unitSlug: string; name: string; online: boolean; lastHeartbeatAt: string | null };

/** Perfis que a API deixa consultar a franquia. Os demais não pedem esse indicador. */
const FRANCHISE_ROLES = ['admin', 'gestor', 'auditor'];

/** Atalhos do painel: cada perfil vê só a tarefa que a API deixa esse perfil fazer. */
const SHORTCUTS: { to: string; label: string; roles: string[] }[] = [
  { to: '/admin/poc', label: 'Rodar lote de 100 mensagens', roles: ['admin', 'gestor'] },
  { to: '/admin/filas', label: 'Chamar senha', roles: ['admin', 'gestor', 'atendente'] },
  { to: '/admin/filas', label: 'Emitir senha', roles: ['lancador_fila'] },
  { to: '/admin/chatwoot', label: 'Abrir o atendimento humano', roles: ['atendente'] },
  { to: '/admin/tv', label: 'Ver os painéis de TV', roles: ['lancador_fila'] },
  { to: '/admin/auditoria', label: 'Exportar auditoria', roles: ['admin', 'gestor', 'auditor'] },
  { to: '/admin/relatorios', label: 'Baixar relatórios', roles: ['auditor'] },
];

export function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const seesFranchise = FRANCHISE_ROLES.includes(role);
  const shortcuts = SHORTCUTS.filter((item) => item.roles.includes(role));
  const [franchise, setFranchise] = useState<Franchise | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ heartbeats: Beat[] }>('/api/v1/units')
      .then((units) => setBeats(units.heartbeats))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o painel.'));
    if (!seesFranchise) return;
    api<{ franchise: Franchise }>('/api/v1/franchise')
      .then((data) => setFranchise(data.franchise))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Não foi possível carregar a franquia.'));
  }, [seesFranchise]);

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Painel do dia</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {seesFranchise && !franchise && !error && <p className="text-sm">Carregando indicadores…</p>}
      {(franchise || !seesFranchise) && (
        <section className="grid gap-4 md:grid-cols-3">
          {franchise && (
            <>
              <article className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Franquia do mês</p>
                <p className="display mt-2 text-3xl">{formatCount(franchise.used)}<span className="text-lg text-muted-foreground">/{formatCount(franchise.capacity)}</span></p>
                <div className="mt-3 h-2 rounded-full bg-secondary">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, franchise.ratio * 100)}%` }} />
                </div>
                <p className="mt-2 text-sm">{franchise.blocked ? 'Campanhas regulares bloqueadas.' : `${formatCount(franchise.remaining)} mensagens restantes.`}</p>
              </article>
              <article className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Reserva técnica</p>
                <p className="display mt-2 text-3xl">{franchise.reserveUsed}/{franchise.reserveSize}</p>
                <p className="mt-2 text-sm">Usada só por alerta de urgência, fora da cota de 5.000.</p>
              </article>
            </>
          )}
          {shortcuts.length > 0 && (
            <article className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Atalhos da comissão</p>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                {shortcuts.map((item) => (
                  <Link key={item.label} to={item.to}>{item.label}</Link>
                ))}
              </div>
            </article>
          )}
        </section>
      )}
      <section>
        <h2 className="display text-2xl">Painéis de TV</h2>
        {beats.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Nenhum heartbeat ainda.</p>}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {beats.map((beat) => (
            <article key={beat.unitSlug} className="rounded-lg border border-border bg-card p-4">
              <p className="font-medium">{beat.name}</p>
              <p className="flex items-center gap-2 text-sm">
                <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${beat.online ? 'bg-emerald-600' : 'bg-stone-400'}`} />
                {beat.online ? 'No ar' : 'Sem sinal recente'}
              </p>
              <p className="text-xs text-muted-foreground">
                {beat.lastHeartbeatAt
                  ? `Último sinal: ${new Date(beat.lastHeartbeatAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
                  : 'Sem sinal do painel ainda'}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
