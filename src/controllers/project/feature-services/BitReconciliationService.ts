/**
 * BitReconciliationService — business logic for reconciling candidate bits against
 * a project's existing context (spec T9, §7.1). It is the only layer between the
 * controller and the reconciliation agent + the bit models; it raises typed
 * ProjectError; it enforces owner scope by owner-verifying the project before any
 * read or write (§11.7). Never touches req/res. Mirrors InterviewEngineService —
 * specifically its callAgentWithFallback + parseOrThrow boundary re-validation
 * pattern (§6.1, §11.2).
 *
 * Two public operations, mirroring the agent-proposes / human-disposes split
 * (spec R2):
 *
 *  - reconcile(): owner-verify → load active bits → call the agent (with model
 *    fallback) → re-validate the plan at the boundary → return the plan. NO WRITES.
 *    This is the preview half: the PM sees what the agent proposes before anything
 *    changes.
 *
 *  - applyResolutions(): owner-verify → apply the HUMAN-confirmed resolutions in
 *    ONE transaction (§10.5). insert/keep_both/force create a bit; merge supersedes
 *    the target and creates the merged summary; skip is a no-op. Never auto-deletes
 *    — merge supersedes (status='superseded'), preserving an audit trail so a bad
 *    merge is reversible (spec R2). Returns the project's resulting ACTIVE bits.
 */
import { generateBitProposal } from "../../../agents/bitProposalAgent";
import { generateReconciliationPlan } from "../../../agents/bitReconciliationAgent";
import { BIT_PROPOSAL, BIT_RECONCILIATION } from "../../../config";
import { logger } from "../../../config/logger";
import { BaseModel, QueryContext } from "../../../models/BaseModel";
import { DecisionRecordModel } from "../../../models/DecisionRecordModel";
import { ProjectBitModel } from "../../../models/ProjectBitModel";
import { ProjectModel } from "../../../models/ProjectModel";
import { TicketModel } from "../../../models/TicketModel";
import {
  bitProposalOutputSchema,
  reconciliationPlanSchema,
} from "../../../validation/projectBit";
import type {
  BitSource,
  CandidateBit,
  IProjectBit,
  ReconciliationPlan,
  ResolvedAction,
} from "../../../types/project";
import type { EffortTier, OwnerContext } from "../../../types/interview";
import { ProjectError } from "../feature-utils/ProjectError";

/**
 * The merge-on-complete preview (spec T13): the candidate bits the proposal agent
 * distilled from a finalized ticket, plus the reconciliation plan diffing them
 * against the project's active bits. The PM resolves the plan (the candidates are
 * the same array the resolve screen sends back to applyResolutions). Returned by
 * proposeFromTicket; surfaced through the envelope unchanged.
 */
export interface MergeProposal {
  candidates: CandidateBit[];
  plan: ReconciliationPlan;
}

/**
 * The result of an import (spec T10). A discriminated union because the two import
 * modes return different things: the additive default returns a plan to preview
 * (no writes), the explicit-force path returns the bits it applied. The `mode`
 * tag lets the controller pass either straight through the envelope and the
 * frontend branch on which happened.
 */
export type ImportResult =
  | { mode: "reconcile"; plan: ReconciliationPlan }
  | { mode: "applied"; bits: IProjectBit[] };

export class BitReconciliationService {
  /**
   * Owner-verify the project a reconciliation targets, or throw NOT_FOUND. The
   * single tenancy gate both public methods run before touching the agent or the
   * models (§11.7) — a missing or foreign project is indistinguishable, never
   * leaked. Mirrors ProjectBitService.assertProjectOwned and
   * InterviewEngineService.requireSession.
   */
  private static async requireProject(
    projectId: number,
    owner: OwnerContext,
  ): Promise<void> {
    const project = await ProjectModel.findByIdForOwner(projectId, owner);
    if (!project) {
      throw new ProjectError(
        "PROJECT_NOT_FOUND",
        `Project ${projectId} was not found.`,
        { id: projectId },
      );
    }
  }

