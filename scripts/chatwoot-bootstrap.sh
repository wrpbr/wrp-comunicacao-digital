#!/bin/sh
# Reaplica a preparação do Chatwoot Community Edition: conta do município, atendentes, filas por unidade,
# webchat com expediente e texto fixo de fora do expediente, respostas prontas e o webhook assinado
# para a API do WRP. O roteiro é infra/chatwoot/bootstrap.rb.
#
# O `docker compose up -d` já roda esta preparação antes de o Chatwoot subir. Use este atalho depois de
# mudar o roteiro ou o .env. Repetir não apaga conversa nem troca senha. Não cria robô nem agente de IA.
set -eu
cd "$(dirname "$0")/.."
exec docker compose run --rm chatwoot-bootstrap
