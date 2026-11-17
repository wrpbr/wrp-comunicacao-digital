# Chatwoot Community Edition

O atendimento humano usa o `chatwoot/chatwoot:v4.19.1-ce` (MIT). Só servidor público responde ao cidadão. Este POC não liga agente de IA, robô de conversa nem resposta automática além do texto fixo de fora do expediente.

## O que já nasce pronto

`docker compose up -d` prepara o banco do Chatwoot (`chatwoot-prepare`), configura a instalação (`chatwoot-bootstrap`) e só então sobe o Chatwoot em `http://127.0.0.1:3309`. A tela pública de primeira configuração nunca fica exposta, e o cadastro aberto de contas fica desligado (`ENABLE_ACCOUNT_SIGNUP=false`).

O roteiro `infra/chatwoot/bootstrap.rb` deixa configurado:

- a conta **Prefeitura Municipal de Pompéu**, em português do Brasil;
- as mesmas pessoas do painel, com o mesmo e-mail: Helena Prado (`admin@`), Paulo Henrique Dutra (`gestor@`) e Ana Cláudia Moura (`atendente@pompeu.mg.gov.br`). A senha é a de `CHATWOOT_AGENT_PASSWORD` ou, sem ela, a `DEMO_PASSWORD`;
- a caixa de entrada **Site da Prefeitura**, um webchat com expediente de segunda a sexta, das 8h às 17h, em `America/Sao_Paulo`, e o texto fixo de fora do expediente;
- uma equipe por unidade, que é a fila do setor: `ubs centro`, `atendimento geral` e `prefeitura sede`. O Chatwoot guarda o nome da equipe em minúsculas;
- as respostas prontas `ubs-horario`, `ubs-vacina`, `iptu`, `transferencia` e `opt-out`, com o mesmo texto que o painel do WRP lista em **Chatwoot**;
- o webhook assinado para `POST /api/v1/webhooks/chatwoot`, com os eventos `message_created` e `conversation_updated`.

`npm run chatwoot:bootstrap` reaplica essa preparação depois de uma mudança no roteiro ou no `.env`. Repetir não apaga conversa e não troca senha.

## Webchat

O cidadão conversa em `<endereço do Chatwoot>/widget?website_token=<CHATWOOT_WEBSITE_TOKEN>`. O painel do WRP traz o link em **Chatwoot > Abrir o webchat (visão do cidadão)**. Para pôr o webchat no site da prefeitura, copie o código em Configurações > Caixas de Entrada > Site da Prefeitura. Não cole no painel de TV.

O webchat não pede e-mail ao cidadão e não promete aviso por e-mail: este POC não tem servidor de e-mail.

## Fila e transferência

A conversa nova entra em **Conversas > Não atribuídas**. Em **Ações da conversa**, o atendente assume a conversa (**Atribuir a mim**) e escolhe o **Time atribuído**, que é a fila da unidade. Trocar o time ou o agente transfere a conversa com todo o histórico, e a própria conversa registra quem transferiu.

## WhatsApp no Chatwoot

O canal WhatsApp do Chatwoot é o **WhatsApp Cloud**, da WhatsApp Business Platform oficial. Ele só pode ser criado com um número de verdade: ao salvar, o Chatwoot confere o Phone Number ID e o token na Meta. Por isso o canal não nasce no `bootstrap.rb`. Com o número da demonstração em mãos:

1. No Chatwoot, crie a caixa de entrada em Configurações > Caixas de Entrada > WhatsApp > WhatsApp Cloud, com o número, o Phone Number ID, o ID da conta WhatsApp Business e o token.
2. Mantenha o callback do aplicativo Meta em `/api/v1/webhooks/meta`, com `META_VERIFY_TOKEN`, e inscreva o aplicativo na conta WhatsApp. Configure o App Secret também no `provider_config.app_secret` da caixa WhatsApp do Chatwoot, para ele validar a assinatura original. A criação manual pela API com `provider_config.source=manual_setup_v2` preserva esse callback; o fluxo automático do Chatwoot pode substituí-lo.
3. Ative `META_MODE=live` e `CHATWOOT_WHATSAPP_RELAY=true`. A API valida a assinatura da Meta e repassa o corpo original ao Chatwoot pela rede interna. Ela só confirma a entrega depois de o Chatwoot aceitar o evento na fila persistente; falha de rede ou recusa devolve 502 para a Meta repetir a entrega. A API mantém os recibos das campanhas. A mensagem recebida é tratada somente quando o Chatwoot entrega seu webhook, evitando processá-la duas vezes.
4. O Chatwoot repassa cada mensagem para `POST /api/v1/webhooks/chatwoot`, assinada com o `WEBHOOK_SECRET`. A API lê o telefone do contato e trata a mensagem como WhatsApp: `PARAR`, `SAIR` e `OPT-OUT` viram opt-out, a resposta do atendente dentro da janela de 24 horas não consome franquia, e a transferência gera o aviso ao cidadão (`transfer_notice`) quando a janela ainda está aberta. Fora da janela, o aviso fica retido e auditado.

A janela de atendimento do WhatsApp informada em `conversation.can_reply` vale quando o webhook tem assinatura válida do Chatwoot, inclusive para contato ainda fora do cadastro da prefeitura. Sem essa assinatura, a API usa somente o horário de entrada já registrado no cadastro.

Com o repasse desligado, o webhook da Meta continua atendendo diretamente a API. Para homologar com número de teste, use o template aprovado `hello_world`, idioma `en_US`, `META_TEMPLATE_BODY_PARAM=false` e destinatário verificado na Meta. Deixe `BIRTHDAY_AUTORUN=false` durante o ensaio, para o agendamento da demonstração não enviar mensagens reais.

No modo simulador, a comissão pode simular a mensagem recebida do WhatsApp pelo painel, em **LGPD**, ou por `POST /api/v1/webhooks/meta` com `{ "from": "5537990001002", "text": "PARAR" }`, com a sessão do painel ou o cabeçalho `X-WRP-Webhook-Secret`.

## Expediente

Cada unidade atende de segunda a sexta, das 8h às 17h, em `America/Sao_Paulo`.

No webchat, o próprio Chatwoot envia o texto fixo de fora do expediente, em nome da caixa de entrada.

No WhatsApp, `OOH_SENDER=wrp` faz a API responder uma única vez no dia com o texto da unidade. É resposta de horário, dentro da janela de 24 horas, e não consome a franquia. Não é um robô de conversa. `OOH_SENDER=chatwoot` deixa esse texto a cargo do Chatwoot; a API só classifica o eco para a franquia, sem enviar de novo.

## Assinatura do webhook

O Chatwoot assina cada entrega com o segredo do webhook: o cabeçalho `X-Chatwoot-Signature` traz `sha256=` e o HMAC-SHA256 de `<X-Chatwoot-Timestamp>.<corpo>`. A API recusa a entrega sem assinatura válida. A sessão do painel e o cabeçalho `X-WRP-Webhook-Secret` também são aceitos, para teste manual.

## O que não fazer

Não instalar Baileys, WhatsApp Web nem automação de navegador. Não ativar o Captain, bots de terceiros ou respostas por modelo de linguagem no fluxo do cidadão.
