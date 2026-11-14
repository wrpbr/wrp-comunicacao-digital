#!/bin/sh
set -eu
mkdir -p /etc/nginx/certs /etc/nginx/wrp
if [ ! -f /etc/nginx/certs/poc.crt ] || [ ! -f /etc/nginx/certs/poc.key ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout /etc/nginx/certs/poc.key \
    -out /etc/nginx/certs/poc.crt \
    -subj "/CN=localhost/O=WRP Comunicacao Digital/OU=POC Pompeu" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi

# WRP_TRUSTED_PROXY: faixas de rede (separadas por vírgula) da borda que já fez o TLS e que
# informa o endereço do visitante em X-Real-IP. Vazio: este Nginx é a borda e termina o TLS.
: > /etc/nginx/wrp/realip.conf
if [ -n "${WRP_TRUSTED_PROXY:-}" ]; then
  for range in $(printf '%s' "$WRP_TRUSTED_PROXY" | tr ',' ' '); do
    case "$range" in
      *[!0-9a-fA-F.:/]*)
        echo "WRP_TRUSTED_PROXY inválido: $range" >&2
        exit 1
        ;;
    esac
    printf 'set_real_ip_from %s;\n' "$range" >> /etc/nginx/wrp/realip.conf
  done
  printf 'real_ip_header X-Real-IP;\n' >> /etc/nginx/wrp/realip.conf
  printf 'include /etc/nginx/wrp/app.conf;\n' > /etc/nginx/wrp/http.conf
else
  printf 'return 308 https://$host:%s$request_uri;\n' "${WRP_HTTPS_PORT:-8443}" > /etc/nginx/wrp/http.conf
fi

exec nginx -g 'daemon off;'
