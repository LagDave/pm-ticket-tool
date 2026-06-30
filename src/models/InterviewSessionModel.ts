/**
 * InterviewSessionModel — all DB access for interview_sessions (§7.4).
 * Every read/write is owner-scoped: owner context is a REQUIRED argument
 * derived from server context, never an optional filter a caller may forget
 * (§11.7, §5.5). A query that could return another owner's row is a data leak.
 */
import type { Knex } from "knex";
import { BaseModel, QueryContext } from "./BaseModel";
import type {
  IInterviewSession,
  OwnerContext,
  SessionStatus,
  TriageResult,
} from "../types/interview";

/** Escape LIKE wildcards so a search term is matched literally (no %/_ injection). */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Narrow a sessions query to rows whose DISPLAYED dashboard title matches
 * `search` (case-insensitive substring). The dashboard label is the generated
 * title with a fallback to the original request (SessionList), so we match
 * COALESCE(title, original_request) — a search hits exactly what the PM sees.
 * No-op when search is empty; wildcards are escaped so the term is literal.
 */
function applyTitleSearch(query: Knex.QueryBuilder, search?: string): void {
  if (!search) return;
  query.whereRaw("COALESCE(title, original_request) ILIKE ?", [
    `%${escapeLikeTerm(search)}%`,
  ]);
}

export interface CreateInterviewSessionInput {
  originalRequest: string;
  /** Optional project to ground the session against (project bits); null when ungrounded. */
  projectId?: number | null;
  status?: SessionStatus;
  /**
   * Concise generated display title (User QA: auto-generated session title).
   * Generated from the request before insert; null when generation failed —
   * the column is nullable and the UI falls back to the request snippet.
   */
  title?: string | null;
}

export class InterviewSessionModel extends BaseModel {
  protected static tableName = "interview_sessions";

  /** Insert a session owned by the caller. Owner fields come from server context. */
  static async create(
    owner: OwnerContext,
    input: CreateInterviewSessionInput,
    trx?: QueryContext,
  ): Promise<IInterviewSession> {
    const [row] = await this.table(trx)
      .insert({
        owner_user_id: owner.ownerUserId,
        organization_id: owner.organizationId,
        original_request: input.originalRequest,
        project_id: input.projectId ?? null,
        status: input.status ?? "draft",
        // Persist the generated title when present; nullable otherwise (User QA).
        title: input.title ?? null,
      })
      .returning("*");
    return row as IInterviewSession;
  }

  /**
   * Fetch one session by id WITHOUT an owner filter — the trusted background-job
   * path only (§21). A scout job stores just session_id; the processor runs in a
   * trusted server context with no HTTP caller, so it reads the session here to
   * reconstruct the OwnerContext (owner_user_id + organization_id) and then calls
   * the owner-scoped service path. This is NOT reachable from a request handler:
   * every HTTP path uses findByIdForOwner so a client can never read another
   * owner's session (§11.7, §5.5). The job itself was enqueued through an
   * owner-verified request, so acting on its session here does not widen access.
   */
  static async findByIdSystem(
    id: number,
    trx?: QueryContext,
  ): Promise<IInterviewSession | null> {
    const row = await this.table(trx).where({ id }).first();
    return (row as IInterviewSession | undefined) ?? null;
  }

