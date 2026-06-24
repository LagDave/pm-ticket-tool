/**
 * Triage endpoint contract + error-path tests (§20.2). Drives the real app via
 * supertest and asserts the { success, data, error } envelope (§8.1) on the happy
 * path AND the failure paths. Both AI seams are mocked (triageAgent + ticketAgent)
 * so the suite is deterministic and free — no live model call, synthetic data
 * only (§20.4). Owner scope is set through the server-side x-dev-user-id header,
 * never the body — matching §11.7.
 *
 * Covers: simple → ticket route + persisted label; scoped → interview route;
 * the override forcing the interview from a simple label; default-to-scoped on a
 * model failure; validation/not-found/cross-owner error envelopes; and the
 * end-to-end-style case that a simple request reaches a valid standard-format
 * ticket through the spec-3 generation endpoint (spec T4).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock both AI seams BEFORE importing anything that pulls them in.
vi.mock("../../agents/triageAgent", () => ({
  classifyRequest: vi.fn(),
}));
vi.mock("../../agents/ticketAgent", () => ({
  generateTicket: vi.fn(),
}));
// Session create generates a title via the title agent; mock its seam so the
// POST /sessions calls in this suite stay deterministic and free (§20.4).
vi.mock("../../agents/titleAgent", () => ({
  generateTitle: vi.fn(async () => ({ title: "Generated session title" })),
  sanitizeTitle: (raw: string) => raw.trim() || null,
}));

import request from "supertest";
import { classifyRequest } from "../../agents/triageAgent";
import { generateTicket } from "../../agents/ticketAgent";
import { createApp } from "../../app";
import { db } from "../../database/connection";
import { makeGeneratedTicket, makeTriageClassification } from "../../test/factories";

const app = createApp();
const mockClassify = vi.mocked(classifyRequest);
const mockGenerateTicket = vi.mocked(generateTicket);

// Synthetic owner ids for this suite (> 1000 so cleanup is scoped).
const OWNER_A = "3001";
const OWNER_B = "3002";

/** Create a session over HTTP for the given owner and return its id. */
async function createSessionFor(owner: string, originalRequest: string): Promise<number> {
  const res = await request(app)
    .post("/sessions")
    .set("x-dev-user-id", owner)
    .send({ originalRequest });
  return res.body.data.id as number;
}

describe("Triage endpoint", () => {
  beforeEach(() => {
    mockClassify.mockReset();
    mockGenerateTicket.mockReset();
  });

  afterAll(async () => {
    // tickets/turns/decisions cascade from the session delete.
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("POST /sessions/:id/triage classifies simple → ticket route + envelope (200)", async () => {
    const id = await createSessionFor(OWNER_A, "Fix the typo on the login button.");
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    const res = await request(app)
      .post(`/sessions/${id}/triage`)
      .set("x-dev-user-id", OWNER_A)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.sessionId).toBe(id);
    expect(res.body.data.result).toBe("simple");
    expect(res.body.data.route).toBe("ticket");
    expect(res.body.data.overridden).toBe(false);
  });

  it("classifies scoped → interview route and persists the label on the session", async () => {
    const id = await createSessionFor(OWNER_A, "Build a full multi-step onboarding flow.");
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "scoped" }));

    const res = await request(app)
      .post(`/sessions/${id}/triage`)
      .set("x-dev-user-id", OWNER_A)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.route).toBe("interview");

    // The label is persisted and visible on the session read.
    const session = await request(app)
      .get(`/sessions/${id}`)
      .set("x-dev-user-id", OWNER_A);
    expect(session.body.data.triage_result).toBe("scoped");
    expect(session.body.data.triaged_at).not.toBeNull();
  });

  it("override forces the interview route even from a simple label (spec What)", async () => {
    const id = await createSessionFor(OWNER_A, "Change the copy on the banner.");
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));

    const res = await request(app)
      .post(`/sessions/${id}/triage`)
      .set("x-dev-user-id", OWNER_A)
      .send({ override: true });

    expect(res.status).toBe(200);
    expect(res.body.data.result).toBe("simple"); // label unchanged
    expect(res.body.data.route).toBe("interview"); // route forced
    expect(res.body.data.overridden).toBe(true);
  });

  it("defaults to scoped (200, never 5xx) when the model fails on both attempts (spec Risk)", async () => {
    const id = await createSessionFor(OWNER_A, "Something ambiguous.");
    mockClassify.mockRejectedValue(new Error("model down"));

    const res = await request(app)
      .post(`/sessions/${id}/triage`)
      .set("x-dev-user-id", OWNER_A)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.result).toBe("scoped");
    expect(res.body.data.route).toBe("interview");
  });

  it("rejects a non-boolean override with 400 + error envelope (boundary §11.2)", async () => {
    const id = await createSessionFor(OWNER_A, "Boundary check.");

    const res = await request(app)
      .post(`/sessions/${id}/triage`)
      .set("x-dev-user-id", OWNER_A)
      .send({ override: "yes-please" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("POST /sessions/:id/triage for a missing session returns 404 + error envelope", async () => {
    const res = await request(app)
      .post("/sessions/999999999/triage")
      .set("x-dev-user-id", OWNER_A)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("cannot triage another owner's session (404, no leak §11.7)", async () => {
    const id = await createSessionFor(OWNER_A, "Owner A only.");

    const res = await request(app)
      .post(`/sessions/${id}/triage`)
      .set("x-dev-user-id", OWNER_B)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("POST /sessions/:id/triage with a non-numeric id returns 400 (param validation)", async () => {
    const res = await request(app)
      .post("/sessions/not-a-number/triage")
      .set("x-dev-user-id", OWNER_A)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  /* ----------- T4: simple path reaches a valid standard-format ticket ---------- */

  it("a simple request reaches a valid standard-format ticket via the spec-3 path", async () => {
    const id = await createSessionFor(OWNER_A, "Rename the 'Submit' button to 'Save'.");

    // Triage says simple → the wizard would route to drafting.
    mockClassify.mockResolvedValueOnce(makeTriageClassification({ result: "simple" }));
    const triage = await request(app)
      .post(`/sessions/${id}/triage`)
      .set("x-dev-user-id", OWNER_A)
      .send({});
    expect(triage.body.data.route).toBe("ticket");

    // The simple path drives the existing spec-3 generation endpoint directly —
    // no interview turns, an empty decision_record is acceptable for simple work.
    mockGenerateTicket.mockResolvedValueOnce(makeGeneratedTicket());
    const ticketRes = await request(app)
      .post(`/sessions/${id}/ticket`)
      .set("x-dev-user-id", OWNER_A)
      .send({});

    expect(ticketRes.status).toBe(201);
    expect(ticketRes.body.success).toBe(true);
    const ticket = ticketRes.body.data;
    // The standard ticket format: story (As a/I want/So that), criteria, tier effort.
    expect(ticket.user_story).toMatch(/^As a .+, I want .+, So that .+/);
    expect(Array.isArray(ticket.acceptance_criteria)).toBe(true);
    expect(ticket.acceptance_criteria.length).toBeGreaterThan(0);
    expect(["XS", "S", "M", "L", "XL"]).toContain(ticket.effort);
    expect(ticket.status).toBe("draft");
  });
});
