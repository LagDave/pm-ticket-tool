/**
 * ScoutJobModel tests (§20.1, §20.2). Proves the durable scout queue that backs
 * the background-job runtime (§21): enqueue, race-safe claim (two processors
 * never claim the same job), mark done, and bounded-retry → dead-letter at the
 * cap (§21.2). The cache/owner isolation is proven at the session model + service
 * layers (§11.7); here the focus is the queue mechanics. Synthetic data only,
 * owner ids > 1000 (§20.4); the FK requires a real session, so each test seeds
 * one via InterviewSessionModel.
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText } from "../test/factories";
import { InterviewSessionModel } from "./InterviewSessionModel";
import { ScoutJobModel } from "./ScoutJobModel";

/** Seed a real session (the scout_jobs FK target) and return its id. */
async function seedSession(): Promise<number> {
  const session = await InterviewSessionModel.create(makeOwner(), {
    originalRequest: makeRequestText("scout-job-model"),
  });
  return session.id;
}

const GITHUB_REPO = { provider: "github" as const, repoRef: "octocat/hello-world" };

describe("ScoutJobModel", () => {
  afterAll(async () => {
    // CASCADE from interview_sessions clears scout_jobs rows for synthetic owners.
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("enqueues a pending job with attempts 0 (§21)", async () => {
    const sessionId = await seedSession();
    const job = await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });

    expect(job.id).toBeGreaterThan(0);
    expect(job.session_id).toBe(sessionId);
    expect(job.provider).toBe("github");
    expect(job.repo_ref).toBe("octocat/hello-world");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.last_error).toBeNull();
  });

  it("findLatestBySession returns null on a miss, then the newest job", async () => {
    const sessionId = await seedSession();
    expect(await ScoutJobModel.findLatestBySession(sessionId)).toBeNull();

    await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });
    const second = await ScoutJobModel.enqueue({
      sessionId,
      provider: "github",
      repoRef: "octocat/second",
    });

    const latest = await ScoutJobModel.findLatestBySession(sessionId);
    expect(latest?.id).toBe(second.id);
    expect(latest?.repo_ref).toBe("octocat/second");
  });

  it("claimNextPending marks the job running and burns one attempt (§21.2)", async () => {
    // Own the queue so the claim is deterministic (FIFO claims the oldest pending).
    await db("scout_jobs").where("status", "pending").del();
    const sessionId = await seedSession();
    const enqueued = await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });

    const claimed = await ScoutJobModel.claimNextPending();
    expect(claimed?.id).toBe(enqueued.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1); // counted at claim time, not only on failure

    // The row is no longer pending, so it is not claimed again.
    const fetched = await ScoutJobModel.findById(enqueued.id);
    expect(fetched?.status).toBe("running");
  });

  it("two concurrent claims never double-run a single job (race-safe, §21)", async () => {
    // Clear any leftover pending jobs from prior tests so this session's single
    // job is the only claimable row.
    await db("scout_jobs").where("status", "pending").del();
    const sessionId = await seedSession();
    const enqueued = await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });

    // Fire two claims concurrently. FOR UPDATE SKIP LOCKED must hand the job to
    // exactly one — the other sees no claimable row and gets null.
    const [a, b] = await Promise.all([
      ScoutJobModel.claimNextPending(),
      ScoutJobModel.claimNextPending(),
    ]);

    const claimedIds = [a?.id, b?.id].filter((id) => id !== undefined && id !== null);
    const nulls = [a, b].filter((r) => r === null);
    expect(claimedIds).toEqual([enqueued.id]); // exactly one claim, of our job
    expect(nulls).toHaveLength(1); // the other got nothing

    // The job was advanced exactly once: attempts == 1, status running.
    const fetched = await ScoutJobModel.findById(enqueued.id);
    expect(fetched?.attempts).toBe(1);
    expect(fetched?.status).toBe("running");
  });

  it("claimNextPending returns null when the queue is empty", async () => {
    await db("scout_jobs").where("status", "pending").del();
    expect(await ScoutJobModel.claimNextPending()).toBeNull();
  });

  it("markDone moves a job to done and clears last_error", async () => {
    await db("scout_jobs").where("status", "pending").del();
    const sessionId = await seedSession();
    const job = await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });
    await ScoutJobModel.claimNextPending();

    const done = await ScoutJobModel.markDone(job.id);
    expect(done?.status).toBe("done");
    expect(done?.last_error).toBeNull();
  });

  it("recordFailure re-queues below the cap, then dead-letters at it (§21.2)", async () => {
    await db("scout_jobs").where("status", "pending").del();
    const sessionId = await seedSession();
    const job = await ScoutJobModel.enqueue({ sessionId, ...GITHUB_REPO });
    const maxAttempts = 3;

    // Attempt 1: claimed (attempts=1), fails → below cap → back to pending.
    await ScoutJobModel.claimNextPending();
    const afterFirst = await ScoutJobModel.recordFailure(
      job.id,
      1,
      maxAttempts,
      "PROVIDER_RATE_LIMITED: transient",
    );
    expect(afterFirst?.status).toBe("pending"); // re-queued, not dead-lettered
    expect(afterFirst?.last_error).toContain("PROVIDER_RATE_LIMITED");

    // Attempt at the cap: fails → dead-letter (terminal `failed`, §21.2).
    const afterMax = await ScoutJobModel.recordFailure(
      job.id,
      maxAttempts,
      maxAttempts,
      "PROVIDER_RATE_LIMITED: still failing",
    );
    expect(afterMax?.status).toBe("failed"); // dead-lettered, held for inspection
  });
});
