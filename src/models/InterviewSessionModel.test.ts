/**
 * InterviewSessionModel tests (§20.1, §20.2). Proves the owner-scope contract
 * (§11.7): a session created by one owner is invisible to another owner. This
 * is the data-isolation rule proven, not assumed (§5.5).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText } from "../test/factories";
import { InterviewSessionModel } from "./InterviewSessionModel";

describe("InterviewSessionModel", () => {
  afterAll(async () => {
    // Clean only the synthetic rows this suite created (owner ids > 1000).
    await db("interview_sessions").where("owner_user_id", ">", 1000).del();
  });

  it("creates a session owned by the caller and reads it back", async () => {
    const owner = makeOwner();
    const created = await InterviewSessionModel.create(owner, {
      originalRequest: makeRequestText("create"),
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.owner_user_id).toBe(owner.ownerUserId);
    expect(created.status).toBe("draft");

    const fetched = await InterviewSessionModel.findByIdForOwner(created.id, owner);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.original_request).toBe(created.original_request);
  });

  it("does NOT return a session to a different owner (§11.7 isolation)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();

    const sessionA = await InterviewSessionModel.create(ownerA, {
      originalRequest: makeRequestText("ownerA"),
    });

    // Owner B asks for owner A's id — must get null, not the row.
    const leaked = await InterviewSessionModel.findByIdForOwner(sessionA.id, ownerB);
    expect(leaked).toBeNull();

    // Owner A still sees it.
    const own = await InterviewSessionModel.findByIdForOwner(sessionA.id, ownerA);
    expect(own?.id).toBe(sessionA.id);
  });

  it("returns null for a non-existent id", async () => {
    const owner = makeOwner();
    const missing = await InterviewSessionModel.findByIdForOwner(999_999_999, owner);
    expect(missing).toBeNull();
  });

  it("lists only the caller's sessions", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    await InterviewSessionModel.create(ownerA, { originalRequest: makeRequestText("a1") });
    await InterviewSessionModel.create(ownerA, { originalRequest: makeRequestText("a2") });
    await InterviewSessionModel.create(ownerB, { originalRequest: makeRequestText("b1") });

    const listA = await InterviewSessionModel.listForOwner(ownerA);
    expect(listA.length).toBe(2);
    expect(listA.every((s) => s.owner_user_id === ownerA.ownerUserId)).toBe(true);
  });

  it("paginates a page and counts the total, owner-scoped (§11.6, §11.7)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    await InterviewSessionModel.create(ownerA, { originalRequest: makeRequestText("pg1") });
    await InterviewSessionModel.create(ownerA, { originalRequest: makeRequestText("pg2") });
    await InterviewSessionModel.create(ownerA, { originalRequest: makeRequestText("pg3") });
    await InterviewSessionModel.create(ownerB, { originalRequest: makeRequestText("other") });

    const total = await InterviewSessionModel.countForOwner(ownerA);
    expect(total).toBe(3);

    const firstPage = await InterviewSessionModel.listPageForOwner(ownerA, {
      limit: 2,
      offset: 0,
    });
    expect(firstPage).toHaveLength(2);
    expect(firstPage.every((s) => s.owner_user_id === ownerA.ownerUserId)).toBe(true);

    const secondPage = await InterviewSessionModel.listPageForOwner(ownerA, {
      limit: 2,
      offset: 2,
    });
    expect(secondPage).toHaveLength(1);

    // Owner B's count and page are isolated from A's rows (§11.7).
    expect(await InterviewSessionModel.countForOwner(ownerB)).toBe(1);
  });

  it("persists a generated title on create and reads it back (User QA)", async () => {
    const owner = makeOwner();
    const created = await InterviewSessionModel.create(owner, {
      originalRequest: makeRequestText("titled"),
      title: "Add magic-link login",
    });
    expect(created.title).toBe("Add magic-link login");

    const fetched = await InterviewSessionModel.findByIdForOwner(created.id, owner);
    expect(fetched?.title).toBe("Add magic-link login");
  });

  it("defaults title to null when none is provided on create", async () => {
    const owner = makeOwner();
    const created = await InterviewSessionModel.create(owner, {
      originalRequest: makeRequestText("untitled"),
    });
    expect(created.title).toBeNull();
  });

  it("updates the title owner-scoped, and will not touch another owner's row (§11.7)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const created = await InterviewSessionModel.create(ownerA, {
      originalRequest: makeRequestText("retitle"),
      title: "Create-time title",
    });

    // Owner B cannot update owner A's title — no row matches, returns null.
    const leaked = await InterviewSessionModel.updateTitleForOwner(
      created.id,
      ownerB,
      "Hijacked title",
    );
    expect(leaked).toBeNull();

    // Owner A replaces the title successfully.
    const updated = await InterviewSessionModel.updateTitleForOwner(
      created.id,
      ownerA,
      "Refined title",
    );
    expect(updated?.title).toBe("Refined title");

    // The hijack attempt never landed.
    const reread = await InterviewSessionModel.findByIdForOwner(created.id, ownerA);
    expect(reread?.title).toBe("Refined title");
  });

  it("filters the page and count by status (§11.6 filter)", async () => {
    const owner = makeOwner();
    await InterviewSessionModel.create(owner, { originalRequest: makeRequestText("d1") });
    await InterviewSessionModel.create(owner, {
      originalRequest: makeRequestText("c1"),
      status: "complete",
    });

    const draftCount = await InterviewSessionModel.countForOwner(owner, {
      status: "draft",
    });
    expect(draftCount).toBe(1);

    const completePage = await InterviewSessionModel.listPageForOwner(owner, {
      limit: 20,
      offset: 0,
      status: "complete",
    });
    expect(completePage).toHaveLength(1);
    expect(completePage[0].status).toBe("complete");
  });
});