  /**
   * Plan a reconciliation for a batch of candidates against an owner-verified
   * project's ACTIVE bits (spec T9). Read-only — it NEVER writes; the returned
   * plan is surfaced to a human resolve step, which then calls applyResolutions.
   * The agent output is re-validated at the boundary (§11.2) and rejected
   * (PLAN_INVALID) when off-schema, so a malformed proposal can never reach the
   * apply path.
   */
  static async reconcile(
    projectId: number,
    owner: OwnerContext,
    candidates: CandidateBit[],
  ): Promise<ReconciliationPlan> {
    await this.requireProject(projectId, owner);
    // The project name + its active bits are the agent's grounding. Loading only
    // ACTIVE bits keeps superseded history out of the reconciliation (spec R2).
    const project = await ProjectModel.findByIdForOwner(projectId, owner);
    const existingBits = await ProjectBitModel.listActiveByProject(projectId);

    // The reconciliation agent is a single bounded LLM call that can take many
    // seconds for a large batch; log start + finish so a long import is visible
    // in the logs rather than silent (§9.3).
    logger.info(
      { projectId, candidateCount: candidates.length, existingCount: existingBits.length },
      "Reconciling candidate bits against project context",
    );
    const plan = await this.callAgentWithFallback(
      {
        // requireProject already proved the project exists for this owner; the
        // re-fetch is non-null here, but guard for the type-checker without leaking.
        projectName: project?.name ?? `Project ${projectId}`,
        existingBits,
        candidates,
      },
      projectId,
    );
    logger.info(
      { projectId, actionCount: plan.actions.length },
      "Reconciliation plan ready",
    );
    return plan;
  }

  /**
   * Merge-on-complete (spec T13): turn a FINALIZED ticket into candidate bits and
   * preview how they reconcile against the project's existing context. The flow,
   * owner-scoped end to end (§11.7):
   *
   *  1. owner-verify the project (NOT_FOUND when missing/foreign, never leaked);
   *  2. load the ticket owner-scoped (TicketModel joins through its session's
   *     owner_user_id, §11.7) — a ticket the caller does not own is NOT_FOUND;
   *  3. load that session's settled decisions (the real source of truth);
   *  4. call the proposal agent with model + fallback (mirrors callAgentWithFallback)
   *     and re-validate its output at the boundary (bitProposalOutputSchema, §11.2);
   *  5. reconcile() the candidates against the project's active bits → a plan.
   *
   * READ-ONLY: like reconcile(), it writes NOTHING. The returned candidates + plan
   * go to the human resolve step, which calls applyResolutions with
   * source "merged" + the ticket id (the agent proposes; the human disposes, spec
   * R2). The two agents are sequenced (propose, then reconcile), each a single
   * bounded call, so the endpoint stays short-lived (no long agent loop).
   */
  static async proposeFromTicket(
    projectId: number,
    owner: OwnerContext,
    ticketId: number,
  ): Promise<MergeProposal> {
    await this.requireProject(projectId, owner);

    // Owner-scoped ticket load: TicketModel joins through interview_sessions and
    // filters owner_user_id, so a foreign/missing ticket is indistinguishable
    // (NOT_FOUND), never leaked (§11.7, §5.5).
    const ticket = await TicketModel.findByIdForOwner(ticketId, owner);
    if (!ticket) {
      throw new ProjectError(
        "TICKET_NOT_FOUND",
        `Ticket ${ticketId} was not found.`,
        { ticketId },
      );
    }

    const decisions = await DecisionRecordModel.listBySession(ticket.session_id);

    const candidates = await this.callProposalWithFallback(
      {
        userStory: ticket.user_story ?? "",
        acceptanceCriteria: ticket.acceptance_criteria ?? [],
        contextSummary: ticket.context_summary ?? "",
        // Effort is always set on a finalized ticket; default to M for the
        // type-checker without leaking (the generator constrains it to a tier).
        effort: (ticket.effort ?? "M") as EffortTier,
        decisions,
      },
      projectId,
    );

    // Diff the proposed candidates against the project's active bits (no writes).
    const plan = await this.reconcile(projectId, owner, candidates);
    return { candidates, plan };
  }

  /**
   * Apply the human-confirmed resolutions for a batch of candidates against an
   * owner-verified project, atomically (spec T9, §10.5). Each resolution is paired
   * with its candidate by incomingIndex. The whole apply runs in ONE transaction
   * so a partial failure rolls back every write (no half-applied plan). Returns
   * the project's resulting ACTIVE bits.
   *
   * Choice semantics (spec R2 — agent proposes, human disposes; never auto-delete):
   *  - insert    → create the candidate as a new active bit.
   *  - merge     → supersede the target bit (audit-preserving, not delete) and
   *                create the merged summary as a new active bit.
   *  - keep_both → create the candidate alongside the existing bit (no supersede).
   *  - skip      → no-op (the candidate is intentionally dropped).
   *  - force     → create the candidate REGARDLESS of any conflict/similar flag.
   */
  static async applyResolutions(
    projectId: number,
    owner: OwnerContext,
    candidates: CandidateBit[],
    resolutions: ResolvedAction[],
    provenance: { source?: BitSource; sourceTicketId?: number } = {},
  ): Promise<IProjectBit[]> {
    await this.requireProject(projectId, owner);

    // Default to the import/manual provenance so existing callers are unchanged
    // (spec T13): source "imported", no originating ticket. Merge-on-complete
    // passes { source: "merged", sourceTicketId } so the applied bits carry their
    // origin (an audit trail, spec R2).
    const source: BitSource = provenance.source ?? "imported";
    const sourceTicketId: number | null = provenance.sourceTicketId ?? null;

    await BaseModel.runTransaction(async (trx) => {
      for (const resolution of resolutions) {
        const candidate = candidates[resolution.incomingIndex];
        if (!candidate) {
          // A resolution that points at no candidate is a malformed payload; reject
          // the whole apply so nothing is half-written (§11.2, §10.5 rollback).
          throw new ProjectError(
            "RESOLUTION_INVALID",
            `Resolution references candidate index ${resolution.incomingIndex}, which does not exist.`,
            { projectId, incomingIndex: resolution.incomingIndex },
          );
        }
        await this.applyOne(projectId, candidate, resolution, source, sourceTicketId, trx);
      }
    });

    // Return the post-apply active set so the caller can refresh its view.
    return ProjectBitModel.listActiveByProject(projectId);
  }

