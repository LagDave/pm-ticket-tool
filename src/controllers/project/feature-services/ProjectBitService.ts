/**
 * ProjectBitService — business logic for project bits (§7.1). Bits are reached
 * only through an owner-verified project: EVERY method first calls
 * ProjectModel.findByIdForOwner (throws PROJECT_NOT_FOUND when missing or another
 * owner's), then issues the ProjectBitModel call scoped by projectId (§11.7).
 * This mirrors how the engine/ticket services scope turns/decisions via an
 * owner-verified session — the project is the tenancy boundary for its bits.
 * Never touches req/res. Mirrors InterviewSessionService (§6.1).
 *
 * Scope note: reconciliation / import / merge-on-complete are NOT here — later
 * tasks (T9/T10/T13) own those via BitReconciliationService. This service is the
 * plain owner-scoped CRUD: a manual bit is created with status active / source
 * manual via ProjectBitModel.create.
 */
import { ProjectBitModel } from "../../../models/ProjectBitModel";
import { ProjectModel } from "../../../models/ProjectModel";
import type { OwnerContext } from "../../../types/interview";
import type { IProjectBit } from "../../../types/project";
import type {
  CandidateBitBody,
  UpdateBitBody,
} from "../../../validation/projectBit";
import { ProjectError } from "../feature-utils/ProjectError";

export class ProjectBitService {
  /**
   * Owner-verify the project a bit operation targets, or throw NOT_FOUND. The
   * single tenancy gate every public method runs before touching ProjectBitModel
   * (§11.7) — a missing or foreign project is indistinguishable, never leaked.
   */
  private static async assertProjectOwned(
    projectId: number,
    owner: OwnerContext,
  ): Promise<void> {
    const project = await ProjectModel.findByIdForOwner(projectId, owner);
    if (!project) {
      throw new ProjectError(
        "PROJECT_NOT_FOUND",
        `Project ${projectId} was not found.`,
        { id: projectId },
      );
    }
  }

  /** List all bits for an owner-verified project, newest first (the management list). */
  static async listBits(
    projectId: number,
    owner: OwnerContext,
  ): Promise<IProjectBit[]> {
    await this.assertProjectOwned(projectId, owner);
    return ProjectBitModel.listByProject(projectId);
  }

  /**
   * Create one manual bit on an owner-verified project. Status defaults to active
   * and source to manual in the model (the import/merge paths set the other
   * sources). Returns the new row.
   */
  static async createBit(
    projectId: number,
    owner: OwnerContext,
    input: CandidateBitBody,
  ): Promise<IProjectBit> {
    await this.assertProjectOwned(projectId, owner);
    return ProjectBitModel.create({
      projectId,
      kind: input.kind,
      bitKey: input.bit_key,
      summary: input.summary,
      source: "manual",
    });
  }

  /**
   * Update a bit on an owner-verified project. The model update is scoped by
   * (id, project_id), so a bit id from another project simply matches nothing and
   * returns null — surfaced as BIT_NOT_FOUND, never reaching across projects.
   */
  static async updateBit(
    projectId: number,
    bitId: number,
    owner: OwnerContext,
    input: UpdateBitBody,
  ): Promise<IProjectBit> {
    await this.assertProjectOwned(projectId, owner);
    const updated = await ProjectBitModel.update(bitId, projectId, {
      kind: input.kind,
      bitKey: input.bit_key,
      summary: input.summary,
    });
    if (!updated) {
      throw new ProjectError(
        "BIT_NOT_FOUND",
        `Bit ${bitId} was not found on project ${projectId}.`,
        { projectId, bitId },
      );
    }
    return updated;
  }

  /**
   * Delete a bit on an owner-verified project, returning its id. The model delete
   * is scoped by (id, project_id); a 0 row count means the bit was missing or in
   * another project, surfaced as BIT_NOT_FOUND so nothing leaks (§11.7).
   */
  static async deleteBit(
    projectId: number,
    bitId: number,
    owner: OwnerContext,
  ): Promise<{ id: number }> {
    await this.assertProjectOwned(projectId, owner);
    const deletedCount = await ProjectBitModel.delete(bitId, projectId);
    if (deletedCount === 0) {
      throw new ProjectError(
        "BIT_NOT_FOUND",
        `Bit ${bitId} was not found on project ${projectId}.`,
        { projectId, bitId },
      );
    }
    return { id: bitId };
  }
}
