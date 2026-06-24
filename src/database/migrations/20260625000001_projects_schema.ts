/**
 * Project Context — projects table (Knex, PostgreSQL). T1a.
 * A project owns a set of bits (project_bits) that ground the interview + ticket,
 * replacing the removed code scout. Owner-scoped like interview_sessions (§11.7):
 * owner_user_id + nullable organization_id, derived from server context, never
 * trusted from the client (§5.5). Postgres-only app — no MSSQL counterpart by
 * design (foundation Risk). Indexed on the owner list path (§10.4).
 */
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("projects", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("owner_user_id").notNullable();
    t.bigInteger("organization_id").nullable(); // nullable v1 (§5.5/§11.7)
    t.text("name").notNullable();
    t.text("description").nullable();
    t.timestamps(true, true);
    t.index(["owner_user_id"]); // §10.4 — the owner list path filters on this
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("projects");
}
