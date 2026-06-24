/**
 * ScoutJobProcessor — the background worker that drains the scout_jobs queue
 * (deploy spec runtime Option C, §21). It is the runtime that keeps the request
 * handler short on Vercel serverless: the POST enqueues a job, this processor
 * runs the bounded scan out of band.
 *
 * §21 conformance:
 *  - §21.1 idempotent: the claimed job's scan is run through CodeScoutService.runScout,
 *    which short-circuits on a cache hit — so a job that is somehow run twice (or a
 *    session already scanned) writes nothing the second time.
 *  - §21.2 bounded retries + dead-letter: the attempt is counted at claim time;
 *    on failure the job re-queues until SCOUT_JOB.MAX_ATTEMPTS, then is dead-lettered
 *    (status `failed`, held for inspection — never silently dropped).
 *  - §21.3 calls services, not its own logic: the scan body is CodeScoutService.runScout,
 *    the SAME path the request used to call inline. The processor only orchestrates
 *    claim → run → mark; it contains no scan logic of its own.
 *  - §21.4 logged with context: every claim/done/failure logs the job name, session id,
 *    job id, attempt count, and (on failure) the error — through Pino (§9), never console.
 *
 * Runtimes (one processor body, two drivers):
 *  - Vercel Cron (prod): a guarded internal HTTP endpoint calls processNext once per
 *    invocation (see routes/internalScout.ts + vercel.json).
 *  - Local / tests: `npm run scout:work` runs runForever (a poll loop); tests call
 *    processNext / drain directly.
 */
import { SCOUT_JOB } from "../../config";
import { logger } from "../../config/logger";
import { CodeScoutService, SCOUT_JOB_NAME } from "../../controllers/codeScout/feature-services/CodeScoutService";
import { InterviewSessionModel } from "../../models/InterviewSessionModel";
import { ScoutJobModel } from "../../models/ScoutJobModel";
import { CodeScoutError } from "../../controllers/codeScout/feature-utils/CodeScoutError";
import type { OwnerContext } from "../../types/interview";
import type { IScoutJob, ScoutJobProcessResult } from "../../types/codeScout";

export class ScoutJobProcessor {
  /**
   * Claim and process at most one pending job (one Vercel Cron invocation, or one
   * iteration of the local loop). Returns what happened — idle when the queue is
   * empty, otherwise the job's outcome. Never throws to the caller: a scan
   * failure is recorded on the job (re-queue or dead-letter) and returned, so a
   * single bad job never crashes the trigger endpoint or the local loop.
   */
  static async processNext(): Promise<ScoutJobProcessResult> {
    const job = await ScoutJobModel.claimNextPending();
    if (!job) {
      return { processed: false, jobId: null, sessionId: null, outcome: null };
    }

    logger.info(
      { jobName: SCOUT_JOB_NAME, jobId: job.id, sessionId: job.session_id, attempt: job.attempts },
      "Scout job claimed; running bounded scan",
    );

    try {
      await this.runClaimedJob(job);
      await ScoutJobModel.markDone(job.id);
      logger.info(
        { jobName: SCOUT_JOB_NAME, jobId: job.id, sessionId: job.session_id, attempt: job.attempts },
        "Scout job completed; findings cached",
      );
      return { processed: true, jobId: job.id, sessionId: job.session_id, outcome: "done" };
    } catch (error) {
      return this.handleFailure(job, error);
    }
  }

