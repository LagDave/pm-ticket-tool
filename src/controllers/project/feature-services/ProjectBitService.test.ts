/**
 * ProjectBitService tests (§20.1, §20.2). Real DB (global setup migrates a test
 * schema); synthetic data only (§20.4). Covers: the create/list/update/delete
 * round-trip, manual bits land with status active / source manual, the
 * PROJECT_NOT_FOUND gate fires for a missing/foreign project on EVERY method, the
 * BIT_NOT_FOUND path for a missing/cross-project bit id, and owner-scope
 * isolation — one owner can never reach another owner's project bits (§11.7).
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../database/connection";
import { makeCandidateBit, makeOwner, makeProjectName } from "../../../test/factories";
import type { OwnerContext } from "../../../types/interview";
import type { IProject } from "../../../types/project";
import { ProjectBitService } from "./ProjectBitService";
import { ProjectService } from "./ProjectService";

/** Create a project for the given owner and return the row. */
async function seedProject(owner: OwnerContext, suffix = ""): Promise<IProject> {
  return ProjectService.createProject(owner, {
    name: makeProjectName(suffix),
    description: null,
  });
}

describe("ProjectBitService", () => {
  afterAll(async () => {
    // project_bits cascade on project delete; cleaning projects reaps bits too.
    await db("projects").where("owner_user_id", ">", 1000).del();
  });

  it("creates a manual bit with status active / source manual and reads it back", async () => {
    const owner = makeOwner();
    const project = await seedProject(owner, "bit-create");

    const bit = await ProjectBitService.createBit(
      project.id,
      owner,
      makeCandidateBit({ kind: "constraint", bit_key: "platform", summary: "Web only." }),
    );

    expect(bit.id).toBeGreaterThan(0);
    expect(bit.project_id).toBe(project.id);
    expect(bit.kind).toBe("constraint");
    expect(bit.status).toBe("active");
    expect(bit.source).toBe("manual");

    const list = await ProjectBitService.listBits(project.id, owner);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(bit.id);
  });

  it("updates a bit on the owner's project and returns the new row", async () => {
    const owner = makeOwner();
    const project = await seedProject(owner, "bit-update");
    const bit = await ProjectBitService.createBit(project.id, owner, makeCandidateBit());

    const updated = await ProjectBitService.updateBit(project.id, bit.id, owner, {
      summary: "Email/password only.",
    });
    expect(updated.summary).toBe("Email/password only.");
    expect(updated.id).toBe(bit.id);
  });

  it("deletes a bit on the owner's project and returns its id", async () => {
    const owner = makeOwner();
    const project = await seedProject(owner, "bit-delete");
    const bit = await ProjectBitService.createBit(project.id, owner, makeCandidateBit());

    const deleted = await ProjectBitService.deleteBit(project.id, bit.id, owner);
    expect(deleted).toEqual({ id: bit.id });

    const list = await ProjectBitService.listBits(project.id, owner);
    expect(list).toHaveLength(0);
  });

  it("throws BIT_NOT_FOUND when updating a non-existent bit on an owned project", async () => {
    const owner = makeOwner();
    const project = await seedProject(owner, "bit-missing");
    await expect(
      ProjectBitService.updateBit(project.id, 999_999_999, owner, { summary: "x" }),
    ).rejects.toMatchObject({ code: "BIT_NOT_FOUND" });
  });

  it("throws BIT_NOT_FOUND when deleting a bit from a different project (cross-project, §11.7)", async () => {
    const owner = makeOwner();
    const projectA = await seedProject(owner, "bit-projA");
    const projectB = await seedProject(owner, "bit-projB");
    const bitInA = await ProjectBitService.createBit(projectA.id, owner, makeCandidateBit());

    // The bit exists, but not under projectB — scoped delete matches nothing.
    await expect(
      ProjectBitService.deleteBit(projectB.id, bitInA.id, owner),
    ).rejects.toMatchObject({ code: "BIT_NOT_FOUND" });

    // It is still present under its real project.
    const list = await ProjectBitService.listBits(projectA.id, owner);
    expect(list.map((b) => b.id)).toContain(bitInA.id);
  });

  it("gates EVERY method on project ownership: another owner gets PROJECT_NOT_FOUND (§11.7)", async () => {
    const ownerA = makeOwner();
    const ownerB = makeOwner();
    const projectA = await seedProject(ownerA, "owner-gate");
    const bitInA = await ProjectBitService.createBit(projectA.id, ownerA, makeCandidateBit());

    // list / create / update / delete all reject for the foreign owner.
    await expect(
      ProjectBitService.listBits(projectA.id, ownerB),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(
      ProjectBitService.createBit(projectA.id, ownerB, makeCandidateBit()),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(
      ProjectBitService.updateBit(projectA.id, bitInA.id, ownerB, { summary: "x" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(
      ProjectBitService.deleteBit(projectA.id, bitInA.id, ownerB),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    // Owner A's bit survived every foreign attempt.
    const list = await ProjectBitService.listBits(projectA.id, ownerA);
    expect(list.map((b) => b.id)).toContain(bitInA.id);
  });

  it("throws PROJECT_NOT_FOUND when listing bits for a non-existent project", async () => {
    const owner = makeOwner();
    await expect(
      ProjectBitService.listBits(999_999_999, owner),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
