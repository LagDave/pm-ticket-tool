/**
 * Code scout — background-job queue migration (Knex, PostgreSQL).
 * Adds scout_jobs: the durable work queue that backs the scout as a background
 * job (deploy spec runtime Option C — §21). A scan is no longer run inline in
 * the request; the POST enqueues a `pending` row here and a processor (Vercel
 * Cron in prod, `npm run scout:work` locally) claims and runs it. This keeps the
 * request handler short so it fits Vercel's serverless function limits (deploy
 * spec Risk, §21.3 — the job calls the SAME CodeScoutService the request path
 * used to call inline).
 *
 * Columns:
 *  - status: pending | running | done | failed. `failed` is the dead-letter
 *    terminal state — a job that exhausts its retries lands here for inspection,
 *    never silently dropped (§21.2).
 *  - attempts: incremented on each failed run; at the cap the job is dead-lettered.
 *  - last_error: the last failure message (redacted/typed-code text, never a leaked
 *    stack — §3.4), kept for dead-letter inspection.
 *  - repo_ref / provider: the repo the scan points at (the scout's RepoRef, spec T5),
 *    carried on the job so the processor scans the right repo with no extra lookup.
 *
 * Owner scope is enforced via the session (§11.7): scout_jobs has no direct owner
 * column; it is reached through an owner-verified session_id, like scout_cache,
 * decision_record, and interview_turns. session_id is FK→interview_sessions ON
 * DELETE CASCADE so deleting a session reaps its jobs.
 *
 * Indexes (§10.4): (status) for the claim path (WHERE status='pending'), and
 * (session_id) for the status read path (latest job for a session). Postgres-only
 * app — no MSSQL counterpart by design (foundation Risk).
 */
import type { Knex } from "knex";

/** The job lifecycle states. Named, not magic (§4.2); mirrors ScoutJobStatus in types. */
const SCOUT_JOB_STATUSES = ["pending", "running", "done", "failed"] as const;

/** The source-agnostic provider set (mirrors CodeContextProviderId / scout_cache). */
const SCOUT_PROVIDERS = ["github", "azure"] as const;

const SCOUT_JOB_STATUS_CHECK = "scout_jobs_status_check";
const SCOUT_JOB_PROVIDER_CHECK = "scout_jobs_provider_check";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("scout_jobs", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("session_id")
      .notNullable()
      .references("id")
      .inTable("interview_sessions")
      .onDelete("CASCADE");
    // github | azure — the source the scan will read (spec T5).
    t.text("provider").notNullable();
    // Provider-native repo identifier, e.g. "owner/name" for GitHub (spec T5).
    t.text("repo_ref").notNullable();
    // pending | running | done | failed (failed = dead-letter terminal, §21.2).
    t.text("status").notNullable().defaultTo("pending");
    // Bounded-retry counter; at the cap the job is dead-lettered (§21.2).
    t.integer("attempts").notNullable().defaultTo(0);
    // Last failure detail for dead-letter inspection (typed/redacted text, §3.4).
    t.text("last_error").nullable();
    // `{ useTz: true }` yields timestamptz; both default to now() on insert.
    t.timestamps(true, true);
    t.index(["status"]); // §10.4 — the claim path filters on status.
    t.index(["session_id"]); // §10.4 — the status read path filters on session_id.
  });

  // CHECK constraints via raw DDL (Knex has no first-class check builder on
  // create). Parameter-free constant SQL, scoped to a models'-owned migration
  // file only (§10.2). status/provider must each be one of the locked sets.
  const statusList = SCOUT_JOB_STATUSES.map((s) => `'${s}'`).join(", ");
  await knex.raw(
    `ALTER TABLE scout_jobs ADD CONSTRAINT ${SCOUT_JOB_STATUS_CHECK} ` +
      `CHECK (status IN (${statusList}))`,
  );
  const providerList = SCOUT_PROVIDERS.map((p) => `'${p}'`).join(", ");
  await knex.raw(
    `ALTER TABLE scout_jobs ADD CONSTRAINT ${SCOUT_JOB_PROVIDER_CHECK} ` +
      `CHECK (provider IN (${providerList}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE scout_jobs DROP CONSTRAINT IF EXISTS ${SCOUT_JOB_STATUS_CHECK}`,
  );
  await knex.raw(
    `ALTER TABLE scout_jobs DROP CONSTRAINT IF EXISTS ${SCOUT_JOB_PROVIDER_CHECK}`,
  );
  await knex.schema.dropTableIfExists("scout_jobs");
}
