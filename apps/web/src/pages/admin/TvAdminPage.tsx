import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DISPLAY_MODES } from '@/lib/labels';

type Unit = { slug: string; name: string; displayMode: string; callNameMode: string; openNow: boolean };
type Beat = { unitSlug: string; name: string; online: boolean; lastHeartbeatAt: string | null; ageMs: number | null };

export function TvAdminPage() {
  const { user } = useAuth();
  // A API só deixa administrador e gestor mudar o que o painel mostra e abrir a chave dele.
  const canManage = Boolean(user && ['admin', 'gestor'].includes(user.role));
  const [units, setUnits] = useState<Unit[]>([]);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  async function load() {
    const data = await api<{ units: Unit[]; heartbeats: Beat[] }>('/api/v1/units');
    setUnits(data.units);
    setBeats(data.heartbeats);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Falha ao ler os painéis.'));
    const timer = setInterval(() => void load().catch(() => undefined), 10000);
    return () => clearInterval(timer);
  }, []);

  async function openPanel(slug: string) {
    try {
      const data = await api<{ path: string }>(`/api/v1/tv/${slug}/display-token`);
      setLinks((current) => ({ ...current, [slug]: data.path }));
      window.open(data.path, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Este perfil não abre a chave do painel.');
    }
  }

  async function mode(slug: string, displayMode: string) {
    try {
      await api(`/api/v1/units/${slug}`, { method: 'PUT', body: JSON.stringify({ displayMode }) });
      setError('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível mudar o que o painel mostra.');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Painéis Full HD</h1>
      <p className="text-sm text-muted-foreground">O player é uma página 1920×1080 no navegador. A unidade fica “No ar” enquanto o painel tiver falado com a API nos últimos 45 segundos.</p>
      {!canManage && <p className="text-sm text-muted-foreground">Seu perfil acompanha os painéis. Mudar o que a TV mostra e abrir o painel é do administrador e do gestor.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {units.map((unit) => {
          const beat = beats.find((item) => item.unitSlug === unit.slug);
          return (
            <article key={unit.slug} className="space-y-2 rounded-lg border border-border bg-card p-4">
              <h2 className="font-medium">{unit.name}</h2>
              <p className="flex items-center gap-2 text-sm">
                <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${beat?.online ? 'bg-emerald-600' : 'bg-stone-400'}`} />
                {beat?.online ? 'No ar' : 'Offline ou ainda não aberto'}
              </p>
              <p className="text-xs text-muted-foreground">
                {beat?.lastHeartbeatAt
                  ? `Último sinal: ${new Date(beat.lastHeartbeatAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
                  : 'Sem sinal do painel ainda'}
              </p>
              <p className="text-xs">Nome {unit.callNameMode === 'reduced' ? 'reduzido' : 'completo'} · expediente {unit.openNow ? 'aberto' : 'fechado'}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`O que o painel de ${unit.name} mostra`}>
                {DISPLAY_MODES.map((item) => (
                  <Button
                    key={item.value}
                    size="sm"
                    variant={unit.displayMode === item.value ? 'default' : 'outline'}
                    aria-pressed={unit.displayMode === item.value}
                    disabled={!canManage}
                    onClick={() => void mode(unit.slug, item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <Button disabled={!canManage} onClick={() => void openPanel(unit.slug)}>Abrir painel</Button>
              {links[unit.slug] && <Link className="block text-xs" to={links[unit.slug]}>{links[unit.slug]}</Link>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
