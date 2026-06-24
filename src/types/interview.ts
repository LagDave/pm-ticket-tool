/**
 * Shared backend domain types for the interview/ticket schema. Rows mirror the
 * migration columns. JSON columns are typed as structured values, never `any`
 * (§4.5).
 */

export type SessionStatus =
  | "draft"
  | "in_progress"
  | "awaiting_input"
  | "complete"
  | "archived";

/**
 * The two-speed triage label (spec 7). `simple` routes straight to a draft
 * ticket (spec 3); `scoped` enters the full interview loop (spec 2). The
 * classifier defaults to `scoped` whenever unsure, so the failure mode is "too
 * much interview", never a thin ticket from scoped work (spec Risk).
 */
export type TriageResult = "simple" | "scoped";

/**
 * Which path the wizard should take after triage (spec T2). `simple` → the
 * ticket-draft path; `scoped` → the interview loop. Mirrors TriageResult but
 * names the routing concern distinctly so the override can force a route that
 * disagrees with the stored label.
 */
export type TriageRoute = "ticket" | "interview";

/** A row of interview_sessions. */
export interface IInterviewSession {
  id: number;
  owner_user_id: number;
  organization_id: number | null;
  status: SessionStatus;
  original_request: string;
  /**
   * Concise generated display title for the dashboard (User QA: auto-generated
   * session title). Generated from original_request at create and replaced from
   * the finalized ticket after finalize. Null until generation runs, or if
   * generation failed — the UI then falls back to the request snippet.
   */
  title: string | null;
  /** The two-speed triage label, or null until the classifier has run (spec 7). */
  triage_result: TriageResult | null;
  /** When the classification ran, or null until triaged (spec 7). */
  triaged_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** A row of interview_turns. JSON columns kept open-shaped for the engine spec. */
export interface IInterviewTurn {
  id: number;
  session_id: number;
  turn_index: number;
  questions: unknown;
  answers: unknown | null;
  created_at: Date;
}

export type DecisionSource = "answer" | "scout" | "default";

/** A row of decision_record. */
export interface IDecisionRecord {
  id: number;
  session_id: number;
  key: string;
  value: unknown;
  source: DecisionSource;
  created_at: Date;
}

export type TicketStatus = "draft" | "final";

/**
 * Effort is a complexity TIER, never a count of hours (spec Constraints): LLM
 * hour estimates are unreliable, so the model only commits to a coarse tier and
 * the UI shows a "verify with engineering" note next to it. Mirrors the
 * tickets_effort_check constraint.
 */
export type EffortTier = "XS" | "S" | "M" | "L" | "XL";

/**
 * Priority is a coarse impact TIER, never a number (spec What). Like effort, the
 * model only commits to a tier and the UI shows a "confirm with team" note — an
 * AI-guessed priority is as unreliable as an hour estimate (spec Risk). Mirrors
 * the tickets_priority_check constraint.
 */
export type TicketPriority = "high" | "medium" | "low";

/**
 * One acceptance-criterion block in Given/When/Then form. Stored as a JSONB
 * array on tickets.acceptance_criteria; structured, never `any` (§4.5).
 */
export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

/**
 * One settled decision surfaced on the ticket (spec What: Key Decisions). `label`
 * is the decision in the PM's terms; `detail` is an optional one-line rationale.
 * Derived by the generator from decision_record so the PM's answers are visible
 * in the artifact instead of compressed away (spec Why). Stored in tickets.details.
 */
export interface KeyDecision {
  label: string;
  detail: string | null;
}

/**
 * One codebase-grounding note (spec What: Codebase Grounding). `area` is a file or
 * module the work touches; `note` is why it matters. Populated from scout findings
 * when a scout ran for the session, else an empty list (spec Risk).
 */
export interface CodebaseGroundingItem {
  area: string;
  note: string;
}

/**
 * The rich enrichment payload persisted as tickets.details (jsonb). One typed
 * object rather than six sparse columns — pure content the app never filters on
 * (spec Risk: data-model choice). Every array defaults to empty and
 * problemBackground to null, so a thin model answer is still a valid ticket
 * (spec Risk: larger model output). Structured, never `any` (§4.5).
 */
export interface TicketDetails {
  problemBackground: string | null;
  keyDecisions: KeyDecision[];
  openQuestions: string[];
  successMetrics: string[];
  dependencies: string[];
  codebaseGrounding: CodebaseGroundingItem[];
}

/** A row of tickets. JSON columns typed as structured values, never `any` (§4.5). */
export interface ITicket {
  id: number;
  session_id: number;
  user_story: string | null;
  acceptance_criteria: AcceptanceCriterion[] | null;
  effort: EffortTier | null;
  status: TicketStatus;
  version: number;
  rendered_markdown: string | null;
  context_summary: string | null;
  /** Coarse priority tier, or null until generation sets it (spec What). */
  priority: TicketPriority | null;
  /** Rich enrichment payload (jsonb), or null on legacy/pre-generation rows. */
  details: TicketDetails | null;
  /**
   * Unguessable per-ticket capability token for the public read-only share link
   * (spec What). 256-bit base64url from crypto (§5.1). Read through the
   * non-owner-scoped findByShareToken — the token IS the capability (spec Risk).
   */
  share_token: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * The public, read-only projection returned by the shared-ticket endpoint (spec
 * What). Content only: it deliberately omits id, session_id, share_token, owner
 * context, and comments so the public link leaks nothing internal (§5.4, §5.5).
 */
export interface PublicTicket {
  user_story: string | null;
  acceptance_criteria: AcceptanceCriterion[] | null;
  effort: EffortTier | null;
  priority: TicketPriority | null;
  context_summary: string | null;
  details: TicketDetails | null;
  status: TicketStatus;
  version: number;
  rendered_markdown: string | null;
  created_at: Date;
}

/** A row of ticket_comments — one PM comment on a ticket (spec Pushback: child table). */
export interface ITicketComment {
  id: number;
  ticket_id: number;
  author_user_id: number;
  body: string;
  created_at: Date;
}

/**
 * The fields the generator produces from a session's decision_record +
 * original_request (spec T1/What). The first four are the original core; the rest
 * are the enrichment that keeps the PM's answers visible (spec Why). snake_case
 * mirrors the structured-output schema the model fills. The service maps the rich
 * fields into the camelCase TicketDetails before persisting. Validated at the
 * boundary before persisting (§11.2); rich fields are best-effort (may be empty).
 */
export interface GeneratedTicket {
  user_story: string;
  acceptance_criteria: AcceptanceCriterion[];
  effort: EffortTier;
  context_summary: string;
  /** Coarse priority tier the model proposes; PM-editable (spec What/Risk). */
  priority: TicketPriority;
  /** The business "why" behind the request (spec What: Problem/Background). */
  problem_background: string;
  /** Settled decisions in the PM's terms (spec What: Key Decisions). */
  key_decisions: { label: string; detail: string }[];
  /** Assumptions / unresolved questions (spec What: Open Questions). */
  open_questions: string[];
  /** Observable success signals (spec What: Success Metrics). */
  success_metrics: string[];
  /** Prerequisites / blockers (spec What: Dependencies). */
  dependencies: string[];
  /** Code areas the work touches, from scout findings (spec What: Codebase Grounding). */
  codebase_grounding: { area: string; note: string }[];
}

/** Server-derived caller context — owner scope is never trusted from the client (§5.5, §11.7). */
export interface OwnerContext {
  ownerUserId: number;
  organizationId: number | null;
}

/**
 * The standard paginated list envelope every list endpoint returns (§11.6).
 * `items` carries the page of rows; the rest is the page metadata so the client
 * can render page controls without a second call.
 */
export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ---------------------------------------------------------------------------
 * Interview engine (spec 2) + grounded options (spec 6). The generated question
 * batch, its options, and the answer-submission shapes. JSON columns stay
 * structured, never `any` (§4.5). Option grounding is filled by the grounding
 * step (spec 6) when the session has cached scout findings, and left null on the
 * no-findings fallback. Every option carries a build-`speed` tier and exactly one
 * option per question is `recommended` on both paths.
 * ------------------------------------------------------------------------- */

/**
 * The ordered per-option build-speed scale (spec 6). 5 steps, slowest→fastest,
 * where `fastest` = least build effort and `slowest` = most. Mirrors the
 * SPEED_TIERS enum in validation/interviewQuestions.ts (the source of truth) and
 * the frontend type. Distinct from EffortTier (ticket complexity).
 */
export type OptionSpeed = "slowest" | "slow" | "moderate" | "fast" | "fastest";

/**
 * One answer option for a question (spec 6 — grounded options). When the session
 * has cached scout findings, `groundingRef` points the option back to the finding
 * that supports it (null/absent when ungrounded). `speed` is the ordered build-
 * speed tier on every option, and exactly one option per question is
 * `recommended` (the single best pick) on both the grounded and ungrounded paths.
 */
export interface QuestionOption {
  /** Stable id within the question, e.g. "opt_a". */
  id?: string;
  /** Human-readable choice text. */
  label: string;
  /** Ordered build-speed tier for this option (slowest→fastest, fastest = least effort). */
  speed: OptionSpeed;
  /** True on the single best (recommended) pick; exactly one per question. */
  recommended: boolean;
  /** A reference into the codebase (a scout finding) backing this option; null/absent when ungrounded. */
  groundingRef?: string | null;
}

/**
 * A single generated question. `decisionKey` is the stable key the answer is
 * recorded under in decision_record. `dependsOn` lists earlier question ids it
 * depends on, so the batch is dependency-ordered (spec What).
 */
export interface InterviewQuestion {
  id: string;
  /** Stable decision key, e.g. "auth_method" — the decision_record key. */
  decisionKey: string;
  text: string;
  /** Choice options; the PM may also answer free-text via "other". */
  options: QuestionOption[];
  /** Whether a free-text "other" answer is allowed for this question. */
  allowOther: boolean;
  /** Earlier question ids this one depends on (dependency ordering). */
  dependsOn: string[];
}

/**
 * One question the grounding step dropped because a cached finding already
 * determines its answer (spec 6 T2 — codebase-first skip). `reason` is recorded
 * for audit and replays with the turn, so a skip is never silent (spec Risk).
 */
export interface SkippedQuestion {
  /** The decision key of the question that was not asked. */
  decisionKey: string;
  /** Short, auditable reason: which finding determined the answer. */
  reason: string;
}

/** A generated batch: up to MAX_QUESTIONS_PER_BATCH dependency-ordered questions. */
export interface QuestionBatch {
  questions: InterviewQuestion[];
}

/**
 * The model's raw structured output for a batch generation. Whether more
 * material decisions remain open drives the materiality gate (spec What).
 * `skipped` lists questions a cached finding already answered (spec 6); null on
 * the ungrounded path.
 */
export interface GeneratedBatch {
  questions: InterviewQuestion[];
  /** Model's signal that an open decision still materially changes the ticket. */
  hasOpenMaterialDecisions: boolean;
  /** Questions skipped because findings determined them, with reasons (spec 6); null when ungrounded. */
  skipped: SkippedQuestion[] | null;
}

/** One submitted answer to a question in the current batch. */
export interface SubmittedAnswer {
  /** The question id being answered (matches a question in the open turn). */
  questionId: string;
  /** The chosen option id, or null when answering free-text via `otherText`. */
  optionId: string | null;
  /** Free-text answer when the PM picks "other"; null otherwise. */
  otherText: string | null;
}

/** The body of a submit-answers request (validated at the boundary, §11.2). */
export interface SubmitAnswersPayload {
  answers: SubmittedAnswer[];
  /** Global "stop and generate now" — ends the interview immediately (spec What). */
  stopAndGenerate?: boolean;
}

/* ---------------------------------------------------------------------------
 * Triage (spec 7). The model's classification of the original request, and the
 * outcome the controller returns to the wizard. JSON stays structured, never
 * `any` (§4.5). The classifier defaults to `scoped` when unsure (spec Risk).
 * ------------------------------------------------------------------------- */

/**
 * The classifier's structured output (spec T1): the two-speed label plus a
 * short reason for logging/debugging. Re-validated at the boundary before it is
 * trusted; an unparsable result defaults to `scoped` (spec Risk).
 */
export interface TriageClassification {
  result: TriageResult;
  /** One short sentence: why the request was labelled this way (for logs). */
  reason: string;
}

/**
 * The triage endpoint's result (spec T2): the persisted label and the route the
 * wizard should take. When the PM overrode the classification, `overridden` is
 * true and `route` is the forced route — which may disagree with `result`.
 */
export interface TriageOutcome {
  sessionId: number;
  /** The classifier's label, persisted on the session (null only if it could not run). */
  result: TriageResult;
  /** The path to take: `simple` → ticket, `scoped` → interview, unless overridden. */
  route: TriageRoute;
  /** True when the PM forced the route via the override flag (spec What). */
  overridden: boolean;
}

/**
 * The full engine state for a session: the original request, every persisted
 * turn, the decision record, the rolled-up status, and whether the interview
 * is complete. Returned by GET .../interview and rebuilt on resume by replaying
 * persisted rows — no batch is ever regenerated (spec What).
 */
export interface InterviewState {
  sessionId: number;
  originalRequest: string;
  status: SessionStatus;
  turns: IInterviewTurn[];
  decisions: IDecisionRecord[];
  /** Index of the next turn to generate (= turns.length). */
  nextTurnIndex: number;
  /** True once the session reached shared understanding or was stopped. */
  isComplete: boolean;
  /**
   * The id of the latest ticket generated for this session, or null when none
   * exists yet (dashboard "view ticket", spec 4 T6). Owner-scoped at the model;
   * lets the dashboard route straight to the ticket view without a second lookup.
   */
  ticketId: number | null;
}
