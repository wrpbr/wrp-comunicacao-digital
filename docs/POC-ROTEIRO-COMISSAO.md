# Roteiro da comissão — itens (i) a (vii)

Pregão Eletrônico nº 089/2026, Processo 243/2026, Prefeitura Municipal de Pompéu/MG.

Este roteiro segue a ordem das alíneas (i) a (vii) do item 4 do Termo de Referência (demonstração técnica). A franquia de mensagens, dos itens 1 e 5 do TR, vem numa seção própria no fim.

## Antes de começar

Suba o sistema com `docker compose up -d` (painel em `https://127.0.0.1:8443`) ou com `npm run dev` (painel em `http://127.0.0.1:43123`). Num endereço publicado na internet, use o endereço e as contas que a WRP entregou junto com o dossiê técnico.

Entre como Helena Prado (`admin@pompeu.mg.gov.br`). Administrador e gestor confirmam o acesso com o código de seis dígitos do aplicativo autenticador. Na máquina local, a tela de login mostra a senha, o código e o QR de demonstração; as contas e o segredo estão no `README.md`. Num endereço público essas dicas ficam desligadas, e o código vem do aplicativo autenticador configurado com o segredo entregue pela WRP.

Os telefones e nomes do cadastro são fictícios. Os bairros Centro, São José e Várzea e as unidades UBS Centro, Atendimento Geral e Prefeitura Sede são o cenário do município.

Se o relógio de Brasília já passou das 8h, a campanha de aniversariantes pode ter saído sozinha. O botão correspondente informa que o disparo do dia já ocorreu.

Para repetir o roteiro do zero, quem opera o servidor roda `npm run ensaio:reset`. O comando apaga a base de demonstração e recria o cenário inicial.

## (i) Envio segmentado, com status de envio e entrega

1. Abra **Campanhas**.
2. Deixe as regras **Bairro = Centro** e **Interesse = Saúde**, com a combinação **E**.
3. Clique em **Prévia**. O resultado esperado é uma pessoa: Maria Aparecida Silva. Pedro Henrique Souza mora no Centro, mas o interesse dele é outro.
4. Clique em **Disparar**. Quem estiver em opt-out dentro do segmento fica de fora.
5. Troque a combinação para **OU** e acrescente a regra **Prédio público = UBS Centro** para ver a união dos critérios.
6. No cartão **Aniversariantes**, dispare os parabéns. Maria e a servidora Camila entram. Helena Souza Dias está em opt-out e não entra. Lúcia tem opt-out com exceção legal, mas aniversário não usa essa exceção.
7. Em **Servidores**, envie o comunicado interno. Servidor em opt-out não recebe.
8. Em **Mídias**, confira as peças originais do POC e, se quiser, envie um SVG ou PNG de até 1,5 MB.
9. Em **Auditoria**, filtre a ação `message_outbound`. Cada mensagem aparece com o destinatário e o status: `queued`, `sent`, `delivered`, `read` ou `failed`, os mesmos nomes da Cloud API da Meta. No simulador, a resposta já nasce num desses estados, como um webhook da Meta que chega na hora.

## (ii) Trilha de auditoria exportável

1. Abra **Auditoria**.
2. Filtre pela ação `campaign_dispatch` ou busque por um telefone.
3. Cada linha mostra data e hora de Brasília e em UTC, o usuário e o perfil dele, a ação, o registro afetado, o destinatário, o status de envio e entrega e o IP.
4. Exporte em CSV e em JSON. A tela mostra o SHA-256 do arquivo, o mesmo valor do cabeçalho `X-Export-Checksum`.
5. A tabela `audit_logs` no PostgreSQL recusa `UPDATE` e `DELETE`.

## (iii) Proteção de dados

Cancelamento de recebimento pelo destinatário:

1. Em **LGPD**, simule uma mensagem recebida do número `5537990001002` com o texto `PARAR`. João Batista Ferreira deixa de receber campanha e aniversário. O atendimento que ele iniciar continua possível.
2. `SAIR` e `OPT-OUT` fazem o mesmo.
3. O botão de reativar só funciona para administrador e gestor. O atendente e o auditor veem o registro; se clicarem, a tela mostra a recusa.
4. Com `META_MODE=live`, o painel não simula mensagem recebida: o webhook só aceita o que a Meta assina. O cancelamento é feito de verdade, enviando `PARAR` pelo WhatsApp para o número da demonstração.

Controle de acesso por perfil:

