/**
 * ProjectBitModel — all DB access for project_bits (§7.4). Bits are reached
 * through an owner-verified project: the service calls ProjectModel.findByIdForOwner
 * first, so these methods take project_id rather than owner — mirroring how
 * InterviewTurnModel / DecisionRecordModel are scoped via an owner-verified session
 * (§11.7). A bit query is therefore only ever issued for a project the caller owns.
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type { BitKind, BitSource, IProjectBit } from "../types/project";

export interface CreateProjectBitInput {
  projectId: number;
  kind: BitKind;
  bitKey: string;
  summary: string;
  /** Defaults to "manual"; "imported"/"merged" set by the import / merge paths. */
  source?: BitSource;
  /** Provenance for merge-on-complete bits; null otherwise. */
  sourceTicketId?: number | null;
}

export interface UpdateProjectBitInput {
  kind?: BitKind;
  bitKey?: string;
  summary?: string;
}

export class ProjectBitModel extends BaseModel {
  protected static tableName = "project_bits";

  /** Map a create input to its DB row shape (defaults applied). */
  private static toRow(input: CreateProjectBitInput): Record<string, unknown> {
    return {
      project_id: input.projectId,
      kind: input.kind,
      bit_key: input.bitKey,
      summary: input.summary,
      source: input.source ?? "manual",
      source_ticket_id: input.sourceTicketId ?? null,
    };
  }

  /** All bits for a project, newest first — the management list (idx project_id). */
  static async listByProject(
    projectId: number,
    trx?: QueryContext,
  ): Promise<IProjectBit[]> {
    const rows = await this.table(trx)
      .where({ project_id: projectId })
      .orderBy("created_at", "desc");
    return rows as IProjectBit[];
  }

  /**
   * Active bits for a project — the grounding + reconciliation read path. Covered
   * by the (project_id, status) index (§10.4). Ordered by kind then age so the
   * rendered prompt block is stable (cache-friendly, spec R4).
   */
  static async listActiveByProject(
    projectId: number,
    trx?: QueryContext,
  ): Promise<IProjectBit[]> {
    const rows = await this.table(trx)
      .where({ project_id: projectId, status: "active" })
      .orderBy("kind")
      .orderBy("created_at");
    return rows as IProjectBit[];
  }

  /** Fetch one bit scoped to its project. Null when missing or in another project. */
  static async findByIdInProject(
    id: number,
    projectId: number,
    trx?: QueryContext,
  ): Promise<IProjectBit | null> {
    const row = await this.table(trx).where({ id, project_id: projectId }).first();
    return (row as IProjectBit | undefined) ?? null;
  }

  /** Insert one bit. */
  static async create(
    input: CreateProjectBitInput,
    trx?: QueryContext,
  ): Promise<IProjectBit> {
    const [row] = await this.table(trx).insert(this.toRow(input)).returning("*");
    return row as IProjectBit;
  }

  /** Bulk insert (import / merge apply); run inside the caller's transaction (§10.5). */
  static async createMany(
    inputs: CreateProjectBitInput[],
    trx?: QueryContext,
  ): Promise<IProjectBit[]> {
    if (inputs.length === 0) return [];
    const rows = await this.table(trx)
      .insert(inputs.map((input) => this.toRow(input)))
      .returning("*");
    return rows as IProjectBit[];
  }

  /** Update a bit's fields, scoped to its project. Returns the row or null. */
  static async update(
    id: number,
    projectId: number,
    input: UpdateProjectBitInput,
    trx?: QueryContext,
  ): Promise<IProjectBit | null> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.bitKey !== undefined) patch.bit_key = input.bitKey;
    if (input.summary !== undefined) patch.summary = input.summary;
    const [row] = await this.table(trx)
      .where({ id, project_id: projectId })
      .update(patch)
      .returning("*");
    return (row as IProjectBit | undefined) ?? null;
  }

  /**
   * Mark a bit superseded (the audit-preserving alternative to delete used when a
   * reconciliation `update`/merge replaces it, spec R2). Returns the row or null.
   */
  static async supersede(
    id: number,
    projectId: number,
    trx?: QueryContext,
  ): Promise<IProjectBit | null> {
    const [row] = await this.table(trx)
      .where({ id, project_id: projectId })
      .update({ status: "superseded", updated_at: new Date() })
      .returning("*");
    return (row as IProjectBit | undefined) ?? null;
  }

  /** Hard-delete a bit, scoped to its project. Returns the deleted row count. */
  static async delete(
    id: number,
    projectId: number,
    trx?: QueryContext,
  ): Promise<number> {
    return this.table(trx).where({ id, project_id: projectId }).del();
  }
}
