/**
 * Vitest global setup. Applies migrations once against the (Docker) test DB so
 * every suite runs on a real schema, then tears the pool down. Synthetic data
 * only — never production data or real PII (§20.4).
 */
import { db } from "../database/connection";

export async function setup(): Promise<void> {
  await db.migrate.latest();
}

export async function teardown(): Promise<void> {
  await db.destroy();
}
