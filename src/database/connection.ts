/**
 * Central Knex connection — the ONE place a pool is created (§10.6). Reads a
 * generic DATABASE_URL so the same code targets local Docker Postgres and
 * Neon's pooled, SSL connection string in prod (foundation spec Rev 1). Never
 * open/close connections per query; import `db` everywhere a query runs (which
 * is only `models/`, §7.4).
 */
import path from "path";
import knex, { Knex } from "knex";
import pg from "pg";
import { config, APP_CONSTANTS } from "../config";

/**
 * pg returns BIGINT (type OID 20) as a string by default to avoid precision
 * loss. Our ids and owner_user_id are typed as `number` and compared with ===
 * for owner scope (§11.7) — a string/number mismatch silently breaks isolation.
 * Parse BIGINT as a JS number; our id ranges stay well under MAX_SAFE_INTEGER.
 */
const PG_BIGINT_OID = 20;
pg.types.setTypeParser(PG_BIGINT_OID, (value: string) => parseInt(value, 10));

/**
 * True when running from the compiled build (dist/…/*.js) rather than from
 * source via tsx (src/…/*.ts). `__filename` is set by both the CJS runtime and
 * tsx, so its extension tells us which migration files exist on disk: `.js`
 * after `npm run build`, `.ts` in dev. This is what lets `migrate:deploy` find
 * the compiled migrations in the Vercel/production context (deploy spec §10.3).
 */
const isCompiled = __filename.endsWith(".js");

/**
 * Pool sizing follows the configured mode (§10.6). Serverless (Vercel on Neon)
 * gets tiny bounds so many warm function instances cannot exhaust Neon's
 * connection limit; a persistent process keeps a warm pool. Driven by env
 * (DATABASE_POOL_MODE), never hardcoded per environment.
 */
const isServerless = config.databasePoolMode === "serverless";
const poolConfig: Knex.PoolConfig = isServerless
  ? {
      min: APP_CONSTANTS.DB_POOL_MIN_SERVERLESS,
      max: APP_CONSTANTS.DB_POOL_MAX_SERVERLESS,
      idleTimeoutMillis: APP_CONSTANTS.DB_POOL_IDLE_TIMEOUT_MS,
      acquireTimeoutMillis: APP_CONSTANTS.DB_ACQUIRE_TIMEOUT_MS,
    }
  : {
      min: APP_CONSTANTS.DB_POOL_MIN,
      max: APP_CONSTANTS.DB_POOL_MAX,
      acquireTimeoutMillis: APP_CONSTANTS.DB_ACQUIRE_TIMEOUT_MS,
    };

export const knexConfig: Knex.Config = {
  client: "pg",
  connection: {
    connectionString: config.databaseUrl,
    // TLS for managed Postgres (Neon) in prod; disabled locally (§5.6 flag).
    // Certificate verification stays ON by default (§5.4) and is only relaxed
    // behind an explicit env flag for providers whose cert can't chain.
    ssl: config.databaseSsl
      ? { rejectUnauthorized: config.databaseSslRejectUnauthorized }
      : false,
  },
  pool: poolConfig,
  migrations: {
    // Resolve relative to THIS file so the runner finds migrations whether it
    // runs from src/ (tsx, dev) or dist/ (compiled, prod) — never a cwd-relative
    // path that breaks under Vercel (deploy spec §10.3). Extension matches the
    // files that actually exist in each context: .js compiled, .ts in dev.
    directory: path.join(__dirname, "migrations"),
    extension: isCompiled ? "js" : "ts",
    loadExtensions: isCompiled ? [".js"] : [".ts"],
    tableName: "knex_migrations",
  },
};

/** The shared connection pool. Single instance for the whole process. */
export const db: Knex = knex(knexConfig);
