/**
 * Project Context & Bits Grounding — Knex migration skeletons (reference).
 *
 * NOTE: This repo's real migrations are TypeScript files in
 * src/database/migrations/<timestamp>_<name>.ts (see 20260624000004_scout_cache_schema.ts).
 * During execution, write these as separate TS files in that directory — NOT as one
 * .js file here. This scaffold captures the up/down shape per the planning convention;
 * fill bodies during execution (-- TODO markers).
 *
 * Five migrations, in order:
 *   1. <ts>_projects_schema.ts            (T1a)
 *   2. <ts>_project_bits_schema.ts        (T1b)
 *   3. <ts>_sessions_add_project.ts       (T1c)
 *   4. <ts>_drop_scout.ts                 (T14 — Wave 3, runs LAST)
 */

// ── 1. projects (T1a) ────────────────────────────────────────────────────────
exports.up_projects = async (knex) => {
  await knex.schema.createTable('projects', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('owner_user_id').notNullable();
    t.bigInteger('organization_id').nullable();
    t.text('name').notNullable();
    t.text('description').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['owner_user_id']); // §10.4
  });
};
exports.down_projects = async (knex) => { await knex.schema.dropTableIfExists('projects'); };

// ── 2. project_bits (T1b) — CHECKs via raw DDL in-migration only (§10.2) ──────
exports.up_project_bits = async (knex) => {
  await knex.schema.createTable('project_bits', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.text('kind').notNullable();
    t.text('bit_key').notNullable();
    t.text('summary').notNullable();
    t.text('status').notNullable().defaultTo('active');
    t.text('source').notNullable().defaultTo('manual');
    t.bigInteger('source_ticket_id').nullable().references('id').inTable('tickets').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['project_id']);
    t.index(['project_id', 'status']);
  });
  // TODO: ALTER TABLE ... ADD CONSTRAINT project_bits_kind_check   CHECK (kind IN ('feature','constraint','integration','tech_stack','inventory'))
  // TODO: ALTER TABLE ... ADD CONSTRAINT project_bits_status_check CHECK (status IN ('active','superseded'))
  // TODO: ALTER TABLE ... ADD CONSTRAINT project_bits_source_check CHECK (source IN ('manual','imported','merged'))
  // NO unique (project_id, bit_key) — keys are cosmetic, dedup is semantic.
};
exports.down_project_bits = async (knex) => { await knex.schema.dropTableIfExists('project_bits'); };

// ── 3. interview_sessions.project_id (T1c) ────────────────────────────────────
exports.up_sessions_add_project = async (knex) => {
  await knex.schema.alterTable('interview_sessions', (t) => {
    t.bigInteger('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
    t.index(['project_id']);
  });
};
exports.down_sessions_add_project = async (knex) => {
  await knex.schema.alterTable('interview_sessions', (t) => {
    t.dropColumn('project_id');
  });
};

// ── 4. drop scout (T14 — Wave 3) ──────────────────────────────────────────────
exports.up_drop_scout = async (knex) => {
  await knex.schema.dropTableIfExists('scout_jobs');   // drop referrers first
  await knex.schema.dropTableIfExists('scout_cache');
};
exports.down_drop_scout = async (_knex) => {
  // Best-effort only — abandoned data is not restorable. Recreate empty schema if a
  // rollback is ever needed (copy from the original scout migrations). TODO during execution.
};
