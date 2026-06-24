/**
 * BitReconciliationService tests (§20.1, §20.2). The Anthropic SDK is mocked at
 * the agent seam (vi.mock of bitReconciliationAgent) so the suite is deterministic
 * and free — no live model call, synthetic data only (§20.4). Mirrors
 * InterviewEngineService.test.ts: the agent module is mocked BEFORE importing
 * anything that pulls it in, synthetic owners are owner_user_id > 1000, and the
 * projects they own are cleaned in afterAll (project_bits CASCADE with the project).
 *
 * Covers: the reconcile() contract (returns the validated plan, writes nothing),
 * the applyResolutions() transaction (insert / merge supersede+create / skip /
 * force), owner-scope isolation (another owner's project is NOT_FOUND), and
 * boundary rejection of off-schema agent output (the plan never reaches apply).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent modules BEFORE importing anything that pulls them in. The
// reconciliation agent is mocked for every path; the PROPOSAL agent is mocked for
// the merge-on-complete (proposeFromTicket) tests (spec T13) — both seams stay
// deterministic and free, synthetic data only (§20.4).
vi.mock("../../../agents/bitReconciliationAgent", () => ({
  generateReconciliationPlan: vi.fn(),
}));
vi.mock("../../../agents/bitProposalAgent", () => ({
  generateBitProposal: vi.fn(),
}));

import { generateBitProposal } from "../../../agents/bitProposalAgent";
import { generateReconciliationPlan } from "../../../agents/bitReconciliationAgent";
import { db } from "../../../database/connection";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { ProjectBitModel } from "../../../models/ProjectBitModel";
import { ProjectModel } from "../../../models/ProjectModel";
import { TicketModel } from "../../../models/TicketModel";
import { makeGeneratedTicket, makeOwner, makeProjectName } from "../../../test/factories";
import type { OwnerContext } from "../../../types/interview";
import type {
  CandidateBit,
  IProjectBit,
  ResolvedAction,
} from "../../../types/project";
import { BitReconciliationService } from "./BitReconciliationService";

const mockGenerate = vi.mocked(generateReconciliationPlan);
const mockPropose = vi.mocked(generateBitProposal);

/** A synthetic candidate-bit batch (defaults to one feature bit). */
function makeCandidates(overrides: CandidateBit[] = []): CandidateBit[] {
  if (overrides.length > 0) return overrides;
  return [{ kind: "feature", bit_key: "auth", summary: "Google sign-in." }];
}

/** Create an owner-owned project; returns its id. */
async function seedProject(owner: OwnerContext): Promise<number> {
  const project = await ProjectModel.create(owner, { name: makeProjectName() });
  return project.id;
}

/** Seed one active bit on a project and return it. */
async function seedBit(
  projectId: number,
  overrides: Partial<{ kind: IProjectBit["kind"]; bitKey: string; summary: string }> = {},
): Promise<IProjectBit> {
  return ProjectBitModel.create({
    projectId,
    kind: overrides.kind ?? "feature",
    bitKey: overrides.bitKey ?? "auth",
    summary: overrides.summary ?? "Email/password auth.",
  });
}

/**
 * Seed an owner-owned session attached to a project, plus a FINALIZED ticket on
 * it (merge-on-complete reads off a finalized ticket, spec T13). Returns the
 * session id + the finalized ticket id. Synthetic data only (§20.4).
 */
async function seedSessionWithFinalTicket(
  owner: OwnerContext,
  projectId: number | null,
): Promise<{ sessionId: number; ticketId: number }> {
  const session = await InterviewSessionModel.create(owner, {
    originalRequest: "Add Google sign-in.",
    projectId,
  });
  const generated = makeGeneratedTicket();
  const ticket = await TicketModel.create({
    sessionId: session.id,
    userStory: generated.user_story,
    acceptanceCriteria: generated.acceptance_criteria,
    effort: generated.effort,
    contextSummary: generated.context_summary,
    priority: "medium",
    details: {
      problemBackground: null,
      keyDecisions: [],
      openQuestions: [],
      successMetrics: [],
      dependencies: [],
      codebaseGrounding: [],
    },
    renderedMarkdown: "# Ticket",
    shareToken: `tok_test_${session.id}`,
  });
  // Flip the draft to final so findLatestFinalBySessionForOwner sees it.
  await TicketModel.finalizeForOwner(ticket.id, ticket.version);
  return { sessionId: session.id, ticketId: ticket.id };
}

