/**
 * Health endpoint test (§20.2). With a live DB, GET /health returns the success
 * envelope only when the ping succeeds (spec T6).
 */
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();

describe("GET /health", () => {
  it("returns 200 + success envelope when the DB responds", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.database).toBe("up");
    expect(typeof res.body.data.timestamp).toBe("string");
  });
});