5. Saia e entre como `atendente@pompeu.mg.gov.br`. Não há segundo fator. O menu não oferece **Campanhas**, e a API responde 403 a quem tentar.
6. Entre como `lancador@pompeu.mg.gov.br` e como `auditor@pompeu.mg.gov.br` para ver o recorte de cada perfil. O lançador só emite senha. O auditor lê cadastro, campanhas, franquia, auditoria e relatórios; não dispara campanha, não autoriza pacote e não reverte opt-out.
7. Administrador e gestor não concluem o login sem o código TOTP.

Criptografia do tráfego e política de privacidade:

8. O painel atende em HTTPS, com TLS 1.2 ou 1.3, e o endereço em HTTP só redireciona para o HTTPS. O cadeado do navegador mostra o protocolo. Na linha de comando, `openssl s_client -connect <endereço>:<porta> -tls1_1` é recusado e `-tls1_2` conecta (porta 8443 no compose local, 443 no endereço público).
9. Abra `/privacidade` e `/seguranca` sem login.

## (iv) API conforme a documentação pública

A equipe municipal executa as duas chamadas pelo Swagger, em `/docs/`. O contrato OpenAPI 3.1 fica em `/openapi.yaml`.

1. Em **Autenticação**, execute `POST /api/v1/auth/login` com o e-mail e a senha do gestor. A resposta traz um `challengeToken`.
2. Execute `POST /api/v1/auth/totp` com o `challengeToken` e o código do aplicativo autenticador. Copie o campo `token` da resposta.
3. Clique em **Authorize**, cole o token e confirme.
4. Envio de mensagem: em **Mensagens**, execute `POST /api/v1/messages/send` com o corpo abaixo. A resposta `201` traz o `id` da mensagem e o status.

   ```json
   { "to": "5537990001001", "body": "Teste da equipe municipal pela API documentada.", "kind": "campaign" }
   ```

5. Consulta de status: execute `GET /api/v1/messages/{id}/status` com o `id` recebido. A resposta traz o status atual, o histórico de status e se a mensagem entrou na franquia.

Os demais caminhos do contrato cobrem campanha, lote de teste, relatório de entrega, exportação de auditoria, opt-out, chamada de senha, stream SSE e heartbeat dos painéis. O stream também existe em WebSocket, em `/api/v1/tv/{unidade}/ws`.

## (v) TV: conteúdo e chamada de senhas, com filas separadas por unidade

1. Como administrador, em **TVs**, clique em **Abrir painel** da UBS Centro e do Atendimento Geral, cada um numa aba. A página é um palco 1920×1080 ajustado à janela. Os botões **Mídia**, **Senhas** e **Mídia e senhas** mudam o que a TV mostra.
2. Em cada painel, clique em **Iniciar painel e ativar som**.
3. Entre como `lancador@pompeu.mg.gov.br`. Em **Filas**, escolha UBS Centro, informe um nome e o serviço e emita a senha. A primeira senha nova é `SAU-014`. Emita outra senha no Atendimento Geral.
4. O lançador não tem o botão de chamar habilitado.
5. Saia e entre como `atendente@pompeu.mg.gov.br`. A atendente chama a próxima senha e não emite senha.
6. A chamada aparece no painel da unidade em menos de 10 segundos, com o número da senha e o nome, e toca o aviso sonoro. Na UBS Centro o nome sai reduzido (`Maria S.`). No Atendimento Geral o nome sai completo. A senha de uma unidade não aparece no painel da outra.
7. O painel envia um sinal a cada 20 segundos. Em **TVs**, a unidade fica “No ar” enquanto o último sinal tiver menos de 45 segundos.
8. Desligue a rede do navegador. O painel mostra a última tela gravada no IndexedDB e, se esse banco falhar, no localStorage. Ao voltar a rede, o stream retoma.

O vídeo da playlist da UBS Centro é “Viaje com a vacinação em dia”, do canal oficial do Ministério da Saúde no YouTube, exibido pelo player incorporado do próprio YouTube. As demais peças são artes originais do POC. O município troca tudo pelo material oficial.

## (vi) Atendimento multicanal por atendente humano

O atendimento usa o Chatwoot Community Edition, sem robô e sem IA. A conta do município, os atendentes, as filas por unidade, o webchat e as respostas prontas já nascem configurados.

