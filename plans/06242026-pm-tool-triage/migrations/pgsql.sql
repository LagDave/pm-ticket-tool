-- Triage — PostgreSQL schema change. FINAL (executed -x).
-- Canonical for this app; runs on Docker Postgres :8765. App is Postgres-only:
-- there is no mssql.sql by design (foundation spec Risk → migration convention).
-- This is the SQL equivalent of the live Knex migration
-- (src/database/migrations/20260624000003_triage_schema.ts); the app applies the
-- Knex file, this is the plan-folder record.
-- Small additive change: triage records its label on the existing session row. No new table.

-- ============================================================
-- interview_sessions — add the triage result of the two-speed path
-- triage_result: NULL until triaged, then 'simple' (→ ticket-draft, spec 3) or 'scoped' (→ interview, spec 2)
-- triaged_at:    when the classification ran (timestamptz)
-- ============================================================
ALTER TABLE interview_sessions
    ADD COLUMN triage_result TEXT        NULL,   -- simple | scoped; NULL = not yet triaged
    ADD COLUMN triaged_at    TIMESTAMPTZ NULL;   -- when the classification ran

-- triage_result is locked to the two labels (NULL allowed = un-triaged).
ALTER TABLE interview_sessions
    ADD CONSTRAINT interview_sessions_triage_result_check
    CHECK (triage_result IS NULL OR triage_result IN ('simple', 'scoped'));

-- No index on triage_result: the dashboard (spec 4) does not filter on it (§10.4).
