/**
 * ProjectService — business logic for the projects domain (§7.1). The only layer
 * between the controller and ProjectModel; raises typed ProjectError on rule
 * violations; enforces owner scope by passing the server-derived owner context
 * into every model call (§11.7). Never touches req/res. Mirrors
 * InterviewSessionService (§6.1).
 */
import { ProjectModel } from "../../../models/ProjectModel";
import type { OwnerContext } from "../../../types/interview";
import type { IProject } from "../../../types/project";
import type {
  CreateProjectBody,
  UpdateProjectBody,
} from "../../../validation/project";
import { ProjectError } from "../feature-utils/ProjectError";

export class ProjectService {
  /** Create a project owned by the caller. Owner fields come from server context (§11.7). */
  static async createProject(
    owner: OwnerContext,
    input: CreateProjectBody,
  ): Promise<IProject> {
    return ProjectModel.create(owner, {
      name: input.name,
      description: input.description ?? null,
    });
  }

  /** List the caller's projects, newest first. Owner scope is mandatory (§11.7). */
  static async listProjects(owner: OwnerContext): Promise<IProject[]> {
    return ProjectModel.listForOwner(owner);
  }

  /**
   * Fetch a project the caller owns. Throws NOT_FOUND when the row is absent or
   * owned by someone else — the model's owner scope makes those indistinguishable
   * (§11.7), so we never reveal another owner's project even exists.
   */
  static async getProjectForOwner(
    id: number,
    owner: OwnerContext,
  ): Promise<IProject> {
    const project = await ProjectModel.findByIdForOwner(id, owner);
    if (!project) {
      throw new ProjectError(
        "PROJECT_NOT_FOUND",
        `Project ${id} was not found.`,
        { id },
      );
    }
    return project;
  }

  /**
   * Update a project the caller owns. The model update is itself owner-scoped, so
   * a missing or foreign row simply matches nothing and returns null — surfaced
   * as the same NOT_FOUND a foreign id gets, never leaking another owner's data
   * (§11.7).
   */
  static async updateProject(
    id: number,
    owner: OwnerContext,
    input: UpdateProjectBody,
  ): Promise<IProject> {
    const updated = await ProjectModel.updateForOwner(id, owner, {
      name: input.name,
      description: input.description,
    });
    if (!updated) {
      throw new ProjectError(
        "PROJECT_NOT_FOUND",
        `Project ${id} was not found.`,
        { id },
      );
    }
    return updated;
  }

  /**
   * Delete a project the caller owns, returning its id. Owner-verifies first via
   * getProjectForOwner, which throws NOT_FOUND when missing or another owner's
   * (§11.7) — so a foreign id is indistinguishable from a missing one and never
   * leaks. The model delete then removes the row; project_bits cascade and
   * sessions' project_id is SET NULL by the FKs, so children are reaped by the
   * database — no app-side multi-table delete (§10.5).
   */
  static async deleteProject(
    id: number,
    owner: OwnerContext,
  ): Promise<{ id: number }> {
    await this.getProjectForOwner(id, owner);
    await ProjectModel.deleteForOwner(id, owner);
    return { id };
  }
}
