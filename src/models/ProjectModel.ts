/**
 * ProjectModel — all DB access for projects (§7.4). Every read/write is
 * owner-scoped: owner context is a REQUIRED argument derived from server context,
 * never an optional filter a caller may forget (§11.7, §5.5). A query that could
 * return another owner's project is a data leak. Mirrors InterviewSessionModel.
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type { OwnerContext } from "../types/interview";
import type { IProject } from "../types/project";

export interface CreateProjectInput {
  name: string;
  description?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
}

export class ProjectModel extends BaseModel {
  protected static tableName = "projects";

  /** Insert a project owned by the caller. Owner fields come from server context. */
  static async create(
    owner: OwnerContext,
    input: CreateProjectInput,
    trx?: QueryContext,
  ): Promise<IProject> {
    const [row] = await this.table(trx)
      .insert({
        owner_user_id: owner.ownerUserId,
        organization_id: owner.organizationId,
        name: input.name,
        description: input.description ?? null,
      })
      .returning("*");
    return row as IProject;
  }

  /** List the caller's projects, newest first. Owner scope is mandatory (§11.7). */
  static async listForOwner(
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<IProject[]> {
    const rows = await this.table(trx)
      .where({ owner_user_id: owner.ownerUserId })
      .orderBy("created_at", "desc");
    return rows as IProject[];
  }

  /**
   * Fetch one project by id, scoped to the owner. Returns null when the row does
   * not exist OR belongs to another owner — the caller cannot tell the
   * difference, which is the point (§11.7).
   */
  static async findByIdForOwner(
    id: number,
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<IProject | null> {
    const row = await this.table(trx)
      .where({ id, owner_user_id: owner.ownerUserId })
      .first();
    return (row as IProject | undefined) ?? null;
  }

  /** Update a project's name/description, scoped to the owner. Returns the row or null. */
  static async updateForOwner(
    id: number,
    owner: OwnerContext,
    input: UpdateProjectInput,
    trx?: QueryContext,
  ): Promise<IProject | null> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    const [row] = await this.table(trx)
      .where({ id, owner_user_id: owner.ownerUserId })
      .update(patch)
      .returning("*");
    return (row as IProject | undefined) ?? null;
  }

  /**
   * Delete a project the caller owns; project_bits CASCADE and sessions'
   * project_id is SET NULL (the FKs). Returns the deleted row count (0 when
   * missing or another owner's).
   */
  static async deleteForOwner(
    id: number,
    owner: OwnerContext,
    trx?: QueryContext,
  ): Promise<number> {
    return this.table(trx).where({ id, owner_user_id: owner.ownerUserId }).del();
  }
}
