/**
 * CodeScoutService — read-through orchestration for the code scout (spec T4,
 * §6.3, §7.1). The only layer between the controller and the model/agent/models;
 * raises typed CodeScoutError; enforces owner scope by owner-verifying the
 * session before any cache read or scan (§11.7). Never touches req/res. Mirrors
 * TriageService / InterviewEngineService (§6.1).
 *
 * BACKGROUND-JOB RUNTIME (deploy spec runtime Option C, §21). On Vercel the
 * inline bounded scan (~13s live) risks a serverless function timeout, so the
 * scan no longer runs in the request. Instead:
 *  - enqueueScan (the POST path): owner-verify the session → if findings are
 *    already cached, short-circuit (idempotent, §21.1) → otherwise enqueue a
 *    `pending` scout_jobs row and return its id (HTTP 202). It does NOT scan.
 *  - getScanStatus (the GET path): owner-verify the session → return the latest
 *    job's status, plus the cached findings once the scan has completed.
 *  - runScout: the SHARED scan body the background processor calls (§21.3 — the
 *    job reuses this service, it does not reimplement the scan). Read-through:
 *    if scout_cache already has a row it returns WITHOUT scanning (idempotent on
 *    a repeat run, §21.1); otherwise it runs the bounded scout ONCE, writes the
 *    row, returns it.
 *  - getFindings: cache-only fetch (used by the status path and tests); NOT_FOUND
 *    on a miss (it never triggers a scan — only runScout does).
 *
 * Provider selection: the GitHub provider is the only implementation in this
 * spec; an `azure` reference is rejected with a typed PROVIDER_UNSUPPORTED error
 * (Azure is a deferred later spec). The CodeContextProvider seam means adding
 * Azure later is a new branch here, not a scout rewrite (spec Constraints).
 */
import { CodeScoutAgent } from "../../../agents/codeScout/CodeScoutAgent";
import { logger } from "../../../config/logger";
import { InterviewSessionModel } from "../../../models/InterviewSessionModel";
import { ScoutCacheModel } from "../../../models/ScoutCacheModel";
import { ScoutJobModel } from "../../../models/ScoutJobModel";
import { GitHubCodeContextProvider } from "../../../services/codeContext/GitHubCodeContextProvider";
import type { CodeContextProvider } from "../../../services/codeContext/CodeContextProvider";
import type {
  CodeContextProviderId,
  RepoRef,
  ScoutEnqueueResult,
  ScoutResult,
  ScoutStatusResult,
} from "../../../types/codeScout";
import type { IInterviewSession, OwnerContext } from "../../../types/interview";
import { CodeScoutError } from "../feature-utils/CodeScoutError";

/**
 * Stable job name for the scout's background work, logged on every job event so
 * failures carry the job name + identifiers (§21.4). Named, not magic (§4.2).
 */
export const SCOUT_JOB_NAME = "code-scout-scan";

export class CodeScoutService {
  /**
   * Enqueue a background scan for a session and return the job id (the POST path,
   * HTTP 202). Owner-verifies the session first (throws SESSION_NOT_FOUND when
   * absent or another owner's, §11.7), then:
   *  - if findings are ALREADY cached for the session, short-circuits with
   *    alreadyComplete=true and enqueues NOTHING (idempotent — re-enqueuing a
   *    scanned session is a no-op, §21.1), so the client can skip polling;
   *  - otherwise validates the provider (rejecting an unsupported one at the
   *    boundary, before any job is created) and enqueues a `pending` job carrying
   *    the repo reference for the processor to scan (spec T5).
   * It never runs the scan — that is the processor's job (§21.3).
   */
  static async enqueueScan(
    sessionId: number,
    owner: OwnerContext,
    repo: RepoRef,
  ): Promise<ScoutEnqueueResult> {
    await this.requireSession(sessionId, owner);

    const cached = await ScoutCacheModel.findBySession(sessionId);
    if (cached) {
      logger.info(
        { sessionId, provider: cached.provider, repoRef: cached.repo_ref },
        "Scout enqueue short-circuited; findings already cached (idempotent, §21.1)",
      );
      return {
        sessionId,
        jobId: null,
        status: "done",
        provider: cached.provider,
        repoRef: cached.repo_ref,
        alreadyComplete: true,
      };
    }

    // Reject an unsupported provider at the boundary, before a job is created,
    // so a doomed scan is never enqueued (the processor would only dead-letter it).
    this.assertProviderSupported(repo.provider);

    const job = await ScoutJobModel.enqueue({
      sessionId,
      provider: repo.provider,
      repoRef: repo.repoRef,
    });
    logger.info(
      { jobName: SCOUT_JOB_NAME, sessionId, jobId: job.id, provider: repo.provider, repoRef: repo.repoRef },
      "Scout scan enqueued as a background job (§21)",
    );
    return {
      sessionId,
      jobId: job.id,
      status: job.status,
      provider: job.provider,
      repoRef: job.repo_ref,
      alreadyComplete: false,
    };
  }