1. No painel, abra **Chatwoot** e clique em **Abrir o webchat (visão do cidadão)**. Envie uma mensagem como cidadão. Fora do expediente (segunda a sexta, das 8h às 17h), o cidadão recebe na hora um texto fixo de horário.
2. Volte ao painel e clique em **Abrir o Chatwoot (servidor público)**. Entre como `atendente@pompeu.mg.gov.br`, com a senha entregue pela WRP.
3. Fila de atendimento: a conversa está em **Conversas > Não atribuídas**. Abra a conversa.
4. Resposta: digite a resposta, ou digite `/` e escolha uma resposta pronta (`/iptu`, `/ubs-horario`, `/ubs-vacina`, `/transferencia`, `/opt-out`), e envie. O cidadão vê a resposta no webchat, com o nome da atendente.
5. Abra o painel lateral da conversa, em **Ações da conversa**. Em **Agente atribuído**, clique em **Atribuir a mim**. Em **Time atribuído**, escolha `ubs centro`: a conversa entra na fila dessa unidade.
6. Transferência entre unidades: troque o **Time atribuído** para `prefeitura sede`. A conversa passa para a fila da outra unidade com todo o histórico, e a própria conversa registra quem transferiu.
7. Entre no Chatwoot como `gestor@pompeu.mg.gov.br`, que pertence à fila da Prefeitura Sede: a conversa transferida está lá, com as mensagens anteriores.

WhatsApp no mesmo atendimento: o Chatwoot recebe o WhatsApp pelo canal WhatsApp Cloud, da mesma WhatsApp Business Platform oficial, e a conversa usa as mesmas filas e a mesma transferência do webchat. Esse canal é ligado com o número da demonstração (ver `docs/CHATWOOT.md`). A partir daí o Chatwoot avisa a API a cada mensagem, por webhook assinado: `PARAR` vira opt-out, a resposta do atendente dentro de 24 horas não consome franquia, e a transferência gera um aviso ao cidadão quando a janela de 24 horas ainda está aberta.

## (vii) Lote de teste de 100 mensagens

1. Como administrador ou gestor, abra **Lote POC**.
2. Escolha **Determinístico** se a comissão quiser repetir o mesmo número: 100 tentativas, 6 falhas, 94 contabilizadas na franquia.
3. O modo aleatório parece mais com a Cloud API e não fixa a quantidade de falhas.
4. O relatório mostra o envio e a entrega por status. As três sondas precisam mostrar variação zero na franquia: mensagem enviada pelo cidadão, recusa da Meta e resposta humana dentro de 24 horas.
5. Baixe o PDF, o CSV e o JSON. O mesmo relatório está em **Relatórios**.

Os cem destinatários do lote são números de teste que não existem. Por isso o lote roda sempre no simulador, mesmo com `META_MODE=live`: nenhuma mensagem sai pela WABA real para um número inexistente. O envio real, pela API oficial, é o da campanha do item (i) e o da chamada do item (iv).

## Franquia, pacote e reserva (itens 1 e 5 do TR)

A cota contratual é de 5.000 mensagens por mês, mais pacotes de 100 autorizados pelo gestor. Não contam: mensagem que o cidadão enviou, recusa da Meta e resposta humana (inclusive o texto fixo de fora do expediente) dentro da janela de 24 horas.

1. Abra **Franquia**.
2. Clique em **Simular 80%**. Surge o alerta no painel. O mesmo evento fica registrado para webhook, e-mail e o WhatsApp do gestor. A cota de demonstração fica marcada. A cota do contrato continua 5.000.
3. Clique em **Simular 100%**. Uma campanha regular passa a responder que a franquia acabou.
4. Envie um alerta de urgência por `POST /api/v1/messages/send` com `"kind": "urgency"`. Ele sai da reserva técnica, não da cota de campanha, e gera registro para o gestor e para a fiscalização.
5. Clique em **Autorizar pacote de 100**. A campanha regular volta a caber.
6. **Restaurar cota de 5.000** apaga só as mensagens sintéticas do cenário.
7. Em **Relatórios**, baixe o consumo mensal e o SLA dos painéis em PDF, CSV ou JSON.

## Envio real pela WhatsApp Business Platform

Com `META_MODE=live` e as credenciais da WABA (`META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_APP_SECRET` e `META_VERIFY_TOKEN`), as campanhas e a chamada `POST /api/v1/messages/send` enviam pela Cloud API oficial da Meta, em `graph.facebook.com`. Dentro da janela de 24 horas vai texto livre. Fora dela, vai o modelo aprovado na Meta, informado em `META_TEMPLATE_NAME`. Sem credencial válida, a Meta recusa e a mensagem recusada não fica na franquia.
