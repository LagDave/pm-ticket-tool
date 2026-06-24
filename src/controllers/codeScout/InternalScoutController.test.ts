/**
 * Internal scout-processor trigger tests (§20.2, §5.4) — the guarded endpoint
 * Vercel Cron hits to drain the scout_jobs queue (§21). Drives the real app via
 * supertest. The scout AGENT is mocked so a drained job runs no live scan. The
 * worker secret is set by vitest config (SCOUT_WORKER_SECRET); these tests prove:
 *  - a request WITHOUT the secret header is rejected (401, fail-closed §5.4);
 *  - a request WITH the wrong secret is rejected;
 *  - a request WITH the correct secret drains the queue and reports the count;
 *  - the response is the { success, data, error } envelope (§8.1) on every path.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/codeScout/CodeScoutAgent", () => ({
  CodeScoutAgent: { run: vi.fn() },
}));

import request from "supertest";
import { CodeScoutAgent } from "../../agents/codeScout/CodeScoutAgent";
import { SCOUT_JOB } from "../../config";
import { createApp } from "../../app";
import { db } from "../../database/connection";
import { ScoutJobModel } from "../../models/ScoutJobModel";
import { InterviewSessionModel } from "../../models/InterviewSessionModel";
import { makeOwner, makeRequestText, makeScoutFindings } from "../../test/factories";

const app = createApp();
const mockRun = vi.mocked(CodeScoutAgent.run);
const SECRET = "test-scout-worker-secret"; // mirrors vitest.config.ts env
const TRIGGER = "/internal/scout/process";

async function seedSession(): Promise<number> {
  const session = await InterviewSessionModel.create(makeOwner(), {
    originalRequest: makeRequestText("internal-trigger"),
  });
  return session.id;
}

describe("Internal scout processor trigger", () => {
  beforeEach(async () => {
    mockRun.mockReset();
    await db("scout_jobs").where("status", "pending").del();
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("rejects a request with no worker secret (401, fail-closed §5.4)", async () => {
    const res = await request(app).post(TRIGGER).send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe("SCOUT_TRIGGER_AUTH_FAILED");
  });

  it("rejects a request with the wrong worker secret (401)", async () => {
    const res = await request(app)
      .post(TRIGGER)
      .set(SCOUT_JOB.TRIGGER_HEADER, "not-the-secret")
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SCOUT_TRIGGER_AUTH_FAILED");
  });

  it("with the correct secret, drains the queue and reports the count (§21)", async () => {
    const sessionId = await seedSession();
    await ScoutJobModel.enqueue({ sessionId, provider: "github", repoRef: "octocat/hello-world" });
    mockRun.mockResolvedValueOnce(makeScoutFindings());

    const res = await request(app)
      .post(TRIGGER)
      .set(SCOUT_JOB.TRIGGER_HEADER, SECRET)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.processed).toBe(1);
    expect(mockRun).toHaveBeenCalledTimes(1);

    const job = await ScoutJobModel.findLatestBySession(sessionId);
    expect(job?.status).toBe("done");
  });

  it("with the correct secret and an empty queue, reports zero processed", async () => {
    const res = await request(app)
      .post(TRIGGER)
      .set(SCOUT_JOB.TRIGGER_HEADER, SECRET)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(0);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
