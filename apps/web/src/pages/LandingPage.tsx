import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';

type Hints = { paineis?: { slug: string; name: string; path: string; chave: string }[] };

// Alíneas (i) a (vii) do item 4 do Termo de Referência, na ordem do edital. A franquia vem dos itens 1 e 5.
const ITEMS = [
  ['Item (i)', 'Campanhas segmentadas', 'Envio por bairro, por interesse e por prédio público, com o status de envio e de entrega de cada mensagem.'],
  ['Item (ii)', 'Trilha de auditoria', 'Data e hora, usuário, ação, registro afetado, destinatário e status. Exporta em CSV e JSON com SHA-256.'],
  ['Item (iii)', 'Proteção de dados', 'Cancelamento pelo destinatário, acesso por perfil com 2FA, tráfego em HTTPS com TLS 1.2 ou superior e política de privacidade.'],
  ['Item (iv)', 'API documentada', 'OpenAPI 3.1 em /docs. A equipe municipal envia uma mensagem e consulta o status.'],
  ['Item (v)', 'TV e senhas', 'Conteúdo e chamada por nome e por número num navegador Full HD, com fila separada por unidade.'],
  ['Item (vi)', 'Atendimento humano multicanal', 'O servidor público recebe e responde no Chatwoot, com fila por unidade e transferência que preserva o histórico.'],
  ['Item (vii)', 'Lote de 100', 'Cem mensagens de teste, com relatório de envio e entrega em PDF, CSV e JSON.'],
  ['Itens 1 e 5', 'Franquia e reserva', '5.000 mensagens por mês, pacotes de 100 e reserva técnica para urgência.'],
];

export function LandingPage() {
  const [panels, setPanels] = useState<Hints['paineis']>([]);
  useEffect(() => {
    api<Hints>('/api/v1/auth/demo-hints').then((data) => setPanels(data.paineis ?? [])).catch(() => setPanels([]));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-accent">WRP Consultoria e Informática Ltda · CNPJ 66.300.125/0001-45</p>
          <h1 className="display mt-2 text-4xl text-primary md:text-5xl">WRP Comunicação Digital</h1>
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            Prova de conceito do Pregão Eletrônico nº 089/2026, Processo 243/2026, para a Prefeitura Municipal de Pompéu/MG.
            Atendimento ao cidadão só com servidor humano. Campanhas e painéis de senha no mesmo sistema.
          </p>
        </div>
        <Link to="/login" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Entrar no painel</Link>
      </header>
      <p className="mt-8 text-xs uppercase tracking-[0.18em] text-muted-foreground">Demonstração técnica · item 4 do Termo de Referência</p>
      <section className="mt-3 grid gap-4 md:grid-cols-2">
        {ITEMS.map(([index, title, text]) => (
          <article key={index} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-widest text-accent">{index}</p>
            <h2 className="display mt-1 text-2xl">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
          </article>
        ))}
      </section>
      <section className="mt-8 rounded-lg border border-border bg-[#102033] p-5 text-[#f4efe6]">
        <h2 className="display text-2xl">Painéis das unidades</h2>
        <p className="mt-1 text-sm text-white/70">Cada TV mostra só a fila da própria unidade. O nome pode sair completo ou reduzido, conforme a LGPD da unidade.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {(panels ?? []).map((panel) => (
            <Link key={panel.slug} to={panel.path} className="rounded-md bg-[#c4a46a] px-3 py-2 text-sm font-medium text-[#1b1408]">
              {panel.name}
            </Link>
          ))}
          {panels?.length === 0 && <p className="text-sm">Cada painel abre com a chave da unidade, pelo menu TVs do painel de gestão.</p>}
        </div>
      </section>
      <footer className="mt-8 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <Link to="/privacidade">Política de privacidade</Link>
        <Link to="/seguranca">Segurança e conformidade</Link>
        <a href="/docs/">Documentação da API</a>
      </footer>
    </div>
  );
}
