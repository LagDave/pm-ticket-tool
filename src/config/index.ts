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
  DEFAULT_PORT: 4000,
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
  MODEL: "claude-opus-4-8",
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
  MODEL: "claude-opus-4-8",
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
 * Triage constants (spec 7). One cheap, low-effort structured-output call labels
 * the original request `simple` or `scoped` (spec T1). No magic values in the
 * triage logic (§4.2). LOW effort (like the engine, vs the ticket generator's
 * MEDIUM): classification is a fast yes/no split, not synthesis, so it gets the
 * least reasoning budget. A tight MAX_TOKENS keeps the single call short-lived
 * and cheap (spec Risk: triage adds a call to every request).
 */
export const TRIAGE = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-opus-4-8",
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
  MODEL: "claude-opus-4-8",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Lowest reasoning effort — a title is a cheap label, not synthesis (spec: low effort). */
  EFFORT: "low",
  /** Small bounded output: the model returns a single short title string. */
  MAX_TOKENS: 256,
} as const;

/**
 * Code scout constants (spec 5). The scout is the longest operation in the app
 * (a bounded loop over an external repo), so the caps here are what keep it from
 * running away under a serverless timeout (spec Risk). No magic values in the
 * scout logic (§4.2). MEDIUM effort (like the ticket generator, vs the engine's
 * LOW): summarizing a codebase into coarse "relevant areas" is synthesis, so it
 * gets a touch more reasoning budget — still bounded by MAX_TOKENS.
 *
 * The three hard caps (spec Must: cap tool-calls, files, tokens):
 *  - MAX_SEARCH_CALLS — search queries the scout may issue to the provider.
 *  - MAX_FILES_READ   — files the scout may read from the provider.
 *  - MAX_TOKENS       — output budget on the single summarization call.
 * MAX_FILE_BYTES and MAX_SEARCH_HITS bound each individual provider read so one
 * call cannot pull an unbounded payload.
 */
export const SCOUT = {
  /** Primary model; falls back to FALLBACK_MODEL if the key rejects it. */
  MODEL: "claude-opus-4-8",
  FALLBACK_MODEL: "claude-sonnet-4-6",
  /** Medium effort for the synthesis-into-areas call (spec T4). */
  EFFORT: "medium",
  /** Bounded output so the single summarization call stays short-lived (serverless). */
  MAX_TOKENS: 4_096,
  /** HARD CAP on provider search calls per scan (spec Must: cap tool-calls). */
  MAX_SEARCH_CALLS: 6,
  /** HARD CAP on files read per scan (spec Must: cap files). */
  MAX_FILES_READ: 8,
  /** Per-search-call hit cap so one search can't pull an unbounded list. */
  MAX_SEARCH_HITS: 10,
  /** Per-file byte cap so one read can't pull an unbounded payload. */
  MAX_FILE_BYTES: 50_000,
  /** Most relevant areas the scout returns — keeps findings coarse (spec Risk). */
  MAX_AREAS: 6,
} as const;

/**
 * Code-scout background-job constants (deploy spec runtime Option C, §21). The
 * scout runs as a queued DB job, not inline in the request: the POST enqueues a
 * scout_jobs row and a processor (Vercel Cron in prod, `npm run scout:work`
 * locally) claims and runs it. No magic values in the job/processor logic (§4.2).
 */
