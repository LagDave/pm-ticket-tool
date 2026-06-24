/**
 * Shared frontend domain types for the interview/session API. Mirrors the
 * backend row shapes; no `any` (§17.2).
 */

export type SessionStatus =
  | "draft"
  | "in_progress"
  | "awaiting_input"
  | "complete"
  | "archived";

/**
 * The two-speed triage label (spec 7). `simple` → a draft ticket; `scoped` →
 * the full interview. Mirrors the backend TriageResult; no `any` (§17.2).
 */
export type TriageResult = "simple" | "scoped";

/** Which path the wizard takes after triage: ticket-draft vs interview (spec 7). */
export type TriageRoute = "ticket" | "interview";

/** A session as returned by the API. */
export interface InterviewSession {
  id: number;
  owner_user_id: number;
  organization_id: number | null;
  status: SessionStatus;
  original_request: string;
  /**
   * Concise generated display title for the dashboard (User QA: auto-generated
   * session title). Generated from original_request at create and replaced from
   * the finalized ticket after finalize. Null until generated, or if generation
   * failed - the UI then falls back to the request snippet.
   */
  title?: string | null;
  /** The two-speed triage label, or null until the classifier has run (spec 7). */
  triage_result: TriageResult | null;
  /** When the classification ran, or null until triaged (spec 7). */
  triaged_at: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /sessions request body. */
export interface CreateSessionInput {
  originalRequest: string;
}

/**
 * POST /sessions/:id/triage request body (spec 7 T2). `override` forces the full
 * interview regardless of the label; defaults to false (a plain triage routes on
 * the label).
 */
export interface TriageRequestInput {
  override?: boolean;
}

/**
 * The triage endpoint's result (spec 7 T2): the persisted label and the route
 * the wizard should take. `overridden` is true when the PM forced the route.
 */
export interface TriageOutcome {
  sessionId: number;
  result: TriageResult;
  route: TriageRoute;
  overridden: boolean;
}

/**
 * The standard paginated list envelope every list endpoint returns (§11.6).
 * Mirrors the backend PaginatedResult; `items` is the page, the rest is the
 * page metadata the dashboard uses to render page controls.
 */
export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Query params for GET /sessions (dashboard list, spec 4 T1). */
export interface ListSessionsParams {
  page?: number;
  limit?: number;
  status?: SessionStatus;
}

/* ---------------------------------------------------------------------------
 * Interview engine (spec 2) + grounded options (spec 6). Mirrors the backend
 * engine shapes; no `any` (§17.2). Option grounding is filled when the session
 * has cached scout findings, and null on the no-findings path. Every option
 * carries a build-`speed` tier and exactly one option per question is
 * `recommended` on both paths.
 * ------------------------------------------------------------------------- */

/** A coarse effort/complexity TIER (mirrors the backend EffortTier); never hours. */
export type EffortTier = "XS" | "S" | "M" | "L" | "XL";

/**
 * The ordered per-option build-speed scale (spec 6), mirroring the backend
 * OptionSpeed. 5 steps slowest→fastest, where `fastest` = least build effort.
 */
export type OptionSpeed = "slowest" | "slow" | "moderate" | "fast" | "fastest";

/**
 * One answer option for a question (spec 6). When grounded in scout findings,
 * `groundingRef` references the supporting finding. `speed` is the ordered
 * build-speed tier on every option, and exactly one option per question is
 * `recommended` (the single best pick) on both the grounded and ungrounded paths.
 */
export interface QuestionOption {
  id?: string;
  label: string;
  speed: OptionSpeed;
  recommended: boolean;
  groundingRef?: string | null;
}

/** One question the grounding step skipped because a finding answered it (spec 6). */
export interface SkippedQuestion {
  decisionKey: string;
  reason: string;
}

/** A single generated question in a batch. */
export interface InterviewQuestion {
  id: string;
  decisionKey: string;
  text: string;
  options: QuestionOption[];
  allowOther: boolean;
  dependsOn: string[];
}

/** The persisted batch shape stored in a turn's `questions` JSON. */
export interface PersistedBatch {
  questions: InterviewQuestion[];
  hasOpenMaterialDecisions: boolean;
  /** Questions the grounding step skipped because findings answered them (spec 6); null when ungrounded. */
  skipped: SkippedQuestion[] | null;
}

/** A row of interview_turns as returned by the API. */
export interface InterviewTurn {
  id: number;
  session_id: number;
  turn_index: number;
  questions: PersistedBatch;
  answers: unknown | null;
  created_at: string;
}

export type DecisionSource = "answer" | "scout" | "default";

/** A row of decision_record as returned by the API. */
export interface DecisionRecord {
  id: number;
  session_id: number;
  key: string;
  value: unknown;
  source: DecisionSource;
  created_at: string;
}

/** The full engine state for a session (GET .../interview and GET .../state). */
export interface InterviewState {
  sessionId: number;
  originalRequest: string;
  status: SessionStatus;
  turns: InterviewTurn[];
  decisions: DecisionRecord[];
  nextTurnIndex: number;
  isComplete: boolean;
  /**
   * Latest ticket id for this session, or null when none exists yet. Returned by
   * GET /sessions/:id/state so the dashboard can route to "view ticket" (spec 4
   * T6). The engine's GET .../interview leaves it null.
   */
  ticketId: number | null;
}

/** One answer the PM submits for a question in the open batch. */
export interface SubmittedAnswer {
  questionId: string;
  optionId: string | null;
  otherText: string | null;
}

/** Body for POST .../interview/answers. */
export interface SubmitAnswersInput {
  answers: SubmittedAnswer[];
  stopAndGenerate?: boolean;
}
