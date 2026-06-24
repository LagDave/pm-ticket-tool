/**
 * InterviewSessionModel triage-write tests (§20.1, §20.2). Proves the triage
 * persistence (spec T2) and the owner-scope contract on the write (§11.7): a
 * session created by one owner cannot have its triage label written by another
 * owner. Data isolation proven on the write path, not assumed (§5.5).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText } from "../test/factories";
import { InterviewSessionModel } from "./InterviewSessionModel";

describe("InterviewSessionModel — triage write", () => {
  afterAll(async () => {
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("writes triage_result + triaged_at, owner-scoped, and reads it back", async () => {
    const owner = makeOwner();
    const created = await InterviewSessionModel.create(owner, {
      originalRequest: makeRequestText("triage-write"),
    });
    // A fresh session is un-triaged.
    expect(created.triage_result).toBeNull();
    expect(created.triaged_at).toBeNull();

    const updated = await InterviewSessionModel.setTriageResultForOwner(
      created.id,
      owner,
      "simple",
    );
    expect(updated?.triage_result).toBe("simple");
    expect(updated?.triaged_at).not.toBeNull();

    const fetched = await InterviewSessionModel.findByIdForOwner(created.id, owner);
    expect(fetched?.triage_result).toBe("simple");
  });

  it("does NOT write another owner's session (returns null, §11.7 isolation)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const sessionA = await InterviewSessionModel.create(ownerA, {
      originalRequest: makeRequestText("triage-iso"),
    });

    // Owner B tries to set the label on owner A's session — must no-op (null).
    const leaked = await InterviewSessionModel.setTriageResultForOwner(
      sessionA.id,
      ownerB,
      "scoped",
    );
    expect(leaked).toBeNull();

    // Owner A's row is untouched.
    const own = await InterviewSessionModel.findByIdForOwner(sessionA.id, ownerA);
    expect(own?.triage_result).toBeNull();
  });

  it("returns null when setting triage on a non-existent id", async () => {
    const owner = makeOwner();
    const missing = await InterviewSessionModel.setTriageResultForOwner(
      999_999_999,
      owner,
      "simple",
    );
    expect(missing).toBeNull();
  });

  it("accepts scoped as well (both labels round-trip)", async () => {
    const owner = makeOwner();
    const created = await InterviewSessionModel.create(owner, {
      originalRequest: makeRequestText("triage-scoped"),
    });
    const updated = await InterviewSessionModel.setTriageResultForOwner(
      created.id,
      owner,
      "scoped",
    );
    expect(updated?.triage_result).toBe("scoped");
  });
});