  /**
   * Report the scan status for a session (the GET path). Owner-verifies the
   * session, then resolves the state:
   *  - findings already cached → status `done` with the findings (covers a scan
   *    that completed, including one enqueued before this code shipped);
   *  - else the latest job's status (pending | running | failed) with NO findings
   *    — the absence is the signal the client (and spec 6) use to keep falling
   *    back to ungrounded generation until the scan lands;
   *  - no job and no cache → status `pending` with jobId-less, findings-less shape
   *    (nothing has been enqueued yet).
   */
  static async getScanStatus(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<ScoutStatusResult> {
    await this.requireSession(sessionId, owner);

    const cached = await ScoutCacheModel.findBySession(sessionId);
    if (cached) {
      return {
        sessionId,
        status: "done",
        provider: cached.provider,
        repoRef: cached.repo_ref,
        attempts: 0,
        lastError: null,
        findings: cached.findings,
      };
    }

    const job = await ScoutJobModel.findLatestBySession(sessionId);
    if (!job) {
      return {
        sessionId,
        status: "pending",
        provider: null,
        repoRef: null,
        attempts: 0,
        lastError: null,
      };
    }
    return {
      sessionId,
      status: job.status,
      provider: job.provider,
      repoRef: job.repo_ref,
      attempts: job.attempts,
      lastError: job.last_error,
    };
  }

  /**
   * Run the scout for a session, or return its cached findings (spec T4). The
   * SHARED scan body the background processor calls (§21.3); also reused by the
   * idempotency short-circuit. Owner-verifies the session first (throws
   * SESSION_NOT_FOUND when absent or another owner's, §11.7). On a cache HIT
   * returns the stored findings without scanning (idempotent on a repeat run,
   * §21.1); on a MISS runs the bounded scout once against the given repo,
   * persists the row, and returns it. The repo reference (provider + repoRef) is
   * recorded on the cached row, so it knows which repo it scanned (spec T5).
   */
  static async runScout(
    sessionId: number,
    owner: OwnerContext,
    repo: RepoRef,
  ): Promise<ScoutResult> {
    const session = await this.requireSession(sessionId, owner);

    const cached = await ScoutCacheModel.findBySession(sessionId);
    if (cached) {
      logger.info(
        { sessionId, provider: cached.provider, repoRef: cached.repo_ref },
        "Scout already ran; returning cached findings (read-through, no re-scan)",
      );
      return {
        sessionId,
        provider: cached.provider,
        repoRef: cached.repo_ref,
        findings: cached.findings,
        cached: true,
      };
    }

    const provider = this.resolveProvider(repo.provider);
    const findings = await CodeScoutAgent.run(provider, {
      originalRequest: session.original_request,
      repo,
    });

    const row = await ScoutCacheModel.create({
      sessionId,
      provider: repo.provider,
      repoRef: repo.repoRef,
      findings,
    });
    logger.info(
      { sessionId, provider: repo.provider, repoRef: repo.repoRef },
      "Scout ran once and cached its findings",
    );

    // Fresh scan — this response is NOT from the cache.
    return {
      sessionId,
      provider: row.provider,
      repoRef: row.repo_ref,
      findings: row.findings,
      cached: false,
    };
  }

  /**
   * Fetch the cached scout findings for a session (the GET endpoint). Owner-
   * verifies the session, then reads the cache; throws SCOUT_NOT_FOUND on a miss
   * — this path never triggers a scan (only runScout does, spec Must Not: no
   * re-scan on later turns).
   */
  static async getFindings(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<ScoutResult> {
    await this.requireSession(sessionId, owner);
    const cached = await ScoutCacheModel.findBySession(sessionId);
    if (!cached) {
      throw new CodeScoutError(
        "SCOUT_NOT_FOUND",
        `No scout findings exist for session ${sessionId} yet. Run the scout first.`,
        { sessionId },
      );
    }
    return {
      sessionId,
      provider: cached.provider,
      repoRef: cached.repo_ref,
      findings: cached.findings,
      cached: true,
    };
  }

  /* ----------------------------- private helpers ------------------------- */

  /** Owner-verify a session or throw NOT_FOUND (§11.7). */
  private static async requireSession(
    sessionId: number,
    owner: OwnerContext,
  ): Promise<IInterviewSession> {
    const session = await InterviewSessionModel.findByIdForOwner(sessionId, owner);
    if (!session) {
      throw new CodeScoutError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} was not found.`,
        { sessionId },
      );
    }
    return session;
  }

  /**
   * Throw a typed PROVIDER_UNSUPPORTED error unless the provider has an
   * implementation. GitHub is the only one in this spec; `azure` is a deferred
   * later spec. Called at enqueue time (so a doomed scan is never queued) and by
   * resolveProvider (so the scan path stays guarded). Adding Azure later is a new
   * branch here, not a scout rewrite (spec Constraints).
   */
  private static assertProviderSupported(provider: CodeContextProviderId): void {
    if (provider !== "github") {
      throw new CodeScoutError(
        "PROVIDER_UNSUPPORTED",
        `The "${provider}" code-context provider is not available yet.`,
        { provider },
      );
    }
  }

  /**
   * Select the CodeContextProvider for a provider id, after asserting it is
   * supported. GitHub is the only implementation in this spec; the seam keeps
   * Azure pluggable later behind the same interface (spec Constraints).
   */
  private static resolveProvider(provider: CodeContextProviderId): CodeContextProvider {
    this.assertProviderSupported(provider);
    return new GitHubCodeContextProvider();
  }
}
