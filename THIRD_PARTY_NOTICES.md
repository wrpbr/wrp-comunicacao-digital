# Avisos de terceiros

O código original da WRP é proprietário. Ver `LICENSE`.

## Dependências diretas da aplicação

Licença declarada por cada pacote na versão travada no `package-lock.json`.

| Componente | Licença |
| --- | --- |
| Fastify e plugins oficiais (`@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/websocket`) | MIT |
| Zod | MIT |
| pg | MIT |
| ioredis | MIT |
| otplib 12 | MIT |
| qrcode | MIT |
| swagger-ui-dist | Apache-2.0 |
| React, React DOM, react-router-dom | MIT |
| Radix UI (`react-dialog`, `react-label`, `react-slot`) | MIT |
| class-variance-authority | Apache-2.0 |
| clsx, tailwind-merge | MIT |
| Vite, `@vitejs/plugin-react` | MIT |
| Tailwind CSS, PostCSS, Autoprefixer | MIT |
| TypeScript | Apache-2.0 |
| tsx, Vitest, Concurrently | MIT |

As dependências indiretas declaram MIT, ISC, Apache-2.0, BSD-3-Clause, BlueOak-1.0.0 e 0BSD. Duas observações:

- `thirty-two`, usada pelo otplib, não declara a licença no registro do npm. O arquivo `LICENSE.txt` do repositório dela traz o texto da licença MIT (Copyright (c) 2011, Chris Umbel).
- `caniuse-lite` é uma base de dados sob CC-BY-4.0, usada só na compilação do painel. Ela não vai para o navegador nem para a API.

## Imagens do `docker compose`

| Imagem | O que é | Licença do componente |
| --- | --- | --- |
| `node:22.23.5-bookworm-slim` | Node.js 22, base da API e da compilação do painel | MIT (o runtime) |
| `nginx:1.30.6-alpine` | Nginx, borda com TLS | BSD-2-Clause |
| `pgvector/pgvector:0.8.7-pg16` | PostgreSQL 16 com a extensão pgvector, que o Chatwoot exige | PostgreSQL License (os dois) |
| `redis:7.2.17-alpine` | Redis 7.2, fila do Chatwoot e barramento dos painéis de TV | BSD-3-Clause |
| `chatwoot/chatwoot:v4.19.1-ce` | Chatwoot Community Edition, atendimento humano | MIT |

O Redis fica na série 7.2 de propósito: a partir da 7.4 o Redis deixou a licença BSD. A imagem do Nginx recebe também o pacote `openssl` do Alpine (Apache-2.0), usado para gerar o certificado da demonstração local.

As imagens trazem ainda o sistema operacional de base (Debian ou Alpine) e as bibliotecas de cada projeto, cada uma com a sua licença. O código da WRP não copia nem altera nenhum desses componentes: o `docker compose` baixa as imagens oficiais e as configura.

## Conteúdo exibido

O vídeo da playlist da UBS Centro é “Viaje com a vacinação em dia”, do canal oficial do Ministério da Saúde no YouTube. O painel não copia o vídeo: ele é exibido pelo player incorporado do YouTube, com o crédito no rodapé. As demais peças da TV são artes originais da WRP para a demonstração.

O painel usa as fontes do sistema. Nenhuma fonte é carregada de terceiros.

## O que não entra

Não há dependência Baileys, whatsapp-web.js, Venom, Puppeteer ou Chromium de automação de WhatsApp. O envio usa só a Cloud API oficial da Meta.
