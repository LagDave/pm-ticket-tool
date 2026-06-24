/**
 * Triage — schema change migration (Knex, PostgreSQL).
 * Small additive change to interview_sessions: records the two-speed triage
 * label on the session row (spec 7 T2). triage_result drives routing (simple →
 * ticket-draft spec 3, scoped → interview spec 2); triaged_at records when the
 * classification ran. Owner scope is enforced in models via the session owner
 * (§11.7). Postgres-only app — no MSSQL counterpart by design (foundation Risk).
 *
 * triage_result is locked to simple|scoped via a CHECK constraint (it allows
 * NULL — a session is un-triaged until the classifier runs). No index is added:
 * the dashboard (spec 4) does not filter on triage_result, so §10.4 says skip it.
 */
import type { Knex } from "knex";

/** The two triage labels (spec What). Named, not magic (§4.2). */
const TRIAGE_RESULTS = ["simple", "scoped"] as const;

const TRIAGE_RESULT_CHECK = "interview_sessions_triage_result_check";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("interview_sessions", (t) => {
    // simple | scoped; NULL until the classifier runs (spec T2).
    t.text("triage_result").nullable();
    // When the classification ran. `{ useTz: true }` yields a Postgres
    // timestamptz (timestamp WITH time zone), per the migration directive.
    t.timestamp("triaged_at", { useTz: true }).nullable();
  });

  // CHECK constraint via raw DDL (Knex has no first-class check builder on
  // alter). Parameter-free constant SQL, scoped to a models'-owned migration
  // file only (§10.2). triage_result allows NULL (un-triaged) but, when set,
  // must be one of the locked labels.
  const resultList = TRIAGE_RESULTS.map((r) => `'${r}'`).join(", ");
  await knex.raw(
    `ALTER TABLE interview_sessions ADD CONSTRAINT ${TRIAGE_RESULT_CHECK} ` +
      `CHECK (triage_result IS NULL OR triage_result IN (${resultList}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE interview_sessions DROP CONSTRAINT IF EXISTS ${TRIAGE_RESULT_CHECK}`,
  );
  await knex.schema.alterTable("interview_sessions", (t) => {
    t.dropColumn("triaged_at");
    t.dropColumn("triage_result");
  });
}
