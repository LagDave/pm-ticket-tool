/**
 * Sessions endpoint contract + error-path tests (§20.2). Drives the real app
 * via supertest and asserts the { success, data, error } envelope (§8.1) on the
 * happy path AND the failure paths (validation 400, not-found 404, cross-owner
 * 404). Owner scope is set through the server-side x-dev-user-id header — never
 * the body — matching §11.7.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent at its seam so resume-state tests can generate a batch over
// HTTP with no live model call (mirrors the engine controller test).
vi.mock("../../agents/interviewAgent", () => ({
  generateBatch: vi.fn(),
}));
// Session create now generates a title via the title agent; mock its seam so
// POST /sessions stays deterministic and free — no live model call (§20.4).
vi.mock("../../agents/titleAgent", () => ({
  generateTitle: vi.fn(async () => ({ title: "Generated session title" })),
  sanitizeTitle: (raw: string) => raw.trim() || null,
}));

import request from "supertest";
import { generateBatch } from "../../agents/interviewAgent";
import { generateTitle } from "../../agents/titleAgent";
import { createApp } from "../../app";
import { db } from "../../database/connection";
import { makeBatch } from "../../test/factories";

const app = createApp();
const mockGenerate = vi.mocked(generateBatch);
const mockTitle = vi.mocked(generateTitle);

// Synthetic owner ids for this suite (> 1000 so cleanup is scoped).
const OWNER_A = "2001";
const OWNER_B = "2002";

/** Create a session over HTTP for the given owner and return its id. */
async function createSessionFor(
  owner: string,
  originalRequest: string,
): Promise<number> {
  const res = await request(app)
    .post("/sessions")
    .set("x-dev-user-id", owner)
    .send({ originalRequest });
  return res.body.data.id as number;
}