  /**
   * Import a batch of bits from an uploaded JSON file (spec T10). Import is
   * ADDITIVE by default and only ever clears under an explicit `force` flag:
   *
   *  - force === false (default): route the bits through reconcile() and return
   *    the plan for preview-then-confirm. NOTHING is written — the PM resolves the
   *    plan via applyResolutions. This is the safe path (spec: never clears).
   *
   *  - force === true: clear-and-replace in ONE transaction (§10.5) — supersede
   *    every active bit (audit-preserving, never hard-delete, spec R2), then bulk
   *    insert the incoming bits as source 'imported'. Return the applied bits.
   *    This is the ONLY path that clears, and only when force is explicit.
   *
   * The two outcomes have different shapes, so the result is a discriminated union
   * the controller passes straight through the envelope.
   */
  static async importBits(
    projectId: number,
    owner: OwnerContext,
    candidates: CandidateBit[],
    force: boolean,
  ): Promise<ImportResult> {
    await this.requireProject(projectId, owner);

    if (!force) {
      // Additive default: preview a reconciliation plan, write nothing.
      const plan = await this.reconcile(projectId, owner, candidates);
      return { mode: "reconcile", plan };
    }

    // Explicit force: clear (supersede) the active set, then replace it, atomically.
    const bits = await BaseModel.runTransaction(async (trx) => {
      const active = await ProjectBitModel.listActiveByProject(projectId, trx);
      for (const bit of active) {
        await ProjectBitModel.supersede(bit.id, projectId, trx);
      }
      await ProjectBitModel.createMany(
        candidates.map((candidate) => ({
          projectId,
          kind: candidate.kind,
          bitKey: candidate.bit_key,
          summary: candidate.summary,
          source: "imported" as const,
        })),
        trx,
      );
      return ProjectBitModel.listActiveByProject(projectId, trx);
    });
    return { mode: "applied", bits };
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * Apply ONE resolution inside the caller's transaction. Centralizes the
   * choice→write mapping so applyResolutions stays a thin loop (§2.2). The
   * merged/edited summary the PM may have supplied (resolution.summary) wins over
   * the candidate's own summary; for `merge` it is the merged text.
   */
  private static async applyOne(
    projectId: number,
    candidate: CandidateBit,
    resolution: ResolvedAction,
    source: BitSource,
    sourceTicketId: number | null,
    trx: QueryContext,
  ): Promise<void> {
    const summary = resolution.summary ?? candidate.summary;

    switch (resolution.choice) {
      case "skip":
        // Intentionally dropped — record nothing.
        return;

      case "merge": {
        // Supersede the target (audit trail, never delete, spec R2), then create
        // the merged summary as a fresh active bit. A merge with no target is
        // malformed — reject so the txn rolls back (§11.2).
        if (resolution.targetBitId === null || resolution.targetBitId === undefined) {
          throw new ProjectError(
            "RESOLUTION_INVALID",
            `A merge for candidate index ${resolution.incomingIndex} requires a targetBitId.`,
            { projectId, incomingIndex: resolution.incomingIndex },
          );
        }
        await ProjectBitModel.supersede(resolution.targetBitId, projectId, trx);
        await ProjectBitModel.create(
          {
            projectId,
            kind: candidate.kind,
            bitKey: candidate.bit_key,
            summary,
            source,
            sourceTicketId,
          },
          trx,
        );
        return;
      }

      case "insert":
      case "keep_both":
      case "force":
        // All three create the candidate as a new active bit. `force` differs only
        // in intent (it overrides a conflict/similar flag) — there is no flag stored
        // on the row to bypass, so the write is the same create regardless.
        await ProjectBitModel.create(
          {
            projectId,
            kind: candidate.kind,
            bitKey: candidate.bit_key,
            summary,
            source,
            sourceTicketId,
          },
          trx,
        );
        return;

      default:
        // Exhaustiveness guard — an unknown choice is a contract drift, not a
        // silent no-op (§3.2). The boundary schema constrains choice, so this is a
        // backstop, never hit in practice.
        throw new ProjectError(
          "RESOLUTION_INVALID",
          `Unknown resolution choice for candidate index ${resolution.incomingIndex}.`,
          { projectId, incomingIndex: resolution.incomingIndex },
        );
    }
  }

  /**
   * Call the agent; on a model-rejection/error, retry once with the fallback
   * model (spec model guidance). Re-validate the parsed output at the boundary;
   * reject (never return) anything off-schema. Mirrors
   * InterviewEngineService.callAgentWithFallback exactly (§11.2).
   */
  private static async callAgentWithFallback(
    params: Parameters<typeof generateReconciliationPlan>[0],
    projectId: number,
  ): Promise<ReconciliationPlan> {
    let raw: unknown;
    try {
      raw = await generateReconciliationPlan(params, BIT_RECONCILIATION.MODEL);
    } catch (error) {
      logger.warn(
        { err: error, projectId, model: BIT_RECONCILIATION.MODEL },
        "Primary reconciliation model failed; retrying with fallback",
      );
      try {
        raw = await generateReconciliationPlan(params, BIT_RECONCILIATION.FALLBACK_MODEL);
      } catch {
        throw new ProjectError(
          "RECONCILIATION_FAILED",
          "The reconciliation engine could not produce a plan.",
          { projectId },
        );
      }
    }
    return this.parsePlanOrThrow(raw, projectId);
  }

  /**
   * Re-validate the model output at the boundary; throw PLAN_INVALID on failure
   * (§11.2). The locked reconciliationPlanSchema is authoritative — an off-schema
   * proposal is never trusted or applied. Mirrors
   * InterviewEngineService.parseBatchOrThrow.
   */
  private static parsePlanOrThrow(raw: unknown, projectId: number): ReconciliationPlan {
    const parsed = reconciliationPlanSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { projectId, issues: parsed.error.issues.map((i) => i.message) },
        "Reconciliation plan failed boundary validation; rejecting",
      );
      throw new ProjectError(
        "RECONCILIATION_PLAN_INVALID",
        "The reconciliation engine returned a malformed plan.",
        { projectId },
      );
    }
    return parsed.data as ReconciliationPlan;
  }

  /**
   * Call the PROPOSAL agent (merge-on-complete, spec T13); on a model-rejection/
   * error, retry once with the fallback model. Re-validate the parsed output at
   * the boundary; reject (never return) anything off-schema. Mirrors
   * callAgentWithFallback exactly, against the proposal agent + its own
   * config/schema (§11.2).
   */
  private static async callProposalWithFallback(
    params: Parameters<typeof generateBitProposal>[0],
    projectId: number,
  ): Promise<CandidateBit[]> {
    let raw: unknown;
    try {
      raw = await generateBitProposal(params, BIT_PROPOSAL.MODEL);
    } catch (error) {
      logger.warn(
        { err: error, projectId, model: BIT_PROPOSAL.MODEL },
        "Primary bit-proposal model failed; retrying with fallback",
      );
      try {
        raw = await generateBitProposal(params, BIT_PROPOSAL.FALLBACK_MODEL);
      } catch {
        throw new ProjectError(
          "BIT_PROPOSAL_FAILED",
          "The bit proposal engine could not produce candidate bits.",
          { projectId },
        );
      }
    }
    return this.parseProposalOrThrow(raw, projectId);
  }

  /**
   * Re-validate the proposal agent's output at the boundary; throw
   * PROPOSAL_INVALID on failure (§11.2). bitProposalOutputSchema is authoritative
   * (it also enforces the 1-4 count) — an off-schema proposal never reaches the
   * reconciliation step. Mirrors parsePlanOrThrow. Returns the candidate array.
   */
  private static parseProposalOrThrow(raw: unknown, projectId: number): CandidateBit[] {
    const parsed = bitProposalOutputSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { projectId, issues: parsed.error.issues.map((i) => i.message) },
        "Bit proposal failed boundary validation; rejecting",
      );
      throw new ProjectError(
        "BIT_PROPOSAL_INVALID",
        "The bit proposal engine returned malformed candidate bits.",
        { projectId },
      );
    }
    return parsed.data.bits;
  }
}
