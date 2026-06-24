/**
 * ScoutCacheModel tests (§20.1, §20.2). Proves the read-through store: findings
 * persist and read back by session, the NEWEST row wins on a re-point, and the
 * cache is reached only through a session (the owner-isolation contract is
 * proven at the session model + service layers, §11.7). Synthetic data only,
 * owner ids > 1000 (§20.4); the FK requires a real session, so each test seeds
 * one via InterviewSessionModel.
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText, makeScoutFindings } from "../test/factories";
import { InterviewSessionModel } from "./InterviewSessionModel";
import { ScoutCacheModel } from "./ScoutCacheModel";

/** Seed a real session (the scout_cache FK target) and return its id. */
async function seedSession(): Promise<number> {
  const session = await InterviewSessionModel.create(makeOwner(), {
    originalRequest: makeRequestText("scout-model"),
  });
  return session.id;
}

describe("ScoutCacheModel", () => {
  afterAll(async () => {
    // CASCADE from interview_sessions clears scout_cache rows for synthetic owners.
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("returns null on a cache miss for a session", async () => {
    const sessionId = await seedSession();
    expect(await ScoutCacheModel.findBySession(sessionId)).toBeNull();
  });

  it("stores findings and reads them back by session (§20.1)", async () => {
    const sessionId = await seedSession();
    const findings = makeScoutFindings();

    const created = await ScoutCacheModel.create({
      sessionId,
      provider: "github",
      repoRef: "octocat/hello-world",
      findings,
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.session_id).toBe(sessionId);
    expect(created.provider).toBe("github");
    expect(created.repo_ref).toBe("octocat/hello-world");

    const fetched = await ScoutCacheModel.findBySession(sessionId);
    expect(fetched).not.toBeNull();
    // JSONB round-trips structured (BaseModel (de)serialization).
    expect(fetched?.findings.summary).toBe(findings.summary);
    expect(fetched?.findings.relevantAreas).toHaveLength(1);
    expect(fetched?.findings.relevantAreas[0].roughSize).toBe("M");
    expect(fetched?.findings.verifyWithEngineering).toBe(true);
  });

  it("returns the NEWEST row when a session is re-pointed (append, latest wins)", async () => {
    const sessionId = await seedSession();

    await ScoutCacheModel.create({
      sessionId,
      provider: "github",
      repoRef: "old/repo",
      findings: makeScoutFindings({ summary: "first scan" }),
    });
    await ScoutCacheModel.create({
      sessionId,
      provider: "github",
      repoRef: "new/repo",
      findings: makeScoutFindings({ summary: "second scan" }),
    });

    const latest = await ScoutCacheModel.findBySession(sessionId);
    expect(latest?.repo_ref).toBe("new/repo");
    expect(latest?.findings.summary).toBe("second scan");
  });

  it("isolates one session's cache from another's", async () => {
    const sessionA = await seedSession();
    const sessionB = await seedSession();
    await ScoutCacheModel.create({
      sessionId: sessionA,
      provider: "github",
      repoRef: "a/repo",
      findings: makeScoutFindings({ summary: "A only" }),
    });

    expect((await ScoutCacheModel.findBySession(sessionA))?.findings.summary).toBe(
      "A only",
    );
    // Session B has no cache row of its own.
    expect(await ScoutCacheModel.findBySession(sessionB)).toBeNull();
  });
});
