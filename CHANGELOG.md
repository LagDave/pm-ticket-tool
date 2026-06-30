# PM Ticket Tool Changelog

All notable changes to PM Ticket Tool are documented here.

## [0.1.2] - July 2026

### DevEasy-Style Two-Pane Shell

Restructures the app to match the sibling DevEasy tool: a persistent sidebar of sessions next to a main pane showing the current session, with a tighter, more compact UI throughout.

**Key Changes:**
- Replaced the full-screen view-swap navigation with a persistent two-pane shell (`AppShell` + `SessionSidebar`). The sidebar lists sessions **grouped by project**, with a "No project" group for ungrounded sessions, plus search and a status filter. Selecting a session opens it in the main pane; a complete session opens straight to its ticket.
- Sidebar data is sourced from the existing list endpoint at `limit=100` (the backend's max) and grouped client-side; a "showing recent 100" note appears past the cap. The public `/?ticket=` shared view stays outside the shell — no sidebar for anonymous viewers.
- Full migration to a DevEasy-style utility kit (`.eyebrow`/`.btn`/`.field`/`.pill`/`.surface`/`.card-hover`) defined in `index.css` and wired to the existing themeable CSS variables, so **light and dark both still work** (the toggle moved into the sidebar). Every screen's JSX moved off the legacy semantic classes; `index.css` shrank from ~2040 to ~380 lines.
- Typography switched to Hanken Grotesk (body) + JetBrains Mono (labels/headings); Fraunces and Sora removed.

**Commits:**
- `feat: DevEasy-style two-pane shell + compact utility-kit migration` (LagDave): new `components/shell/` (AppShell, SessionSidebar); rewritten `App.tsx`; font + token + kit changes in `index.css`; `Button` and all interview/ticket/projects/bits/ui components restyled to the kit; `Dashboard.tsx` + `dashboard/SessionList.tsx` removed; `InterviewWizard`/`RequestEntry` gained an `initialProjectId` for per-project new sessions. Plan: `plans/07012026-deveasy-style-two-pane-shell`.

**Verification:**
- `tsc --noEmit` clean; frontend production build succeeds; `check:conventions` reports 0 backend hard violations; frontend lint 0 errors (4 advisory warnings); 2/2 frontend tests pass.
- The 10 in-app UI acceptance items (`test.html`) were waived to a manual pass in the dev server — they require the running app/DB, which this environment did not have.

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
