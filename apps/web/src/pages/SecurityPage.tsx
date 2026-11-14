import { Link } from 'react-router-dom';

const ROWS = [
  ['Perfis', 'Administrador, gestor, atendente, lançador de fila e auditor. A API recusa a ação fora do perfil.'],
  ['2FA', 'Código TOTP obrigatório para administrador e gestor, lido no aplicativo autenticador. Os demais perfis usam senha.'],
  ['Transporte', 'HTTPS com TLS 1.2 ou superior e limite de taxa na borda Nginx. O painel fala com a API pelo mesmo endereço.'],
  ['Segredos', 'Nenhum token de produção no código. As credenciais da WABA e os segredos TOTP ficam cifrados com AES-256-GCM. Com as dicas de demonstração desligadas, o sistema só sobe com segredos próprios.'],
  ['WhatsApp', 'Somente a Cloud API oficial da Meta, em graph.facebook.com. META_MODE=simulator não chama a Meta. Não há WhatsApp Web nem automação de navegador.'],
  ['Atendimento', 'Chatwoot Community Edition, só com servidor humano. Fora do expediente, um texto fixo dentro da janela de 24 horas. Sem robô e sem IA.'],
  ['Franquia', 'Não contam: mensagem do cidadão, recusa da Meta e resposta humana na janela de 24 horas, inclusive o aviso de fora do expediente.'],
  ['Auditoria', 'Trilha somente de acréscimo. No PostgreSQL, um gatilho recusa UPDATE e DELETE.'],
];

export function SecurityPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="display text-4xl">Segurança e conformidade</h1>
      <p className="mt-3 text-sm text-muted-foreground">Resumo do que a comissão pode verificar neste repositório.</p>
      <dl className="mt-6 divide-y divide-border rounded-lg border border-border bg-card">
        {ROWS.map(([title, text]) => (
          <div key={title} className="grid gap-1 p-4 md:grid-cols-[10rem_1fr]">
            <dt className="text-sm font-medium">{title}</dt>
            <dd className="text-sm leading-6 text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>
      <Link to="/" className="mt-6 inline-block text-sm">Voltar ao início</Link>
    </article>
  );
}