  /**
   * Drain the queue: process jobs until none remain pending, up to a safety cap
   * so a misbehaving producer cannot spin this forever. Returns the number of
   * jobs processed. Used by tests and by a single `scout:work` burst.
   */
  static async drain(maxJobs = 100): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
      const result = await this.processNext();
      if (!result.processed) break;
      processed += 1;
    }
    return processed;
  }

  /**
   * The local long-running driver (`npm run scout:work`): poll the queue forever,
   * draining each time and sleeping between empty passes. Vercel uses Cron +
   * processNext instead; this exists so the same processor runs locally without
   * any cron. `signal` lets a test or a shutdown hook stop the loop.
   */
  static async runForever(signal?: AbortSignal): Promise<void> {
    logger.info(
      { jobName: SCOUT_JOB_NAME, pollMs: SCOUT_JOB.LOCAL_POLL_INTERVAL_MS },
      "Scout worker started (local poll loop)",
    );
    while (!signal?.aborted) {
      const drained = await this.drain();
      if (drained === 0) {
        await this.sleep(SCOUT_JOB.LOCAL_POLL_INTERVAL_MS, signal);
      }
    }
    logger.info({ jobName: SCOUT_JOB_NAME }, "Scout worker stopped");
  }

  /* ----------------------------- private helpers ------------------------- */

  /**
   * Run the scan for a claimed job by reconstructing the session's owner and
   * delegating to CodeScoutService.runScout (§21.3 — reuse, no reimplementation).
   * A job whose session has vanished (deleted before the scan ran) is a
   * non-retryable error: it throws a typed CodeScoutError the failure handler
   * dead-letters immediately rather than retrying.
   */
  private static async runClaimedJob(job: IScoutJob): Promise<void> {
    const owner = await this.ownerForSession(job.session_id);
    await CodeScoutService.runScout(job.session_id, owner, {
      provider: job.provider,
      repoRef: job.repo_ref,
    });
  }

  /**
   * Reconstruct the OwnerContext for a job's session from the session row (the
   * trusted-processor path, §21). The job carries only session_id; the processor
   * has no HTTP caller, so it reads the session via the system accessor and
   * rebuilds the owner that enqueued it. runScout still owner-verifies with this
   * context, so the §11.7 contract holds end to end.
   */
  private static async ownerForSession(sessionId: number): Promise<OwnerContext> {
    const session = await InterviewSessionModel.findByIdSystem(sessionId);
    if (!session) {
      throw new CodeScoutError(
        "SCOUT_SESSION_GONE",
        `Session ${sessionId} no longer exists; cannot run its scout job.`,
        { sessionId },
      );
    }
    return {
      ownerUserId: session.owner_user_id,
      organizationId: session.organization_id,
    };
  }

  /**
   * Record a failed run and decide re-queue vs dead-letter (§21.2). The attempt
   * was already counted at claim time, so recordFailure compares the claimed
   * attempt count against the cap. The stored message is the typed code + message
   * (or a generic string) — never a raw stack (§3.4). Logs the full context
   * including the attempt and whether the job is now dead-lettered (§21.4).
   */
  private static async handleFailure(
    job: IScoutJob,
    error: unknown,
  ): Promise<ScoutJobProcessResult> {
    const message = this.failureMessage(error);
    const updated = await ScoutJobModel.recordFailure(
      job.id,
      job.attempts,
      SCOUT_JOB.MAX_ATTEMPTS,
      message,
    );
    const outcome = updated?.status ?? "failed";
    const deadLettered = outcome === "failed";

    logger.error(
      {
        jobName: SCOUT_JOB_NAME,
        jobId: job.id,
        sessionId: job.session_id,
        attempt: job.attempts,
        maxAttempts: SCOUT_JOB.MAX_ATTEMPTS,
        deadLettered,
        err: error,
      },
      deadLettered
        ? "Scout job failed and was dead-lettered (max attempts reached, §21.2)"
        : "Scout job failed; re-queued for retry (§21.2)",
    );
    return { processed: true, jobId: job.id, sessionId: job.session_id, outcome };
  }

  /**
   * Reduce an error to a stored failure message — the typed code + message for a
   * CodeScoutError, else a generic string. Never serializes a raw stack or
   * internal detail into the persisted row (§3.4).
   */
  private static failureMessage(error: unknown): string {
    if (error instanceof CodeScoutError) {
      return `${error.code}: ${error.message}`;
    }
    return "Scout scan failed with an unexpected error.";
  }

  /** Sleep that resolves early if the abort signal fires (clean shutdown). */
  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
