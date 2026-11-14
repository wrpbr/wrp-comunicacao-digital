#!/bin/sh
# Volta a base de demonstração do WRP ao estado inicial, entre um ensaio e outro.
#
# Apaga o banco `wrp` inteiro (cadastros, campanhas, mensagens, senhas das filas e a trilha de auditoria
# do ensaio) e a API recria o cenário de demonstração ao subir. Só roda com DEMO_MODE=true.
# Não toca no Chatwoot: contas, filas e conversas dele ficam como estão.
#
# Uso: npm run ensaio:reset            pergunta antes de apagar
#      npm run ensaio:reset -- --sim   apaga sem perguntar
set -eu
cd "$(dirname "$0")/.."

# O valor vem da configuração efetiva do serviço (compose + .env), mesmo com a API parada.
demo_mode="$(docker compose run --rm --no-deps -T wrp-api printenv DEMO_MODE 2>/dev/null || true)"
if [ "$demo_mode" != "true" ]; then
  echo "Reset recusado: a API não está configurada com DEMO_MODE=true. Este comando apaga a base e só vale na demonstração." >&2
  exit 1
fi

if [ "${1:-}" != "--sim" ]; then
  printf 'Isto apaga a base de demonstração do WRP, inclusive a trilha de auditoria do ensaio.\nDigite "apagar" para continuar: '
  read -r answer
  if [ "$answer" != "apagar" ]; then
    echo "Nada foi alterado."
    exit 1
  fi
fi

docker compose stop wrp-api
docker compose exec -T postgres dropdb --force --if-exists -U wrp wrp
docker compose exec -T postgres createdb -U wrp -O wrp wrp
# Espera a API voltar saudável (healthcheck do compose) com o cenário de demonstração recriado.
docker compose up -d --wait wrp-api
# O Nginx guarda o endereço da API; recarregar faz ele procurar o container que acabou de subir.
docker compose exec -T nginx nginx -s reload
echo "Base de demonstração restaurada ao estado inicial. Entre de novo no painel: a sessão anterior deixou de valer."
