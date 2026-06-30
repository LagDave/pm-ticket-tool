/**
 * App configuration — the ONLY place env vars are read (§5.1) and named
 * constants live (§4.2). Required config is validated at startup and the
 * process fails fast with a clear message (§5.6); never discover a missing
 * value at request time.
 */
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/** Named constants — no magic values scattered through the code (§4.2). */
export const APP_CONSTANTS = {
  DEFAULT_PORT: 4222,
  /**
   * Knex pool bounds for a LONG-RUNNING process (local dev, a dedicated Node
   * host), managed centrally (§10.6). A persistent process can hold a warm pool.
   */
  DB_POOL_MIN: 2,
  DB_POOL_MAX: 10,
  /**
   * Knex pool bounds for a SERVERLESS process (Vercel functions on Neon). Each
   * concurrently-warm function instance owns its own pool, so the bounds must be
   * tiny or many instances exhaust Neon's connection limit (deploy spec Risk:
   * "Neon serverless connection exhaustion", §10.6). min 0 means an idle instance
   * holds no connection; max 1 caps each instance to a single pooled connection.
   * Neon's own PgBouncer pooler multiplexes these onto far fewer Postgres
   * backends, so the pooled connection string is mandatory (deploy spec §10.6).
   */
  DB_POOL_MIN_SERVERLESS: 0,
  DB_POOL_MAX_SERVERLESS: 1,
  /**
   * Reap idle serverless connections quickly so a frozen/torn-down function does
   * not leave a connection lingering against Neon (ms).
   */
  DB_POOL_IDLE_TIMEOUT_MS: 10_000,
  /** Acquire-connection timeout (ms) so a dead DB fails fast rather than hanging. */
  DB_ACQUIRE_TIMEOUT_MS: 10_000,
  /**
   * Bind host for the HTTP server. 0.0.0.0 so a container platform (Railway)
   * can route external traffic to the process; localhost-only binding would make
   * the service unreachable behind Railway's proxy. Named, not magic (§4.2).
   */
  BIND_HOST: "0.0.0.0",
} as const;

/**
 * Interview engine constants (spec 2). No magic values in the engine logic
 * (§4.2). The model id and reasoning effort are named here, not inlined in the
 * agent. `MAX_ROUNDS` is the hard cap that — together with the materiality gate
 * — kills the "interview goes on and on" failure mode (spec Risk).
 */
export const INTERVIEW_ENGINE = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-sonnet-4-6",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Low reasoning effort on generation calls to control cost (spec Constraints). */
  EFFORT: "low",
  /** Bounded output so a single batch call stays short-lived (serverless, spec Risk). */
  MAX_TOKENS: 4_096,
  /** At most four dependency-ordered questions per batch (spec What). */
  MAX_QUESTIONS_PER_BATCH: 4,
  /** Hard cap on generated batches; the gate may terminate earlier (§4.2). */
  MAX_ROUNDS: 5,
} as const;

/**
 * Ticket generation constants (spec 3). One bounded structured-output call turns
 * a session's decision_record + original_request into a ticket. No magic values
 * in the generation logic (§4.2). MEDIUM effort (vs the engine's LOW): synthesis
 * into a coherent story + Given/When/Then is more structurally demanding than
 * emitting questions, so it gets a touch more reasoning budget — still bounded.
 */
export const TICKET_GENERATION = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-sonnet-4-6",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Medium reasoning effort for the synthesis call (spec T1). */
  EFFORT: "medium",
  /**
   * Bounded output so a single generation call stays short-lived (serverless).
   * Raised for the enriched ticket (problem, key decisions, open questions,
   * metrics, dependencies, grounding on top of the core fields) — spec What.
   */
  MAX_TOKENS: 8_192,
} as const;

