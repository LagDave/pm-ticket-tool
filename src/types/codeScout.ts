/**
 * Shared backend domain types for the code scout (spec 5). The scout reads a
 * repo for ORIENTATION ONLY — coarse "relevant areas / what exists / rough size
 * / what it touches" plus feasibility and effort hints — never code-level or
 * file-level implementation steps (spec Must Not). Every finding set carries a
 * "verify with engineering" framing so it is never mistaken for certainty
 * (§3.4). JSON columns stay structured, never `any` (§4.5).
 *
 * These types are SOURCE-AGNOSTIC: nothing GitHub- or Azure-specific leaks in,
 * so the CodeContextProvider seam (CodeContextProvider.ts) keeps Azure pluggable
 * later without touching the scout (spec Constraints).
 */

/** The repo-context sources the scout can point at. GitHub now; Azure later. */
export type CodeContextProviderId = "github" | "azure";

/**
 * A source-agnostic reference to the repo a session's scout scanned (spec T5).
 * The provider id selects the implementation; `repoRef` is the provider's own
 * identifier for the repo (for GitHub: `owner/name`). Persisted with the cached
 * findings so the row records which repo it came from (spec Pushback).
 */
export interface RepoRef {
  provider: CodeContextProviderId;
  /** Provider-native repo identifier, e.g. "facebook/react" for GitHub. */
  repoRef: string;
}

/**
 * A coarse effort/feasibility tier — never a count of hours (mirrors the
 * ticket effort tier in types/interview.ts). LLM hour estimates are unreliable,
 * so the scout only commits to a tier and the result is tagged "verify".
 */
export type EffortHint = "XS" | "S" | "M" | "L" | "XL";

/** How confident the scout is that an area is actually relevant (orientation only). */
export type FeasibilityHint = "clear" | "likely" | "uncertain";

/**
 * One relevant area the scout surfaced. Coarse by design (spec Risk: keep
 * findings coarse, not file-level claims): an area names a part of the codebase,
 * says what already exists there, roughly how big touching it looks, and what
 * else it touches. `paths` are illustrative pointers (a few files the search
 * matched), NOT an implementation checklist.
 */
export interface RelevantArea {
  /** Short label for the area, e.g. "Authentication". */
  area: string;
  /** What already exists here, in orientation terms (no code-level steps). */
  whatExists: string;
  /** Rough size of working in this area, as a coarse tier. */
  roughSize: EffortHint;
  /** What this area touches — adjacent areas, integrations, data. */
  whatItTouches: string[];
  /** How confident the scout is the area is relevant. */
  feasibility: FeasibilityHint;
  /** A few illustrative file paths the search matched — pointers, not a plan. */
  paths: string[];
}

/**
 * The structured findings the scout returns and caches (spec T4). Orientation
 * only: a short summary, the few relevant areas, and an explicit
 * `verifyWithEngineering` flag that is ALWAYS true — the framing is structural,
 * not optional, so the UI can never present findings as certain (spec Risk,
 * §3.4).
 */
export interface ScoutFindings {
  /** One short paragraph orienting the PM to the relevant parts of the codebase. */
  summary: string;
  /** The few relevant areas (bounded — see SCOUT.MAX_AREAS). */
  relevantAreas: RelevantArea[];
  /**
   * Always true: findings are orientation, to be verified with engineering, never
   * an engineering plan (spec Must / Risk). Structural, not a model choice.
   */
  verifyWithEngineering: true;
}

/** A row of scout_cache. `findings` is the structured ScoutFindings JSONB. */
export interface IScoutCache {
  id: number;
  session_id: number;
  provider: CodeContextProviderId;
  repo_ref: string;
  findings: ScoutFindings;
  created_at: Date;
}

/**
 * The scout result the controller returns to the client (spec T4). Carries the
 * findings plus the repo they came from and whether this call read the cache or
 * ran a fresh scan — so a re-trigger can show "cached" without a second scan.
 */
export interface ScoutResult {
  sessionId: number;
  provider: CodeContextProviderId;
  repoRef: string;
  findings: ScoutFindings;
  /** True when this response came from scout_cache (no re-scan); false on a fresh scan. */
  cached: boolean;
}

/* ------------------------------------------------------------------------- *
 * Background-job queue (deploy spec runtime Option C — §21)
 * ------------------------------------------------------------------------- */

/**
 * The lifecycle states of a scout job (scout_jobs.status, §21). `failed` is the
 * dead-letter terminal state — a job that exhausts its bounded retries lands
 * here for inspection, never silently dropped (§21.2). Mirrors the DB CHECK in
 * the scout_jobs migration.
 */
export type ScoutJobStatus = "pending" | "running" | "done" | "failed";

/**
 * A row of scout_jobs — the durable work item that backs the scout as a
 * background job. The POST enqueues one (`pending`); a processor claims it
 * (`running`), runs the bounded scan through CodeScoutService, and marks it
 * `done`, or increments `attempts` and re-queues / dead-letters on failure
 * (§21.1–§21.2). Reached through an owner-verified session_id (§11.7).
 */
export interface IScoutJob {
  id: number;
  session_id: number;
  provider: CodeContextProviderId;
  repo_ref: string;
  status: ScoutJobStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * What the enqueue endpoint returns (HTTP 202). The job id lets the client poll
 * the status endpoint; `status` is the just-enqueued state. `alreadyComplete` is
 * true when the scan's findings are ALREADY cached for the session — the
 * enqueue short-circuits (idempotent, §21.1) and no job is created, so the
 * client can skip polling.
 */
export interface ScoutEnqueueResult {
  sessionId: number;
  jobId: number | null;
  status: ScoutJobStatus;
  provider: CodeContextProviderId;
  repoRef: string;
  /** True when findings already existed (no job enqueued; poll-free). */
  alreadyComplete: boolean;
}

/**
 * What the status endpoint returns. `status` is the latest job's state (or
 * `done` when findings are already cached with no tracked job). `findings` is
 * present only once the scan has completed; absent while pending/running/failed,
 * which is the signal callers (and spec 6) use to fall back to ungrounded
 * generation until the scan lands.
 */
export interface ScoutStatusResult {
  sessionId: number;
  status: ScoutJobStatus;
  provider: CodeContextProviderId | null;
  repoRef: string | null;
  attempts: number;
  lastError: string | null;
  /** The cached findings, present only when the scan has completed. */
  findings?: ScoutFindings;
}

/**
 * The outcome of a single processor pass over the queue. Returned by the
 * processor so the internal trigger endpoint and the local `scout:work` loop can
 * report what happened without leaking internals (§3.4).
 */
export interface ScoutJobProcessResult {
  /** True when a pending job was claimed and processed this pass; false when the queue was empty. */
  processed: boolean;
  jobId: number | null;
  sessionId: number | null;
  /** The job's state after this pass (done | failed | running on a transient re-queue), or null when idle. */
  outcome: ScoutJobStatus | null;
}
