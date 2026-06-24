-- Project Context & Bits Grounding — PostgreSQL schema (reference DDL)
-- The app is Postgres-only (foundation Risk). Real migrations land as Knex TS files
-- in src/database/migrations/ during execution; this file is the schema contract.
-- Mirrors the style of 20260624000004_scout_cache_schema.ts (timestamptz, CHECK via
-- raw DDL in-migration, index what you filter on — §10.x).

-- ── T1a: projects ──────────────────────────────────────────────────────────
CREATE TABLE projects (
  id              BIGSERIAL PRIMARY KEY,
  owner_user_id   BIGINT       NOT NULL,                 -- §11.7 owner scope (mirrors interview_sessions)
  organization_id BIGINT       NULL,                     -- nullable in v1 (single-tenant placeholder)
  name            TEXT         NOT NULL,
  description     TEXT         NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_user_id_idx ON projects (owner_user_id);   -- §10.4 list path filters owner

-- ── T1b: project_bits ──────────────────────────────────────────────────────
-- bit_key is a cosmetic label; dedup is semantic (reconciliation agent) — so NO
-- unique (project_id, bit_key) constraint by design.
CREATE TABLE project_bits (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT       NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind            TEXT         NOT NULL,                  -- CHECK below
  bit_key         TEXT         NOT NULL,                  -- human-readable topic label, e.g. "auth"
  summary         TEXT         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'active', -- CHECK below
  source          TEXT         NOT NULL DEFAULT 'manual', -- CHECK below
  source_ticket_id BIGINT      NULL REFERENCES tickets (id) ON DELETE SET NULL, -- merge-on-complete provenance
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE project_bits ADD CONSTRAINT project_bits_kind_check
  CHECK (kind IN ('feature', 'constraint', 'integration', 'tech_stack', 'inventory'));
ALTER TABLE project_bits ADD CONSTRAINT project_bits_status_check
  CHECK (status IN ('active', 'superseded'));
ALTER TABLE project_bits ADD CONSTRAINT project_bits_source_check
  CHECK (source IN ('manual', 'imported', 'merged'));
CREATE INDEX project_bits_project_id_idx        ON project_bits (project_id);             -- §10.4 read path
CREATE INDEX project_bits_project_status_idx    ON project_bits (project_id, status);     -- grounding loads active bits

-- ── T1c: interview_sessions.project_id ──────────────────────────────────────
-- Nullable so existing + ungrounded sessions keep working; the grounded/ungrounded
-- branch in InterviewEngineService keys off presence of bits for this project.
ALTER TABLE interview_sessions
  ADD COLUMN project_id BIGINT NULL REFERENCES projects (id) ON DELETE SET NULL;
CREATE INDEX interview_sessions_project_id_idx ON interview_sessions (project_id);

-- ── T14: scout teardown (Wave 3 — separate migration, runs LAST) ────────────
-- Drop order matters; both reference interview_sessions and are the referrers.
-- Data is abandoned by design (the scout is removed). down() recreates empty schema only.
-- DROP TABLE IF EXISTS scout_jobs;
-- DROP TABLE IF EXISTS scout_cache;
