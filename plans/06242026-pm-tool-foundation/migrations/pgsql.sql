-- Foundation — PostgreSQL schema (canonical for this app; runs on Docker Postgres :8765)
-- Reference DDL. The executable source of truth is the Knex migration at
-- src/database/migrations/20260624000001_foundation_base_schema.ts (run via `npm run migrate`).
-- App is Postgres-only: there is no mssql.sql by design (see spec Risk -> migration convention deviation).

-- ============================================================
-- interview_sessions — one row per interview the PM starts
-- Owner-scoped per §11.7 / §5.5 (owner_user_id required; organization_id nullable for future multi-tenant)
-- ============================================================
CREATE TABLE interview_sessions (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id    BIGINT      NOT NULL,
    organization_id  BIGINT      NULL,                              -- nullable v1; see spec Pushback
    status           TEXT        NOT NULL DEFAULT 'draft',          -- draft | in_progress | awaiting_input | complete | archived
    original_request TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX interview_sessions_owner_user_id_status_index
    ON interview_sessions (owner_user_id, status);  -- §10.4 filter columns

-- ============================================================
-- interview_turns — write-through log of each generated batch + answers (enables resume by replay)
-- ============================================================
CREATE TABLE interview_turns (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id  BIGINT      NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
    turn_index  INTEGER     NOT NULL,
    questions   JSONB       NOT NULL,   -- the generated batch (<=4 grounded questions + options + effort tags)
    answers     JSONB       NULL,       -- PM answers; null until answered
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, turn_index)
);
CREATE INDEX interview_turns_session_id_index
    ON interview_turns (session_id);  -- §10.4 join column

-- ============================================================
-- decision_record — structured decisions (NOT chat text), the spine that prunes questions and becomes the ticket
-- ============================================================
CREATE TABLE decision_record (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id  BIGINT      NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
    key         TEXT        NOT NULL,   -- e.g. 'link_format', 'expiration', 'persist_to_dashboard'
    value       JSONB       NOT NULL,   -- chosen value (+ chosen option id / free-text)
    source      TEXT        NOT NULL,   -- answer | scout | default
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    -- Append-only in foundation; engine spec decides last-write-wins vs versioning.
);
CREATE INDEX decision_record_session_id_index
    ON decision_record (session_id);  -- §10.4

-- ============================================================
-- tickets — the generated PM ticket (story + Given/When/Then + effort); persisted, versioned
-- ============================================================
CREATE TABLE tickets (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id          BIGINT      NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
    user_story          TEXT        NULL,
    acceptance_criteria JSONB       NULL,   -- array of Given/When/Then blocks
    effort              TEXT        NULL,   -- summary effort/complexity tier
    status              TEXT        NOT NULL DEFAULT 'draft',  -- draft | final
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    -- ticket-draft spec owns columns; foundation creates the table shell only.
);
CREATE INDEX tickets_session_id_index
    ON tickets (session_id);  -- §10.4
