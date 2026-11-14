import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, download } from '@/lib/api';

export function ReportsPage() {
  const [error, setError] = useState('');

  // A recusa da API aparece na tela: sem lote rodado, por exemplo, ainda não há relatório de entrega.
  function get(path: string, filename: string) {
    setError('');
    void download(path, filename).catch((err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Não foi possível baixar o relatório.'),
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Relatórios</h1>
      <p className="text-sm text-muted-foreground">Consumo da franquia, disponibilidade dos painéis e a última entrega do lote POC.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <article className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Franquia mensal</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/franchise?format=pdf', 'franquia.pdf')}>PDF</Button>
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/franchise?format=csv', 'franquia.csv')}>CSV</Button>
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/franchise?format=json', 'franquia.json')}>JSON</Button>
          </div>
        </article>
        <article className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">SLA dos painéis</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/sla?format=pdf', 'sla.pdf')}>PDF</Button>
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/sla?format=csv', 'sla.csv')}>CSV</Button>
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/sla?format=json', 'sla.json')}>JSON</Button>
          </div>
        </article>
        <article className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Última entrega</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/delivery?format=pdf', 'entrega.pdf')}>PDF</Button>
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/delivery?format=csv', 'entrega.csv')}>CSV</Button>
            <Button size="sm" variant="outline" onClick={() => get('/api/v1/reports/delivery?format=json', 'entrega.json')}>JSON</Button>
          </div>
        </article>
      </div>
    </div>
  );
}
