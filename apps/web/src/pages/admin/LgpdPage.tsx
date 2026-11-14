import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import { optOutSourceLabel } from '@/lib/labels';

type Row = { id: string; phone: string; active: boolean; source: string; reason?: string; keyword?: string };

export function LgpdPage() {
  const [rows, setRows] = useState<Row[]>([]);
  // João Batista Ferreira, o cidadão do passo de cancelamento no roteiro da comissão.
  const [phone, setPhone] = useState('5537990001002');
  const [text, setText] = useState('PARAR');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const data = await api<{ optOuts: Row[] }>('/api/v1/opt-out');
    setRows(data.optOuts);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Sem acesso ao registro.'));
  }, []);

  async function simulate() {
    setError('');
    try {
      const data = await api<{ ok: boolean }>('/api/v1/webhooks/meta', {
        method: 'POST',
        body: JSON.stringify({ from: phone, text }),
      });
      setInfo(data.ok ? `Mensagem simulada de ${phone}: "${text}".` : 'Não processado.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Simulação recusada.');
    }
  }

  async function toggle(row: Row) {
    setError('');
    setInfo('');
    try {
      await api('/api/v1/opt-out', {
        method: 'POST',
        body: JSON.stringify({ phone: row.phone, active: !row.active, reason: 'Painel LGPD' }),
      });
      await load();
    } catch (err) {
      // A recusa por perfil (reativar é só do administrador e do gestor) aparece na tela.
      setError(err instanceof ApiError ? err.message : 'Alteração recusada.');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Opt-out e LGPD</h1>
      <p className="max-w-3xl text-sm leading-6">
        PARAR, SAIR e OPT-OUT bloqueiam campanhas e aniversários na hora. O atendimento que o cidadão iniciou continua.
        A exceção legal só entra se estiver marcada no cadastro e a campanha declarar a base. Leia a <Link to="/privacidade">política</Link>.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="lgpd-phone">Telefone do cidadão</Label>
          <Input id="lgpd-phone" inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} className="w-56" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lgpd-text">Texto recebido</Label>
          <Input id="lgpd-text" value={text} onChange={(event) => setText(event.target.value)} className="w-40" />
        </div>
        <Button onClick={() => void simulate()}>Simular WhatsApp recebido</Button>
      </div>
      {info && <p className="text-sm">{info}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum opt-out registrado.</p>}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-sm">
            <span>{row.phone} · {row.active ? 'bloqueado' : 'reativado'} · {optOutSourceLabel(row.source)}{row.keyword ? ` · ${row.keyword}` : ''}</span>
            <Button size="sm" variant="outline" onClick={() => void toggle(row)}>
              {row.active ? 'Reativar' : 'Bloquear'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
