/**
 * Session title — schema change migration (Knex, PostgreSQL).
 * Small additive change to interview_sessions: a concise, generated display
 * title for the dashboard (User QA: auto-generated session title). `title` is
 * generated at session create (from original_request) and replaced after the
 * ticket is finalized (from the finalized ticket). Nullable so an old row, or a
 * row whose title generation failed, simply has no title and the UI falls back
 * to the request snippet. Owner scope is enforced in models via the session
 * owner (§11.7). Postgres-only app — no MSSQL counterpart by design (foundation
 * Risk).
 *
 * No index is added: the dashboard (spec 4) does not filter or sort on title,
 * so §10.4 says skip it.
 */
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("interview_sessions", (t) => {
    // Concise generated label; NULL until generation runs (or if it failed).
    t.text("title").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("interview_sessions", (t) => {
    t.dropColumn("title");
  });
}
