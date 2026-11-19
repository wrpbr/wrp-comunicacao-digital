# Segurança e LGPD

Este texto descreve o que o POC já faz. A Procuradoria de Pompéu revisa a política publicada em `/privacidade` antes de qualquer operação.

## Controle de acesso

Perfis: `admin`, `gestor`, `atendente`, `lancador_fila` e `auditor`. A API recusa com 403 a ação fora do perfil; o menu do painel só mostra o que o perfil usa.

Administrador e gestor entram com senha e código TOTP (otplib, passo de 30 segundos, aceitando um passo de diferença no relógio). Os demais perfis usam só a senha. A senha fica guardada como hash scrypt. A sessão dura 12 horas, e o servidor guarda só o SHA-256 do token entregue ao navegador.

Tentativas de login têm freio por conta, além do limite por endereço da borda. As quatro primeiras falhas em 24 horas não impõem espera. A quinta impõe 30 segundos, e cada falha seguinte dobra a espera, até 1 hora. Durante a espera a API responde 429 com `Retry-After`, mesmo para a senha certa, e o acerto zera a contagem. A senha e o código TOTP têm contagens separadas. O critério é o da NIST SP 800-63B-4, seção 3.2.2. O endereço que já concluiu um login na conta tem contagem própria nela: quem erra a senha de fora faz esperar os endereços desconhecidos, e não o servidor que entra sempre da mesma rede.

O lançador emite senha de fila e não chama. O atendente chama e não emite. O auditor lê auditoria, relatórios e cadastro, e não dispara campanha nem registra ou reverte opt-out.

## Transporte e borda

O Nginx do compose atende em TLS 1.2 e TLS 1.3, e o HTTP só redireciona para o HTTPS. Ele envia `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`, e limita cada endereço a 30 requisições por segundo, com rajada curta, antes de a requisição chegar à API. O corpo aceito é de até 2 MB.

A imagem do Nginx é a oficial de base Debian, fixada por digest em `infra/nginx/Dockerfile`, na mesma versão da borda que publica o sistema: 1.31.9 desde 19/11/2026, com as correções de HTTP/2, HTTP/3 e resolver dessa versão. Não use a variante Alpine, que o projeto deixou depois que o Alpine reconstruiu do zero o próprio GitLab, alvo de uma tentativa de ataque cujo sucesso não pôde descartar. Ao atualizar, troque a versão e o digest juntos; tag sem digest não entra.

A API soma Helmet, CORS restrito a `CORS_ORIGIN` e o limite de 300 requisições por minuto por endereço (`@fastify/rate-limit`). O corpo de cada rota é validado com Zod.

PostgreSQL e Redis não publicam porta no host: só os serviços do compose falam com eles, pela rede interna. A API também não publica porta; o acesso é sempre pelo Nginx.

O endereço do visitante que vai para a auditoria e para o limite por IP é o que o Nginx viu na conexão. Se outro proxy fizer o TLS na frente, a faixa de rede dele entra em `WRP_TRUSTED_PROXY`, e só então o Nginx aceita o endereço informado por esse proxy em `X-Real-IP`. O que o visitante escreve em `X-Forwarded-For` nunca é usado.

## Segredos

Não há segredo de produção no código. Os valores do `docker-compose.yml` são de demonstração local e estão neste repositório público.

`SECRETS_KEY` é a origem da chave AES-256-GCM que cifra o token da WABA, os segredos TOTP e a chave de cada painel de TV.

Dois controles impedem que os valores de demonstração cheguem a um endereço público:

- `DEMO_HINTS=false` tira da tela de login a senha, o segredo e o código de demonstração, e troca a chave fixa dos painéis de TV por uma chave aleatória. Com as dicas desligadas, a API se recusa a subir se `SECRETS_KEY`, `WEBHOOK_SECRET`, `DEMO_PASSWORD` ou `DEMO_TOTP_SECRET` ainda forem os valores deste repositório.
- Fora do modo demonstração (`DEMO_MODE=false`), `SECRETS_KEY` e `WEBHOOK_SECRET` são obrigatórios e não podem ser os valores deste repositório. `NODE_ENV=production` só aceita `DEMO_MODE=true` com `ALLOW_DEMO_MODE=true`.

