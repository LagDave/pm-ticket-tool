-- Ticket share + enrichment (PostgreSQL reference DDL).
-- SCAFFOLD for plans/06252026-rich-ticket-shareable-link. The Knex migration
-- (knexmigration.ts -> src/database/migrations/) is the source of truth that runs;
-- this file is the plain-SQL equivalent for review. Postgres-only app — MSSQL N/A.

-- 1) Add nullable columns.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS share_token text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority    text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS details     jsonb;

-- 2) Backfill a unique share token for every existing row.
--    The Knex migration uses the app's shareToken util (256-bit base64url) per row.
--    Pure-SQL equivalent (requires pgcrypto) — TODO: confirm extension at execution:
--    UPDATE tickets
--       SET share_token = replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_')
--     WHERE share_token IS NULL;

-- 3) Enforce NOT NULL + UNIQUE on share_token (public lookup filters on it — §10.4).
-- ALTER TABLE tickets ALTER COLUMN share_token SET NOT NULL;
-- ALTER TABLE tickets ADD CONSTRAINT tickets_share_token_unique UNIQUE (share_token);

-- 4) Constrain priority to the tier set (nullable until generation sets it).
-- ALTER TABLE tickets ADD CONSTRAINT tickets_priority_check
--   CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low'));
