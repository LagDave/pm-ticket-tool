/**
 * Ticket share + enrichment — add the share token, priority, and the rich
 * "details" payload to the tickets table (Knex, PostgreSQL). SCAFFOLD for the
 * plan plans/06252026-rich-ticket-shareable-link; the real migration is created
 * in src/database/migrations/<timestamp>_ticket_share_and_enrichment.ts during
 * execution (-x). Mirrors 20260624000002_ticket_draft_schema.ts.
 *
 * Schema changes on tickets:
 *   - share_token  text  — unguessable per-ticket capability token for the public
 *                          read-only share link. Backfilled for every existing row,
 *                          THEN set NOT NULL + UNIQUE (the public lookup filters on
 *                          it, so it carries a unique index — §10.4).
 *   - priority     text  — complexity/urgency TIER high|medium|low, nullable until
 *                          generation sets it; CHECK (priority IS NULL OR tier).
 *   - details      jsonb — the enrichment object: problemBackground, keyDecisions[],
 *                          openQuestions[], successMetrics[], dependencies[],
 *                          codebaseGrounding[]. Pure content, never filtered on, so
 *                          one typed jsonb column (not six sparse columns) — spec Risk.
 *
 * Postgres-only app — no MSSQL counterpart by design (matches the analog migration).
 * Owner scope stays enforced in models via the session owner (§11.7); share_token is
 * a deliberate public capability, read through the non-owner-scoped findByShareToken.
 */
import type { Knex } from "knex";

/** Priority is a coarse tier, never a number. Named, not magic (§4.2). */
const PRIORITY_TIERS = ["high", "medium", "low"] as const;
const PRIORITY_CHECK = "tickets_priority_check";

export async function up(knex: Knex): Promise<void> {
  // TODO (execution): add nullable columns.
  //   await knex.schema.alterTable("tickets", (t) => {
  //     t.text("share_token").nullable();
  //     t.text("priority").nullable();
  //     t.jsonb("details").nullable();
  //   });

  // TODO (execution): backfill share_token for every existing row using the
  //   shareToken util (generateShareToken()), one UPDATE per row so each is unique.
  //   const rows = await knex("tickets").select("id").whereNull("share_token");
  //   for (const { id } of rows) {
  //     await knex("tickets").where({ id }).update({ share_token: generateShareToken() });
  //   }

  // TODO (execution): enforce NOT NULL + UNIQUE on share_token, and the priority CHECK.
  //   await knex.schema.alterTable("tickets", (t) => {
  //     t.text("share_token").notNullable().alter();
  //     t.unique(["share_token"], { indexName: "tickets_share_token_unique" });
  //   });
  //   const tierList = PRIORITY_TIERS.map((p) => `'${p}'`).join(", ");
  //   await knex.raw(
  //     `ALTER TABLE tickets ADD CONSTRAINT ${PRIORITY_CHECK} CHECK (priority IS NULL OR priority IN (${tierList}))`,
  //   );
  throw new Error("Scaffold only — implement during -x execution.");
}

export async function down(knex: Knex): Promise<void> {
  // TODO (execution): drop the CHECK + unique index, then the three columns.
  //   await knex.raw(`ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ${PRIORITY_CHECK}`);
  //   await knex.schema.alterTable("tickets", (t) => {
  //     t.dropUnique(["share_token"], "tickets_share_token_unique");
  //     t.dropColumn("share_token");
  //     t.dropColumn("priority");
  //     t.dropColumn("details");
  //   });
  throw new Error("Scaffold only — implement during -x execution.");
}
