#!/bin/sh
# PostgreSQL container first-start script (docker-entrypoint-initdb.d), Unit 9.
# Creates the two accounts of SEC-INF-03: tb_owner runs the migrations and owns the schemas;
# tb_app is the application's account and cannot change the schema. Passwords come from the
# environment (Compose secrets in production). Runs once, when the data volume is empty.
set -eu
: "${TB_OWNER_PASSWORD:?TB_OWNER_PASSWORD is required}"
: "${TB_APP_PASSWORD:?TB_APP_PASSWORD is required}"
DB="${TB_DATABASE:-trustbazaar}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
     -v owner_pw="$TB_OWNER_PASSWORD" -v app_pw="$TB_APP_PASSWORD" -v db="$DB" <<'SQL'
SET password_encryption = 'scram-sha-256';
CREATE ROLE tb_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE ROLE tb_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;
SELECT format('CREATE DATABASE %I OWNER tb_owner', :'db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO tb_app', :'db') \gexec
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO tb_owner;
-- The extensions (citext, pgcrypto, pg_trgm) live in public. Without USAGE, tb_app cannot find their
-- functions and operators by name: the audit chain trigger's digest() fails, and citext comparisons
-- silently fall back to case-sensitive text. USAGE only: tb_app still cannot create anything here.
GRANT USAGE ON SCHEMA public TO tb_app;
SQL
