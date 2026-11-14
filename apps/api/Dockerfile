FROM node:22.23.5-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts
COPY apps/api apps/api
RUN npm run build -w @wrp/api

# Imagem de execução: só as dependências de produção da API, sem privilégio de root.
FROM node:22.23.5-bookworm-slim
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=43110
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @wrp/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 43110
CMD ["node", "apps/api/dist/index.js"]
