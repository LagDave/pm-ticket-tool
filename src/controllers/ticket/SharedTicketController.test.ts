/**
 * Public shared-ticket endpoint contract + security tests (§20.2). Drives the real
 * app via supertest. Proves: the route is reachable with NO auth header (the token
 * is the capability), returns the { success, data, error } envelope (§8.1), exposes
 * ONLY ticket content (no id/session_id/share_token/comments — §5.4), 404s an
 * unknown token without leaking existence, and 400s a malformed token (§11.2). The
 * agent seams are mocked so generation is deterministic and free (§20.4).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/ticketAgent", () => ({ generateTicket: vi.fn() }));
vi.mock("../../agents/titleAgent", () => ({
  generateTitle: vi.fn(async () => ({ title: "Synthetic title" })),
  sanitizeTitle: (raw: string) => raw.trim() || null,
}));

import request from "supertest";
import { generateTicket } from "../../agents/ticketAgent";
import { createApp } from "../../app";
import { db } from "../../database/connection";
import { makeGeneratedTicket } from "../../test/factories";

const app = createApp();
const mockGenerate = vi.mocked(generateTicket);

// Synthetic owner id (> 1000 so cleanup is scoped).
const OWNER = "3501";

/** Create a session + generate a ticket for it; return the ticket row (carries share_token). */
async function createSharedTicket() {
  const sessionRes = await request(app)
    .post("/sessions")
    .set("x-dev-user-id", OWNER)
    .send({ originalRequest: "Build a magic-link login." });
  const sessionId = sessionRes.body.data.id as number;

  mockGenerate.mockResolvedValueOnce(makeGeneratedTicket());
  const genRes = await request(app)
    .post(`/sessions/${sessionId}/ticket`)
    .set("x-dev-user-id", OWNER);
  return genRes.body.data as { id: number; share_token: string };
}

describe("Public shared-ticket endpoint", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
  });

  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("GET /shared/tickets/:token returns ticket content with NO auth and NO internal fields", async () => {
    const ticket = await createSharedTicket();
    const token = ticket.share_token;
    expect(typeof token).toBe("string");

    // Deliberately NO x-dev-user-id header — the route is public.
    const res = await request(app).get(`/shared/tickets/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();

    const data = res.body.data;
    expect(data.user_story).toMatch(/^As a .+, I want .+, So that .+/);
    expect(data.rendered_markdown).toContain("## User Story");
    expect(data.status).toBe("draft");
    expect(data.priority).toBe("medium");

    // Security contract: content only — no internal identifiers, no comments (§5.4).
    expect(data.id).toBeUndefined();
    expect(data.session_id).toBeUndefined();
    expect(data.share_token).toBeUndefined();
    expect(data.comments).toBeUndefined();
  });

  it("returns 404 for an unknown but well-formed token (no existence leak)", async () => {
    const res = await request(app).get(
      "/shared/tickets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("SHARED_TICKET_NOT_FOUND");
  });

  it("returns 400 for a malformed token (boundary validation, §11.2)", async () => {
    const res = await request(app).get("/shared/tickets/too-short");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
