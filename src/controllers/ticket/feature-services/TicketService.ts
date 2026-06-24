/**
 * TicketService — business logic for reading, editing, commenting on, and
 * finalizing a persisted ticket (spec T2/T3, §7.1). The only layer between the
 * controller and the models; raises typed TicketError; enforces owner scope by
 * owner-verifying the ticket (through its session) before every read/write
 * (§11.7). Never touches req/res. Generation lives in its sibling
 * TicketGenerationService. Mirrors InterviewEngineService (§6.1).
 */
import { logger } from "../../../config/logger";
import { BaseModel } from "../../../models/BaseModel";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { TicketCommentModel } from "../../../models/TicketCommentModel";
import { TicketModel } from "../../../models/TicketModel";
import { TitleService } from "../../interview/feature-services/TitleService";
import {
  BitReconciliationService,
  type MergeProposal,
} from "../../project/feature-services/BitReconciliationService";
import { TicketMarkdownService } from "./TicketMarkdownService";
import type {
  ITicket,
  ITicketComment,
  OwnerContext,
} from "../../../types/interview";
import type { UpdateTicketBody } from "../../../validation/ticket";
import { TicketError } from "../feature-utils/TicketError";

/** A ticket plus its comments — the read model the API returns (spec T3). */
export interface TicketWithComments {
  ticket: ITicket;
  comments: ITicketComment[];
}

export class TicketService {
  /** Fetch a ticket the caller owns, with its comments (spec T3). Throws NOT_FOUND otherwise. */
  static async getForOwner(
    ticketId: number,
    owner: OwnerContext,
  ): Promise<TicketWithComments> {
    const ticket = await this.requireTicket(ticketId, owner);
    const comments = await TicketCommentModel.listByTicket(ticketId);
    return { ticket, comments };
  }

  /**
   * Apply an inline edit, guarded by optimistic concurrency (spec T3, spec Risk:
   * concurrent edits). Owner-verifies the ticket, re-renders Markdown from the
   * merged fields, and writes both in one version-guarded statement. A stale
   * `expectedVersion` is rejected with a typed conflict so the PM re-reads first.
   */
  static async updateForOwner(
    ticketId: number,
    owner: OwnerContext,
    body: UpdateTicketBody,
  ): Promise<TicketWithComments> {
    const current = await this.requireTicket(ticketId, owner);
    this.assertVersionMatches(current, body.expectedVersion, ticketId);

    // Merge the edit onto the current ticket so Markdown reflects every field,
    // not only the ones that changed. priority is editable; the rich details are
    // display-only and carried through unchanged so a re-render keeps every
    // enrichment section (spec What / Out Of Scope).
    const merged = {
      userStory: body.userStory ?? current.user_story ?? "",
      acceptanceCriteria: body.acceptanceCriteria ?? current.acceptance_criteria ?? [],
      effort: body.effort ?? current.effort ?? "M",
      contextSummary: body.contextSummary ?? current.context_summary ?? "",
      priority: body.priority ?? current.priority,
      details: current.details,
    };
    const renderedMarkdown = TicketMarkdownService.render(merged);

    const updated = await TicketModel.updateForOwner(
      ticketId,
      body.expectedVersion,
      {
        userStory: body.userStory,
        acceptanceCriteria: body.acceptanceCriteria,
        effort: body.effort,
        priority: body.priority,
        contextSummary: body.contextSummary,
        renderedMarkdown,
      },
    );
    // Null means the version no longer matched (a concurrent write landed first).
    if (!updated) throw this.versionConflict(ticketId, body.expectedVersion);

    const comments = await TicketCommentModel.listByTicket(ticketId);
    return { ticket: updated, comments };
  }

  /** Add a comment to a ticket the caller owns (spec T3). Author from server context (§5.5). */
  static async addCommentForOwner(
    ticketId: number,
    owner: OwnerContext,
    body: string,
  ): Promise<ITicketComment> {
    await this.requireTicket(ticketId, owner);
    return TicketCommentModel.create({
      ticketId,
      authorUserId: owner.ownerUserId,
      body,
    });
  }

  /**
   * Finalize a ticket: flip status draft→final and bump version (spec T3),
   * guarded by the expected version. Re-renders Markdown so rendered_markdown
   * stays canonical at the final version (spec T5). Writes both atomically.
   */
  static async finalizeForOwner(
    ticketId: number,
    owner: OwnerContext,
    expectedVersion: number,
  ): Promise<TicketWithComments> {
    const current = await this.requireTicket(ticketId, owner);
    this.assertVersionMatches(current, expectedVersion, ticketId);
    if (current.status === "final") {
      throw new TicketError(
        "TICKET_ALREADY_FINAL",
        `Ticket ${ticketId} is already final.`,
        { ticketId },
      );
    }

    const finalized = await BaseModel.runTransaction(async (trx) => {
      const row = await TicketModel.finalizeForOwner(ticketId, expectedVersion, trx);
      if (!row) return null;
      const renderedMarkdown = TicketMarkdownService.render({
        userStory: row.user_story ?? "",
        acceptanceCriteria: row.acceptance_criteria ?? [],
        effort: row.effort ?? "M",
        contextSummary: row.context_summary ?? "",
        priority: row.priority,
        details: row.details,
      });
      await TicketModel.setRenderedMarkdown(ticketId, renderedMarkdown, trx);
      return { ...row, rendered_markdown: renderedMarkdown };
    });
    if (!finalized) throw this.versionConflict(ticketId, expectedVersion);

    // Refine the session's display title from the now-finalized ticket (User QA:
    // auto-generated session title). Best-effort and AFTER the atomic finalize —
    // a title is never a hard gate, so a model blip or a slow call can never fail
    // a finalize that already succeeded. Degrades to leaving the create-time title.
    await this.refreshSessionTitle(finalized, owner);

    const comments = await TicketCommentModel.listByTicket(ticketId);
    return { ticket: finalized, comments };
  }