## Webhooks

| Entrada | Quem pode chamar |
| --- | --- |
| `POST /api/v1/webhooks/meta` com `META_MODE=live` | Só a Meta: a API confere `X-Hub-Signature-256`, o HMAC-SHA256 do corpo com `META_APP_SECRET`. |
| `POST /api/v1/webhooks/meta` no simulador | Quem tem sessão no painel, ou quem envia `X-WRP-Webhook-Secret`. Visitante anônimo recebe 401. |
| `POST /api/v1/webhooks/chatwoot` | O Chatwoot, pela assinatura `X-Chatwoot-Signature` (HMAC-SHA256 de `<X-Chatwoot-Timestamp>.<corpo>` com o `WEBHOOK_SECRET`). Sessão do painel e `X-WRP-Webhook-Secret` também valem, para teste. |

A verificação do webhook da Meta (`GET /api/v1/webhooks/meta`) responde ao desafio só com o `META_VERIFY_TOKEN` certo.

## LGPD no fluxo

O cidadão cancela pelo WhatsApp, com as palavras `PARAR`, `SAIR` e `OPT-OUT`: a mensagem prova que o número é dele. Quem pede no balcão é atendido por um servidor, que registra o pedido pelo botão do painel ou por `POST /api/v1/opt-out`. Essa rota exige sessão de administrador, gestor ou atendente; sem sessão ela responde 401, para que um visitante não tire o telefone de outra pessoa dos avisos. Reverter o opt-out e marcar exceção legal é só de administrador e gestor. O bloqueio vale na hora para campanha, aniversário e canal de servidores.

A exceção do art. 7º só é usada se o cadastro tiver `legalException` e a campanha declarar que honra essa base. Urgência não ignora opt-out.

O painel de senha pode mostrar o nome completo ou a forma reduzida (`Maria S.`). Partículas como da, de, do, das, dos e e não viram a inicial. A API pública da TV não devolve o sobrenome oculto.

A auditoria só aceita acréscimo: no PostgreSQL, um gatilho recusa `UPDATE` e `DELETE` em `audit_logs`. A exportação traz `X-Export-Checksum` e `X-Content-SHA256` com o SHA-256 do corpo.

Transferência internacional: a política em `/privacidade` declara que ela só ocorre nas hipóteses do art. 33 da Lei 13.709/2018. A WhatsApp Cloud API é operada pela Meta, que pode tratar as mensagens fora do Brasil. O Chatwoot roda no mesmo servidor do sistema, com a telemetria desligada. O vídeo da TV é exibido pelo player do YouTube no modo de privacidade (`youtube-nocookie.com`).

## O que este POC não afirma

- Não há pentest nem laudo de segurança de terceiro.
- Não há termo de encarregado assinado. A caixa `encarregado@pompeu.mg.gov.br` é só a sugestão de endereço a criar pelo município.
- O certificado TLS gerado na primeira subida do Nginx é autoassinado, para a demonstração local. Num endereço público, o certificado é o da borda que publica o sistema.
- O compose não cifra o volume do banco. A cifra em repouso do banco inteiro depende do disco do servidor. No nível da aplicação, ficam cifrados o token da WABA, os segredos TOTP e as chaves dos painéis.
- O compose não traz WAF. A proteção contra OWASP Top 10 e a mitigação de negação de serviço antes da aplicação ficam na borda que publica o sistema.
- O freio de tentativas de login fica na memória da API: reiniciar o serviço zera as contagens. Ele só existe para e-mail cadastrado, então a espera e o tempo de resposta permitem a um terceiro descobrir se um e-mail tem conta.
- Backup em outra localidade, varredura periódica de vulnerabilidades e plano de resposta a incidentes são da operação contratada, não deste POC.
