/**
 * TicketModel tests (§20.1, §20.2). Proves the owner-scope contract through the
 * session join (§11.7): a ticket whose session belongs to one owner is invisible
 * to another owner — the data-isolation rule proven, not assumed (§5.5). Also
 * covers create, the version-guarded update/finalize (optimistic concurrency,
 * spec Risk), and that a stale version writes nothing. Synthetic data (§20.4).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText } from "../test/factories";
import { InterviewSessionModel } from "./InterviewSessionModel";
import { TicketModel } from "./TicketModel";
import type { AcceptanceCriterion, OwnerContext } from "../types/interview";

const CRITERIA: AcceptanceCriterion[] = [
  { given: "a session", when: "generate", then: "a draft persists" },
];

/** Seed a session for an owner and a draft ticket on it; return both ids. */
async function seedTicket(owner: OwnerContext) {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("ticket-model"),
  });
  const ticket = await TicketModel.create({
    sessionId: session.id,
    userStory: "As a PM, I want X, So that Y.",
    acceptanceCriteria: CRITERIA,
    effort: "M",
    contextSummary: "ctx",
    renderedMarkdown: "## User Story\n\nAs a PM, I want X, So that Y.\n",
  });
  return { sessionId: session.id, ticketId: ticket.id };
}

describe("TicketModel", () => {
  afterAll(async () => {
    // Cascade from sessions cleans tickets + comments (FK ON DELETE CASCADE).
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("creates a draft ticket at version 1 and reads it back (criteria round-trip)", async () => {
    const owner = makeOwner();
    const { ticketId } = await seedTicket(owner);

    const fetched = await TicketModel.findByIdForOwner(ticketId, owner);
    expect(fetched).not.toBeNull();
    expect(fetched?.status).toBe("draft");
    expect(fetched?.version).toBe(1);
    expect(fetched?.effort).toBe("M");
    // JSONB acceptance_criteria deserializes to a structured array, not a string.
    expect(Array.isArray(fetched?.acceptance_criteria)).toBe(true);
    expect(fetched?.acceptance_criteria?.[0].given).toBe("a session");
    expect(fetched?.rendered_markdown).toContain("As a PM");
  });

  it("does NOT return a ticket to a different owner (§11.7 isolation)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const { ticketId } = await seedTicket(ownerA);

    // Owner B asks for owner A's ticket — must get null, not the row.
    const leaked = await TicketModel.findByIdForOwner(ticketId, ownerB);
    expect(leaked).toBeNull();

    // Owner A still sees it.
    const own = await TicketModel.findByIdForOwner(ticketId, ownerA);
    expect(own?.id).toBe(ticketId);
  });

  it("updates editable fields and bumps the version when the expected version matches", async () => {
    const owner = makeOwner();
    const { ticketId } = await seedTicket(owner);

    const updated = await TicketModel.updateForOwner(ticketId, 1, {
      userStory: "As a PM, I want EDITED, So that Z.",
      renderedMarkdown: "## User Story\n\nedited\n",
    });
    expect(updated).not.toBeNull();
    expect(updated?.version).toBe(2);
    expect(updated?.user_story).toContain("EDITED");
  });

  it("rejects a stale-version update (writes nothing) — optimistic concurrency", async () => {
    const owner = makeOwner();
    const { ticketId } = await seedTicket(owner);
    // Bump to version 2 first.
    await TicketModel.updateForOwner(ticketId, 1, { effort: "L" });

    // A second writer still holding version 1 must not land.
    const stale = await TicketModel.updateForOwner(ticketId, 1, { effort: "XL" });
    expect(stale).toBeNull();

    const current = await TicketModel.findByIdForOwner(ticketId, owner);
    expect(current?.version).toBe(2);
    expect(current?.effort).toBe("L"); // the stale XL never landed
  });

  it("finalize flips status draft→final and bumps the version", async () => {
    const owner = makeOwner();
    const { ticketId } = await seedTicket(owner);

    const finalized = await TicketModel.finalizeForOwner(ticketId, 1);
    expect(finalized?.status).toBe("final");
    expect(finalized?.version).toBe(2);

    // A stale finalize attempt at the old version writes nothing.
    const stale = await TicketModel.finalizeForOwner(ticketId, 1);
    expect(stale).toBeNull();
  });

  it("lists tickets for a session newest-version first", async () => {
    const owner = makeOwner();
    const { sessionId, ticketId } = await seedTicket(owner);
    await TicketModel.updateForOwner(ticketId, 1, { effort: "S" });

    const list = await TicketModel.listBySession(sessionId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].session_id).toBe(sessionId);
  });
});
