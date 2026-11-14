import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api';

type Person = { id: string; name: string; cargo?: string; phone: string; bairro: string; optOut: boolean };

export function ServidoresPage() {
  const [rows, setRows] = useState<Person[]>([]);
  const [body, setBody] = useState('Servidores de Pompéu: este é um comunicado interno da administração. Responda PARAR se não quiser novos avisos deste canal.');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ citizens: Person[] }>('/api/v1/citizens?publico=servidor')
      .then((data) => setRows(data.citizens))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Falha ao listar servidores.'));
  }, []);

  async function send() {
    setError('');
    try {
      const data = await api<{ sent: number }>('/api/v1/servidores/broadcast', { method: 'POST', body: JSON.stringify({ body }) });
      setMessage(`Mensagens registradas: ${data.sent}. O canal direto entra na franquia porque é comunicação ativa do município.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não enviado.');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Canal dos servidores</h1>
      {rows.length === 0 && !error && <p className="text-sm">Carregando servidores…</p>}
      <ul className="grid gap-2 md:grid-cols-2">
        {rows.map((person) => (
          <li key={person.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <strong>{person.name}</strong>
            <div className="text-muted-foreground">{person.cargo} · {person.bairro} {person.optOut ? '· opt-out' : ''}</div>
          </li>
        ))}
      </ul>
      <Textarea value={body} onChange={(event) => setBody(event.target.value)} />
      <Button onClick={() => void send()}>Enviar aos servidores elegíveis</Button>
      {message && <p className="text-sm">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
