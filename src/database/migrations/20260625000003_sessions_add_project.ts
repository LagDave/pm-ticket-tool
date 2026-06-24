/**
 * Project Context — interview_sessions.project_id (Knex, PostgreSQL). T1c.
 * Attaches a session to a project so the engine can load that project's bits to
 * ground generation (replacing the scout_cache read). Nullable so existing and
 * ungrounded sessions are unaffected — presence of bits for the project drives the
 * grounded/ungrounded branch, exactly as findings did. ON DELETE SET NULL so
 * deleting a project orphans (never deletes) its sessions. Indexed (§10.4).
 * Postgres-only app (foundation Risk).
 */
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("interview_sessions", (t) => {
    t.bigInteger("project_id")
      .nullable()
      .references("id")
      .inTable("projects")
      .onDelete("SET NULL");
    t.index(["project_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("interview_sessions", (t) => {
    t.dropIndex(["project_id"]);
    t.dropColumn("project_id");
  });
}