  /**
   * Fetch one session by id, scoped to the owner. Returns null when the row
   * does not exist OR belongs to another owner — the caller cannot tell the
   * difference, which is the point (§11.7).
   */
  static async findByIdForOwner(
    id: number,
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<IInterviewSession | null> {
    const row = await this.table(trx)
      .where({ id, owner_user_id: owner.ownerUserId })
      .first();
    return (row as IInterviewSession | undefined) ?? null;
  }

  /** List the caller's sessions, newest first. Owner scope is mandatory. */
  static async listForOwner(
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<IInterviewSession[]> {
    const rows = await this.table(trx)
      .where({ owner_user_id: owner.ownerUserId })
      .orderBy("created_at", "desc");
    return rows as IInterviewSession[];
  }

  /**
   * One page of the caller's sessions, newest first, optionally narrowed to a
   * single status (dashboard list, spec 4 T1). Owner scope is mandatory (§11.7)
   * and the optional status is applied with the same owner filter, so neither
   * can return another owner's rows. Covered by the
   * (owner_user_id, status) index (§10.4). `offset`/`limit` page the result; the
   * caller pairs this with countForOwner to build the §11.6 envelope.
   */
  static async listPageForOwner(
    owner: OwnerContext,
    params: { limit: number; offset: number; status?: SessionStatus; search?: string },
    trx?: QueryContext,
  ): Promise<IInterviewSession[]> {
    const query = this.table(trx).where({ owner_user_id: owner.ownerUserId });
    if (params.status) query.where({ status: params.status });
    applyTitleSearch(query, params.search);
    const rows = await query
      .orderBy("created_at", "desc")
      .limit(params.limit)
      .offset(params.offset);
    return rows as IInterviewSession[];
  }

  /**
   * Total count of the caller's sessions for the same optional status filter
   * (the `total` in the §11.6 envelope). Owner-scoped (§11.7); pairs with
   * listPageForOwner so the page and the total agree.
   */
  static async countForOwner(
    owner: OwnerContext,
    params: { status?: SessionStatus; search?: string } = {},
    trx?: QueryContext,
  ): Promise<number> {
    const query = this.table(trx).where({ owner_user_id: owner.ownerUserId });
    if (params.status) query.where({ status: params.status });
    applyTitleSearch(query, params.search);
    const [row] = await query.count<{ count: string }[]>({ count: "*" });
    return Number(row?.count ?? 0);
  }

  /**
   * Update a session's status, scoped to the owner (§11.7). Returns the updated
   * row, or null when no row matches (missing or another owner's). Used by the
   * engine to move a session through in_progress → complete.
   */
  static async updateStatusForOwner(
    id: number,
    owner: OwnerContext,
    status: SessionStatus,
    trx?: QueryContext,
  ): Promise<IInterviewSession | null> {
    const [row] = await this.table(trx)
      .where({ id, owner_user_id: owner.ownerUserId })
      .update({ status, updated_at: new Date() })
      .returning("*");
    return (row as IInterviewSession | undefined) ?? null;
  }

  /**
   * Replace a session's generated display title, scoped to the owner (User QA:
   * auto-generated session title, §11.7). Used after the ticket is finalized to
   * swap the create-time title (from the request) for the refined one (from the
   * finalized ticket). Returns the updated row, or null when no row matches
   * (missing or another owner's) — the caller cannot tell the difference, which
   * is the point. A null title is a valid write (generation may have failed).
   */
  static async updateTitleForOwner(
    id: number,
    owner: OwnerContext,
    title: string | null,
    trx?: QueryContext,
  ): Promise<IInterviewSession | null> {
    const [row] = await this.table(trx)
      .where({ id, owner_user_id: owner.ownerUserId })
      .update({ title, updated_at: new Date() })
      .returning("*");
    return (row as IInterviewSession | undefined) ?? null;
  }

  /**
   * Persist the two-speed triage label and the time it ran, scoped to the owner
   * (spec 7 T2, §11.7). Returns the updated row, or null when no row matches
   * (missing or another owner's) — the caller cannot tell the difference, which
   * is the point. `triaged_at` is stamped server-side, never from the client.
   */
  static async setTriageResultForOwner(
    id: number,
    owner: OwnerContext,
    triageResult: TriageResult,
    trx?: QueryContext,
  ): Promise<IInterviewSession | null> {
    const now = new Date();
    const [row] = await this.table(trx)
      .where({ id, owner_user_id: owner.ownerUserId })
      .update({
        triage_result: triageResult,
        triaged_at: now,
        updated_at: now,
      })
      .returning("*");
    return (row as IInterviewSession | undefined) ?? null;
  }

  /**
   * Hard-delete a session, scoped to the owner (§11.7). The owner filter makes a
   * missing row and another owner's row indistinguishable — both delete nothing
   * and return 0 — so a caller can never confirm another owner's session exists
   * (§5.5). Returns the number of rows deleted (1 on success, 0 otherwise).
   *
   * A single delete of this row removes ALL children atomically: interview_turns,
   * decision_record, tickets (and ticket_comments under them), scout_cache, and
   * scout_jobs all carry `ON DELETE CASCADE` on their session_id FK, so the
   * database reaps them — no app-side multi-table delete is needed (§10.5).
   */
  static async deleteForOwner(
    id: number,
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<number> {
    return this.table(trx)
      .where({ id, owner_user_id: owner.ownerUserId })
      .del();
  }
}
