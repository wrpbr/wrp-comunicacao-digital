import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, api, download } from '@/lib/api';
import { deliveryLabel, formatCount, probeLabel } from '@/lib/labels';

type Report = {
  id: string;
  attempted: number;
  counted: number;
  excluded: number;
  byStatus: Record<string, number>;
  franchiseBefore: number;
  franchiseAfter: number;
  probes: { kind: string; counted: boolean; franchiseDelta: number; detail: string }[];
  segmentSummary: string;
};

export function PocPage() {
  const [pattern, setPattern] = useState<'random' | 'pattern'>('random');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ report: Report }>('/api/v1/campaigns/test-batch', {
        method: 'POST',
        body: JSON.stringify({ pattern }),
      });
      setReport(data.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'O lote não rodou.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Lote de 100 mensagens</h1>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Dispara 100 mensagens segmentadas entre Centro, São José e Várzea. No simulador, a Graph API devolve sent, delivered, read ou failed.
        Recusa da Meta sai da franquia. Três sondas provam que inbound, recusa e resposta humana em 24 horas não contam.
      </p>
      <label className="block text-sm">
        Padrão do simulador
        <select className="mt-1 h-10 rounded-md border border-input bg-card px-2" value={pattern} onChange={(event) => setPattern(event.target.value as 'random' | 'pattern')}>
          <option value="random">Aleatório, parecido com a Meta</option>
          <option value="pattern">Determinístico, para a comissão repetir o número</option>
        </select>
      </label>
      <Button disabled={busy} onClick={() => void run()}>{busy ? 'Enviando 100…' : 'Executar lote POC'}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!report && !busy && <p className="text-sm text-muted-foreground">Nenhum lote nesta sessão do navegador. O último relatório continua disponível em Relatórios.</p>}
      {report && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm">{report.segmentSummary}</p>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            {Object.entries(report.byStatus).map(([status, count]) => (
              <div key={status} className="rounded-md bg-secondary p-2"><div className="text-xs">{deliveryLabel(status)}</div><div className="text-2xl">{count}</div></div>
            ))}
          </div>
          <p className="text-sm">Tentativas {report.attempted}. Contabilizadas {report.counted}. Excluídas {report.excluded}. Franquia {formatCount(report.franchiseBefore)} → {formatCount(report.franchiseAfter)}.</p>
          <ul className="space-y-1 text-sm">
            {report.probes.map((probe) => (
              <li key={probe.kind}><strong>{probeLabel(probe.kind)}</strong>: variação na franquia {probe.franchiseDelta}. {probe.detail}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void download(`/api/v1/reports/delivery?reportId=${report.id}&format=pdf`, `${report.id}.pdf`)}>PDF</Button>
            <Button variant="outline" onClick={() => void download(`/api/v1/reports/delivery?reportId=${report.id}&format=csv`, `${report.id}.csv`)}>CSV</Button>
            <Button variant="outline" onClick={() => void download(`/api/v1/reports/delivery?reportId=${report.id}&format=json`, `${report.id}.json`)}>JSON</Button>
          </div>
        </section>
      )}
    </div>
  );
}
