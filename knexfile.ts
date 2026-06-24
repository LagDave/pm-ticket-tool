/**
 * Knex CLI config. Defers to the central connection config (§10.6) so the CLI
 * (migrate:latest / rollback) and the app share one source of truth. All
 * environments resolve from DATABASE_URL via src/config.
 */
import type { Knex } from "knex";
import { knexConfig } from "./src/database/connection";

const config: Record<string, Knex.Config> = {
  development: knexConfig,
  test: knexConfig,
  production: knexConfig,
};

export default config;
