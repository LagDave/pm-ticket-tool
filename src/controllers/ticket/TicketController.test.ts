/**
 * Ticket endpoint contract + error-path tests (§20.2). Drives the real app via
 * supertest and asserts the { success, data, error } envelope (§8.1) on the happy
 * path AND the failure paths: validation 400, not-found 404, cross-owner 404
 * (§11.7), stale-version conflict 409 (spec Risk). The agent seam is mocked so
 * generation is deterministic and free (§20.4). Owner scope is set through the
 * server-side x-dev-user-id header — never the body — matching §11.7.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/ticketAgent", () => ({
  generateTicket: vi.fn(),
}));
// Session create (POST /sessions) and ticket finalize both generate a title via
// the title agent; mock its seam so the suite stays deterministic and free —
// no live model call (§20.4). A finalize returns a refined title.
vi.mock("../../agents/titleAgent", () => ({
  generateTitle: vi.fn(async () => ({ title: "Refined ticket title" })),
  sanitizeTitle: (raw: string) => raw.trim() || null,
}));

import request from "supertest";
import { generateTicket } from "../../agents/ticketAgent";
import { generateTitle } from "../../agents/titleAgent";
import { createApp } from "../../app";
import { db } from "../../database/connection";
import { makeGeneratedTicket } from "../../test/factories";

const app = createApp();
const mockGenerate = vi.mocked(generateTicket);
const mockTitle = vi.mocked(generateTitle);

// Synthetic owner ids for this suite (> 1000 so cleanup is scoped).
const OWNER_A = "3001";
const OWNER_B = "3002";

/** Create a session for OWNER_A and return its id. */
async function createSession(owner = OWNER_A): Promise<number> {
  const res = await request(app)
    .post("/sessions")
    .set("x-dev-user-id", owner)
    .send({ originalRequest: "Build a magic-link login." });
  return res.body.data.id as number;
}

/** Generate a draft ticket for a session and return the ticket data. */
async function generateTicketFor(sessionId: number, owner = OWNER_A) {
  mockGenerate.mockResolvedValueOnce(makeGeneratedTicket());
  const res = await request(app)
    .post(`/sessions/${sessionId}/ticket`)
    .set("x-dev-user-id", owner);
  return res;
}

