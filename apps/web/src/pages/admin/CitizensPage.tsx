import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { INTERESTS, audienceLabel, tagLabel } from '@/lib/labels';

type Citizen = {
  id: string;
  name: string;
  phone: string;
  bairro: string;
  interesses: string[];
  predioPublico: string;
  publico: string;
  optOut: boolean;
  legalException: boolean;
  birthDate: string;
};

export function CitizensPage() {
  const [rows, setRows] = useState<Citizen[]>([]);
  const [bairro, setBairro] = useState('');
  const [interesse, setInteresse] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (bairro) params.set('bairro', bairro);
    if (interesse) params.set('interesse', interesse);
    try {
      const data = await api<{ citizens: Citizen[] }>(`/api/v1/citizens?${params.toString()}`);
      setRows(data.citizens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao listar cidadãos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(person: Citizen) {
    try {
      await api('/api/v1/opt-out', {
        method: 'POST',
        body: JSON.stringify({ phone: person.phone, active: !person.optOut, reason: 'Alternância no painel' }),
      });
      await load();
    } catch (err) {
      // A recusa por perfil (reativar é só do administrador e do gestor) aparece na tela.
      setError(err instanceof ApiError ? err.message : 'Não foi possível alterar o opt-out.');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Cadastro de demonstração</h1>
      <p className="text-sm text-muted-foreground">Nomes e telefones são fictícios, com bairros reais de Pompéu: Centro, São José e Várzea.</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void load();
        }}
      >
        <Input placeholder="Nome ou telefone" value={q} onChange={(event) => setQ(event.target.value)} className="max-w-xs" />
        <Input placeholder="Bairro" value={bairro} onChange={(event) => setBairro(event.target.value)} className="max-w-[10rem]" />
        <select
          aria-label="Interesse"
          className="h-10 rounded-md border border-input bg-card px-2 text-sm"
          value={interesse}
          onChange={(event) => setInteresse(event.target.value)}
        >
          <option value="">Todos os interesses</option>
          {INTERESTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <Button type="submit">Filtrar</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm">Carregando cadastro…</p>}
      {!loading && rows.length === 0 && <p className="text-sm">Nenhum registro com esse filtro.</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Nome</th>
              <th>Bairro</th>
              <th>Interesse</th>
              <th>Prédio</th>
              <th>Opt-out</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id} className="border-b border-border/70">
                <td className="p-3">
                  <div className="font-medium">{person.name}</div>
                  <div className="text-xs text-muted-foreground">{audienceLabel(person.publico)} · {person.phone}</div>
                </td>
                <td>{person.bairro}</td>
                <td>{person.interesses.map(tagLabel).join(', ')}</td>
                <td>{person.predioPublico}</td>
                <td>{person.optOut ? (person.legalException ? 'Opt-out com exceção' : 'Ativo') : 'Não'}</td>
                <td className="pr-3 text-right">
                  <Button size="sm" variant="outline" onClick={() => void toggle(person)}>{person.optOut ? 'Reativar' : 'Opt-out'}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