/**
 * Bit reconciliation constants (spec project-context-bits, T8). One bounded
 * structured-output call decides, for each incoming candidate bit, whether to
 * insert / update(merge) / skip_duplicate / conflict / similar against the
 * project's existing ACTIVE bits AND the other candidates in the same batch. No
 * magic values in the reconciliation logic (§4.2). MEDIUM effort (like the ticket
 * generator, vs the engine/triage's LOW): semantic dedup-and-merge across two sets
 * of bits is synthesis, not a cheap yes/no split, so it gets a touch more
 * reasoning budget — still bounded by MAX_TOKENS so the single call stays
 * short-lived under a serverless timeout (spec Risk R5).
 *
 * The two input caps mirror validation/projectBit.ts so the agent and the import
 * boundary share one source of truth (§4.2): MAX_BITS_PER_IMPORT bounds how many
 * candidates one call may reconcile, MAX_SUMMARY_CHARS bounds a single summary so
 * a runaway row cannot blow the prompt.
 */
export const BIT_RECONCILIATION = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-sonnet-4-6",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Medium reasoning effort for the dedup/merge synthesis call (spec T8). */
  EFFORT: "medium",
  /** Bounded output so a single reconciliation call stays short-lived (serverless). */
  MAX_TOKENS: 4_096,
  /** HARD CAP on candidates one reconciliation call may take (mirrors the import cap, §4.2). */
  MAX_BITS_PER_IMPORT: 200,
  /** Per-summary char cap so one runaway row cannot blow the prompt (mirrors the validation cap). */
  MAX_SUMMARY_CHARS: 2_000,
} as const;

/**
 * Bit proposal constants (spec project-context-bits, T13 — merge-on-complete).
 * One bounded structured-output call turns a FINALIZED ticket (its user story,
 * acceptance criteria, context summary, effort tier, and the session's settled
 * decisions) into 1-4 CANDIDATE bits capturing the durable facts the completed
 * feature establishes about the app. No magic values in the proposal logic
 * (§4.2). MEDIUM effort (like the ticket generator + the reconciler, vs the
 * engine/triage's LOW): distilling a whole ticket down to a few durable,
 * correctly-kinded project facts is synthesis, not a cheap split, so it gets a
 * touch more reasoning budget — still bounded by MAX_TOKENS so the single call
 * stays short-lived under a serverless timeout. The candidates are then run
 * through BitReconciliationService (the agent proposes; the human disposes), so
 * a loose proposal is never silently applied (spec R2).
 */
export const BIT_PROPOSAL = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-sonnet-4-6",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Medium reasoning effort for the ticket-to-bits synthesis call (spec T13). */
  EFFORT: "medium",
  /** Bounded output so a single proposal call stays short-lived (serverless). */
  MAX_TOKENS: 2_048,
} as const;

/**
 * Triage constants (spec 7). One cheap, low-effort structured-output call labels
 * the original request `simple` or `scoped` (spec T1). No magic values in the
 * triage logic (§4.2). LOW effort (like the engine, vs the ticket generator's
 * MEDIUM): classification is a fast yes/no split, not synthesis, so it gets the
 * least reasoning budget. A tight MAX_TOKENS keeps the single call short-lived
 * and cheap (spec Risk: triage adds a call to every request).
 */
export const TRIAGE = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-sonnet-4-6",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Lowest reasoning effort — triage is a cheap split, not synthesis (spec Constraints). */
  EFFORT: "low",
  /** Small bounded output: the classifier returns a label + one short reason. */
  MAX_TOKENS: 512,
} as const;

/**
 * Title generation constants (User QA: auto-generated session title). One cheap,
 * low-effort structured-output call turns either the original request (at session
 * create) or the finalized ticket (after finalize) into a concise display title.
 * No magic values in the title logic (§4.2). LOW effort (like triage, vs the
 * ticket generator's MEDIUM): a title is a short label, not synthesis, so it gets
 * the least reasoning budget — keeping session create fast and the call cheap. A
 * tight MAX_TOKENS keeps the single call short-lived; a title is a few words.
 */
