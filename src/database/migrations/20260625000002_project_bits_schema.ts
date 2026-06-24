/**
 * Project Context — project_bits table (Knex, PostgreSQL). T1b.
 * Typed key→summary rows about an app — the grounding substrate for the interview
 * + ticket. kind/status/source are locked via CHECK constraints whose value sets
 * are the source of truth mirrored in types/project.ts. `bit_key` is a COSMETIC
 * label: dedup is semantic (the reconciliation agent matches by meaning), so there
 * is deliberately NO unique (project_id, bit_key). Reached through an owner-verified
 * project (§11.7); project_id CASCADE-deletes with the project. Indexed on the read
 * paths (§10.4). Postgres-only app — no MSSQL counterpart by design (foundation Risk).
 */
import type { Knex } from "knex";

/** Locked enums — named, not magic (§4.2); mirror types/project.ts. */
const BIT_KINDS = ["feature", "constraint", "integration", "tech_stack", "inventory"] as const;
const BIT_STATUSES = ["active", "superseded"] as const;
const BIT_SOURCES = ["manual", "imported", "merged"] as const;

const KIND_CHECK = "project_bits_kind_check";
const STATUS_CHECK = "project_bits_status_check";
const SOURCE_CHECK = "project_bits_source_check";

/** Render a constant string list for a CHECK IN (...) clause. */
function inList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("project_bits", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("project_id")
      .notNullable()
      .references("id")
      .inTable("projects")
      .onDelete("CASCADE");
    t.text("kind").notNullable();
    t.text("bit_key").notNullable(); // human-readable topic label; NOT unique (semantic dedup)
    t.text("summary").notNullable();
    t.text("status").notNullable().defaultTo("active");
    t.text("source").notNullable().defaultTo("manual");
    t.bigInteger("source_ticket_id")
      .nullable()
      .references("id")
      .inTable("tickets")
      .onDelete("SET NULL"); // merge-on-complete provenance
    t.timestamps(true, true);
    t.index(["project_id"]); // §10.4 — bit reads filter by project
    t.index(["project_id", "status"]); // grounding loads active bits per project
  });

  // CHECK constraints via raw DDL (Knex has no first-class check builder on
  // create). Parameter-free constant SQL, scoped to this migration only (§10.2).
  await knex.raw(
    `ALTER TABLE project_bits ADD CONSTRAINT ${KIND_CHECK} CHECK (kind IN (${inList(BIT_KINDS)}))`,
  );
  await knex.raw(
    `ALTER TABLE project_bits ADD CONSTRAINT ${STATUS_CHECK} CHECK (status IN (${inList(BIT_STATUSES)}))`,
  );
  await knex.raw(
    `ALTER TABLE project_bits ADD CONSTRAINT ${SOURCE_CHECK} CHECK (source IN (${inList(BIT_SOURCES)}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE project_bits DROP CONSTRAINT IF EXISTS ${KIND_CHECK}`);
  await knex.raw(`ALTER TABLE project_bits DROP CONSTRAINT IF EXISTS ${STATUS_CHECK}`);
  await knex.raw(`ALTER TABLE project_bits DROP CONSTRAINT IF EXISTS ${SOURCE_CHECK}`);
  await knex.schema.dropTableIfExists("project_bits");
}
