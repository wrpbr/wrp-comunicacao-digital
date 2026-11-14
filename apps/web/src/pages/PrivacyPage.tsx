import { Link } from 'react-router-dom';

export function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs uppercase tracking-[0.18em] text-accent">Lei 13.709/2018</p>
      <h1 className="display mt-2 text-4xl">Política de privacidade</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Modelo operacional do POC para revisão da Procuradoria do Município de Pompéu. Não substitui o ato formal do controlador.
      </p>
      <div className="mt-6 space-y-4 text-sm leading-6">
        <p><strong>Controlador.</strong> Prefeitura Municipal de Pompéu/MG, a quem compete decidir sobre o tratamento dos dados de cidadãos e servidores no âmbito deste serviço.</p>
        <p><strong>Operador.</strong> WRP CONSULTORIA E INFORMATICA LTDA, CNPJ 66.300.125/0001-45, que trata os dados segundo as instruções do município no Pregão Eletrônico nº 089/2026, Processo 243/2026.</p>
        <p><strong>Dados tratados.</strong> Nome, telefone, data de nascimento, bairro, interesses informados, vínculo com prédio público, mensagens trocadas no atendimento humano, senhas de fila e registros de auditoria de quem operou o sistema.</p>
        <p><strong>Finalidades.</strong> Comunicação institucional segmentada, aviso de aniversário, atendimento humano por WhatsApp oficial e chamada de senha nas unidades. Não há decisão automatizada nem resposta de inteligência artificial durante o atendimento.</p>
        <p><strong>Bases.</strong> Execução de política pública e cumprimento de obrigação legal, nos termos do art. 7º da Lei 13.709/2018. Campanhas de relacionamento respeitam o opt-out. Exceção legal só vale quando estiver marcada no cadastro, com a base escrita.</p>
        <p><strong>Opt-out.</strong> O cidadão envia PARAR, SAIR ou OPT-OUT no WhatsApp, usa esta API em POST /api/v1/opt-out, ou pede o bloqueio no balcão. O efeito é imediato para campanhas e aniversários. A conversa que ele mesmo iniciou pode continuar dentro da janela de 24 horas da Meta.</p>
        <p><strong>Compartilhamento.</strong> A Meta Platforms recebe o necessário para a WhatsApp Cloud API. O inbox humano pode operar no Chatwoot Community Edition, sob controle do município. Não há venda de cadastro.</p>
        <p><strong>Transferência internacional.</strong> Só ocorre nas hipóteses do art. 33 da Lei 13.709/2018, com garantia contratual de que o dado não será usado para outra finalidade. A WhatsApp Cloud API é operada pela Meta Platforms, que pode tratar as mensagens fora do Brasil. O cadastro desta demonstração traz apenas nomes e telefones fictícios.</p>
        <p><strong>Retenção.</strong> Mensagens e auditoria permanecem pelo prazo definido pelo município para prestação de contas do contrato. O opt-out fica registrado para impedir novo envio.</p>
        <p><strong>Direitos.</strong> Confirmação, acesso, correção, anonimização e oposição podem ser pedidos ao encarregado que o município designar. Caixa sugerida, ainda a criar: encarregado@pompeu.mg.gov.br.</p>
        <p><strong>Segurança.</strong> Acesso por perfil, 2FA para admin e gestor, TLS na borda, segredo da WABA cifrado com AES-256-GCM e trilha de auditoria sem edição.</p>
      </div>
      <Link to="/" className="mt-8 inline-block text-sm">Voltar ao início</Link>
    </article>
  );
}