describe("Ticket endpoints", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    // Reset the title mock to its happy-path default each test (create + finalize
    // both call it); individual tests override it as needed.
    mockTitle.mockReset();
    mockTitle.mockResolvedValue({ title: "Refined ticket title" });
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("POST /sessions/:id/ticket generates a draft and returns 201 + the success envelope", async () => {
    const sessionId = await createSession();
    const res = await generateTicketFor(sessionId);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.status).toBe("draft");
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.user_story).toMatch(/^As a .+, I want .+, So that .+/);
    expect(Array.isArray(res.body.data.acceptance_criteria)).toBe(true);
    expect(res.body.data.rendered_markdown).toContain("## User Story");
  });

  it("generate → get round-trips the ticket with its comments (200 + envelope)", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    const fetched = await request(app)
      .get(`/tickets/${ticketId}`)
      .set("x-dev-user-id", OWNER_A);

    expect(fetched.status).toBe(200);
    expect(fetched.body.success).toBe(true);
    expect(fetched.body.data.ticket.id).toBe(ticketId);
    expect(Array.isArray(fetched.body.data.comments)).toBe(true);
    expect(fetched.body.data.comments).toHaveLength(0);
  });

  it("PATCH /tickets/:id edits a field and bumps the version (200)", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    const res = await request(app)
      .patch(`/tickets/${ticketId}`)
      .set("x-dev-user-id", OWNER_A)
      .send({ expectedVersion: 1, effort: "L" });

    expect(res.status).toBe(200);
    expect(res.body.data.ticket.version).toBe(2);
    expect(res.body.data.ticket.effort).toBe("L");
    // The re-rendered Markdown reflects the edit.
    expect(res.body.data.ticket.rendered_markdown).toContain("**L**");
  });

  it("PATCH with a stale expectedVersion returns 409 conflict (spec Risk)", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;
    // First edit bumps to version 2.
    await request(app)
      .patch(`/tickets/${ticketId}`)
      .set("x-dev-user-id", OWNER_A)
      .send({ expectedVersion: 1, effort: "S" });

    // A second editor still holding version 1 is rejected.
    const stale = await request(app)
      .patch(`/tickets/${ticketId}`)
      .set("x-dev-user-id", OWNER_A)
      .send({ expectedVersion: 1, effort: "XL" });

    expect(stale.status).toBe(409);
    expect(stale.body.success).toBe(false);
    expect(stale.body.error.code).toBe("TICKET_VERSION_CONFLICT");
  });

  it("POST /tickets/:id/comments adds a comment and returns 201", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    const res = await request(app)
      .post(`/tickets/${ticketId}/comments`)
      .set("x-dev-user-id", OWNER_A)
      .send({ body: "Tighten the second criterion." });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe("Tighten the second criterion.");
    expect(res.body.data.author_user_id).toBe(Number(OWNER_A));

    // The comment is visible on a subsequent get.
    const fetched = await request(app)
      .get(`/tickets/${ticketId}`)
      .set("x-dev-user-id", OWNER_A);
    expect(fetched.body.data.comments).toHaveLength(1);
  });

  it("POST /tickets/:id/finalize flips status draft→final and bumps the version (200)", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    const res = await request(app)
      .post(`/tickets/${ticketId}/finalize`)
      .set("x-dev-user-id", OWNER_A)
      .send({ expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.ticket.status).toBe("final");
    expect(res.body.data.ticket.version).toBe(2);
  });

  it("finalize regenerates and replaces the session title from the finalized ticket (User QA)", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    // The create-time title (from the request mock default) is on the session.
    const before = await request(app)
      .get(`/sessions/${sessionId}`)
      .set("x-dev-user-id", OWNER_A);
    expect(before.body.data.title).toBe("Refined ticket title");

    // Finalize regenerates from the ticket; here the mock returns a distinct title.
    mockTitle.mockResolvedValueOnce({ title: "Add magic-link login" });
    const fin = await request(app)
      .post(`/tickets/${ticketId}/finalize`)
      .set("x-dev-user-id", OWNER_A)
      .send({ expectedVersion: 1 });
    expect(fin.status).toBe(200);

    // The session title is now the refined one from the finalized ticket.
    const after = await request(app)
      .get(`/sessions/${sessionId}`)
      .set("x-dev-user-id", OWNER_A);
    expect(after.body.data.title).toBe("Add magic-link login");
  });

  it("finalize still succeeds and keeps the prior title when title regeneration fails", async () => {
    const sessionId = await createSession(); // create-time title persisted
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    // Title regeneration fails on both models during finalize — the finalize must
    // still succeed, and the create-time title must be left untouched (not blanked).
    mockTitle.mockRejectedValue(new Error("model down"));
    const fin = await request(app)
      .post(`/tickets/${ticketId}/finalize`)
      .set("x-dev-user-id", OWNER_A)
      .send({ expectedVersion: 1 });

    expect(fin.status).toBe(200);
    expect(fin.body.data.ticket.status).toBe("final");
    const after = await request(app)
      .get(`/sessions/${sessionId}`)
      .set("x-dev-user-id", OWNER_A);
    expect(after.body.data.title).toBe("Refined ticket title"); // prior title kept
  });

  it("PATCH with no editable fields returns 400 (boundary validation)", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    const res = await request(app)
      .patch(`/tickets/${ticketId}`)
      .set("x-dev-user-id", OWNER_A)
      .send({ expectedVersion: 1 }); // nothing to change

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /tickets/:id for a missing id returns 404 + error envelope", async () => {
    const res = await request(app)
      .get("/tickets/999999999")
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("GET /tickets/:id from a different owner returns 404 (no leak, §11.7)", async () => {
    const sessionId = await createSession();
    const gen = await generateTicketFor(sessionId);
    const ticketId = gen.body.data.id as number;

    const leak = await request(app)
      .get(`/tickets/${ticketId}`)
      .set("x-dev-user-id", OWNER_B);

    expect(leak.status).toBe(404);
    expect(leak.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("POST /sessions/:id/ticket for a different owner's session returns 404 (§11.7)", async () => {
    const sessionId = await createSession(OWNER_A);
    mockGenerate.mockResolvedValueOnce(makeGeneratedTicket());

    const res = await request(app)
      .post(`/sessions/${sessionId}/ticket`)
      .set("x-dev-user-id", OWNER_B);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("GET /tickets/:id with a non-numeric id returns 400 (param validation)", async () => {
    const res = await request(app)
      .get("/tickets/not-a-number")
      .set("x-dev-user-id", OWNER_A);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