describe("BitReconciliationService", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockPropose.mockReset();
  });

  afterAll(async () => {
    // Projects own their bits (CASCADE); sessions own their tickets (CASCADE).
    // Delete the synthetic owners' rows in both trees (owner_user_id > 1000).
    await db("projects").where("owner_user_id", ">", 1000).del();
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  /* ------------------------------- reconcile ----------------------------- */

  describe("reconcile", () => {
    it("returns the validated plan and writes nothing", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      await seedBit(projectId, { summary: "Email/password auth." });
      mockGenerate.mockResolvedValueOnce({
        actions: [
          { incomingIndex: 0, action: "update", targetBitId: null, reason: "Merges auth." },
        ],
      });

      const plan = await BitReconciliationService.reconcile(
        projectId,
        owner,
        makeCandidates(),
      );

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0].action).toBe("update");
      // No writes: the project still has exactly the one seeded active bit.
      const active = await ProjectBitModel.listActiveByProject(projectId);
      expect(active).toHaveLength(1);
    });

    it("forwards the project's active bits + candidates to the agent", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      await seedBit(projectId, { summary: "Email/password auth." });
      mockGenerate.mockResolvedValueOnce({ actions: [] });

      await BitReconciliationService.reconcile(projectId, owner, makeCandidates());

      const params = mockGenerate.mock.calls[0][0];
      expect(params.existingBits.some((b) => b.summary.includes("Email/password"))).toBe(true);
      expect(params.candidates[0].bit_key).toBe("auth");
      expect(params.projectName.length).toBeGreaterThan(0);
    });

    it("retries with the fallback model, then surfaces a typed failure when both fail", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      mockGenerate.mockRejectedValue(new Error("model down")); // primary + fallback

      await expect(
        BitReconciliationService.reconcile(projectId, owner, makeCandidates()),
      ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
      expect(mockGenerate).toHaveBeenCalledTimes(2); // primary then fallback
    });

    it("rejects an off-schema plan at the boundary and writes nothing (§11.2)", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      // `action` is not a valid enum member → boundary validation fails.
      mockGenerate.mockResolvedValueOnce({
        actions: [{ incomingIndex: 0, action: "frobnicate", reason: "nonsense" }],
      });

      await expect(
        BitReconciliationService.reconcile(projectId, owner, makeCandidates()),
      ).rejects.toMatchObject({ code: "RECONCILIATION_PLAN_INVALID" });
    });

    it("hides another owner's project (NOT_FOUND, §11.7)", async () => {
      const ownerA = makeOwner();
      const ownerB = makeOwner();
      const projectId = await seedProject(ownerA);
      mockGenerate.mockResolvedValueOnce({ actions: [] });

      await expect(
        BitReconciliationService.reconcile(projectId, ownerB, makeCandidates()),
      ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
      // The agent was never called — owner scope is checked first.
      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  /* --------------------------- applyResolutions -------------------------- */

  describe("applyResolutions", () => {
    it("inserts a candidate as a new active bit", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const candidates = makeCandidates([
        { kind: "constraint", bit_key: "platform", summary: "Web only." },
      ]);
      const resolutions: ResolvedAction[] = [{ incomingIndex: 0, choice: "insert" }];

      const bits = await BitReconciliationService.applyResolutions(
        projectId,
        owner,
        candidates,
        resolutions,
      );

      expect(bits).toHaveLength(1);
      expect(bits[0].summary).toBe("Web only.");
      expect(bits[0].source).toBe("imported"); // default apply source
      expect(bits[0].status).toBe("active");
    });

    it("merges: supersedes the target and creates the merged summary", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const target = await seedBit(projectId, { summary: "Email/password auth." });
      const candidates = makeCandidates([
        { kind: "feature", bit_key: "auth", summary: "Google sign-in." },
      ]);
      const resolutions: ResolvedAction[] = [
        {
          incomingIndex: 0,
          choice: "merge",
          targetBitId: target.id,
          summary: "Auth: email/password and Google sign-in.",
        },
      ];

      const active = await BitReconciliationService.applyResolutions(
        projectId,
        owner,
        candidates,
        resolutions,
      );

      // The merged bit is the only active one; the target was superseded (not deleted).
      expect(active).toHaveLength(1);
      expect(active[0].summary).toBe("Auth: email/password and Google sign-in.");
      const all = await ProjectBitModel.listByProject(projectId);
      const superseded = all.find((b) => b.id === target.id);
      expect(superseded?.status).toBe("superseded"); // audit trail preserved (spec R2)
    });

    it("skips a candidate (no write)", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      await seedBit(projectId, { summary: "Existing." });
      const candidates = makeCandidates([
        { kind: "feature", bit_key: "dupe", summary: "Already present." },
      ]);
      const resolutions: ResolvedAction[] = [{ incomingIndex: 0, choice: "skip" }];

      const active = await BitReconciliationService.applyResolutions(
        projectId,
        owner,
        candidates,
        resolutions,
      );

      // Only the pre-existing bit remains; the skipped candidate wrote nothing.
      expect(active).toHaveLength(1);
      expect(active[0].summary).toBe("Existing.");
    });

    it("force creates the candidate regardless of any flag", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      await seedBit(projectId, { summary: "Web only." });
      const candidates = makeCandidates([
        { kind: "constraint", bit_key: "platform", summary: "Native mobile app." },
      ]);
      // A conflicting fact forced in over the agent's flag — both now coexist.
      const resolutions: ResolvedAction[] = [{ incomingIndex: 0, choice: "force" }];

      const active = await BitReconciliationService.applyResolutions(
        projectId,
        owner,
        candidates,
        resolutions,
      );

      expect(active).toHaveLength(2);
      expect(active.some((b) => b.summary === "Native mobile app.")).toBe(true);
    });

    it("rolls back the whole apply when one resolution is malformed (§10.5)", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const candidates = makeCandidates([
        { kind: "feature", bit_key: "a", summary: "First." },
        { kind: "feature", bit_key: "b", summary: "Second." },
      ]);
      // Second resolution is a merge with no targetBitId → throws mid-transaction.
      const resolutions: ResolvedAction[] = [
        { incomingIndex: 0, choice: "insert" },
        { incomingIndex: 1, choice: "merge", targetBitId: null },
      ];

      await expect(
        BitReconciliationService.applyResolutions(projectId, owner, candidates, resolutions),
      ).rejects.toMatchObject({ code: "RESOLUTION_INVALID" });

      // The first insert was rolled back with the failed merge — nothing persisted.
      const active = await ProjectBitModel.listActiveByProject(projectId);
      expect(active).toHaveLength(0);
    });

    it("hides another owner's project (NOT_FOUND, §11.7)", async () => {
      const ownerA = makeOwner();
      const ownerB = makeOwner();
      const projectId = await seedProject(ownerA);
      const resolutions: ResolvedAction[] = [{ incomingIndex: 0, choice: "insert" }];

      await expect(
        BitReconciliationService.applyResolutions(
          projectId,
          ownerB,
          makeCandidates(),
          resolutions,
        ),
      ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    });
  });

  /* ------------------------------- importBits ---------------------------- */

  describe("importBits", () => {
    it("additive default: returns a reconcile plan and writes nothing", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      await seedBit(projectId, { summary: "Existing." });
      mockGenerate.mockResolvedValueOnce({
        actions: [{ incomingIndex: 0, action: "insert", reason: "New fact." }],
      });

      const result = await BitReconciliationService.importBits(
        projectId,
        owner,
        makeCandidates(),
        false,
      );

      expect(result.mode).toBe("reconcile");
      if (result.mode === "reconcile") {
        expect(result.plan.actions).toHaveLength(1);
      }
      // Nothing cleared, nothing added.
      const active = await ProjectBitModel.listActiveByProject(projectId);
      expect(active).toHaveLength(1);
      expect(active[0].summary).toBe("Existing.");
    });

    it("force: clears (supersedes) the active set and replaces it", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const old = await seedBit(projectId, { summary: "Old fact." });
      const candidates = makeCandidates([
        { kind: "tech_stack", bit_key: "stack", summary: "React SPA + Express + Postgres." },
        { kind: "constraint", bit_key: "platform", summary: "Web only." },
      ]);

      const result = await BitReconciliationService.importBits(
        projectId,
        owner,
        candidates,
        true,
      );

      // The agent is NOT consulted on the force path — it is a direct replace.
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(result.mode).toBe("applied");
      if (result.mode === "applied") {
        expect(result.bits).toHaveLength(2);
        expect(result.bits.every((b) => b.source === "imported")).toBe(true);
      }
      // The old bit was superseded (audit trail), not deleted.
      const all = await ProjectBitModel.listByProject(projectId);
      const superseded = all.find((b) => b.id === old.id);
      expect(superseded?.status).toBe("superseded");
    });
  });

  /* ---------------------------- proposeFromTicket ------------------------ */

  describe("proposeFromTicket (merge-on-complete, spec T13)", () => {
    it("returns the proposed candidates + the reconciliation plan, writing nothing", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      await seedBit(projectId, { summary: "Email/password auth." });
      const { ticketId } = await seedSessionWithFinalTicket(owner, projectId);

      // The proposal agent distills the finalized ticket into one candidate bit;
      // the reconciliation agent then diffs it against the project's active bits.
      mockPropose.mockResolvedValueOnce({
        bits: [{ kind: "feature", bit_key: "auth", summary: "Google sign-in." }],
      });
      mockGenerate.mockResolvedValueOnce({
        actions: [
          { incomingIndex: 0, action: "update", targetBitId: null, reason: "Merges auth." },
        ],
      });

      const result = await BitReconciliationService.proposeFromTicket(
        projectId,
        owner,
        ticketId,
      );

      // Both agents ran once (propose, then reconcile), and the shape is the
      // candidates the agent proposed plus the plan to resolve.
      expect(mockPropose).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].summary).toBe("Google sign-in.");
      expect(result.plan.actions).toHaveLength(1);
      expect(result.plan.actions[0].action).toBe("update");
      // Read-only: still exactly the one seeded active bit.
      const active = await ProjectBitModel.listActiveByProject(projectId);
      expect(active).toHaveLength(1);
    });

    it("rejects an off-schema proposal at the boundary, before reconciling (§11.2)", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const { ticketId } = await seedSessionWithFinalTicket(owner, projectId);
      // `kind` is not a valid bit kind → boundary validation fails.
      mockPropose.mockResolvedValueOnce({
        bits: [{ kind: "nonsense", bit_key: "x", summary: "y" }],
      });

      await expect(
        BitReconciliationService.proposeFromTicket(projectId, owner, ticketId),
      ).rejects.toMatchObject({ code: "BIT_PROPOSAL_INVALID" });
      // The reconciliation agent was never reached — the bad proposal stopped first.
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("retries the proposal with the fallback model, then surfaces a typed failure", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const { ticketId } = await seedSessionWithFinalTicket(owner, projectId);
      mockPropose.mockRejectedValue(new Error("model down")); // primary + fallback

      await expect(
        BitReconciliationService.proposeFromTicket(projectId, owner, ticketId),
      ).rejects.toMatchObject({ code: "BIT_PROPOSAL_FAILED" });
      expect(mockPropose).toHaveBeenCalledTimes(2); // primary then fallback
    });

    it("hides another owner's ticket (NOT_FOUND, §11.7)", async () => {
      const ownerA = makeOwner();
      const ownerB = makeOwner();
      const projectId = await seedProject(ownerB); // B owns the project...
      const { ticketId } = await seedSessionWithFinalTicket(ownerA, null); // ...A owns the ticket
      mockPropose.mockResolvedValueOnce({
        bits: [{ kind: "feature", bit_key: "auth", summary: "Google sign-in." }],
      });

      await expect(
        BitReconciliationService.proposeFromTicket(projectId, ownerB, ticketId),
      ).rejects.toMatchObject({ code: "TICKET_NOT_FOUND" });
      // The proposal agent is never called — the ticket scope is checked first.
      expect(mockPropose).not.toHaveBeenCalled();
    });
  });

  /* -------------------- applyResolutions provenance (T13) ---------------- */

  describe("applyResolutions provenance (merge-on-complete, spec T13)", () => {
    it("stamps source 'merged' and source_ticket_id when provenance is passed", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const { ticketId } = await seedSessionWithFinalTicket(owner, projectId);
      const candidates = makeCandidates([
        { kind: "feature", bit_key: "auth", summary: "Google sign-in." },
      ]);
      const resolutions: ResolvedAction[] = [{ incomingIndex: 0, choice: "insert" }];

      const bits = await BitReconciliationService.applyResolutions(
        projectId,
        owner,
        candidates,
        resolutions,
        { source: "merged", sourceTicketId: ticketId },
      );

      expect(bits).toHaveLength(1);
      expect(bits[0].source).toBe("merged");
      expect(bits[0].source_ticket_id).toBe(ticketId);
      expect(bits[0].status).toBe("active");
    });

    it("defaults to source 'imported' with a null ticket id when no provenance is passed", async () => {
      const owner = makeOwner();
      const projectId = await seedProject(owner);
      const candidates = makeCandidates([
        { kind: "constraint", bit_key: "platform", summary: "Web only." },
      ]);
      const resolutions: ResolvedAction[] = [{ incomingIndex: 0, choice: "insert" }];

      const bits = await BitReconciliationService.applyResolutions(
        projectId,
        owner,
        candidates,
        resolutions,
      );

      // The existing import/manual apply path is unchanged.
      expect(bits[0].source).toBe("imported");
      expect(bits[0].source_ticket_id).toBeNull();
    });
  });
});
