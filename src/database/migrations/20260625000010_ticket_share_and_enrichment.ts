/**
 * Ticket share + enrichment — add the public share token, the priority tier, and
 * the rich "details" payload to the tickets table (Knex, PostgreSQL). Mirrors the
 * shape of 20260624000002_ticket_draft_schema.ts.
 *
 *   - share_token text: unguessable per-ticket capability token for the public
 *     read-only share link (spec What). Backfilled for every existing row via the
 *     shareToken util, THEN set NOT NULL + UNIQUE — the public lookup filters on it,
 *     so it carries a unique index (§10.4). The token IS the capability; it is read
 *     through the non-owner-scoped findByShareToken (spec Risk; §11.7 has its
 *     trusted-path precedent in findByIdSystem).
 *   - priority text: coarse impact tier high|medium|low, nullable until generation
 *     sets it; CHECK (priority IS NULL OR tier). A TIER, never a number (spec Risk).
 *   - details jsonb: the enrichment object (problemBackground, keyDecisions[],
 *     openQuestions[], successMetrics[], dependencies[], codebaseGrounding[]). Pure
 *     content, never filtered on, so one typed jsonb column not six (spec Risk).
 *
 * Postgres-only app — no MSSQL counterpart by design (matches 20260624000002).
 */
import type { Knex } from "knex";
import { generateShareToken } from "../../utils/shareToken";

/** Priority is a coarse tier, never a number (spec Risk). Named, not magic (§4.2). */
const PRIORITY_TIERS = ["high", "medium", "low"] as const;
const PRIORITY_CHECK = "tickets_priority_check";
const SHARE_TOKEN_UNIQUE = "tickets_share_token_unique";

export async function up(knex: Knex): Promise<void> {
  // 1) Add the columns nullable so the backfill can run before NOT NULL lands.
  await knex.schema.alterTable("tickets", (t) => {
    t.text("share_token").nullable();
    t.text("priority").nullable();
    t.jsonb("details").nullable();
  });

  // 2) Backfill a distinct token for every existing row — one update per row so
  //    each token is independently generated from the CSPRNG (§5.1).
  const rows = await knex("tickets").select("id");
  for (const row of rows) {
    await knex("tickets")
      .where({ id: (row as { id: number }).id })
      .update({ share_token: generateShareToken() });
  }

  // 3) Enforce NOT NULL + UNIQUE now that every row has a token.
  await knex.schema.alterTable("tickets", (t) => {
    t.text("share_token").notNullable().alter();
    t.unique(["share_token"], { indexName: SHARE_TOKEN_UNIQUE });
  });

  // 4) CHECK constraint via raw constant DDL (Knex has no check builder on alter),
  //    parameter-free and scoped to this migration file (§10.2). priority allows
  //    NULL (pre-generation rows) but, when set, must be one of the tiers.
  const tierList = PRIORITY_TIERS.map((p) => `'${p}'`).join(", ");
  await knex.raw(
    `ALTER TABLE tickets ADD CONSTRAINT ${PRIORITY_CHECK} CHECK (priority IS NULL OR priority IN (${tierList}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ${PRIORITY_CHECK}`);
  await knex.schema.alterTable("tickets", (t) => {
    t.dropUnique(["share_token"], SHARE_TOKEN_UNIQUE);
    t.dropColumn("share_token");
    t.dropColumn("priority");
    t.dropColumn("details");
  });
}
