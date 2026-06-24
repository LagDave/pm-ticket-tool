/**
 * Code scout — schema change migration (Knex, PostgreSQL).
 * Adds scout_cache: the per-session store of the scout's structured findings
 * (spec 5 T3). The scout runs ONCE per session; this row is the read-through
 * cache every later turn reads instead of re-scanning (spec What). Owner scope
 * is enforced in the model via the session owner (§11.7) — scout_cache has no
 * direct owner column; it is reached through an owner-verified session, like
 * decision_record and interview_turns.
 *
 * provider is locked to github|azure via a CHECK constraint (the source-agnostic
 * provider set; Azure is a deferred later spec but the column allows it now so no
 * migration is needed when it lands). session_id is indexed (§10.4) — the cache
 * read path filters on it. Postgres-only app — no MSSQL counterpart by design
 * (foundation Risk).
 */
import type { Knex } from "knex";

/** The source-agnostic provider set (mirrors CodeContextProviderId). Named, not magic (§4.2). */
const SCOUT_PROVIDERS = ["github", "azure"] as const;

const SCOUT_PROVIDER_CHECK = "scout_cache_provider_check";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("scout_cache", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("session_id")
      .notNullable()
      .references("id")
      .inTable("interview_sessions")
      .onDelete("CASCADE");
    // github | azure — the source the findings came from (spec T5).
    t.text("provider").notNullable();
    // Provider-native repo identifier, e.g. "owner/name" for GitHub (spec T5).
    t.text("repo_ref").notNullable();
    // Structured ScoutFindings (summary + relevant areas + verify flag), JSONB.
    t.jsonb("findings").notNullable();
    // `{ useTz: true }` yields a Postgres timestamptz, per the migration directive.
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["session_id"]); // §10.4 — the cache read path filters on session_id.
  });

  // CHECK constraint via raw DDL (Knex has no first-class check builder on
  // create). Parameter-free constant SQL, scoped to a models'-owned migration
  // file only (§10.2). provider must be one of the locked source ids.
  const providerList = SCOUT_PROVIDERS.map((p) => `'${p}'`).join(", ");
  await knex.raw(
    `ALTER TABLE scout_cache ADD CONSTRAINT ${SCOUT_PROVIDER_CHECK} ` +
      `CHECK (provider IN (${providerList}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE scout_cache DROP CONSTRAINT IF EXISTS ${SCOUT_PROVIDER_CHECK}`,
  );
  await knex.schema.dropTableIfExists("scout_cache");
}
