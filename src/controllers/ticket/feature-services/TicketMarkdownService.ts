/**
 * TicketMarkdownService — renders a ticket's fields into stable copy-paste
 * Markdown (spec T5, §7.1). Pure: no DB, no req/res. The service layer calls it
 * on generate and on edit/finalize, then persists the result to
 * tickets.rendered_markdown so the copy action (T4) and any later consumer read
 * one canonical string. Mirrors the gbp-automation service shape (§6.1).
 */
import type { AcceptanceCriterion, EffortTier } from "../../../types/interview";

/** The fields needed to render — a subset of a persisted ticket. */
export interface RenderableTicket {
  userStory: string;
  acceptanceCriteria: AcceptanceCriterion[];
  effort: EffortTier;
  contextSummary: string;
}

/**
 * Fixed note rendered next to the effort tier (spec Risk: effort overconfidence).
 * The model commits to a coarse complexity tier, never hours — this makes the
 * uncertainty explicit in the artifact itself.
 */
const EFFORT_NOTE = "complexity tier — verify with engineering, not an hour estimate";

export class TicketMarkdownService {
  /**
   * Render the ticket to Markdown with a stable structure: a story header, a
   * Given/When/Then block per criterion, the effort tier + note, and the context
   * summary. The output is deterministic for a given ticket, so the copy button
   * and any later consumer get the same string.
   */
  static render(ticket: RenderableTicket): string {
    const sections = [
      "## User Story",
      "",
      ticket.userStory.trim(),
      "",
      "## Acceptance Criteria",
      "",
      this.renderCriteria(ticket.acceptanceCriteria),
      "## Effort",
      "",
      `**${ticket.effort}** (${EFFORT_NOTE})`,
      "",
      "## Context",
      "",
      ticket.contextSummary.trim(),
    ];
    // Trailing newline so the block pastes cleanly above following content.
    return `${sections.join("\n")}\n`;
  }

  /** One numbered Given/When/Then block per criterion. */
  private static renderCriteria(criteria: AcceptanceCriterion[]): string {
    return criteria
      .map((c, index) =>
        [
          `${index + 1}. **Given** ${c.given.trim()}`,
          `   **When** ${c.when.trim()}`,
          `   **Then** ${c.then.trim()}`,
          "",
        ].join("\n"),
      )
      .join("\n");
  }
}
