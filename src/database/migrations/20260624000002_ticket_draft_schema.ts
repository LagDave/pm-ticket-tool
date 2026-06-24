/**
 * Ticket draft — finalize the tickets columns + add ticket_comments (Knex, PostgreSQL).
 * Foundation (20260624000001) created the tickets shell: session_id, user_story (text),
 * acceptance_criteria (jsonb), effort (text), status (text default 'draft'), version (int
 * default 1), timestamps, and the session_id index. This migration:
 *   - adds tickets.rendered_markdown (the canonical copy-paste Markdown, written on
 *     generate + finalize so the copy action and any later consumer read one string);
 *   - constrains status to draft|final and effort to the tier enum XS|S|M|L|XL
 *     (a complexity TIER, never hours — see spec Constraints) via CHECK constraints;
 *   - adds the ticket_comments child table (one row per comment, FK → tickets ON DELETE
 *     CASCADE, indexed on ticket_id) — queryable + attributable, keeping comment writes
 *     off the ticket row (see spec Pushback §10.3, §10.4).
 *
 * Owner scope is enforced in models via the session owner (§11.7). Postgres-only app —
 * no MSSQL counterpart by design (spec Risk). Foundation already created the
 * tickets.session_id index, so it is NOT re-added here (would conflict on re-apply).
 */
import type { Knex } from "knex";

/** Effort is a complexity tier, never hours (spec Constraints). Named, not magic (§4.2). */
const EFFORT_TIERS = ["XS", "S", "M", "L", "XL"] as const;
/** A ticket is a draft until the PM marks it final (spec What). */
const TICKET_STATUSES = ["draft", "final"] as const;

const STATUS_CHECK = "tickets_status_check";
const EFFORT_CHECK = "tickets_effort_check";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("tickets", (t) => {
    // Canonical copy-paste Markdown, written on generate + finalize (spec T5).
    t.text("rendered_markdown").nullable();
    // The short hand-off context summary the generator produces (spec T1/What).
    // Persisted as its own column (not only folded into rendered_markdown) so an
    // edit can re-render Markdown without losing it. Additive to the spec's T2
    // column list — execution deviation, see spec Revision Log (§10.3).
    t.text("context_summary").nullable();
  });

  // CHECK constraints via raw DDL (Knex has no first-class check builder on alter).
  // Parameter-free constant SQL, scoped to models'-owned migration files only (§10.2).
  // effort allows NULL (the shell may hold draft rows pre-generation) but, when set,
  // must be one of the tiers.
  const statusList = TICKET_STATUSES.map((s) => `'${s}'`).join(", ");
  const effortList = EFFORT_TIERS.map((e) => `'${e}'`).join(", ");
  await knex.raw(
    `ALTER TABLE tickets ADD CONSTRAINT ${STATUS_CHECK} CHECK (status IN (${statusList}))`,
  );
  await knex.raw(
    `ALTER TABLE tickets ADD CONSTRAINT ${EFFORT_CHECK} CHECK (effort IS NULL OR effort IN (${effortList}))`,
  );

  await knex.schema.createTable("ticket_comments", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("ticket_id")
      .notNullable()
      .references("id")
      .inTable("tickets")
      .onDelete("CASCADE");
    t.bigInteger("author_user_id").notNullable();
    t.text("body").notNullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["ticket_id"]); // §10.4 join/filter column
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("ticket_comments");
  await knex.raw(`ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ${EFFORT_CHECK}`);
  await knex.raw(`ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ${STATUS_CHECK}`);
  await knex.schema.alterTable("tickets", (t) => {
    t.dropColumn("rendered_markdown");
    t.dropColumn("context_summary");
  });
}
