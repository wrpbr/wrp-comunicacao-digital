FROM node:22.23.5-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts
COPY apps/web apps/web
RUN npm run build -w @wrp/web

FROM nginx:1.30.6-alpine
RUN apk add --no-cache openssl
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/app.conf infra/nginx/proxy.conf /etc/nginx/wrp/
COPY infra/nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=web /app/apps/web/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.sh
EXPOSE 8080 8443
ENTRYPOINT ["/docker-entrypoint.sh"]
