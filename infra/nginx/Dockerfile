FROM node:22.23.5-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts
COPY apps/web apps/web
RUN npm run build -w @wrp/web

# Base Debian oficial fixada por digest; já traz o openssl usado pelo docker-entrypoint.sh.
FROM nginx:1.31.9@sha256:08f354a3b44c422021a5c0f5efb3e27f8f90236b5447d3bac4053f5f50ab6760
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/app.conf infra/nginx/proxy.conf /etc/nginx/wrp/
COPY infra/nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=web /app/apps/web/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.sh
EXPOSE 8080 8443
ENTRYPOINT ["/docker-entrypoint.sh"]
