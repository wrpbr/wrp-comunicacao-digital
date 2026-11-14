import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api';
import { AUDIENCES, INTERESTS } from '@/lib/labels';

type Rule = { field: 'bairro' | 'interesse' | 'predio_publico' | 'publico'; value: string };

/** Campos com lista fechada de valores. Bairro e prédio público são texto livre do cadastro. */
const CHOICES: Partial<Record<Rule['field'], { value: string; label: string }[]>> = {
  interesse: INTERESTS,
  publico: AUDIENCES,
};

export function CampaignsPage() {
  const [name, setName] = useState('Aviso de vacinação no Centro');
  const [body, setBody] = useState('Olá, {{nome}}. A UBS Centro de Pompéu convida os moradores do {{bairro}} para atualizar a caderneta. Responda PARAR para não receber novos avisos.');
  const [match, setMatch] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<Rule[]>([
    { field: 'bairro', value: 'Centro' },
    { field: 'interesse', value: 'saude' },
  ]);
  const [preview, setPreview] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState('');
  const [birthdays, setBirthdays] = useState<string>('');

  useEffect(() => {
    api<{ citizens: { name: string; birthDate: string; optOut: boolean }[] }>('/api/v1/citizens')
      .then((data) => {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', month: '2-digit', day: '2-digit' }).format(new Date());
        const names = data.citizens.filter((person) => person.birthDate.slice(5) === today).map((person) => `${person.name}${person.optOut ? ' (opt-out)' : ''}`);
        setBirthdays(names.join(', ') || 'Nenhum aniversariante no cadastro de hoje.');
      })
      .catch(() => setBirthdays('Não foi possível ler os aniversariantes.'));
  }, []);

  const segment = { match, rules: rules.filter((rule) => rule.value) };

  function setRule(index: number, next: Rule) {
    setRules((current) => current.map((item, i) => (i === index ? next : item)));
  }

  async function runPreview() {
    setError('');
    try {
      const data = await api<{ total: number; sample: { name: string; optOut: boolean }[] }>('/api/v1/campaigns/preview', {
        method: 'POST',
        body: JSON.stringify({ segment }),
      });
      setPreview(`${data.total} pessoa(s): ${data.sample.map((item) => item.name).join(', ')}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha na prévia.');
    }
  }

  async function dispatch() {
    setError('');
    setResult('');
    try {
      const created = await api<{ campaign: { id: string } }>('/api/v1/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name, body, segment }),
      });
      const sent = await api<{ sent: number; excluded: { name: string }[] }>(`/api/v1/campaigns/${created.campaign.id}/dispatch`, { method: 'POST' });
      setResult(`Enviadas ${sent.sent}. Fora por opt-out: ${sent.excluded.map((item) => item.name).join(', ') || 'ninguém'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível disparar.');
    }
  }

  async function birthday() {
    setError('');
    try {
      const data = await api<{ sent: number; excluded: number; alreadyRan: boolean }>('/api/v1/campaigns/birthday/run', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setResult(data.alreadyRan ? 'A campanha de aniversário de hoje já tinha sido disparada.' : `Aniversários enviados: ${data.sent}. Excluídos por opt-out: ${data.excluded}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha nos aniversariantes.');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h1 className="display text-3xl">Campanha segmentada</h1>
        <Input aria-label="Nome da campanha" value={name} onChange={(event) => setName(event.target.value)} />
        <Textarea aria-label="Texto da mensagem" value={body} onChange={(event) => setBody(event.target.value)} />
        <label className="block text-sm">
          Combinação
          <select className="mt-1 h-10 w-full rounded-md border border-input bg-card px-2" value={match} onChange={(event) => setMatch(event.target.value as 'AND' | 'OR')}>
            <option value="AND">E (AND)</option>
            <option value="OR">OU (OR)</option>
          </select>
        </label>
        {rules.map((rule, index) => (
          <div key={index} className="grid grid-cols-2 gap-2">
            <select
              aria-label={`Campo da regra ${index + 1}`}
              className="h-10 rounded-md border border-input bg-card px-2 text-sm"
              value={rule.field}
              onChange={(event) => {
                // O valor antigo não vale para o campo novo: interesse e público têm lista fechada.
                const field = event.target.value as Rule['field'];
                setRule(index, { field, value: CHOICES[field]?.[0]?.value ?? '' });
              }}
            >
              <option value="bairro">Bairro</option>
              <option value="interesse">Interesse</option>
              <option value="predio_publico">Prédio público</option>
              <option value="publico">Público</option>
            </select>
            {CHOICES[rule.field] ? (
              <select
                aria-label={`Valor da regra ${index + 1}`}
                className="h-10 rounded-md border border-input bg-card px-2 text-sm"
                value={rule.value}
                onChange={(event) => setRule(index, { ...rule, value: event.target.value })}
              >
                {CHOICES[rule.field]?.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            ) : (
              <Input
                aria-label={`Valor da regra ${index + 1}`}
                placeholder={rule.field === 'bairro' ? 'Centro, São José ou Várzea' : 'UBS Centro, Prefeitura Sede…'}
                value={rule.value}
                onChange={(event) => setRule(index, { ...rule, value: event.target.value })}
              />
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setRules((current) => [...current, { field: 'bairro', value: '' }])}>Adicionar regra</Button>
          <Button type="button" variant="secondary" onClick={() => void runPreview()}>Prévia</Button>
          <Button type="button" onClick={() => void dispatch()}>Disparar</Button>
        </div>
        {preview && <p className="text-sm">{preview}</p>}
        {result && <p className="text-sm">{result}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
      <aside className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="display text-2xl">Aniversariantes</h2>
        <p className="text-sm leading-6">{birthdays}</p>
        <Button onClick={() => void birthday()}>Disparar parabéns de hoje</Button>
        <p className="text-xs text-muted-foreground">Quem pediu opt-out fica de fora, inclusive servidor e cidadão. O agendador também dispara após as 8h se BIRTHDAY_AUTORUN não estiver desligado.</p>
      </aside>
    </div>
  );
}