export const SCOUT_JOB = {
  /**
   * Bounded retries before a job is dead-lettered (§21.2). attempts is counted at
   * claim time; on reaching this cap the job's terminal state is `failed`
   * (dead-letter, held for inspection — never silently dropped). 3 attempts ride
   * out transient provider/model blips without retrying a genuinely broken scan
   * forever.
   */
  MAX_ATTEMPTS: 3,
  /**
   * The shared-secret header name the internal processor trigger checks (§5.4).
   * Vercel Cron sends this header; an unauthenticated caller is rejected so the
   * processor is not a public endpoint. Named, not magic (§4.2).
   */
  TRIGGER_HEADER: "x-scout-worker-secret",
  /** Poll interval (ms) for the local `scout:work` dev loop between empty passes. */
  LOCAL_POLL_INTERVAL_MS: 2_000,
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
   * Run the scout queue worker IN-PROCESS on server startup (deploy spec Rev 2,
   * Railway single service, §21). On Railway there is no cron, so the long-running
   * web process drains the scout_jobs queue itself via ScoutJobProcessor — the
   * same processor the Vercel cron path used, called directly, not over HTTP. A
   * scout failure can never bring down the web server (the processor never throws
   * to its caller, §21.4). Defaults to ON in production and OFF otherwise; force
   * with "true"/"false". Local dev keeps using `npm run scout:work` instead.
   */
  RUN_SCOUT_WORKER: z
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
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /**
   * Server-side only — never exposed to the browser (§5.1, §17.3). Empty in
   * foundation; the orchestrator injects the real value for later specs.
   */
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  /**
   * Optional GitHub token for the code scout's GitHub provider (spec 5). Server-
   * side only — never shipped in the frontend bundle (§5.1, §17.3) and never
   * logged (§5.3). The GitHub REST API works UNAUTHENTICATED on public repos, so
   * a public-repo scan needs no token; a token is required only for private repos
   * or higher rate limits. Optional + empty default so the server boots without
   * it; the provider sends it as a Bearer header only when present.
   */
  GITHUB_TOKEN: z.string().optional().default(""),
  /**
   * Shared secret guarding the internal scout-processor trigger (§5.4). Vercel
   * Cron sends it as a header; the endpoint rejects callers that do not present
   * it, so the processor is never publicly invokable. Server-side only — never in
   * the frontend bundle (§5.1, §17.3) and never logged (§5.3). Optional + empty
   * default so the server boots without it (the processor is then trigger-locked
   * and runs only via the in-process local worker); set it in any environment
   * that exposes the HTTP trigger.
   */
  SCOUT_WORKER_SECRET: z.string().optional().default(""),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  databaseSslRejectUnauthorized: boolean;
  databasePoolMode: "serverless" | "persistent";
  serveStatic: boolean;
  runScoutWorker: boolean;
  corsOrigins: string[];
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  anthropicApiKey: string;
  githubToken: string;
  scoutWorkerSecret: string;
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
  // Both Railway-runtime flags default ON in production and OFF elsewhere, but an
  // explicit env value always wins (env-driven, never hardcoded per environment).
  const isProduction = env.NODE_ENV === "production";
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL,
    databaseSslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    databasePoolMode: env.DATABASE_POOL_MODE,
    serveStatic: env.SERVE_STATIC ?? isProduction,
    runScoutWorker: env.RUN_SCOUT_WORKER ?? isProduction,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    logLevel: env.LOG_LEVEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    githubToken: env.GITHUB_TOKEN,
    scoutWorkerSecret: env.SCOUT_WORKER_SECRET,
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

/**
 * Return the optional GitHub token, or null when unset (spec 5). Unlike the
 * Anthropic key, this does NOT fail fast: the GitHub REST API works
 * unauthenticated on public repos, so an empty token is a valid configuration
 * (public-repo scan). The provider sends a Bearer header only when this returns
 * a non-null value; a private-repo or rate-limited scan that needs a token will
 * surface a typed auth/rate-limit error from the provider instead. Server-side
 * only; never exposed to the frontend (§5.1, §17.3) and never logged (§5.3).
 */
export function getGitHubToken(): string | null {
  return config.githubToken ? config.githubToken : null;
}

/**
 * Return the scout-processor trigger secret, or null when unset (§5.4). When
 * null, the internal HTTP trigger refuses every caller (fail closed) — the
 * processor is then reachable only via the in-process local worker
 * (`npm run scout:work`) or direct invocation in tests, never over HTTP. When
 * set, the trigger requires an exact header match. Server-side only; never
 * exposed to the frontend (§5.1, §17.3) and never logged (§5.3).
 */
export function getScoutWorkerSecret(): string | null {
  return config.scoutWorkerSecret ? config.scoutWorkerSecret : null;
}
