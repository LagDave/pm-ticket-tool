-- Ticket draft — PostgreSQL schema changes (canonical for this app; runs on Docker Postgres :8765)
-- Planning scaffold. DDL is filled during execution (-x). -- TODO markers mark unfinished sections.
-- App is Postgres-only: there is no mssql.sql by design (see spec Risk → migration convention deviation).
--
-- Foundation created the tickets shell. This finalizes its columns, adds rendered_markdown,
-- and adds the ticket_comments child table (child table over jsonb — see spec Pushback).

-- ============================================================
-- tickets — finalize the generated PM ticket (story + Given/When/Then + effort tier); persisted, versioned
-- Foundation shell already has: user_story TEXT, acceptance_criteria JSONB, effort TEXT,
-- status TEXT DEFAULT 'draft', version INTEGER DEFAULT 1.
-- ============================================================
ALTER TABLE tickets
    ADD COLUMN rendered_markdown TEXT NULL;   -- canonical copy-paste Markdown, written on generate + finalize
-- TODO: ALTER COLUMN effort — constrain to a tier enum/CHECK (XS|S|M|L|XL), never hours (see spec Constraints)
-- TODO: status CHECK constraint (status IN ('draft','final'))  -- foundation left this open
-- TODO: confirm acceptance_criteria holds an array of { given, when, then } blocks
-- TODO: fill during execution — backfill / default reconciliation for existing draft rows
-- TODO: CREATE INDEX ON tickets (session_id);  -- §10.4 join column (foundation noted this as TODO)

-- ============================================================
-- ticket_comments — one row per PM comment on a ticket; queryable + attributable (not a jsonb blob)
-- ============================================================
CREATE TABLE ticket_comments (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id      BIGINT      NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
    author_user_id BIGINT      NOT NULL,
    body           TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    -- TODO: decide soft-delete (deleted_at) vs hard-delete for comments
);
-- TODO: CREATE INDEX ON ticket_comments (ticket_id);  -- §10.4 join/filter column