export const TITLE_GENERATION = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-sonnet-4-6",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Lowest reasoning effort — a title is a cheap label, not synthesis (spec: low effort). */
  EFFORT: "low",
  /** Small bounded output: the model returns a single short title string. */
  MAX_TOKENS: 256,
} as const;

/**
 * Schema for required + optional environment. `DATABASE_URL` is generic so the
 * same code targets local Docker Postgres and Neon's pooled, SSL connection
 * string in prod (foundation spec Rev 1). SSL is opt-in via DATABASE_SSL.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(APP_CONSTANTS.DEFAULT_PORT),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/db)"),
  /** "true" enables TLS for the DB connection (Neon prod); off locally. */
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Knex pool sizing profile (§10.6). "serverless" uses tiny bounds (min 0, max 1)
   * so many concurrently-warm Vercel function instances do not exhaust Neon's
   * connection limit (deploy spec Risk); "persistent" uses the warm bounds for a
   * long-running process (local dev / a dedicated Node host). Defaults to
   * "persistent" so local dev and a classic Node deploy are unchanged; set it to
   * "serverless" in the Vercel env. Env-driven — never hardcoded per environment.
   */
  DATABASE_POOL_MODE: z.enum(["serverless", "persistent"]).default("persistent"),
  /**
   * Serve the built SPA (frontend/dist) from Express as static assets with a
   * client-routing catch-all (deploy spec Rev 2, Railway single service). On a
   * single Railway service one Express process serves the API AND the SPA from
   * one origin; in local dev the Vite dev server owns the SPA, so this stays off.
   * Defaults to ON in production and OFF otherwise (env-driven, never hardcoded
   * per environment) and can be forced either way with "true"/"false".
   */
  SERVE_STATIC: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === "true",
    ),
  /**
   * Verify the DB server certificate (§5.4). Defaults to "true" — never weaken
   * TLS silently. Set to "false" ONLY when a provider serves a cert the default
   * CA bundle can't chain (some managed Postgres poolers) and you accept the
   * MITM tradeoff for that environment.
   */
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Comma-separated allowed origins for CORS (§11.4). No wildcard in prod. */
  CORS_ORIGINS: z.string().default("http://localhost:4221"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /**
   * Server-side only — never exposed to the browser (§5.1, §17.3). Empty in
   * foundation; the orchestrator injects the real value for later specs.
   */
  ANTHROPIC_API_KEY: z.string().optional().default(""),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  databaseSslRejectUnauthorized: boolean;
  databasePoolMode: "serverless" | "persistent";
  serveStatic: boolean;
  corsOrigins: string[];
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  anthropicApiKey: string;
};

/**
 * Parse and validate the environment once. Throws a single readable error
 * listing every missing/invalid variable so startup fails fast (§5.6).
 */
function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Fix these before starting:\n${issues}`,
    );
  }

  const env = parsed.data;
  // serveStatic defaults ON in production and OFF elsewhere, but an explicit env
  // value always wins (env-driven, never hardcoded per environment).
  const isProduction = env.NODE_ENV === "production";
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL,
    databaseSslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    databasePoolMode: env.DATABASE_POOL_MODE,
    serveStatic: env.SERVE_STATIC ?? isProduction,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    logLevel: env.LOG_LEVEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
  };
}

export const config: AppConfig = loadConfig();

/**
 * Return the Anthropic API key or throw a clear error (§5.6). The key is
 * optional in the base schema so the server boots without it (foundation),
 * but the interview engine cannot run without it — this turns a missing key
 * into a fail-fast at the seam, never a confusing request-time SDK error.
 * Server-side only; never exposed to the frontend (§5.1, §17.3).
 */
export function requireAnthropicApiKey(): string {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for the interview engine but is not set. " +
        "Add it to the server environment (.env). It is server-side only and " +
        "must never be exposed to the frontend.",
    );
  }
  return config.anthropicApiKey;
}
