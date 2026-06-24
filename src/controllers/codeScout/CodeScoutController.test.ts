/**
 * Code scout endpoint contract + error-path tests (§20.2) for the BACKGROUND-JOB
 * runtime (deploy spec runtime Option C, §21). Drives the real app via supertest
 * and asserts the { success, data, error } envelope (§8.1) on the happy AND
 * failure paths. The scout AGENT is mocked at its seam (CodeScoutAgent.run) so
 * the enqueue → process → status flow runs with no live provider or model call.
 *
 * The central guarantees under test:
 *  - POST ENQUEUES a job and returns 202 WITHOUT scanning inline (no agent call
 *    on the request path) — this is what keeps the handler short on Vercel;
 *  - the scan runs only when the processor is invoked, after which GET reports
 *    `done` and returns the findings;
 *  - a re-POST for an already-cached session short-circuits idempotently (§21.1);
 *  - validation, owner isolation (§11.7), and typed errors still hold.
 * Owner scope is set via the server-side x-dev-user-id header, never the body.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/codeScout/CodeScoutAgent", () => ({
  CodeScoutAgent: { run: vi.fn() },
}));

import request from "supertest";
import { CodeScoutAgent } from "../../agents/codeScout/CodeScoutAgent";
import { createApp } from "../../app";
import { db } from "../../database/connection";
import { ScoutJobProcessor } from "../../services/scoutJobs/ScoutJobProcessor";
import { makeScoutFindings } from "../../test/factories";

const app = createApp();
const mockRun = vi.mocked(CodeScoutAgent.run);

const OWNER_A = "4201";
const OWNER_B = "4202";
const VALID_BODY = { provider: "github", repoRef: "octocat/hello-world" };

/** Create a session over HTTP (owner A) and return its id. */
async function createSession(text: string): Promise<number> {
  const res = await request(app)
    .post("/sessions")
    .set("x-dev-user-id", OWNER_A)
    .send({ originalRequest: text });
  return res.body.data.id as number;
}

describe("Code scout endpoints (background-job runtime)", () => {
  beforeEach(async () => {
    mockRun.mockReset();
    await db("scout_jobs").where("status", "pending").del();
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("POST enqueues a job and returns 202 WITHOUT scanning inline (§21)", async () => {
    const id = await createSession("Add SSO login.");

    const res = await request(app)
      .post(`/sessions/${id}/scout`)
      .set("x-dev-user-id", OWNER_A)
      .send(VALID_BODY);

    expect(res.status).toBe(202); // Accepted — queued, not run
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.sessionId).toBe(id);
    expect(res.body.data.jobId).toBeGreaterThan(0);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.alreadyComplete).toBe(false);
    // The request did NOT scan — that is the whole point of backgrounding.
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("GET status is `pending` after enqueue, `done` with findings after processing", async () => {
    const id = await createSession("Add reporting.");
    mockRun.mockResolvedValueOnce(makeScoutFindings({ summary: "scanned by the worker" }));

    await request(app).post(`/sessions/${id}/scout`).set("x-dev-user-id", OWNER_A).send(VALID_BODY);

    // Before the processor runs: status pending, no findings (spec 6 falls back).
    const pending = await request(app).get(`/sessions/${id}/scout`).set("x-dev-user-id", OWNER_A);
    expect(pending.status).toBe(200);
    expect(pending.body.data.status).toBe("pending");
    expect(pending.body.data.findings).toBeUndefined();

    // Run the processor (stand-in for Vercel Cron / the local worker).
    await ScoutJobProcessor.drain();

    // Now: status done, findings present.
    const done = await request(app).get(`/sessions/${id}/scout`).set("x-dev-user-id", OWNER_A);
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("done");
    expect(done.body.data.findings.summary).toBe("scanned by the worker");
    expect(done.body.data.findings.verifyWithEngineering).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(1); // scanned exactly once, by the worker
  });

  it("a re-POST after the scan completed short-circuits idempotently (§21.1)", async () => {
    const id = await createSession("Add exports.");
    mockRun.mockResolvedValueOnce(makeScoutFindings());

    await request(app).post(`/sessions/${id}/scout`).set("x-dev-user-id", OWNER_A).send(VALID_BODY);
    await ScoutJobProcessor.drain();
    expect(mockRun).toHaveBeenCalledTimes(1);

    // Re-POST: findings already cached → 202, alreadyComplete, NO new job, NO re-scan.
    const rePost = await request(app)
      .post(`/sessions/${id}/scout`)
      .set("x-dev-user-id", OWNER_A)
      .send(VALID_BODY);

    expect(rePost.status).toBe(202);
    expect(rePost.body.data.alreadyComplete).toBe(true);
    expect(rePost.body.data.jobId).toBeNull();
    expect(rePost.body.data.status).toBe("done");
    expect(mockRun).toHaveBeenCalledTimes(1); // STILL one — never re-scanned
  });

  it("GET status before any enqueue returns `pending` with no findings (never scans)", async () => {
    const id = await createSession("No scout yet.");

    const res = await request(app).get(`/sessions/${id}/scout`).set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.findings).toBeUndefined();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("POST with a missing repo reference is rejected at the boundary (400, §11.2)", async () => {
    const id = await createSession("Validate me.");

    const res = await request(app)
      .post(`/sessions/${id}/scout`)
      .set("x-dev-user-id", OWNER_A)
      .send({ provider: "github" }); // no repoRef

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("POST with an unknown provider is rejected at the boundary (400)", async () => {
    const id = await createSession("Bad provider.");

    const res = await request(app)
      .post(`/sessions/${id}/scout`)
      .set("x-dev-user-id", OWNER_A)
      .send({ provider: "gitlab", repoRef: "a/b" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST for a missing session returns 404 + error envelope (no job enqueued)", async () => {
    const res = await request(app)
      .post("/sessions/999999999/scout")
      .set("x-dev-user-id", OWNER_A)
      .send(VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does not leak another owner's session on enqueue (404, §11.7) and never scans", async () => {
    const id = await createSession("Owner A only.");

    const res = await request(app)
      .post(`/sessions/${id}/scout`)
      .set("x-dev-user-id", OWNER_B)
      .send(VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does not leak another owner's scan status (404, §11.7)", async () => {
    const id = await createSession("Status owner-scoped.");
    await request(app).post(`/sessions/${id}/scout`).set("x-dev-user-id", OWNER_A).send(VALID_BODY);

    const res = await request(app).get(`/sessions/${id}/scout`).set("x-dev-user-id", OWNER_B);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });
});
