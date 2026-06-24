-- Code scout — PostgreSQL schema (canonical for this app; runs on Docker Postgres :8765)
-- FINALIZED at execution (-x). Mirror of the applied Knex migration
-- src/database/migrations/20260624000004_scout_cache_schema.ts (the source of
-- truth run by `npm run migrate`). App is Postgres-only: there is no mssql.sql
-- by design (mirrors foundation's migration convention deviation).

-- ============================================================
-- scout_cache — the cached scout result per session
-- The scout runs ONCE per session; later turns read this row (read-through), they never re-scan.
-- Owner-scoped through interview_sessions (§11.7 / §5.5); findings are orientation-only, tagged "verify".
-- Design: NOT UNIQUE on session_id — the model reads the NEWEST row per session,
-- so a re-point to a different repo_ref appends a new row (history preserved),
-- exactly like decision_record. The service still scans only once per session.
-- ============================================================
CREATE TABLE scout_cache (
    id          BIGSERIAL PRIMARY KEY,
    session_id  BIGINT      NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
    provider    TEXT        NOT NULL,   -- 'github' | 'azure' (azure provider is a later spec)
    repo_ref    TEXT        NOT NULL,   -- which repo this scan pointed at (see spec Pushback)
    findings    JSONB       NOT NULL,   -- relevant areas + what exists / rough size / what it touches + effort hints, tagged "verify"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT scout_cache_provider_check CHECK (provider IN ('github', 'azure'))
);
CREATE INDEX scout_cache_session_id_index ON scout_cache (session_id);  -- §10.4 join column

-- Down:
--   ALTER TABLE scout_cache DROP CONSTRAINT IF EXISTS scout_cache_provider_check;
--   DROP TABLE IF EXISTS scout_cache;
