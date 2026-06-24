/**
 * InterviewEngineService tests (§20.1, §20.2). The Anthropic SDK is mocked at
 * the agent seam (vi.mock of interviewAgent) so the suite is deterministic and
 * free — no live model call, synthetic data only (§20.4). Covers: the batch
 * schema (≤4 well-formed questions), atomic write-through persistence, the
 * materiality gate (asks again vs terminates), resume/replay with no
 * regeneration, the global stop, the malformed-output rejection path, and the
 * project-bits grounding path (grounded options + suppression).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent module BEFORE importing anything that pulls it in.
vi.mock("../../../agents/interviewAgent", () => ({
  generateBatch: vi.fn(),
}));

import { generateBatch } from "../../../agents/interviewAgent";
import { db } from "../../../database/connection";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { InterviewTurnModel } from "../../../models/InterviewTurnModel";
import { ProjectBitModel } from "../../../models/ProjectBitModel";
import { ProjectModel } from "../../../models/ProjectModel";
import {
  makeBatch,
  makeGroundedBatch,
  makeOwner,
  makeProjectName,
  makeRequestText,
} from "../../../test/factories";
import type { OwnerContext } from "../../../types/interview";
import { SPEED_TIERS } from "../../../validation/interviewQuestions";
import { InterviewEngineService } from "./InterviewEngineService";

const mockGenerate = vi.mocked(generateBatch);

/** Create a fresh persisted (ungrounded) session owned by a synthetic owner. */
async function seedSession(owner: OwnerContext): Promise<number> {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("engine"),
  });
  return session.id;
}

/**
 * Create a project with active bits and a session attached to it, so the
 * session's generation takes the grounded path. Includes a SETTLED tech_stack
 * bit (data_store) the grounded batch factory can mark as the suppressed question.
 */
async function seedGroundedSession(owner: OwnerContext): Promise<number> {
  const project = await ProjectModel.create(owner, { name: makeProjectName() });
  await ProjectBitModel.createMany([
    {
      projectId: project.id,
      kind: "tech_stack",
      bitKey: "data_store",
      summary: "Postgres via Knex is already the data store.",
    },
    {
      projectId: project.id,
      kind: "feature",
      bitKey: "auth",
      summary: "Email/password auth already exists.",
    },
  ]);
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: makeRequestText("engine"),
    projectId: project.id,
  });
  return session.id;
}

