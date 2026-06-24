/**
 * TicketCommentModel tests (§20.1). Comments are reached through an owner-verified
 * ticket; this proves the create/list path and oldest-first ordering, and that
 * deleting the parent ticket cascades comments away (FK ON DELETE CASCADE).
 * Synthetic data (§20.4).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText } from "../test/factories";
import { InterviewSessionModel } from "./InterviewSessionModel";
import { TicketCommentModel } from "./TicketCommentModel";
import { TicketModel } from "./TicketModel";
import type { AcceptanceCriterion, OwnerContext } from "../types/interview";

const CRITERIA: AcceptanceCriterion[] = [
  { given: "g", when: "w", then: "t" },
];

async function seedTicketId(owner: OwnerContext): Promise<number> {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("comment-model"),
  });
  const ticket = await TicketModel.create({
    sessionId: session.id,
    userStory: "As a PM, I want X, So that Y.",
    acceptanceCriteria: CRITERIA,
    effort: "S",
    contextSummary: "ctx",
    renderedMarkdown: "md",
  });
  return ticket.id;
}

describe("TicketCommentModel", () => {
  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("creates a comment attributed to the author and lists it back", async () => {
    const owner = makeOwner();
    const ticketId = await seedTicketId(owner);

    const created = await TicketCommentModel.create({
      ticketId,
      authorUserId: owner.ownerUserId,
      body: "Looks good, ship it.",
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.ticket_id).toBe(ticketId);
    expect(created.author_user_id).toBe(owner.ownerUserId);

    const list = await TicketCommentModel.listByTicket(ticketId);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("Looks good, ship it.");
  });

  it("lists comments oldest-first", async () => {
    const owner = makeOwner();
    const ticketId = await seedTicketId(owner);
    await TicketCommentModel.create({ ticketId, authorUserId: 1, body: "first" });
    await TicketCommentModel.create({ ticketId, authorUserId: 1, body: "second" });

    const list = await TicketCommentModel.listByTicket(ticketId);
    expect(list.map((c) => c.body)).toEqual(["first", "second"]);
  });

  it("cascades comments away when the parent ticket is removed", async () => {
    const owner = makeOwner();
    const ticketId = await seedTicketId(owner);
    await TicketCommentModel.create({ ticketId, authorUserId: 1, body: "doomed" });

    // Deleting the session cascades to the ticket and then to its comments.
    await db("interview_sessions").where("owner_user_id", owner.ownerUserId).del();

    const list = await TicketCommentModel.listByTicket(ticketId);
    expect(list).toHaveLength(0);
  });
});
