/**
 * Scout teardown — drop scout_jobs then scout_cache (Knex, PostgreSQL). T14.
 * The code scout is removed (replaced by human-curated project bits), so its two
 * tables are dropped. Both referenced interview_sessions (ON DELETE CASCADE) — they
 * are the referrers, so they drop cleanly; scout_jobs first by convention. The data
 * is abandoned by design: down() restores only the empty STRUCTURE (so a rollback
 * leaves a consistent schema), never the discarded findings/jobs. Postgres-only app.
 */
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("scout_jobs");
  await knex.schema.dropTableIfExists("scout_cache");
}

export async function down(knex: Knex): Promise<void> {
  // Best-effort STRUCTURAL restore only — the dropped rows are not recoverable.
  // Mirrors the original 20260624 scout migrations closely enough for a consistent
  // rollback; CHECK constraints are omitted (an abandoned feature needs none).
  const hasCache = await knex.schema.hasTable("scout_cache");
  if (!hasCache) {
    await knex.schema.createTable("scout_cache", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("session_id")
        .notNullable()
        .references("id")
        .inTable("interview_sessions")
        .onDelete("CASCADE");
      t.text("provider").notNullable();
      t.text("repo_ref").notNullable();
      t.jsonb("findings").notNullable();
      t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(["session_id"]);
    });
  }
  const hasJobs = await knex.schema.hasTable("scout_jobs");
  if (!hasJobs) {
    await knex.schema.createTable("scout_jobs", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("session_id")
        .notNullable()
        .references("id")
        .inTable("interview_sessions")
        .onDelete("CASCADE");
      t.text("provider").notNullable();
      t.text("repo_ref").notNullable();
      t.text("status").notNullable().defaultTo("pending");
      t.integer("attempts").notNullable().defaultTo(0);
      t.text("last_error").nullable();
      t.timestamps(true, true);
      t.index(["session_id"]);
    });
  }
}