  /**
   * Merge-on-complete (spec T13): turn a session's FINALIZED ticket into candidate
   * project-context bits and preview how they reconcile against the project. This
   * is the ticket-domain entry point for POST /sessions/:id/propose-bits — it lives
   * here (not in the project domain) because the trigger is a finalized TICKET and
   * the gate is the SESSION's project attachment, both owned by this domain; it then
   * delegates the project-side work (proposal agent + reconciliation) to
   * BitReconciliationService (§7.1 — services call services, no cross-domain DB).
   *
   * Owner-scoped throughout (§11.7):
   *  - owner-verify the session (SESSION_NOT_FOUND when absent/foreign, never leaked);
   *  - require a project attachment, else NO_PROJECT (mapped to 409 — the session is
   *    not in a state to merge; spec: typed error → 409/400);
   *  - require a finalized ticket, else NO_FINAL_TICKET (the feature is not complete).
   *
   * READ-ONLY: nothing is written here. The returned candidates + plan go to the
   * resolve screen, which applies them with source "merged" + the ticket id.
   */
  static async proposeBitsFromSession(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<MergeProposal> {
    const session = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    if (!session) {
      throw new TicketError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} was not found.`,
        { sessionId },
      );
    }
    if (session.project_id === null) {
      // The session is not attached to a project, so there is nowhere to merge the
      // bits. A typed conflict (NO_PROJECT → 409): the resource is not in a state
      // for this operation. The frontend only shows the trigger for attached
      // sessions, so this is a server-side backstop (§5.4), not the happy path.
      throw new TicketError(
        "NO_PROJECT",
        "This session is not attached to a project, so there is no project context to merge into.",
        { sessionId },
      );
    }

    const ticket = await TicketModel.findLatestFinalBySessionForOwner(sessionId, owner);
    if (!ticket) {
      throw new TicketError(
        "NO_FINAL_TICKET",
        "Finalize the ticket before merging it into project context.",
        { sessionId },
      );
    }

    return BitReconciliationService.proposeFromTicket(
      session.project_id,
      owner,
      ticket.id,
    );
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * Regenerate the parent session's title from the finalized ticket and persist
   * it owner-scoped (User QA). TitleService never throws (degrades to null), and
   * this only REPLACES an existing title when generation produced a usable one —
   * a null result leaves the create-time title in place rather than blanking a
   * good label. Any unexpected error is swallowed-with-a-log (§3.2): the finalize
   * has already succeeded and must not be undone by a cosmetic title step.
   */
  private static async refreshSessionTitle(
    ticket: ITicket,
    owner: OwnerContext,
  ): Promise<void> {
    try {
      const title = await TitleService.generate(
        {
          kind: "ticket",
          userStory: ticket.user_story ?? "",
          contextSummary: ticket.context_summary ?? "",
          acceptanceCriteria: ticket.acceptance_criteria ?? [],
          effort: ticket.effort ?? "M",
        },
        { sessionId: ticket.session_id },
      );
      if (title === null) return; // keep the create-time title; don't blank it.
      await InterviewSessionModel.updateTitleForOwner(
        ticket.session_id,
        owner,
        title,
      );
    } catch (error) {
      logger.warn(
        { err: error, ticketId: ticket.id, sessionId: ticket.session_id },
        "Failed to refresh session title after finalize; keeping prior title",
      );
    }
  }

  /** Owner-verify a ticket or throw NOT_FOUND (§11.7). */
  private static async requireTicket(
    ticketId: number,
    owner: OwnerContext,
  ): Promise<ITicket> {
    const ticket = await TicketModel.findByIdForOwner(ticketId, owner);
    if (!ticket) {
      throw new TicketError(
        "TICKET_NOT_FOUND",
        `Ticket ${ticketId} was not found.`,
        { ticketId },
      );
    }
    return ticket;
  }

  /** Fast-fail an obviously stale version before attempting the guarded write. */
  private static assertVersionMatches(
    ticket: ITicket,
    expectedVersion: number,
    ticketId: number,
  ): void {
    if (ticket.version !== expectedVersion) {
      throw this.versionConflict(ticketId, expectedVersion);
    }
  }

  private static versionConflict(ticketId: number, expectedVersion: number): TicketError {
    return new TicketError(
      "TICKET_VERSION_CONFLICT",
      "This ticket changed since you loaded it. Reload and try again.",
      { ticketId, expectedVersion },
    );
  }
}
