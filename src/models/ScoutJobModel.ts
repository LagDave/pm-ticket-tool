/**
 * ScoutJobModel — all DB access for scout_jobs (§7.4). The durable work queue
 * that backs the scout as a background job (deploy spec runtime Option C, §21).
 * The request path enqueues a `pending` row; a processor claims it race-safely,
 * runs the bounded scan through CodeScoutService, and marks it `done`, or
 * increments `attempts` and re-queues / dead-letters on failure (§21.1–§21.2).
 *
 * Reached through an owner-verified session (§11.7): scout_jobs has no direct
 * owner column; the service owner-verifies the session via InterviewSessionModel
 * before enqueue / status reads, so every read/write is scoped by a session_id
 * the caller has been proven to own — like scout_cache, decision_record, and
 * interview_turns.
 *
 * Race-safe claim (§21): claimNextPending runs inside a transaction and uses
 * `FOR UPDATE SKIP LOCKED` to lock exactly one pending row and skip rows another
 * processor already holds, so two processors NEVER claim the same job. `attempts`
 * is incremented AT CLAIM TIME (not only on failure) so a processor that dies
 * mid-run — never reaching markFailed — still burns one attempt and the job
 * cannot retry forever (bounded retry holds even on a hard crash, §21.2).
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type {
  CodeContextProviderId,
  IScoutJob,
  ScoutJobStatus,
} from "../types/codeScout";

export interface EnqueueScoutJobInput {
  sessionId: number;
  provider: CodeContextProviderId;
  repoRef: string;
}

/** The states a job can be claimed from (only freshly-enqueued work). */
const CLAIMABLE_STATUS: ScoutJobStatus = "pending";

export class ScoutJobModel extends BaseModel {
  protected static tableName = "scout_jobs";

  /**
   * Enqueue a pending scout job for a session (the request path's write). The
   * session_id is owner-verified by the caller before this runs (§11.7);
   * provider is constrained to the locked set by the DB CHECK. attempts defaults
   * to 0 and status to 'pending' at the DB level.
   */
  static async enqueue(
    input: EnqueueScoutJobInput,
    trx?: QueryContext,
  ): Promise<IScoutJob> {
    const [row] = await this.table(trx)
      .insert({
        session_id: input.sessionId,
        provider: input.provider,
        repo_ref: input.repoRef,
        status: "pending",
      })
      .returning("*");
    return row as IScoutJob;
  }

  /**
   * The latest job for a session, or null when none exists (the status read
   * path). Newest first so a re-enqueue surfaces the current attempt. Filtered by
   * session_id, which the caller has owner-verified (§11.7); covered by the
   * session_id index (§10.4).
   */
  static async findLatestBySession(
    sessionId: number,
    trx?: QueryContext,
  ): Promise<IScoutJob | null> {
    const row = await this.table(trx)
      .where({ session_id: sessionId })
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .first();
    return (row as IScoutJob | undefined) ?? null;
  }

  /**
   * Atomically claim the oldest pending job, marking it `running` and burning one
   * attempt — race-safe via `FOR UPDATE SKIP LOCKED` (§21). Returns the claimed
   * job, or null when the queue holds no claimable work. Two concurrent
   * processors lock different rows (or one gets null), so a job is never
   * double-run. The whole select-then-update is one transaction: either the
   * caller passes a trx, or one is opened here so the lock is held for the update.
   *
   * Claiming increments attempts so the bound is enforced even if the worker
   * crashes before markFailed (§21.2). The processor compares attempts against
   * the max AFTER a failure to decide re-queue vs dead-letter.
   */
  static async claimNextPending(trx?: QueryContext): Promise<IScoutJob | null> {
    if (trx) return this.claimWithin(trx);
    return BaseModel.runTransaction((tx) => this.claimWithin(tx));
  }

  /** The claim body, always inside a transaction so the row lock spans the update. */
  private static async claimWithin(trx: QueryContext): Promise<IScoutJob | null> {
    const locked = await this.table(trx)
      .where({ status: CLAIMABLE_STATUS })
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .limit(1)
      .forUpdate()
      .skipLocked()
      .first();
    if (!locked) return null;

    const lockedRow = locked as IScoutJob;
    const [updated] = await this.table(trx)
      .where({ id: lockedRow.id })
      .update({
        status: "running",
        attempts: lockedRow.attempts + 1,
        updated_at: new Date(),
      })
      .returning("*");
    return updated as IScoutJob;
  }

  /** Mark a claimed job `done` (the scan completed and findings were cached). */
  static async markDone(id: number, trx?: QueryContext): Promise<IScoutJob | null> {
    const [row] = await this.table(trx)
      .where({ id })
      .update({ status: "done", last_error: null, updated_at: new Date() })
      .returning("*");
    return (row as IScoutJob | undefined) ?? null;
  }

  /**
   * Record a failed run (§21.2). When the job's attempts have reached the cap it
   * is dead-lettered (`failed` — the terminal state held for inspection);
   * otherwise it returns to `pending` to be retried by a later processor pass.
   * The attempt was already counted at claim time, so `attempts` is read, not
   * re-incremented here. `lastError` is a typed/redacted message, never a leaked
   * stack (§3.4).
   */
  static async recordFailure(
    id: number,
    attempts: number,
    maxAttempts: number,
    lastError: string,
    trx?: QueryContext,
  ): Promise<IScoutJob | null> {
    const isDeadLettered = attempts >= maxAttempts;
    const [row] = await this.table(trx)
      .where({ id })
      .update({
        status: isDeadLettered ? "failed" : "pending",
        last_error: lastError,
        updated_at: new Date(),
      })
      .returning("*");
    return (row as IScoutJob | undefined) ?? null;
  }

  /** Fetch one job by id (used by tests and internal inspection). */
  static async findById(id: number, trx?: QueryContext): Promise<IScoutJob | null> {
    const row = await this.table(trx).where({ id }).first();
    return (row as IScoutJob | undefined) ?? null;
  }
}
