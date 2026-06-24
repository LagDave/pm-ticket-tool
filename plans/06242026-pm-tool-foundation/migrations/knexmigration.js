/**
 * Foundation — base schema migration (Knex, PostgreSQL).
 * Reference scaffold. EXECUTED as TypeScript at
 * src/database/migrations/20260624000001_foundation_base_schema.ts (the app's
 * Knex config uses extension: "ts"). Run via `npm run migrate`.
 * Postgres-only app — no MSSQL counterpart by design.
 *
 * Tables: interview_sessions, interview_turns, decision_record, tickets.
 * Owner-scoped (§11.7); indexes on filter/join columns (§10.4).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable("interview_sessions", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("owner_user_id").notNullable();
    t.bigInteger("organization_id").nullable(); // nullable v1; see spec Pushback (§5.5/§11.7)
    t.text("status").notNullable().defaultTo("draft"); // draft|in_progress|awaiting_input|complete|archived
    t.text("original_request").notNullable();
    t.timestamps(true, true);
    t.index(["owner_user_id", "status"]); // §10.4
    // TODO: status check constraint; soft-delete if needed
  });

  await knex.schema.createTable("interview_turns", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("session_id").notNullable()
      .references("id").inTable("interview_sessions").onDelete("CASCADE");
    t.integer("turn_index").notNullable();
    t.jsonb("questions").notNullable(); // generated batch: ≤4 questions + options + effort tags
    t.jsonb("answers").nullable();      // null until the PM answers
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.unique(["session_id", "turn_index"]);
    t.index(["session_id"]);
  });

  await knex.schema.createTable("decision_record", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("session_id").notNullable()
      .references("id").inTable("interview_sessions").onDelete("CASCADE");
    t.text("key").notNullable();   // e.g. link_format, expiration, persist_to_dashboard
    t.jsonb("value").notNullable();
    t.text("source").notNullable(); // answer|scout|default
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["session_id"]);
    // TODO: decide unique-per-(session,key) last-write-wins vs append-only + versioning
  });

  await knex.schema.createTable("tickets", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("session_id").notNullable()
      .references("id").inTable("interview_sessions").onDelete("CASCADE");
    t.text("user_story").nullable();
    t.jsonb("acceptance_criteria").nullable(); // array of Given/When/Then blocks
    t.text("effort").nullable();
    t.text("status").notNullable().defaultTo("draft"); // draft|final
    t.integer("version").notNullable().defaultTo(1);
    t.timestamps(true, true);
    t.index(["session_id"]);
    // TODO: ticket-draft spec refines columns; foundation creates the shell
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("tickets");
  await knex.schema.dropTableIfExists("decision_record");
  await knex.schema.dropTableIfExists("interview_turns");
  await knex.schema.dropTableIfExists("interview_sessions");
};