describe("InterviewEngineService", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
  });

  afterAll(async () => {
    // CASCADE from interview_sessions clears turns/decisions; projects own their
    // bits (CASCADE) and are deleted separately for synthetic owners.
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
    await db("projects").where("owner_user_id", ">", 1000).del();
  });

  it("generates a first batch, validates it, and persists it as turn 0", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));

    const state = await InterviewEngineService.advanceNextBatch(sessionId, owner);

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].turn_index).toBe(0);
    expect(state.status).toBe("in_progress");
    expect(state.isComplete).toBe(false);
    // The persisted batch round-trips as a structured value (not a string).
    const persisted = state.turns[0].questions as { questions: unknown[] };
    expect(persisted.questions).toHaveLength(1);
  });

  it("rejects an over-long batch (>4 questions) and persists nothing", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    const tooMany = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      decisionKey: `key_${i}`,
      text: `Q${i}?`,
      options: [{ id: "a", label: "A", groundingRef: null, speed: "fast" as const, recommended: true }],
      allowOther: false,
      dependsOn: [],
    }));
    mockGenerate.mockResolvedValueOnce(makeBatch({ questions: tooMany }));

    await expect(
      InterviewEngineService.advanceNextBatch(sessionId, owner),
    ).rejects.toMatchObject({ code: "BATCH_GENERATION_INVALID" });

    const turns = await InterviewTurnModel.listBySession(sessionId);
    expect(turns).toHaveLength(0); // nothing written
  });

  it("rejects malformed (off-schema) model output and persists nothing", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    // Missing required fields → boundary validation fails.
    mockGenerate.mockResolvedValueOnce({ questions: [{ id: "q1" }] });

    await expect(
      InterviewEngineService.advanceNextBatch(sessionId, owner),
    ).rejects.toMatchObject({ code: "BATCH_GENERATION_INVALID" });
    expect(await InterviewTurnModel.listBySession(sessionId)).toHaveLength(0);
  });

  it("surfaces a generation failure as a typed error when both models fail", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockRejectedValue(new Error("model down")); // primary + fallback

    await expect(
      InterviewEngineService.advanceNextBatch(sessionId, owner),
    ).rejects.toMatchObject({ code: "BATCH_GENERATION_FAILED" });
    expect(mockGenerate).toHaveBeenCalledTimes(2); // primary then fallback
  });

  it("persists answers and their decision rows atomically (write-through)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));
    await InterviewEngineService.advanceNextBatch(sessionId, owner);

    const state = await InterviewEngineService.submitAnswers(sessionId, owner, {
      answers: [{ questionId: "q1", optionId: "opt_magic", otherText: null }],
    });

    // The turn now carries answers, and exactly one decision row was written.
    expect(state.turns[0].answers).not.toBeNull();
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0].key).toBe("auth_method");
    expect(state.decisions[0].source).toBe("answer");
    expect(state.decisions[0].value).toEqual({ optionId: "opt_magic" });
    expect(state.status).toBe("in_progress");
  });

  it("records a free-text 'other' answer as a decision", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: false }));
    await InterviewEngineService.advanceNextBatch(sessionId, owner);

    const state = await InterviewEngineService.submitAnswers(sessionId, owner, {
      answers: [{ questionId: "q1", optionId: null, otherText: "Biometric" }],
    });
    expect(state.decisions[0].value).toEqual({ otherText: "Biometric" });
  });

  it("rejects an answer for an unknown question (boundary, §11.2)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));
    await InterviewEngineService.advanceNextBatch(sessionId, owner);

    await expect(
      InterviewEngineService.submitAnswers(sessionId, owner, {
        answers: [{ questionId: "does_not_exist", optionId: "opt_magic", otherText: null }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("terminates via the gate when no material decisions remain", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    // Batch 0 signals nothing more is material.
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: false }));
    await InterviewEngineService.advanceNextBatch(sessionId, owner);
    await InterviewEngineService.submitAnswers(sessionId, owner, {
      answers: [{ questionId: "q1", optionId: "opt_pw", otherText: null }],
    });

    // Next advance should NOT generate — it should terminate.
    const finalState = await InterviewEngineService.advanceNextBatch(sessionId, owner);
    expect(finalState.isComplete).toBe(true);
    expect(finalState.status).toBe("complete");
    expect(mockGenerate).toHaveBeenCalledTimes(1); // only the first batch was generated
  });

  it("stop-and-generate ends the interview immediately", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));
    await InterviewEngineService.advanceNextBatch(sessionId, owner);

    const state = await InterviewEngineService.submitAnswers(sessionId, owner, {
      answers: [{ questionId: "q1", optionId: "opt_magic", otherText: null }],
      stopAndGenerate: true,
    });
    expect(state.status).toBe("complete");
    expect(state.isComplete).toBe(true);
  });

  it("resume replays persisted turns + decisions with NO new generation", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));
    await InterviewEngineService.advanceNextBatch(sessionId, owner);
    await InterviewEngineService.submitAnswers(sessionId, owner, {
      answers: [{ questionId: "q1", optionId: "opt_magic", otherText: null }],
    });
    const callsAfterSetup = mockGenerate.mock.calls.length;

    // Simulate a fresh session/process: getState rebuilds purely from the DB.
    const resumed = await InterviewEngineService.getState(sessionId, owner);

    expect(mockGenerate).toHaveBeenCalledTimes(callsAfterSetup); // no regeneration
    expect(resumed.turns).toHaveLength(1);
    expect(resumed.turns[0].answers).not.toBeNull();
    expect(resumed.decisions).toHaveLength(1);
    expect(resumed.nextTurnIndex).toBe(1);
  });

  it("blocks advancing while the current batch is unanswered (conflict)", async () => {
    const owner = makeOwner();
    const sessionId = await seedSession(owner);
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));
    await InterviewEngineService.advanceNextBatch(sessionId, owner);

    await expect(
      InterviewEngineService.advanceNextBatch(sessionId, owner),
    ).rejects.toMatchObject({ code: "OPEN_BATCH_CONFLICT" });
  });

  it("hides another owner's session (NOT_FOUND, §11.7)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const sessionId = await seedSession(ownerA);

    await expect(
      InterviewEngineService.getState(sessionId, ownerB),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  /* ---------------- project-bits grounding (spec: project context) -------- */

  describe("grounded options (project bits)", () => {
    it("no-grounding fallback: forwards no grounding and persists ungrounded options", async () => {
      const owner = makeOwner();
      const sessionId = await seedSession(owner); // NO project attached
      mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));

      const state = await InterviewEngineService.advanceNextBatch(sessionId, owner);

      // The agent was called WITHOUT grounding (ungrounded path).
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      const params = mockGenerate.mock.calls[0][0];
      expect(params.grounding).toBeUndefined();

      // The persisted options carry no grounding and skipped is null, but each
      // still carries a speed tier and exactly one option is recommended.
      const persisted = state.turns[0].questions as {
        questions: Array<{
          options: Array<{
            groundingRef: string | null;
            speed: string;
            recommended: boolean;
          }>;
        }>;
        skipped: unknown;
      };
      const options = persisted.questions[0].options;
      expect(options.every((o) => o.groundingRef === null)).toBe(true);
      expect(options.every((o) => SPEED_TIERS.includes(o.speed as never))).toBe(true);
      expect(options.filter((o) => o.recommended === true)).toHaveLength(1);
      expect(persisted.skipped).toBeNull();
    });

    it("grounded path: forwards the project bits and persists grounded options + skips", async () => {
      const owner = makeOwner();
      const sessionId = await seedGroundedSession(owner);
      mockGenerate.mockResolvedValueOnce(makeGroundedBatch({ hasOpenMaterialDecisions: true }));

      const state = await InterviewEngineService.advanceNextBatch(sessionId, owner);

      // The agent received the project bits — the grounded branch.
      const params = mockGenerate.mock.calls[0][0];
      expect(params.grounding).toBeDefined();
      expect(params.grounding?.bits.length).toBeGreaterThan(0);
      expect(params.grounding?.bits.some((b) => b.summary.includes("Postgres"))).toBe(true);

      // Options reference a bit, carry a speed tier, and ONE is recommended.
      const persisted = state.turns[0].questions as {
        questions: Array<{
          options: Array<{
            groundingRef: string | null;
            speed: string;
            recommended: boolean;
          }>;
        }>;
        skipped: Array<{ decisionKey: string; reason: string }> | null;
      };
      const options = persisted.questions[0].options;
      expect(options.some((o) => o.groundingRef !== null)).toBe(true);
      expect(options.every((o) => SPEED_TIERS.includes(o.speed as never))).toBe(true);
      expect(options.filter((o) => o.recommended === true)).toHaveLength(1);

      // A fully-determined question was suppressed, with a recorded reason (auditable).
      expect(persisted.skipped).not.toBeNull();
      expect(persisted.skipped?.[0].decisionKey).toBe("data_store");
      expect(persisted.skipped?.[0].reason.length).toBeGreaterThan(0);
    });

    it("rejects a batch with more than one recommended option per question (boundary)", async () => {
      const owner = makeOwner();
      const sessionId = await seedGroundedSession(owner);
      // Two recommended options on one question violates "at most one" (spec Constraints).
      mockGenerate.mockResolvedValueOnce(
        makeGroundedBatch({
          questions: [
            {
              id: "q1",
              decisionKey: "auth_method",
              text: "How should users authenticate?",
              options: [
                { id: "a", label: "A", groundingRef: "auth", speed: "fast", recommended: true },
                { id: "b", label: "B", groundingRef: "auth", speed: "moderate", recommended: true },
              ],
              allowOther: false,
              dependsOn: [],
            },
          ],
          skipped: null,
        }),
      );

      await expect(
        InterviewEngineService.advanceNextBatch(sessionId, owner),
      ).rejects.toMatchObject({ code: "BATCH_GENERATION_INVALID" });
      // Nothing persisted — the off-schema batch never reaches the DB (§11.2).
      expect(await InterviewTurnModel.listBySession(sessionId)).toHaveLength(0);
    });

    it("accepts a grounded batch with no recommended pick (the ≤1 refine permits zero)", async () => {
      const owner = makeOwner();
      const sessionId = await seedGroundedSession(owner);
      mockGenerate.mockResolvedValueOnce(
        makeGroundedBatch({
          questions: [
            {
              id: "q1",
              decisionKey: "auth_method",
              text: "How should users authenticate?",
              options: [
                { id: "a", label: "A", groundingRef: "auth", speed: "fast", recommended: false },
                { id: "b", label: "B", groundingRef: "auth", speed: "moderate", recommended: false },
              ],
              allowOther: false,
              dependsOn: [],
            },
          ],
          skipped: null,
        }),
      );

      const state = await InterviewEngineService.advanceNextBatch(sessionId, owner);
      expect(state.turns).toHaveLength(1);
    });

    it("rejects an option with an invalid speed value (enum, §11.2)", async () => {
      const owner = makeOwner();
      const sessionId = await seedGroundedSession(owner);
      mockGenerate.mockResolvedValueOnce(
        makeGroundedBatch({
          questions: [
            {
              id: "q1",
              decisionKey: "auth_method",
              text: "How should users authenticate?",
              options: [
                // "medium" is not on the speed scale → boundary validation rejects it.
                { id: "a", label: "A", groundingRef: "auth", speed: "medium" as never, recommended: true },
              ],
              allowOther: false,
              dependsOn: [],
            },
          ],
          skipped: null,
        }),
      );

      await expect(
        InterviewEngineService.advanceNextBatch(sessionId, owner),
      ).rejects.toMatchObject({ code: "BATCH_GENERATION_INVALID" });
      expect(await InterviewTurnModel.listBySession(sessionId)).toHaveLength(0);
    });
  });
});
