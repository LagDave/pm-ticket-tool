/**
 * ScoutJobProcessor tests (§20.1, §20.2) — the background-job runtime (§21). The
 * scout AGENT is mocked at its seam (CodeScoutAgent.run) so the processor's
 * claim → run → mark loop is exercised against the REAL DB/models/cache with no
 * live provider or model call. Proves:
 *  - a claimed job runs the scan, writes scout_cache, and is marked done (§21.3);
 *  - idempotent re-run: a job for an already-cached session marks done WITHOUT
 *    re-scanning (§21.1);
 *  - the failure path increments attempts and re-queues, then dead-letters at the
 *    cap (§21.2);
 *  - an empty queue is a clean no-op.
 * Synthetic data only, owner ids > 1000 (§20.4).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/codeScout/CodeScoutAgent", () => ({
  CodeScoutAgent: { run: vi.fn() },
}));

import { CodeScoutAgent } from "../../agents/codeScout/CodeScoutAgent";
import { SCOUT_JOB } from "../../config";
import { db } from "../../database/connection";
import { CodeScoutError } from "../../controllers/codeScout/feature-utils/CodeScoutError";
import { ScoutCacheModel } from "../../models/ScoutCacheModel";
import { ScoutJobModel } from "../../models/ScoutJobModel";
import { InterviewSessionModel } from "../../models/InterviewSessionModel";
import { makeOwner, makeRequestText, makeScoutFindings } from "../../test/factories";
import { ScoutJobProcessor } from "./ScoutJobProcessor";

const mockRun = vi.mocked(CodeScoutAgent.run);
const GITHUB_REPO = { provider: "github" as const, repoRef: "octocat/hello-world" };

/** Seed a real session (the scout_jobs/scout_cache FK target) and return its id. */
async function seedSession(): Promise<number> {
  const session = await InterviewSessionModel.create(makeOwner(), {
    originalRequest: makeRequestText("scout-processor"),
  });
  return session.id;
}

describe("ScoutJobProcessor", () => {
  beforeEach(async () => {
    mockRun.mockReset();
    // Each test owns the queue: clear any pending jobs so claims are deterministic.
    await db("scout_jobs").where("status", "pending").del();
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("claims a pending job, runs the scan, caches findings, marks done (§21.3)", async () => {
    const sessionId = await seedSession();
    await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });
    mockRun.mockResolvedValueOnce(makeScoutFindings({ summary: "processed once" }));

    const result = await ScoutJobProcessor.processNext();

    expect(result.processed).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(result.outcome).toBe("done");
    expect(mockRun).toHaveBeenCalledTimes(1);

    // scout_cache was written by the shared service path.
    const cached = await ScoutCacheModel.findBySession(sessionId);
    expect(cached?.findings.summary).toBe("processed once");

    // The job is done.
    const job = await ScoutJobModel.findLatestBySession(sessionId);
    expect(job?.status).toBe("done");
    expect(job?.attempts).toBe(1);
  });

  it("is idempotent: a job for an already-cached session does NOT re-scan (§21.1)", async () => {
    const sessionId = await seedSession();
    // Pre-seed the cache as if a prior run already scanned this session.
    await ScoutCacheModel.create({
      sessionId,
      ...GITHUB_REPO,
      findings: makeScoutFindings({ summary: "already cached" }),
    });
    await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });

    const result = await ScoutJobProcessor.processNext();

    expect(result.outcome).toBe("done");
    // The read-through short-circuit means the agent never ran.
    expect(mockRun).not.toHaveBeenCalled();
    const cached = await ScoutCacheModel.findBySession(sessionId);
    expect(cached?.findings.summary).toBe("already cached"); // unchanged
  });

  it("returns a clean no-op when the queue is empty", async () => {
    const result = await ScoutJobProcessor.processNext();
    expect(result).toEqual({ processed: false, jobId: null, sessionId: null, outcome: null });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("on a scan failure, re-queues below the cap then dead-letters at it (§21.2)", async () => {
    const sessionId = await seedSession();
    const enqueued = await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });

    // Make every scan attempt fail with a typed error.
    mockRun.mockRejectedValue(
      new CodeScoutError("SCOUT_GENERATION_FAILED", "model could not summarize"),
    );

    // Drive MAX_ATTEMPTS passes; each claims the (re-queued) job and fails.
    const outcomes: (string | null)[] = [];
    for (let i = 0; i < SCOUT_JOB.MAX_ATTEMPTS; i += 1) {
      const r = await ScoutJobProcessor.processNext();
      outcomes.push(r.outcome);
    }

    // Below the cap the job re-queued (running→pending); the final pass dead-letters.
    expect(outcomes.slice(0, -1).every((o) => o === "pending")).toBe(true);
    expect(outcomes[outcomes.length - 1]).toBe("failed");

    const job = await ScoutJobModel.findById(enqueued.id);
    expect(job?.status).toBe("failed"); // dead-letter terminal (§21.2)
    expect(job?.attempts).toBe(SCOUT_JOB.MAX_ATTEMPTS);
    expect(job?.last_error).toContain("SCOUT_GENERATION_FAILED"); // typed, no stack leak (§3.4)

    // A dead-lettered job is not picked up again (no longer pending).
    const after = await ScoutJobProcessor.processNext();
    expect(after.processed).toBe(false);
  });

  it("does not throw to the caller on failure — the loop survives a bad job", async () => {
    const sessionId = await seedSession();
    await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });
    mockRun.mockRejectedValueOnce(
      new CodeScoutError("SCOUT_GENERATION_FAILED", "boom"),
    );

    // processNext resolves (does not reject) and reports the failure outcome.
    await expect(ScoutJobProcessor.processNext()).resolves.toMatchObject({
      processed: true,
      outcome: "pending", // first failure re-queues (cap not reached)
    });
  });

  it("drain processes every pending job until the queue empties", async () => {
    const sessionA = await seedSession();
    const sessionB = await seedSession();
    await ScoutJobModel.enqueue({ sessionId: sessionA, ...GITHUB_REPO });
    await ScoutJobModel.enqueue({ sessionId: sessionB, ...GITHUB_REPO });
    mockRun.mockResolvedValue(makeScoutFindings({ summary: "drained" }));

    const processed = await ScoutJobProcessor.drain();

    expect(processed).toBe(2);
    expect(await ScoutCacheModel.findBySession(sessionA)).not.toBeNull();
    expect(await ScoutCacheModel.findBySession(sessionB)).not.toBeNull();
  });
});
