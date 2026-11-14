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
2. No aplicativo da Meta, aponte o webhook do número para o endereço que o Chatwoot mostra (`<endereço do Chatwoot>/webhooks/whatsapp/<número>`), com o token de verificação que ele gera.
3. O Chatwoot repassa cada mensagem para `POST /api/v1/webhooks/chatwoot`, assinada com o `WEBHOOK_SECRET`. A API lê o telefone do contato e trata a mensagem como WhatsApp: `PARAR`, `SAIR` e `OPT-OUT` viram opt-out, a resposta do atendente dentro da janela de 24 horas não consome franquia, e a transferência gera o aviso ao cidadão (`transfer_notice`) quando a janela ainda está aberta. Fora da janela, o aviso fica retido e auditado.

Limite conhecido: neste POC o webhook da Meta do número aponta para um só destino, o Chatwoot ou a API. Com o webhook no Chatwoot, as confirmações de entrega e leitura das campanhas (`delivered`, `read`) não chegam à API, e a mensagem de campanha fica no status devolvido no envio. Com o webhook na API (`/api/v1/webhooks/meta`), as confirmações chegam, mas as conversas do WhatsApp não entram no Chatwoot. Ter as duas coisas no mesmo número exige um segundo destino para o webhook ou um repasse entre a API e o Chatwoot, que este POC ainda não tem.

No modo simulador, a comissão pode simular a mensagem recebida do WhatsApp pelo painel, em **LGPD**, ou por `POST /api/v1/webhooks/meta` com `{ "from": "5537990001002", "text": "PARAR" }`, com a sessão do painel ou o cabeçalho `X-WRP-Webhook-Secret`.

## Expediente

Cada unidade atende de segunda a sexta, das 8h às 17h, em `America/Sao_Paulo`.

No webchat, o próprio Chatwoot envia o texto fixo de fora do expediente, em nome da caixa de entrada.

No WhatsApp, `OOH_SENDER=wrp` faz a API responder uma única vez no dia com o texto da unidade. É resposta de horário, dentro da janela de 24 horas, e não consome a franquia. Não é um robô de conversa. `OOH_SENDER=chatwoot` deixa esse texto a cargo do Chatwoot; a API só classifica o eco para a franquia, sem enviar de novo.

## Assinatura do webhook

O Chatwoot assina cada entrega com o segredo do webhook: o cabeçalho `X-Chatwoot-Signature` traz `sha256=` e o HMAC-SHA256 de `<X-Chatwoot-Timestamp>.<corpo>`. A API recusa a entrega sem assinatura válida. A sessão do painel e o cabeçalho `X-WRP-Webhook-Secret` também são aceitos, para teste manual.

## O que não fazer

Não instalar Baileys, WhatsApp Web nem automação de navegador. Não ativar o Captain, bots de terceiros ou respostas por modelo de linguagem no fluxo do cidadão.
