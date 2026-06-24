/**
 * Triage — schema change migration (Knex, PostgreSQL). FINAL (executed -x).
 * Mirror of src/database/migrations/20260624000003_triage_schema.ts (the live
 * migration; this copy is the plan-folder record). Postgres-only app — no MSSQL
 * counterpart by design.
 *
 * Small additive change to interview_sessions: records the two-speed triage label
 * on the session row. triage_result drives routing (simple → ticket-draft spec 3,
 * scoped → interview spec 2); triaged_at records when it ran. triage_result is
 * locked to simple|scoped via a CHECK constraint (NULL = not yet triaged). No
 * index: the dashboard (spec 4) does not filter on triage_result (§10.4).
 */

const TRIAGE_RESULTS = ["simple", "scoped"];
const TRIAGE_RESULT_CHECK = "interview_sessions_triage_result_check";

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable("interview_sessions", (t) => {
    t.text("triage_result").nullable(); // simple | scoped; NULL = not yet triaged
    t.timestamp("triaged_at", { useTz: true }).nullable(); // timestamptz
  });
  const resultList = TRIAGE_RESULTS.map((r) => `'${r}'`).join(", ");
  await knex.raw(
    `ALTER TABLE interview_sessions ADD CONSTRAINT ${TRIAGE_RESULT_CHECK} ` +
      `CHECK (triage_result IS NULL OR triage_result IN (${resultList}))`,
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.raw(
    `ALTER TABLE interview_sessions DROP CONSTRAINT IF EXISTS ${TRIAGE_RESULT_CHECK}`,
  );
  await knex.schema.alterTable("interview_sessions", (t) => {
    t.dropColumn("triaged_at");
    t.dropColumn("triage_result");
  });
};
