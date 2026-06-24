/**
 * TriageService tests (§20.1, §20.2). The Anthropic SDK is mocked at the agent
 * seam (vi.mock of triageAgent) so the suite is deterministic and free — no live
 * model call, synthetic data only (§20.4). Covers: a `simple` classification
 * routes to the ticket path, a `scoped` one to the interview, an off-schema /
 * failed classification defaults to `scoped` (spec Risk), the override forces the
 * interview even from `simple`, the label persists on the session, and owner
 * scope hides another owner's session (§11.7).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent module BEFORE importing anything that pulls it in.
vi.mock("../../../agents/triageAgent", () => ({
  classifyRequest: vi.fn(),
}));

import { classifyRequest } from "../../../agents/triageAgent";
import { db } from "../../../database/connection";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { makeOwner, makeRequestText, makeTriageClassification } from "../../../test/factories";
import type { OwnerContext } from "../../../types/interview";
import { TriageService } from "./TriageService";

const mockClassify = vi.mocked(classifyRequest);

/** Create a fresh session for the given owner and return its id. */
async function seedSession(owner: OwnerContext): Promise<number> {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("triage"),
  });
  return session.id;
}

describe("TriageService", () => {
  beforeEach(() => {
    mockClassify.mockReset();
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("classifies a simple request and routes to the ticket path", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    const outcome = await TriageService.triageSession(sessionId, owner, false);

    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(outcome.result).toBe("simple");
    expect(outcome.route).toBe("ticket");
    expect(outcome.overridden).toBe(false);
    expect(outcome.sessionId).toBe(sessionId);
  });

  it("classifies a scoped request and routes to the interview path", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "scoped" }));

    const outcome = await TriageService.triageSession(sessionId, owner, false);

    expect(outcome.result).toBe("scoped");
    expect(outcome.route).toBe("interview");
  });

  it("persists triage_result + triaged_at on the session (spec T2)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    await TriageService.triageSession(sessionId, owner, false);

    const persisted = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    expect(persisted?.triage_result).toBe("simple");
    expect(persisted?.triaged_at).not.toBeNull();
  });

  it("defaults to scoped when the model returns an off-schema result (spec Risk)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    // Not a valid label → boundary parse fails → default scoped, no throw.
    mockClassify.mockResolvedValueOnce({ result: "maybe", reason: 42 });

    const outcome = await TriageService.triageSession(sessionId, owner, false);

    expect(outcome.result).toBe("scoped");
    expect(outcome.route).toBe("interview");
    const persisted = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    expect(persisted?.triage_result).toBe("scoped");
  });

  it("defaults to scoped when null is returned (unparseable model output)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockResolvedValueOnce(null);

    const outcome = await TriageService.triageSession(sessionId, owner, false);
    expect(outcome.result).toBe("scoped");
  });

  it("defaults to scoped (never throws) when both models fail, after a fallback retry", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockRejectedValue(new Error("model down")); // primary + fallback

    const outcome = await TriageService.triageSession(sessionId, owner, false);

    expect(outcome.result).toBe("scoped");
    expect(mockClassify).toHaveBeenCalledTimes(2); // primary then fallback
    const persisted = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    expect(persisted?.triage_result).toBe("scoped");
  });

  it("recovers on the fallback model when the primary rejects", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify
      .mockRejectedValueOnce(new Error("primary rejected the model"))
      .mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    const outcome = await TriageService.triageSession(sessionId, owner, false);

    expect(outcome.result).toBe("simple");
    expect(outcome.route).toBe("ticket");
    expect(mockClassify).toHaveBeenCalledTimes(2);
  });

  it("override forces the interview route even from a simple label (spec What)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    const outcome = await TriageService.triageSession(sessionId, owner, true);

    // The label still persists as classified; only the route is forced.
    expect(outcome.result).toBe("simple");
    expect(outcome.route).toBe("interview");
    expect(outcome.overridden).toBe(true);
    const persisted = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    expect(persisted?.triage_result).toBe("simple");
  });

  it("is idempotent: returns the persisted label without re-calling the model on a re-trigger", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    // First triage classifies + persists.
    const first = await TriageService.triageSession(sessionId, owner, false);
    expect(first.result).toBe("simple");
    expect(mockClassify).toHaveBeenCalledTimes(1);

    // A re-trigger (StrictMode double-mount / query refetch) must NOT classify again.
    const second = await TriageService.triageSession(sessionId, owner, false);
    expect(second.result).toBe("simple");
    expect(second.route).toBe("ticket");
    expect(mockClassify).toHaveBeenCalledTimes(1); // still one — no second model call
  });

  it("re-applies the override against the persisted label on a re-trigger (route forced, no re-classify)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    await TriageService.triageSession(sessionId, owner, false);
    // Re-trigger with override: the persisted label stays simple, the route is forced.
    const outcome = await TriageService.triageSession(sessionId, owner, true);

    expect(outcome.result).toBe("simple");
    expect(outcome.route).toBe("interview");
    expect(outcome.overridden).toBe(true);
    expect(mockClassify).toHaveBeenCalledTimes(1);
  });

  it("hides another owner's session (NOT_FOUND, §11.7) and never calls the model", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const sessionId = await seedSession(ownerA);

    await expect(
      TriageService.triageSession(sessionId, ownerB, false),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(mockClassify).not.toHaveBeenCalled();
  });
});
