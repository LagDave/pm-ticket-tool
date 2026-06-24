/**
 * Interview engine endpoint contract + error-path tests (§20.2). Drives the
 * real app via supertest and asserts the { success, data, error } envelope
 * (§8.1) on the happy path AND the failure paths. The Anthropic SDK is mocked
 * at the agent seam so a full multi-round interview runs over HTTP with no live
 * model call. Owner scope is set via the server-side x-dev-user-id header,
 * never the body (§11.7).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/interviewAgent", () => ({
  generateBatch: vi.fn(),
}));

import request from "supertest";
import { generateBatch } from "../../agents/interviewAgent";
import { createApp } from "../../app";
import { db } from "../../database/connection";
import { makeBatch } from "../../test/factories";

const app = createApp();
const mockGenerate = vi.mocked(generateBatch);

const OWNER_A = "3001";
const OWNER_B = "3002";

/** Create a session over HTTP and return its id. */
async function createSession(request_text: string): Promise<number> {
  const res = await request(app)
    .post("/sessions")
    .set("x-dev-user-id", OWNER_A)
    .send({ originalRequest: request_text });
  return res.body.data.id as number;
}

describe("Interview engine endpoints", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("GET /sessions/:id/interview returns the envelope + empty initial state", async () => {
    const id = await createSession("Build a magic link login.");

    const res = await request(app)
      .get(`/sessions/${id}/interview`)
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.sessionId).toBe(id);
    expect(res.body.data.turns).toEqual([]);
    expect(res.body.data.status).toBe("draft");
  });

  it("POST next-batch generates a batch and returns it in the envelope", async () => {
    const id = await createSession("Build a magic link login.");
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));

    const res = await request(app)
      .post(`/sessions/${id}/interview/next-batch`)
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.turns).toHaveLength(1);
    expect(res.body.data.status).toBe("in_progress");
  });

  it("POST answers with an invalid body is rejected at the boundary (400)", async () => {
    const id = await createSession("Validate me.");

    const res = await request(app)
      .post(`/sessions/${id}/interview/answers`)
      .set("x-dev-user-id", OWNER_A)
      .send({ answers: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET interview for a missing session returns 404 + error envelope", async () => {
    const res = await request(app)
      .get("/sessions/999999999/interview")
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("does not leak another owner's session (404, §11.7)", async () => {
    const id = await createSession("Owner A only.");

    const res = await request(app)
      .get(`/sessions/${id}/interview`)
      .set("x-dev-user-id", OWNER_B);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("answering with no open batch is a 409 conflict", async () => {
    const id = await createSession("No open batch yet.");

    const res = await request(app)
      .post(`/sessions/${id}/interview/answers`)
      .set("x-dev-user-id", OWNER_A)
      .send({ answers: [] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_OPEN_BATCH_CONFLICT");
  });

  it("runs a full multi-round interview over HTTP to termination", async () => {
    const id = await createSession("Add SSO to the app.");

    // Round 1: material decisions still open.
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));
    let res = await request(app)
      .post(`/sessions/${id}/interview/next-batch`)
      .set("x-dev-user-id", OWNER_A);
    expect(res.body.data.turns).toHaveLength(1);

    res = await request(app)
      .post(`/sessions/${id}/interview/answers`)
      .set("x-dev-user-id", OWNER_A)
      .send({ answers: [{ questionId: "q1", optionId: "opt_magic", otherText: null }] });
    expect(res.status).toBe(200);

    // Round 2: now nothing material remains.
    mockGenerate.mockResolvedValueOnce(
      makeBatch({
        questions: [
          {
            id: "q1",
            decisionKey: "sso_provider",
            text: "Which provider?",
            options: [{ id: "opt_okta", label: "Okta", groundingRef: null, speed: "fast", recommended: true }],
            allowOther: false,
            dependsOn: [],
          },
        ],
        hasOpenMaterialDecisions: false,
      }),
    );
    res = await request(app)
      .post(`/sessions/${id}/interview/next-batch`)
      .set("x-dev-user-id", OWNER_A);
    expect(res.body.data.turns).toHaveLength(2);

    res = await request(app)
      .post(`/sessions/${id}/interview/answers`)
      .set("x-dev-user-id", OWNER_A)
      .send({ answers: [{ questionId: "q1", optionId: "opt_okta", otherText: null }] });
    expect(res.status).toBe(200);

    // Final advance terminates the interview.
    res = await request(app)
      .post(`/sessions/${id}/interview/next-batch`)
      .set("x-dev-user-id", OWNER_A);
    expect(res.body.data.isComplete).toBe(true);
    expect(res.body.data.status).toBe("complete");
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});
