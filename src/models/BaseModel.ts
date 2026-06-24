/**
 * BaseModel — shared base for all models. Centralizes the table accessor over
 * the single Knex pool (§10.6) and JSON-field (de)serialization, mirroring the
 * gbp-automation model skeleton (§6.1). ALL DB access lives in subclasses of
 * this (§7.4); nothing outside models/ touches `db`.
 */
import type { Knex } from "knex";
import { db } from "../database/connection";

/** A Knex transaction or the base connection — passed through to scope writes. */
export type QueryContext = Knex.Transaction | Knex;

export abstract class BaseModel {
  /** Subclasses set their table name. */
  protected static tableName: string;

  /** JSON/JSONB columns that need parse-on-read. Override per model. */
  protected static jsonFields: string[] = [];

  /** Query builder bound to this model's table, optionally inside a trx. */
  protected static table(trx?: QueryContext): Knex.QueryBuilder {
    const conn = trx ?? db;
    return conn(this.tableName);
  }

  /**
   * Run a function inside a single DB transaction (§10.5). Keeps the `db`
   * handle inside models/ (§7.4): services compose multi-table writes by
   * passing the provided trx to each model call, never opening a trx themselves.
   * Rolls back automatically if the callback throws.
   */
  static runTransaction<T>(
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(work);
  }

  /**
   * pg returns JSONB already parsed, but a string can arrive when a column is
   * cast to text or hydrated from a raw query. Normalize defensively so callers
   * always get a value, never a JSON string.
   */
  protected static deserializeJsonFields<T extends Record<string, unknown>>(
    row: T,
  ): T {
    if (!row) return row;
    const out: Record<string, unknown> = { ...row };
    for (const field of this.jsonFields) {
      const value = out[field];
      if (typeof value === "string") {
        try {
          out[field] = JSON.parse(value);
        } catch {
          // Leave the raw string if it is not valid JSON — never throw on read.
        }
      }
    }
    return out as T;
  }

  /** Serialize JSON fields for write (Knex/pg accept objects for jsonb, but be explicit). */
  protected static serializeJsonFields<T extends Record<string, unknown>>(
    data: T,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    for (const field of this.jsonFields) {
      if (field in out && out[field] !== null && out[field] !== undefined) {
        out[field] = JSON.stringify(out[field]);
      }
    }
    return out;
  }
}
