/**
 * TicketMarkdownService — renders a ticket's fields into stable copy-paste
 * Markdown (spec T5, §7.1). Pure: no DB, no req/res. The service layer calls it
 * on generate and on edit/finalize, then persists the result to
 * tickets.rendered_markdown so any consumer reads one canonical string. This is
 * the FULL rendering (all sections, spec What); the short copy-with-link is built
 * client-side from the same fields (spec Constraints). Mirrors the gbp-automation
 * service shape (§6.1). Never emits em/en-dashes (project copy rule).
 */
import type {
  AcceptanceCriterion,
  CodebaseGroundingItem,
  EffortTier,
  KeyDecision,
  TicketDetails,
  TicketPriority,
} from "../../../types/interview";

/** The fields needed to render — a subset of a persisted ticket. */
export interface RenderableTicket {
  userStory: string;
  acceptanceCriteria: AcceptanceCriterion[];
  effort: EffortTier;
  contextSummary: string;
  /** Coarse priority tier, or null when not set (renders no Priority section). */
  priority: TicketPriority | null;
  /** Rich enrichment payload, or null (each empty section is omitted). */
  details: TicketDetails | null;
}

/**
 * Fixed notes rendered next to the effort + priority tiers (spec Risk: tier
 * overconfidence). The model commits to coarse tiers, never hours or hard
 * priority — these make the uncertainty explicit in the artifact itself.
 */
const EFFORT_NOTE = "complexity tier, verify with engineering, not an hour estimate";
const PRIORITY_NOTE = "impact tier, confirm with the team";

export class TicketMarkdownService {
  /**
   * Render the full ticket to Markdown with a stable section order. Empty
   * enrichment sections (no items / blank text) are omitted so a sparse ticket
   * stays clean. Deterministic for a given ticket, so the copy action and any
   * later consumer get the same string.
   */
  static render(ticket: RenderableTicket): string {
    const d = ticket.details;
    const sections: string[] = [];

    sections.push(this.section("User Story", ticket.userStory.trim()));

    if (this.hasText(d?.problemBackground)) {
      sections.push(this.section("Problem / Background", d!.problemBackground!.trim()));
    }

    sections.push(
      this.section("Acceptance Criteria", this.renderCriteria(ticket.acceptanceCriteria)),
    );

    if (d?.keyDecisions?.length) {
      sections.push(this.section("Key Decisions", this.renderDecisions(d.keyDecisions)));
    }
    if (d?.openQuestions?.length) {
      sections.push(this.section("Open Questions", this.renderBullets(d.openQuestions)));
    }
    if (d?.successMetrics?.length) {
      sections.push(this.section("Success Metrics", this.renderBullets(d.successMetrics)));
    }
    if (d?.dependencies?.length) {
      sections.push(this.section("Dependencies", this.renderBullets(d.dependencies)));
    }
    if (d?.codebaseGrounding?.length) {
      sections.push(this.section("Codebase Grounding", this.renderGrounding(d.codebaseGrounding)));
    }

    sections.push(this.section("Effort", `**${ticket.effort}** (${EFFORT_NOTE})`));

    if (ticket.priority) {
      sections.push(
        this.section("Priority", `**${this.priorityLabel(ticket.priority)}** (${PRIORITY_NOTE})`),
      );
    }

    if (this.hasText(ticket.contextSummary)) {
      sections.push(this.section("Context", ticket.contextSummary.trim()));
    }

    // One blank line between sections; a single trailing newline so the block
    // pastes cleanly above following content.
    return `${sections.join("\n\n")}\n`;
  }

  /* ----------------------------- private helpers ------------------------- */

  /** A `## Heading` followed by a blank line and the body. */
  private static section(heading: string, body: string): string {
    return `## ${heading}\n\n${body}`;
  }

  /** One numbered Given/When/Then block per criterion. */
  private static renderCriteria(criteria: AcceptanceCriterion[]): string {
    return criteria
      .map((c, index) =>
        [
          `${index + 1}. **Given** ${c.given.trim()}`,
          `   **When** ${c.when.trim()}`,
          `   **Then** ${c.then.trim()}`,
        ].join("\n"),
      )
      .join("\n\n");
  }

  /** One bullet per key decision: bold label, optional detail after a colon. */
  private static renderDecisions(decisions: KeyDecision[]): string {
    return decisions
      .map((kd) => {
        const detail = this.hasText(kd.detail) ? `: ${kd.detail!.trim()}` : "";
        return `- **${kd.label.trim()}**${detail}`;
      })
      .join("\n");
  }

  /** One bullet per code area: the area in backticks, then the note after a colon. */
  private static renderGrounding(items: CodebaseGroundingItem[]): string {
    return items.map((g) => `- \`${g.area.trim()}\`: ${g.note.trim()}`).join("\n");
  }

  /** A plain bulleted list, one item per line. */
  private static renderBullets(items: string[]): string {
    return items.map((s) => `- ${s.trim()}`).join("\n");
  }

  /** Title-case a priority tier for display (high -> High). */
  private static priorityLabel(priority: TicketPriority): string {
    return priority.charAt(0).toUpperCase() + priority.slice(1);
  }

  /** True when a value is a non-empty, non-blank string. */
  private static hasText(value: string | null | undefined): boolean {
    return typeof value === "string" && value.trim().length > 0;
  }
}
