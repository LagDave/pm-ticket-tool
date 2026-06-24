/**
 * Ticket draft — finalize tickets columns + add ticket_comments (Knex, PostgreSQL).
 * Planning scaffold per the plan-folder convention. Column details are finalized during execution (-x).
 * Lives in src/database/migrations/ once executed. Postgres-only app — no MSSQL counterpart by design.
 *
 * Foundation created the tickets shell (session_id, user_story, acceptance_criteria, effort, status, version).
 * This migration finalizes those columns, adds rendered_markdown, and adds the ticket_comments child table.
 * Comments live in a child table (not a jsonb column) for queryability/attribution — see spec Pushback.
 * Owner-scope is enforced in models via the session owner (§11.7); indexes on filter/join columns (§10.4).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable("tickets", (t) => {
    // foundation shell already has: user_story (text), acceptance_criteria (jsonb),
    // effort (text), status (text default 'draft'), version (int default 1).
    t.text("rendered_markdown").nullable(); // canonical copy-paste Markdown, written on generate + finalize
    // TODO: confirm effort is constrained to a tier enum (XS|S|M|L|XL), never hours — see spec Constraints
    // TODO: status CHECK constraint draft|final (foundation left it open)
    // TODO: confirm acceptance_criteria stores an array of { given, when, then } blocks
    // TODO: fill during execution — any NOT NULL backfill / default reconciliation for existing draft rows
  });
  // TODO: CREATE INDEX ON tickets (session_id) — §10.4 join column (foundation noted this as TODO)

  await knex.schema.createTable("ticket_comments", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("ticket_id").notNullable()
      .references("id").inTable("tickets").onDelete("CASCADE");
    t.bigInteger("author_user_id").notNullable();
    t.text("body").notNullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["ticket_id"]); // §10.4 join/filter column
    // TODO: fill during execution — decide soft-delete vs hard-delete for comments
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("ticket_comments");
  await knex.schema.alterTable("tickets", (t) => {
    t.dropColumn("rendered_markdown");
    // TODO: drop any index/constraint added in up() (e.g. tickets.session_id index, status check)
  });
};
