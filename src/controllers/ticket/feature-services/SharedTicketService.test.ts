/**
 * SharedTicketService tests (§20.1, §20.2). Proves the public capability read:
 * a valid token resolves to a content-only projection that omits every internal
 * field (id, session_id, share_token — §5.4), and an unknown token throws
 * SHARED_TICKET_NOT_FOUND so the link never reveals whether a ticket exists.
 * Synthetic data (§20.4).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../database/connection";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { TicketModel } from "../../../models/TicketModel";
import { makeOwner, makeRequestText } from "../../../test/factories";
import { generateShareToken } from "../../../utils/shareToken";
import type { OwnerContext, TicketDetails } from "../../../types/interview";
import { SharedTicketService } from "./SharedTicketService";

const DETAILS: TicketDetails = {
  problemBackground: "PMs lose detail in thin tickets.",
  keyDecisions: [{ label: "Magic-link auth", detail: null }],
  openQuestions: ["single-use?"],
  successMetrics: [],
  dependencies: [],
  codebaseGrounding: [],
};

async function seedTicket(owner: OwnerContext) {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("shared"),
  });
  const shareToken = generateShareToken();
  await TicketModel.create({
    sessionId: session.id,
    userStory: "As a PM, I want X, So that Y.",
    acceptanceCriteria: [{ given: "g", when: "w", then: "t" }],
    effort: "M",
    contextSummary: "ctx",
    renderedMarkdown: "## User Story\n\nX\n",
    priority: "high",
    details: DETAILS,
    shareToken,
  });
  return { shareToken };
}

describe("SharedTicketService", () => {
  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("resolves a token to a content-only projection with no internal fields", async () => {
    const { shareToken } = await seedTicket(makeOwner());
    const pub = await SharedTicketService.getByToken(shareToken);

    expect(pub.user_story).toContain("As a PM");
    expect(pub.priority).toBe("high");
    expect(pub.details?.keyDecisions[0].label).toBe("Magic-link auth");
    expect(pub.status).toBe("draft");
    expect(pub.rendered_markdown).toContain("## User Story");

    // The internal identifiers must never be projected onto the public shape (§5.4).
    const bag = pub as unknown as Record<string, unknown>;
    expect(bag.id).toBeUndefined();
    expect(bag.session_id).toBeUndefined();
    expect(bag.share_token).toBeUndefined();
  });

  it("throws SHARED_TICKET_NOT_FOUND for an unknown token (no existence leak)", async () => {
    await expect(
      SharedTicketService.getByToken("definitely-not-a-real-token-1234567890"),
    ).rejects.toMatchObject({ code: "SHARED_TICKET_NOT_FOUND" });
  });
});
