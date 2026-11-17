# Comunicação Digital

Plataforma para a prefeitura falar com o cidadão pelo WhatsApp oficial e pela TV das unidades: campanhas segmentadas por bairro, interesse e prédio público, atendimento humano com fila por unidade, chamada de senhas na TV, controle da franquia mensal e trilha de auditoria exportável. Este repositório é a demonstração técnica (POC) do **Pregão Eletrônico nº 089/2026** (Processo 243/2026) da **Prefeitura Municipal de Pompéu/MG**, e sobe inteira com um comando.

Operador: **WRP CONSULTORIA E INFORMATICA LTDA**, CNPJ **66.300.125/0001-45**.

Só servidor público responde ao cidadão: não há robô nem IA no atendimento. O envio pelo WhatsApp usa só a Cloud API oficial da Meta.

## Subir com um comando

Na raiz do repositório, com Docker e Docker Compose:

```bash
docker compose up -d
```

Não é preciso criar o `.env` para a demonstração local. O `docker-compose.yml` já traz o modo demonstração, o simulador da Meta e os valores locais.

| O que | Endereço |
| --- | --- |
| Painel e TVs (HTTPS, TLS 1.2 ou 1.3) | https://127.0.0.1:8443 |
| HTTP, que só redireciona para o HTTPS | http://127.0.0.1:8088 |
| Documentação da API (Swagger) | https://127.0.0.1:8443/docs/ |
| Contrato OpenAPI 3.1 | https://127.0.0.1:8443/openapi.yaml |
| Política de privacidade e página de segurança | https://127.0.0.1:8443/privacidade e https://127.0.0.1:8443/seguranca |
| Chatwoot (atendimento humano) | http://127.0.0.1:3309 |

O certificado da demonstração local é gerado na primeira subida e é autoassinado: o navegador pede confirmação. A primeira subida do Chatwoot prepara o banco e leva alguns minutos; o painel já funciona enquanto isso.

## Contas de demonstração

Senha de todas: `Pompeu#089`

| Perfil | E-mail | Segundo fator |
| --- | --- | --- |
| Administrador | admin@pompeu.mg.gov.br | obrigatório |
| Gestor | gestor@pompeu.mg.gov.br | obrigatório |
| Atendente | atendente@pompeu.mg.gov.br | não |
| Lançador de fila | lancador@pompeu.mg.gov.br | não |
| Auditor | auditor@pompeu.mg.gov.br | não |

Segredo TOTP de demonstração do administrador e do gestor: `OBQWIZLOOQZGS4DZ`. Na demonstração local, a tela de login mostra a senha, o código atual e o QR.

No Chatwoot entram o administrador, o gestor e a atendente, com o mesmo e-mail e a mesma senha.

Painéis de TV, na demonstração local:

- UBS Centro: https://127.0.0.1:8443/tv/unidade-centro-saude?chave=demo.unidade-centro-saude.painel
- Atendimento Geral: https://127.0.0.1:8443/tv/unidade-atendimento-geral?chave=demo.unidade-atendimento-geral.painel
- Prefeitura Sede: https://127.0.0.1:8443/tv/unidade-prefeitura-sede?chave=demo.unidade-prefeitura-sede.painel

Esses valores são públicos e servem só para a máquina local. Veja “Publicar num endereço público” antes de expor o sistema.

## O que a comissão exercita

O passo a passo está em [docs/POC-ROTEIRO-COMISSAO.md](docs/POC-ROTEIRO-COMISSAO.md), na ordem do item 4 do Termo de Referência:

| Item | O que demonstra | Onde |
| --- | --- | --- |
| (i) | Envio segmentado por bairro, interesse e prédio público, com status de envio e entrega | Campanhas e Auditoria |
| (ii) | Trilha de auditoria exportável em CSV e JSON, com SHA-256 | Auditoria |
| (iii) | Cancelamento pelo destinatário, acesso por perfil, HTTPS e política de privacidade | LGPD, login, `/privacidade` |
| (iv) | API conforme a documentação pública: envio de mensagem e consulta de status | `/docs/` |
| (v) | Conteúdo e chamada de senhas na TV, com filas separadas por unidade | TVs e Filas |
| (vi) | Atendimento multicanal por atendente humano, com fila e transferência com histórico | Chatwoot |
| (vii) | Lote de teste de 100 mensagens, com relatório de envio e entrega | Lote POC e Relatórios |

A franquia de 5.000 mensagens, os pacotes de 100 e a reserva técnica (itens 1 e 5 do TR) têm uma seção própria no roteiro.

Para voltar a base ao estado inicial entre um ensaio e outro:

```bash
npm run ensaio:reset
```

O comando apaga a base de demonstração, inclusive a trilha de auditoria do ensaio, e recria o cenário. Só roda com `DEMO_MODE=true` e pede confirmação. Não mexe no Chatwoot.

