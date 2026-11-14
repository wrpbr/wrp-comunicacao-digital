import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api, download } from '@/lib/api';
import { formatCount, roleLabel } from '@/lib/labels';

/** Linhas que a tela mostra; a exportação não tem esse corte. */
const SHOWN = 80;

type Log = {
  id: string;
  timestampUtc: string;
  timestampSaoPaulo: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  targetEntity: string;
  targetId: string;
  recipient: string;
  deliveryStatus: string;
  ipAddress: string;
};

export function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [checksum, setChecksum] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (q) params.set('q', q);
    try {
      const data = await api<{ total: number; logs: Log[] }>(`/api/v1/audit-logs?${params.toString()}`);
      setLogs(data.logs);
      setTotal(data.total);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auditoria indisponível para este perfil.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Trilha de auditoria</h1>
      <p className="text-sm text-muted-foreground">
        Cada linha traz data e hora de Brasília e em UTC, o usuário, a ação, o registro afetado, o destinatário, o status de envio e entrega e o IP.
        A exportação devolve o SHA-256 do arquivo no cabeçalho X-Export-Checksum.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Ação" value={action} onChange={(event) => setAction(event.target.value)} className="max-w-[12rem]" />
        <Input placeholder="Busca" value={q} onChange={(event) => setQ(event.target.value)} className="max-w-xs" />
        <Button variant="outline" onClick={() => void load()}>Filtrar</Button>
        <Button onClick={() => void download('/api/v1/audit-logs/export?format=csv', 'auditoria-pompeu.csv').then((value) => setChecksum(value ?? ''))}>CSV</Button>
        <Button variant="secondary" onClick={() => void download('/api/v1/audit-logs/export?format=json', 'auditoria-pompeu.json').then((value) => setChecksum(value ?? ''))}>JSON</Button>
      </div>
      {checksum && <p className="break-all text-xs">SHA-256: {checksum}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm">Lendo a trilha…</p>}
      {!loading && logs.length === 0 && <p className="text-sm">Nenhum evento com esse filtro.</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[920px] text-left text-xs">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="p-2">Brasília</th>
              <th className="p-2">UTC</th>
              <th className="p-2">Usuário</th>
              <th className="p-2">Ação</th>
              <th className="p-2">Registro afetado</th>
              <th className="p-2">Destinatário</th>
              <th className="p-2">Status</th>
              <th className="p-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, SHOWN).map((log) => (
              <tr key={log.id} className="border-b border-border/60 align-top">
                <td className="whitespace-nowrap p-2">{log.timestampSaoPaulo.slice(0, 19).replace('T', ' ')}</td>
                <td className="whitespace-nowrap p-2">{log.timestampUtc.slice(11, 19)}</td>
                <td className="p-2">
                  {log.actorUserId}
                  <div className="text-muted-foreground">{roleLabel(log.actorRole)}</div>
                </td>
                <td className="p-2">{log.action}</td>
                <td className="p-2">
                  {log.targetEntity}
                  <div className="break-all text-muted-foreground">{log.targetId}</div>
                </td>
                <td className="p-2">{log.recipient}</td>
                <td className="p-2">{log.deliveryStatus}</td>
                <td className="whitespace-nowrap p-2">{log.ipAddress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > SHOWN && (
        <p className="text-xs text-muted-foreground">
          A tela mostra os {SHOWN} eventos mais recentes de {formatCount(total)} com este filtro. O CSV e o JSON trazem a trilha inteira.
        </p>
      )}
    </div>
  );
}
