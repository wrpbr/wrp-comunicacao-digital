export const openApiYaml = `openapi: 3.1.0
info:
  title: WRP Comunicação Digital
  version: 1.0.0
  summary: API do POC/MVP para o Pregão Eletrônico 089/2026 da Prefeitura Municipal de Pompéu/MG.
  description: |
    Contratada: WRP CONSULTORIA E INFORMATICA LTDA, CNPJ 66.300.125/0001-45.
    Canal oficial: Meta WhatsApp Cloud API (graph.facebook.com; a versão vem de META_GRAPH_VERSION, padrão v26.0).
    META_MODE=simulator devolve respostas determinísticas ou aleatórias da Graph API sem credencial WABA.
    META_MODE=live envia para https://graph.facebook.com. Dentro da janela de 24 horas vai texto livre;
    fora dela vai o modelo aprovado em META_TEMPLATE_NAME, quando configurado.
    O lote POC de 100 mensagens usa destinatários sintéticos e roda sempre no simulador.
    A franquia não contabiliza mensagem iniciada pelo cidadão, recusa da Meta nem resposta humana
    (incluindo a resposta automática de fora do expediente) dentro da janela de 24 horas.

    Como testar por aqui: chame POST /api/v1/auth/login; se a conta tiver segundo fator, chame
    POST /api/v1/auth/totp com o challengeToken e o código do aplicativo autenticador. Copie o campo
    token da resposta, clique em Authorize e cole o valor. As demais chamadas passam a levar a sessão.
servers:
  - url: /
    description: Mesma origem do painel
tags:
  - name: Autenticação
  - name: Mensagens
  - name: Campanhas
  - name: Relatórios
  - name: Auditoria
  - name: LGPD
  - name: TV
  - name: Franquia
  - name: Webhooks
security:
  - bearerAuth: []
paths:
  /api/v1/health:
    get:
      tags: [Relatórios]
      security: []
      summary: Saúde do serviço
      responses:
        '200':
          description: Serviço no ar
  /api/v1/auth/login:
    post:
      tags: [Autenticação]
      security: []
      summary: Primeiro passo do login (e-mail e senha)
      operationId: login
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
      responses:
        '200':
          description: |
            Conta sem segundo fator: totpRequired=false, com token e user.
            Admin e gestor: totpRequired=true, com challengeToken válido por 5 minutos para POST /api/v1/auth/totp.
        '401':
          description: Credenciais inválidas
  /api/v1/auth/totp:
    post:
      tags: [Autenticação]
      security: []
      summary: Segundo passo do login (código TOTP de admin e gestor)
      operationId: loginTotp
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [challengeToken, code]
              properties:
                challengeToken:
                  type: string
                code:
                  type: string
                  description: Código de 6 dígitos do aplicativo autenticador
      responses:
        '200':
          description: Sessão aberta, com token e user
        '401':
          description: Desafio expirado ou código inválido
  /api/v1/auth/session:
    delete:
      tags: [Autenticação]
      summary: Encerra a sessão do token informado
      operationId: logout
      responses:
        '200':
          description: Sessão encerrada
  /api/v1/messages/send:
    post:
      tags: [Mensagens]
      summary: Envia uma mensagem ativa ou resposta operacional
      operationId: sendMessage
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [to, body]
              properties:
                to:
                  type: string
                  description: Telefone E.164 brasileiro
                  examples: ['5537990001001']
                body:
                  type: string
                kind:
                  type: string
                  enum: [campaign, birthday, servidor, urgency, agent_reply]
                honorLegalException:
                  type: boolean
      responses:
        '201':
          description: Mensagem registrada com status de entrega
        '409':
          description: Franquia ou reserva esgotada
        '422':
          description: Opt-out sem exceção legal
  /api/v1/messages/{id}/status:
    get:
      tags: [Mensagens]
      summary: Consulta o status de entrega
      operationId: messageStatus
      parameters:
        - $ref: '#/components/parameters/MessageId'
      responses:
        '200':
          description: Status queued, sent, delivered, read ou failed
  /api/v1/campaigns/test-batch:
    post:
      tags: [Campanhas]
      summary: Dispara o lote POC de 100 mensagens segmentadas
      operationId: testBatch
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                pattern:
                  type: string
                  enum: [random, pattern]
      responses:
        '201':
          description: Relatório do lote, com sondas de exclusão da franquia
  /api/v1/reports/delivery:
    get:
      tags: [Relatórios]
      summary: Relatório de entrega em JSON, CSV ou PDF
      operationId: deliveryReport
      parameters:
        - in: query
          name: format
          schema:
            type: string
            enum: [json, csv, pdf]
        - in: query
          name: reportId
          schema:
            type: string
        - in: query
          name: campaignId
          schema:
            type: string
      responses:
        '200':
          description: Arquivo do relatório
          headers:
            X-Export-Checksum:
              schema:
                type: string
  /api/v1/franchise:
    get:
      tags: [Franquia]
      summary: Consumo da franquia do mês, pacotes, reserva técnica e alertas
      operationId: franchiseStatus
      responses:
        '200':
          description: |
            Objeto franchise (used, capacity, remaining, ratio, blocked, packsAuthorized, contractualMonthly,
            reserveUsed, reserveSize e reserveRemaining) e a lista alerts, do alerta mais recente para o mais antigo.
        '403':
          description: Perfil sem permissão. Exige administrador, gestor ou auditor.
  /api/v1/reports/franchise:
    get:
      tags: [Franquia]
      summary: Relatório mensal da franquia em JSON, CSV ou PDF
      operationId: franchiseReport
      parameters:
        - in: query
          name: format
          schema:
            type: string
            enum: [json, csv, pdf]
        - in: query
          name: month
          description: Mês no formato AAAA-MM. Sem ele, vale o mês corrente.
          schema:
            type: string
      responses:
        '200':
          description: Arquivo do relatório
          headers:
            X-Export-Checksum:
              schema:
                type: string
  /api/v1/audit-logs/export:
    get:
      tags: [Auditoria]
      summary: Exporta a trilha de auditoria
      operationId: exportAudit
      parameters:
        - in: query
          name: format
          schema:
            type: string
            enum: [json, csv]
        - in: query
          name: from
          schema:
            type: string
            format: date-time
        - in: query
          name: to
          schema:
            type: string
            format: date-time
        - in: query
          name: actor
          schema:
            type: string
        - in: query
          name: action
          schema:
            type: string
        - in: query
          name: status
          schema:
            type: string
        - in: query
          name: q
          schema:
            type: string
      responses:
        '200':
          description: Exportação com checksum SHA-256
          headers:
            X-Export-Checksum:
              schema:
                type: string
              description: SHA-256 hexadecimal do corpo exportado
  /api/v1/opt-out:
    post:
      tags: [LGPD]
      summary: Registra ou remove opt-out do cidadão
      operationId: optOut
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [phone]
              properties:
                phone:
                  type: string
                active:
                  type: boolean
                  description: Sem autenticação, somente active=true é aceito.
                reason:
                  type: string
                legalException:
                  type: boolean
                legalExceptionBasis:
                  type: string
      responses:
        '200':
          description: Registro de opt-out atualizado
  /api/v1/tv/{unitSlug}/call:
    post:
      tags: [TV]
      summary: Chama a próxima senha ou uma senha específica da unidade
      operationId: callTicket
      parameters:
        - $ref: '#/components/parameters/UnitSlug'
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                ticketId:
                  type: string
                desk:
                  type: string
      responses:
        '200':
          description: Chamada publicada no painel em tempo real
  /api/v1/tv/{unitSlug}/stream:
    get:
      tags: [TV]
      summary: Fluxo SSE do painel (atualização típica abaixo de 1s)
      operationId: tvStream
      security: []
      parameters:
        - $ref: '#/components/parameters/UnitSlug'
        - in: query
          name: chave
          schema:
            type: string
          description: Chave do painel da unidade
      responses:
        '200':
          description: text/event-stream
          content:
            text/event-stream:
              schema:
                type: string
  /api/v1/tv/{unitSlug}/heartbeat:
    post:
      tags: [TV]
      summary: Telemetria do player Full HD
      operationId: tvHeartbeat
      security: []
      parameters:
        - $ref: '#/components/parameters/UnitSlug'
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                chave:
                  type: string
                mode:
                  type: string
                  enum: [media, tickets, split]
                playerVersion:
                  type: string
      responses:
        '201':
          description: Heartbeat registrado
  /api/v1/webhooks/meta:
    get:
      tags: [Webhooks]
      security: []
      summary: Verificação do webhook pela Meta (hub.challenge)
      operationId: metaWebhookVerify
      parameters:
        - in: query
          name: hub.mode
          schema:
            type: string
        - in: query
          name: hub.verify_token
          schema:
            type: string
        - in: query
          name: hub.challenge
          schema:
            type: string
      responses:
        '200':
          description: Devolve o hub.challenge quando o token confere com META_VERIFY_TOKEN
        '403':
          description: Verificação recusada
    post:
      tags: [Webhooks]
      summary: Recebe mensagens do cidadão e status de entrega
      description: |
        Com META_MODE=live, a Meta assina o corpo no cabeçalho X-Hub-Signature-256 (HMAC SHA-256 com META_APP_SECRET).
        Com META_MODE=simulator, o operador do ensaio simula a mensagem recebida: exige a sessão do painel
        ou o cabeçalho X-WRP-Webhook-Secret.
      operationId: metaWebhook
      security:
        - bearerAuth: []
        - webhookSecret: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              description: No simulador, o corpo curto abaixo. No modo live, o corpo padrão da Cloud API (entry, changes, value).
              properties:
                from:
                  type: string
                  examples: ['5537990001002']
                text:
                  type: string
                  examples: ['PARAR']
                unitSlug:
                  type: string
                  examples: ['unidade-atendimento-geral']
      responses:
        '200':
          description: Evento registrado
        '401':
          description: Assinatura, sessão ou segredo ausente
  /api/v1/webhooks/chatwoot:
    post:
      tags: [Webhooks]
      summary: Recebe os eventos message_created e conversation_updated do Chatwoot
      description: |
        O Chatwoot assina cada entrega com o segredo do webhook: cabeçalhos X-Chatwoot-Timestamp e
        X-Chatwoot-Signature (sha256= seguido do HMAC SHA-256 de "<timestamp>.<corpo>").
        Também aceita a sessão do painel ou o cabeçalho X-WRP-Webhook-Secret.
      operationId: chatwootWebhook
      security:
        - bearerAuth: []
        - webhookSecret: []
        - chatwootSignature: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
      responses:
        '200':
          description: Evento tratado ou ignorado (nota privada, atividade, canal sem telefone)
        '401':
          description: Webhook não autorizado
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
    webhookSecret:
      type: apiKey
      in: header
      name: X-WRP-Webhook-Secret
    chatwootSignature:
      type: apiKey
      in: header
      name: X-Chatwoot-Signature
  parameters:
    MessageId:
      in: path
      name: id
      required: true
      schema:
        type: string
    UnitSlug:
      in: path
      name: unitSlug
      required: true
      schema:
        type: string
        examples: [unidade-centro-saude, unidade-atendimento-geral, unidade-prefeitura-sede]
`;
