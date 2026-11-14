import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Status = {
  online: boolean;
  url: string;
  webchatUrl?: string;
  webhook: string;
  humanOnly: boolean;
  sectors: { slug: string; inbox: string; openNow: boolean }[];
};
type Reply = { id: string; sector: string; shortCode: string; content: string };

export function ChatwootPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<Status>('/api/v1/chatwoot/status'), api<{ replies: Reply[] }>('/api/v1/canned-replies')])
      .then(([nextStatus, canned]) => {
        setStatus(nextStatus);
        setReplies(canned.replies);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Chatwoot indisponível na consulta.'));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Inbox humano</h1>
      <p className="max-w-3xl text-sm leading-6">
        O Chatwoot Community Edition recebe o cidadão. Não há robô de IA. Fora do expediente, a resposta é um texto fixo dentro da janela de 24 horas da Meta.
        Transferir a conversa preserva o histórico e avisa o cidadão quando a janela ainda está aberta.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!status && !error && <p className="text-sm">Consultando o Chatwoot…</p>}
      {status && (
        <section className="rounded-lg border border-border bg-card p-4 text-sm">
          <p>{status.online ? 'Chatwoot respondeu.' : 'Chatwoot não está neste processo. Suba com docker compose para o inbox.'}</p>
          <p className="mt-1">Endereço: {status.url}</p>
          <p>Webhook desta API: {status.webhook}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="rounded-md bg-primary px-3 py-2 text-primary-foreground" href={status.url} target="_blank" rel="noreferrer">
              Abrir o Chatwoot (servidor público)
            </a>
            {status.webchatUrl && (
              <a className="rounded-md border border-border px-3 py-2" href={status.webchatUrl} target="_blank" rel="noreferrer">
                Abrir o webchat (visão do cidadão)
              </a>
            )}
          </div>
          <ul className="mt-3 space-y-1">
            {status.sectors.map((sector) => (
              <li key={sector.slug}>{sector.inbox}: {sector.openNow ? 'expediente aberto' : 'fora do expediente, só o texto fixo'}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="display text-2xl">Respostas prontas</h2>
        {replies.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma resposta cadastrada.</p>}
        <ul className="mt-2 space-y-2">
          {replies.map((reply) => (
            <li key={reply.id} className="rounded-md border border-border bg-card p-3 text-sm">
              <strong>{reply.sector}</strong> · {reply.shortCode}
              <p>{reply.content}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
