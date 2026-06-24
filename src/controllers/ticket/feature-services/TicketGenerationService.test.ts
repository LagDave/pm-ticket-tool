/**
 * TicketGenerationService tests (§20.1, §20.2). The Anthropic SDK is mocked at
 * the agent seam (vi.mock of ticketAgent) so the suite is deterministic and free
 * — no live model call, synthetic data only (§20.4). Covers: the structured
 * ticket shape persists as a draft, a malformed/off-schema result is rejected
 * and NOTHING is written (spec Risk), both-models-fail surfaces a typed error,
 * and owner scope hides another owner's session (§11.7).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent module BEFORE importing anything that pulls it in.
vi.mock("../../../agents/ticketAgent", () => ({
  generateTicket: vi.fn(),
}));

import { generateTicket } from "../../../agents/ticketAgent";
import { db } from "../../../database/connection";
import { DecisionRecordModel } from "../../../models/DecisionRecordModel";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { TicketModel } from "../../../models/TicketModel";
import { makeGeneratedTicket, makeOwner, makeRequestText } from "../../../test/factories";
import type { OwnerContext } from "../../../types/interview";
import { TicketGenerationService } from "./TicketGenerationService";

const mockGenerate = vi.mocked(generateTicket);

/** Create a session with a couple of synthetic decisions (the generator's input). */
async function seedSessionWithDecisions(owner: OwnerContext): Promise<number> {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("ticket-gen"),
  });
  await DecisionRecordModel.createMany([
    { sessionId: session.id, key: "auth_method", value: { optionId: "magic_link" }, source: "answer" },
    { sessionId: session.id, key: "expiration", value: { otherText: "15 minutes" }, source: "answer" },
  ]);
  return session.id;
}

describe("TicketGenerationService", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("generates, validates, and persists a draft ticket in the standard shape", async () => {
    const owner = makeOwner();
    const sessionId = await seedSessionWithDecisions(owner);
    mockGenerate.mockResolvedValueOnce(makeGeneratedTicket());

    const ticket = await TicketGenerationService.generateForSession(sessionId, owner);

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(ticket.session_id).toBe(sessionId);
    expect(ticket.status).toBe("draft");
    expect(ticket.version).toBe(1);
    expect(ticket.user_story).toMatch(/^As a .+, I want .+, So that .+/);
    expect(ticket.acceptance_criteria).toHaveLength(2);
    expect(ticket.effort).toBe("M");
    // Markdown is rendered + persisted at generate time (spec T5).
    expect(ticket.rendered_markdown).toContain("## User Story");
    expect(ticket.rendered_markdown?.toLowerCase()).toContain("verify with engineering");

    // It is readable back through the owner-scoped path.
    const fetched = await TicketModel.findByIdForOwner(ticket.id, owner);
    expect(fetched?.id).toBe(ticket.id);
  });

  it("rejects a malformed (off-schema) model result and persists nothing", async () => {
    const owner = makeOwner();
    const sessionId = await seedSessionWithDecisions(owner);
    // Missing acceptance_criteria + effort → boundary validation fails.
    mockGenerate.mockResolvedValueOnce({ user_story: "As a PM, I want X, So that Y." });

    await expect(
      TicketGenerationService.generateForSession(sessionId, owner),
    ).rejects.toMatchObject({ code: "TICKET_GENERATION_INVALID" });

    expect(await TicketModel.listBySession(sessionId)).toHaveLength(0);
  });

  it("rejects an empty-criteria ticket (boundary refine) and persists nothing", async () => {
    const owner = makeOwner();
    const sessionId = await seedSessionWithDecisions(owner);
    mockGenerate.mockResolvedValueOnce(makeGeneratedTicket({ acceptance_criteria: [] }));

    await expect(
      TicketGenerationService.generateForSession(sessionId, owner),
    ).rejects.toMatchObject({ code: "TICKET_GENERATION_INVALID" });
    expect(await TicketModel.listBySession(sessionId)).toHaveLength(0);
  });

  it("surfaces a generation failure as a typed error when both models fail", async () => {
    const owner = makeOwner();
    const sessionId = await seedSessionWithDecisions(owner);
    mockGenerate.mockRejectedValue(new Error("model down")); // primary + fallback

    await expect(
      TicketGenerationService.generateForSession(sessionId, owner),
    ).rejects.toMatchObject({ code: "TICKET_GENERATION_FAILED" });
    expect(mockGenerate).toHaveBeenCalledTimes(2); // primary then fallback
  });

  it("hides another owner's session (NOT_FOUND, §11.7) and never calls the model", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const sessionId = await seedSessionWithDecisions(ownerA);

    await expect(
      TicketGenerationService.generateForSession(sessionId, ownerB),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
