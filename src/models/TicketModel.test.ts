/**
 * TicketModel tests (§20.1, §20.2). Proves the owner-scope contract through the
 * session join (§11.7): a ticket whose session belongs to one owner is invisible
 * to another owner — the data-isolation rule proven, not assumed (§5.5). Also
 * covers create (now persisting priority/details/share_token), the public
 * findByShareToken capability lookup (spec What), the version-guarded
 * update/finalize (optimistic concurrency, spec Risk), and that a stale version
 * writes nothing. Synthetic data (§20.4).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText } from "../test/factories";
import { generateShareToken } from "../utils/shareToken";
import { InterviewSessionModel } from "./InterviewSessionModel";
import { TicketModel } from "./TicketModel";
import type {
  AcceptanceCriterion,
  OwnerContext,
  TicketDetails,
} from "../types/interview";

const CRITERIA: AcceptanceCriterion[] = [
  { given: "a session", when: "generate", then: "a draft persists" },
];

const DETAILS: TicketDetails = {
  problemBackground: "PMs lose detail in thin tickets.",
  keyDecisions: [{ label: "decided X", detail: "because Y" }],
  openQuestions: ["still open?"],
  successMetrics: ["fewer follow-ups"],
  dependencies: ["email provider"],
  codebaseGrounding: [{ area: "Auth", note: "login exists" }],
};

/** Seed a session for an owner and a draft ticket on it; return ids + the token. */
async function seedTicket(owner: OwnerContext) {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("ticket-model"),
  });
  const shareToken = generateShareToken();
  const ticket = await TicketModel.create({
    sessionId: session.id,
    userStory: "As a PM, I want X, So that Y.",
    acceptanceCriteria: CRITERIA,
    effort: "M",
    contextSummary: "ctx",
    renderedMarkdown: "## User Story\n\nAs a PM, I want X, So that Y.\n",
    priority: "medium",
    details: DETAILS,
    shareToken,
  });
  return { sessionId: session.id, ticketId: ticket.id, shareToken };
}

describe("TicketModel", () => {
  afterAll(async () => {
    // Cascade from sessions cleans tickets + comments (FK ON DELETE CASCADE).
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("creates a draft at version 1 and round-trips criteria, priority, and details", async () => {
    const owner = makeOwner();
    const { ticketId } = await seedTicket(owner);

    const fetched = await TicketModel.findByIdForOwner(ticketId, owner);
    expect(fetched).not.toBeNull();
    expect(fetched?.status).toBe("draft");
    expect(fetched?.version).toBe(1);
    expect(fetched?.effort).toBe("M");
    expect(fetched?.priority).toBe("medium");
    // JSONB columns deserialize to structured values, not strings.
    expect(Array.isArray(fetched?.acceptance_criteria)).toBe(true);
    expect(fetched?.acceptance_criteria?.[0].given).toBe("a session");
    expect(fetched?.details?.keyDecisions[0].label).toBe("decided X");
    expect(fetched?.details?.codebaseGrounding[0].area).toBe("Auth");
    expect(typeof fetched?.share_token).toBe("string");
    expect(fetched?.rendered_markdown).toContain("As a PM");
  });

  it("finds a ticket by its share token regardless of owner (public capability path)", async () => {
    const owner = makeOwner();
    const { ticketId, shareToken } = await seedTicket(owner);

    // No owner argument — the token alone resolves the ticket (spec What).
    const found = await TicketModel.findByShareToken(shareToken);
    expect(found?.id).toBe(ticketId);
    expect(found?.user_story).toContain("As a PM");
    expect(found?.details?.openQuestions[0]).toBe("still open?");

    // An unknown token returns null — the link never reveals existence (§5.4).
    const miss = await TicketModel.findByShareToken("no-such-token-abcdefghijklmnop");
    expect(miss).toBeNull();
  });

  it("mints a distinct share token per ticket (uniqueness)", async () => {
    const owner = makeOwner();
    const a = await seedTicket(owner);
    const b = await seedTicket(owner);
    expect(a.shareToken).not.toBe(b.shareToken);
  });

  it("does NOT return a ticket to a different owner (§11.7 isolation)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const { ticketId } = await seedTicket(ownerA);

    const leaked = await TicketModel.findByIdForOwner(ticketId, ownerB);
    expect(leaked).toBeNull();

    const own = await TicketModel.findByIdForOwner(ticketId, ownerA);
    expect(own?.id).toBe(ticketId);
  });

  it("updates editable fields and bumps the version when the expected version matches", async () => {
    const owner = makeOwner();
    const { ticketId } = await seedTicket(owner);

    const updated = await TicketModel.updateForOwner(ticketId, 1, {
      userStory: "As a PM, I want EDITED, So that Z.",
      priority: "high",
      renderedMarkdown: "## User Story\n\nedited\n",
    });
    expect(updated).not.toBeNull();
    expect(updated?.version).toBe(2);
    expect(updated?.user_story).toContain("EDITED");
    expect(updated?.priority).toBe("high");
  });

  it("rejects a stale-version update (writes nothing) — optimistic concurrency", async () => {
    const owner = makeOwner();
    const { ticketId } = await seedTicket(owner);
    await TicketModel.updateForOwner(ticketId, 1, { effort: "L" });

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
