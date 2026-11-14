import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Unit = { slug: string; name: string; callNameMode: 'full' | 'reduced' };
type Ticket = { id: string; number: string; displayName: string; service: string; status: string };

export function QueuesPage() {
  const { user } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [slug, setSlug] = useState('unidade-centro-saude');
  const [name, setName] = useState('Maria Aparecida Silva');
  const [service, setService] = useState('Vacina');
  const [waiting, setWaiting] = useState<Ticket[]>([]);
  const [recent, setRecent] = useState<Ticket[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canCheck = user && ['admin', 'gestor', 'lancador_fila'].includes(user.role);
  const canCall = user && ['admin', 'gestor', 'atendente'].includes(user.role);

  async function load(next = slug) {
    const state = await api<{ waiting: Ticket[]; recentCalls: Ticket[] }>(`/api/v1/tv/${next}/state`);
    setWaiting(state.waiting);
    setRecent(state.recentCalls);
  }

  useEffect(() => {
    api<{ units: Unit[] }>('/api/v1/units')
      .then((data) => {
        setUnits(data.units);
        if (data.units[0]) setSlug(data.units[0].slug);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Falha ao ler unidades.'));
  }, []);

  useEffect(() => {
    if (slug) void load(slug).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Falha na fila.'));
  }, [slug]);

  const unit = units.find((item) => item.slug === slug);

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Fila da unidade</h1>
      <p className="text-sm text-muted-foreground">O lançador faz o check-in. O atendente chama pelo nome e pelo número. A outra unidade não vê esta senha.</p>
      <select className="h-10 rounded-md border border-input bg-card px-2" value={slug} onChange={(event) => setSlug(event.target.value)}>
        {units.map((item) => <option key={item.slug} value={item.slug}>{item.name} · nome {item.callNameMode === 'reduced' ? 'reduzido' : 'completo'}</option>)}
      </select>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Check-in</h2>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do cidadão" />
          <Input value={service} onChange={(event) => setService(event.target.value)} placeholder="Serviço" />
          <Button disabled={!canCheck} onClick={() => void api(`/api/v1/tv/${slug}/checkin`, { method: 'POST', body: JSON.stringify({ citizenName: name, service }) }).then(() => load()).then(() => setMessage('Senha emitida.')).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Check-in recusado.'))}>Emitir senha</Button>
          {!canCheck && <p className="text-xs text-muted-foreground">Seu perfil não emite senha.</p>}
        </section>
        <section className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Aguardando</h2>
          {waiting.length === 0 && <p className="text-sm text-muted-foreground">Fila vazia nesta unidade.</p>}
          {waiting.map((ticket) => (
            <div key={ticket.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{ticket.number} · {ticket.displayName} · {ticket.service}</span>
              <Button size="sm" disabled={!canCall} onClick={() => void api(`/api/v1/tv/${slug}/call`, { method: 'POST', body: JSON.stringify({ ticketId: ticket.id }) }).then(() => load()).then(() => setMessage(`Chamada ${ticket.number}`)).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Chamada recusada.'))}>Chamar</Button>
            </div>
          ))}
          <Button variant="secondary" disabled={!canCall || waiting.length === 0} onClick={() => void api(`/api/v1/tv/${slug}/call`, { method: 'POST', body: JSON.stringify({}) }).then(() => load()).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Chamada recusada.'))}>Chamar próxima</Button>
          {!canCall && <p className="text-xs text-muted-foreground">Seu perfil não chama senha.</p>}
        </section>
      </div>
      <section>
        <h2 className="font-medium">Últimas chamadas {unit ? `· ${unit.name}` : ''}</h2>
        {recent.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma chamada ainda.</p>}
        <ul className="mt-2 text-sm">{recent.map((ticket) => <li key={ticket.id}>{ticket.number} — {ticket.displayName}</li>)}</ul>
      </section>
      {message && <p className="text-sm">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