## WhatsApp: simulador ou Cloud API

`META_MODE=simulator` é o padrão. A API responde como a Cloud API da Meta, com os status `sent`, `delivered`, `read` e `failed`, e nenhuma chamada sai da máquina. `SIMULATOR_PATTERN=pattern` deixa o resultado reproduzível.

`META_MODE=live` envia de verdade pela Graph API `v26.0`, em `graph.facebook.com`. Preencha `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_APP_SECRET` e `META_VERIFY_TOKEN`. O número pode ser o de teste da Meta.

- Dentro da janela de 24 horas do cidadão vai texto livre. Fora dela, a Meta só aceita modelo aprovado: informe o nome em `META_TEMPLATE_NAME` (idioma em `META_TEMPLATE_LANGUAGE`).
- O webhook da Meta é `/api/v1/webhooks/meta` e exige a assinatura `X-Hub-Signature-256`.
- O token também pode ser gravado por `PUT /api/v1/settings/waba`, só pelo administrador. Ele fica cifrado com AES-256-GCM.
- O lote de 100 do item (vii) roda sempre no simulador. Os cem destinatários são números de teste que não existem, e nenhum deles recebe mensagem pela conta real.

## Atendimento humano no Chatwoot

O Chatwoot Community Edition já nasce configurado: conta do município, atendentes, uma fila por unidade, webchat com expediente, respostas prontas e o webhook assinado para a API. O cadastro aberto de contas fica desligado. Detalhes, inclusive como ligar o WhatsApp ao Chatwoot, em [docs/CHATWOOT.md](docs/CHATWOOT.md).

```bash
npm run chatwoot:bootstrap
```

reaplica essa preparação depois de mudar o `.env`. Repetir não apaga conversa nem troca senha.

## Publicar num endereço público

Os valores de demonstração estão neste repositório, que é público. Antes de expor o sistema:

1. Copie `.env.example` para `.env`, no servidor. O `.env` nunca vai para o git.
2. Preencha todos os segredos do primeiro bloco: `SECRETS_KEY`, `WEBHOOK_SECRET`, `DEMO_PASSWORD`, `DEMO_TOTP_SECRET`, `CHATWOOT_AGENT_PASSWORD`, `POSTGRES_PASSWORD`, `CHATWOOT_DB_PASSWORD` e `CHATWOOT_SECRET_KEY_BASE`.
3. Ponha `DEMO_HINTS=false`. A tela de login para de mostrar senha e código, e cada painel de TV ganha uma chave aleatória, que o administrador abre em **TVs**. Com as dicas desligadas, a API se recusa a subir enquanto algum segredo ainda for o valor deste repositório.
4. Informe o endereço público do painel em `CORS_ORIGIN` e o do Chatwoot em `CHATWOOT_FRONTEND_URL`, com `CHATWOOT_FORCE_SSL=true`.
5. Se outro proxy fizer o TLS na frente, informe a faixa de rede dele em `WRP_TRUSTED_PROXY`. O Nginx do compose passa a servir em HTTP para esse proxy e a ler o endereço do visitante em `X-Real-IP`, que vale na auditoria e no limite por IP.

PostgreSQL e Redis não publicam porta: só os serviços do compose falam com eles. Mais sobre a borda, os segredos e os webhooks em [docs/SEGURANCA-LGPD.md](docs/SEGURANCA-LGPD.md).

## Desenvolvimento local

Requer Node.js 22.

```bash
npm ci
npm run dev
```

- Painel: http://127.0.0.1:43123
- API: http://127.0.0.1:43110
- Swagger: http://127.0.0.1:43123/docs/

Sem `DATABASE_URL`, a API guarda tudo em memória e recria o cenário a cada subida. Com PostgreSQL, os dados ficam.

```bash
npm run typecheck
npm run build
npm test
```

## Fora do modo demonstração

`NODE_ENV=production` recusa `DEMO_MODE=true` sem `ALLOW_DEMO_MODE=true`. Sem o modo demonstração, `SECRETS_KEY` e `WEBHOOK_SECRET` são obrigatórios e não podem ser os valores deste repositório.

```bash
npm run bootstrap -w @wrp/api -- --password 'uma-senha-longa'
```

O comando cria o primeiro administrador e imprime uma vez o segredo TOTP dele.

## Aviso de aniversário

Com `BIRTHDAY_AUTORUN` ligado (padrão), a API envia os parabéns do dia depois das 8h de Brasília, uma vez por dia. Quem está em opt-out fica de fora. Numa subida à tarde, Maria Aparecida Silva e a servidora Camila Rocha Mendes podem já ter recebido a mensagem.

## Licença

O código original da WRP é proprietário: veja `LICENSE`. As dependências diretas são MIT ou Apache-2.0. As licenças das dependências, das imagens do compose e do conteúdo exibido estão em `THIRD_PARTY_NOTICES.md`.
