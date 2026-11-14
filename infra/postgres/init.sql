-- Banco do Chatwoot no mesmo PostgreSQL do POC.
-- A senha vem da variável CHATWOOT_DB_PASSWORD do serviço `postgres` no compose.
\getenv chatwoot_password CHATWOOT_DB_PASSWORD
CREATE USER chatwoot WITH PASSWORD :'chatwoot_password';
CREATE DATABASE chatwoot_production OWNER chatwoot;

-- As extensões que o esquema do Chatwoot habilita entram pelo superusuário:
-- pg_stat_statements não pode ser criada pelo dono do banco.
\connect chatwoot_production
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
