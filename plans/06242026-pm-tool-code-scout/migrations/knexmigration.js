/**
 * Code scout — scout_cache migration (Knex, PostgreSQL).
 * FINALIZED at execution (-x). The applied, TypeScript source of truth is
 * src/database/migrations/20260624000004_scout_cache_schema.ts (run by
 * `npm run migrate`); this .js mirror is the plan-folder copy. Postgres-only app
 * — no MSSQL counterpart by design.
 *
 * Table: scout_cache — the cached scout result per session (run once, read-
 * through thereafter). Owner-scoped through interview_sessions (§11.7); index
 * the join column (§10.4). provider locked to github|azure via CHECK. NOT unique
 * on session_id — the model reads the newest row per session (append on re-point),
 * like decision_record.
 */
const SCOUT_PROVIDERS = ["github", "azure"];
const SCOUT_PROVIDER_CHECK = "scout_cache_provider_check";

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable("scout_cache", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("session_id").notNullable()
      .references("id").inTable("interview_sessions").onDelete("CASCADE");
    t.text("provider").notNullable();   // github | azure (azure provider is a later spec)
    t.text("repo_ref").notNullable();   // which repo this scan pointed at (see spec Pushback)
    t.jsonb("findings").notNullable();  // structured, orientation-only findings tagged "verify with engineering"
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["session_id"]); // §10.4 join column
  });

  const providerList = SCOUT_PROVIDERS.map((p) => `'${p}'`).join(", ");
  await knex.raw(
    `ALTER TABLE scout_cache ADD CONSTRAINT ${SCOUT_PROVIDER_CHECK} ` +
      `CHECK (provider IN (${providerList}))`,
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.raw(
    `ALTER TABLE scout_cache DROP CONSTRAINT IF EXISTS ${SCOUT_PROVIDER_CHECK}`,
  );
  await knex.schema.dropTableIfExists("scout_cache");
};