describe("Sessions endpoints", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    // Reset the title mock back to its happy-path default each test; individual
    // tests override it (e.g. to a rejection) as needed.
    mockTitle.mockReset();
    mockTitle.mockResolvedValue({ title: "Generated session title" });
  });

  afterAll(async () => {
    // ticket_comments/tickets/turns/decisions cascade from the session delete.
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("POST /sessions creates a session and returns 201 + the success envelope", async () => {
    const res = await request(app)
      .post("/sessions")
      .set("x-dev-user-id", OWNER_A)
      .send({ originalRequest: "Build a magic link login." });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.id).toBeGreaterThan(0);
    expect(res.body.data.original_request).toBe("Build a magic link login.");
    expect(res.body.data.status).toBe("draft");
    // The generated title is persisted at create and exposed in the response
    // (User QA: auto-generated session title).
    expect(res.body.data.title).toBe("Generated session title");
    expect(mockTitle).toHaveBeenCalledTimes(1);
  });

  it("POST /sessions still succeeds with a null title when title generation fails (degrade, never block)", async () => {
    // The title agent failing on both models must NOT fail the create — the
    // session persists with title null and the UI falls back to the snippet.
    mockTitle.mockRejectedValue(new Error("model down")); // primary + fallback

    const res = await request(app)
      .post("/sessions")
      .set("x-dev-user-id", OWNER_A)
      .send({ originalRequest: "Title generation will fail here." });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBeNull();
  });

  it("POST then GET round-trips the persisted row (200 + envelope)", async () => {
    const created = await request(app)
      .post("/sessions")
      .set("x-dev-user-id", OWNER_A)
      .send({ originalRequest: "Round trip me." });
    const id = created.body.data.id as number;

    const fetched = await request(app)
      .get(`/sessions/${id}`)
      .set("x-dev-user-id", OWNER_A);

    expect(fetched.status).toBe(200);
    expect(fetched.body.success).toBe(true);
    expect(fetched.body.data.id).toBe(id);
    expect(fetched.body.data.original_request).toBe("Round trip me.");
  });

  it("POST /sessions with an empty request returns 400 + error envelope", async () => {
    const res = await request(app)
      .post("/sessions")
      .set("x-dev-user-id", OWNER_A)
      .send({ originalRequest: "" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.body.error.details.fields)).toBe(true);
  });

  it("GET /sessions/:id for a missing id returns 404 + error envelope", async () => {
    const res = await request(app)
      .get("/sessions/999999999")
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("GET /sessions/:id from a different owner returns 404 (no leak, §11.7)", async () => {
    const created = await request(app)
      .post("/sessions")
      .set("x-dev-user-id", OWNER_A)
      .send({ originalRequest: "Owner A only." });
    const id = created.body.data.id as number;

    const leak = await request(app)
      .get(`/sessions/${id}`)
      .set("x-dev-user-id", OWNER_B);

    expect(leak.status).toBe(404);
    expect(leak.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("GET /sessions/:id with a non-numeric id returns 400 (param validation)", async () => {
    const res = await request(app)
      .get("/sessions/not-a-number")
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  /* --------------------------- T1: list endpoint -------------------------- */

  it("GET /sessions returns the standard pagination envelope (§11.6)", async () => {
    // A dedicated owner so the page counts are deterministic for this suite run.
    const owner = "2010";
    await createSessionFor(owner, "List one.");
    await createSessionFor(owner, "List two.");

    const res = await request(app)
      .get("/sessions?page=1&limit=20")
      .set("x-dev-user-id", owner);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(20);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.totalPages).toBe(1);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("GET /sessions paginates: limit caps the page and totalPages reflects total", async () => {
    const owner = "2011";
    await createSessionFor(owner, "p1");
    await createSessionFor(owner, "p2");
    await createSessionFor(owner, "p3");

    const res = await request(app)
      .get("/sessions?page=1&limit=2")
      .set("x-dev-user-id", owner);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.totalPages).toBe(2);

    const page2 = await request(app)
      .get("/sessions?page=2&limit=2")
      .set("x-dev-user-id", owner);
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.page).toBe(2);
  });

  it("GET /sessions never returns another owner's rows (§11.7)", async () => {
    const ownerA = "2012";
    const ownerB = "2013";
    await createSessionFor(ownerA, "A's session.");
    await createSessionFor(ownerB, "B's session.");

    const res = await request(app)
      .get("/sessions")
      .set("x-dev-user-id", ownerA);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].owner_user_id).toBe(Number(ownerA));
  });

  it("GET /sessions?status= narrows the list to that status", async () => {
    const owner = "2014";
    // Two drafts; mark one complete via the engine path so a status filter has
    // something to narrow. Generating a no-open-decision batch then advancing
    // again terminates the interview → status 'complete'.
    const completeId = await createSessionFor(owner, "Will complete.");
    await createSessionFor(owner, "Stays draft.");

    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: false }));
    await request(app)
      .post(`/sessions/${completeId}/interview/next-batch`)
      .set("x-dev-user-id", owner);
    await request(app)
      .post(`/sessions/${completeId}/interview/answers`)
      .set("x-dev-user-id", owner)
      .send({ answers: [{ questionId: "q1", optionId: "opt_magic", otherText: null }] });
    await request(app)
      .post(`/sessions/${completeId}/interview/next-batch`)
      .set("x-dev-user-id", owner);

    const drafts = await request(app)
      .get("/sessions?status=draft")
      .set("x-dev-user-id", owner);
    expect(drafts.body.data.items.every((s: { status: string }) => s.status === "draft")).toBe(true);

    const complete = await request(app)
      .get("/sessions?status=complete")
      .set("x-dev-user-id", owner);
    expect(complete.body.data.items.every((s: { status: string }) => s.status === "complete")).toBe(true);
    expect(complete.body.data.items.some((s: { id: number }) => s.id === completeId)).toBe(true);
  });

  it("GET /sessions with a bad status returns 400 (boundary validation §11.2)", async () => {
    const res = await request(app)
      .get("/sessions?status=bogus")
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  /* ----------------------- T2: session-state (resume) --------------------- */

  it("GET /sessions/:id/state returns the resume shape + null ticketId for a fresh session", async () => {
    const id = await createSessionFor(OWNER_A, "Resume me later.");

    const res = await request(app)
      .get(`/sessions/${id}/state`)
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBe(id);
    expect(res.body.data.turns).toEqual([]);
    expect(res.body.data.decisions).toEqual([]);
    expect(res.body.data.nextTurnIndex).toBe(0);
    expect(res.body.data.ticketId).toBeNull();
  });

  it("GET /sessions/:id/state carries the open turn needed to compute the next step", async () => {
    const id = await createSessionFor(OWNER_A, "Mid-interview resume.");
    mockGenerate.mockResolvedValueOnce(makeBatch({ hasOpenMaterialDecisions: true }));
    await request(app)
      .post(`/sessions/${id}/interview/next-batch`)
      .set("x-dev-user-id", OWNER_A);

    const res = await request(app)
      .get(`/sessions/${id}/state`)
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(200);
    expect(res.body.data.turns).toHaveLength(1);
    // The open turn (answers still null) is what the wizard replays to land on
    // the next unanswered batch (spec 4 T2/T5).
    expect(res.body.data.turns[0].answers).toBeNull();
    expect(res.body.data.turns[0].questions.questions[0].id).toBe("q1");
    expect(res.body.data.status).toBe("in_progress");
  });

  it("GET /sessions/:id/state for another owner's session returns 404 (no leak §11.7)", async () => {
    const id = await createSessionFor(OWNER_A, "Owner A state only.");

    const res = await request(app)
      .get(`/sessions/${id}/state`)
      .set("x-dev-user-id", OWNER_B);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  /* ------------------------- T3: re-run (clone) --------------------------- */

  it("POST /sessions/:id/clone creates a fresh session from original_request (201)", async () => {
    const sourceId = await createSessionFor(OWNER_A, "Original to clone.");

    const res = await request(app)
      .post(`/sessions/${sourceId}/clone`)
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).not.toBe(sourceId);
    expect(res.body.data.original_request).toBe("Original to clone.");
    expect(res.body.data.status).toBe("draft");

    // The source is untouched.
    const source = await request(app)
      .get(`/sessions/${sourceId}`)
      .set("x-dev-user-id", OWNER_A);
    expect(source.body.data.id).toBe(sourceId);
    expect(source.body.data.original_request).toBe("Original to clone.");
  });

  it("POST /sessions/:id/clone cannot clone another owner's session (404 §11.7)", async () => {
    const sourceId = await createSessionFor(OWNER_A, "A's private source.");

    const res = await request(app)
      .post(`/sessions/${sourceId}/clone`)
      .set("x-dev-user-id", OWNER_B);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });
});
