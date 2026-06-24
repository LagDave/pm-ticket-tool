/**
 * ProjectService tests (§20.1, §20.2). Real DB (the global setup migrates a test
 * schema); synthetic data only (§20.4). Covers: create/read/list/update/delete
 * round-trips, the NOT_FOUND error path on a missing/foreign id, and owner-scope
 * isolation — one owner can never read, update, or delete another owner's project
 * (§11.7). This is the data-isolation rule proven, not assumed (§5.5).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../database/connection";
import { makeOwner, makeProjectName } from "../../../test/factories";
import type { OwnerContext } from "../../../types/interview";
import { ProjectService } from "./ProjectService";

/** Create a project for the given owner and return it. */
async function seedProject(owner: OwnerContext, suffix = "") {
  return ProjectService.createProject(owner, {
    name: makeProjectName(suffix),
    description: null,
  });
}

describe("ProjectService", () => {
  afterAll(async () => {
    // Clean only the synthetic rows this suite created (owner ids > 1000).
    await db("projects").where("owner_user_id", ">", 1000).del();
  });

  it("creates a project owned by the caller and reads it back", async () => {
    const owner = makeOwner();
    const created = await seedProject(owner, "create");

    expect(created.id).toBeGreaterThan(0);
    expect(created.owner_user_id).toBe(owner.ownerUserId);
    expect(created.name).toBe(makeProjectName("create"));

    const fetched = await ProjectService.getProjectForOwner(created.id, owner);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe(created.name);
  });

  it("lists only the caller's projects", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    await seedProject(ownerA, "a1");
    await seedProject(ownerA, "a2");
    await seedProject(ownerB, "b1");

    const listA = await ProjectService.listProjects(ownerA);
    expect(listA.length).toBe(2);
    expect(listA.every((p) => p.owner_user_id === ownerA.ownerUserId)).toBe(true);
  });

  it("updates the caller's project and returns the new row", async () => {
    const owner = makeOwner();
    const created = await seedProject(owner, "update");

    const updated = await ProjectService.updateProject(created.id, owner, {
      name: "Renamed",
      description: "Now described.",
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.description).toBe("Now described.");

    const reread = await ProjectService.getProjectForOwner(created.id, owner);
    expect(reread.name).toBe("Renamed");
  });

  it("deletes the caller's project and returns its id", async () => {
    const owner = makeOwner();
    const created = await seedProject(owner, "delete");

    const deleted = await ProjectService.deleteProject(created.id, owner);
    expect(deleted).toEqual({ id: created.id });

    // The row is gone — a re-read now raises NOT_FOUND.
    await expect(
      ProjectService.getProjectForOwner(created.id, owner),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("throws PROJECT_NOT_FOUND for a non-existent id", async () => {
    const owner = makeOwner();
    await expect(
      ProjectService.getProjectForOwner(999_999_999, owner),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("hides another owner's project on read (NOT_FOUND, §11.7)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const projectA = await seedProject(ownerA, "ownerA-read");

    await expect(
      ProjectService.getProjectForOwner(projectA.id, ownerB),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    // Owner A still sees it.
    const own = await ProjectService.getProjectForOwner(projectA.id, ownerA);
    expect(own.id).toBe(projectA.id);
  });

  it("will not update another owner's project (NOT_FOUND), leaving it intact (§11.7)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const projectA = await seedProject(ownerA, "ownerA-update");

    await expect(
      ProjectService.updateProject(projectA.id, ownerB, { name: "Hijacked" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    // The hijack attempt never landed.
    const reread = await ProjectService.getProjectForOwner(projectA.id, ownerA);
    expect(reread.name).toBe(makeProjectName("ownerA-update"));
  });

  it("will not delete another owner's project (NOT_FOUND), leaving it intact (§11.7)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const projectA = await seedProject(ownerA, "ownerA-delete");

    await expect(
      ProjectService.deleteProject(projectA.id, ownerB),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    // Owner A's project is untouched.
    const stillThere = await ProjectService.getProjectForOwner(projectA.id, ownerA);
    expect(stillThere.id).toBe(projectA.id);
  });
});
