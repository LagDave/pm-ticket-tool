/**
 * ScoutCacheModel — all DB access for scout_cache (§7.4). Stores the scout's
 * structured findings per session so the scout runs ONCE and is read-through
 * thereafter (spec T3). Reached through an owner-verified session (§11.7): the
 * service owner-verifies the session via InterviewSessionModel before calling
 * here, so every read/write is scoped by a session_id the caller has already
 * been proven to own — scout_cache has no direct owner column, like
 * decision_record and interview_turns.
 *
 * `findings` is the structured ScoutFindings object (JSONB) — declared as a JSON
 * field so it round-trips through BaseModel's (de)serialization.
 */
import { BaseModel, QueryContext } from "./BaseModel";
import type {
  CodeContextProviderId,
  IScoutCache,
  ScoutFindings,
} from "../types/codeScout";

export interface CreateScoutCacheInput {
  sessionId: number;
  provider: CodeContextProviderId;
  repoRef: string;
  findings: ScoutFindings;
}

export class ScoutCacheModel extends BaseModel {
  protected static tableName = "scout_cache";
  protected static jsonFields = ["findings"];

  /**
   * The cached scout result for a session, or null on a cache miss. Returns the
   * NEWEST row (a re-point to a different repo appends a new row), so the latest
   * scan wins. Filtered by session_id, which the caller has owner-verified
   * (§11.7); covered by the session_id index (§10.4).
   */
  static async findBySession(
    sessionId: number,
    trx?: QueryContext,
  ): Promise<IScoutCache | null> {
    const row = await this.table(trx)
      .where({ session_id: sessionId })
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .first();
    if (!row) return null;
    return this.deserializeJsonFields(
      row as Record<string, unknown>,
    ) as unknown as IScoutCache;
  }

  /**
   * Insert one cached scout result for a session (the scout's write-once after a
   * scan). The session_id is owner-verified by the caller before this runs
   * (§11.7); provider is constrained to the locked set by the DB CHECK.
   */
  static async create(
    input: CreateScoutCacheInput,
    trx?: QueryContext,
  ): Promise<IScoutCache> {
    const [row] = await this.table(trx)
      .insert(
        this.serializeJsonFields({
          session_id: input.sessionId,
          provider: input.provider,
          repo_ref: input.repoRef,
          findings: input.findings,
        }),
      )
      .returning("*");
    return this.deserializeJsonFields(
      row as Record<string, unknown>,
    ) as unknown as IScoutCache;
  }
}
