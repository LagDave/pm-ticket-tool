# PM Ticket Tool Changelog

All notable changes to PM Ticket Tool are documented here.

## [0.1.1] - June 2026

### Rich Ticket + Shareable Link

Makes the finished ticket carry the decisions a PM actually made in the interview instead of compressing them into four fields, and adds a public read-only share link so a ticket can be handed to anyone outside the app.

**Key Changes:**
- The ticket gains seven sections on top of the original story, acceptance criteria, effort, and context: Problem/Background, Key Decisions, Open Questions, Success Metrics, Dependencies, Codebase Grounding, and a Priority tier. Empty sections are omitted from both the in-app view and the rendered Markdown.
- New public endpoint `GET /api/shared/tickets/:token` returns a content-only projection (never comments, owner, or session internals), rate-limited, and guarded by an unguessable 256-bit capability token.
- A `/?ticket=<token>` deep link opens the full ticket read-only in the app. The copy action now produces a short Markdown block (story, criteria, effort, priority) ending in that link; the full Markdown stays available as a secondary copy.
- Priority is editable like effort, with a "confirm with the team" note. Codebase Grounding is grounded in the session's scout findings when present.

**Commits:**
- `feat: enrich ticket + public shareable link` (LagDave): backend types/validation/agent/model, generation + markdown + shared-ticket services, the public route, migration `20260625000010` (adds `share_token`, `priority`, `details`; backfills tokens), and the new `express-rate-limit` dependency; frontend types/api/hook, `TicketReadView`, `SharedTicketView`, the short-copy util, the priority edit control, and the deep-link wiring; plus tests. Plan: `plans/06252026-rich-ticket-shareable-link`.

**Verification:**
- Backend and frontend `tsc` clean; 198 backend tests pass; `check:conventions --strict` reports 0 hard violations; frontend production build succeeds.
- Three in-app UI acceptance items (section rendering, short-copy link, deep-link view) were waived for a manual pass after deploy; their data path and security contract are covered by automated API tests.

**Notes for the next merge:**
- The parallel `project-context-bits` branch removes the scout subsystem that this release's Codebase Grounding reads. When that branch merges, the grounding source must be re-pointed at the curated project bits.
