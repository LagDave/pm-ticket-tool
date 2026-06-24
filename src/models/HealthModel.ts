/**
 * HealthModel — the DB-ping query lives here, not in the controller/service
 * (§7.4). Layering applies even to /health (§7.1). Uses a trivial parameterized
 * round-trip to prove the pool answers.
 */
import { db } from "../database/connection";

export class HealthModel {
  /** Round-trip the pool. Throws if the DB is unreachable. */
  static async ping(): Promise<boolean> {
    const result = await db.raw("SELECT 1 AS ok");
    // pg returns { rows: [{ ok: 1 }] }
    const rows = (result as { rows?: Array<{ ok: number }> }).rows ?? [];
    return rows.length > 0 && rows[0].ok === 1;
  }
}
