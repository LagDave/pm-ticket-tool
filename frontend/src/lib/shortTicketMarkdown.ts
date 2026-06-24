/**
 * Build the SHORT, copyable Markdown for a ticket (spec What). This is the compact
 * artifact a PM pastes into Jira/Slack: the core fields (story, criteria, effort,
 * priority) plus a "View full ticket" link back into the app. The link is built
 * from the current browser origin + the ticket's share token, so the env-specific
 * URL lives in the browser and is never baked into the persisted rendered_markdown
 * (spec Constraints). The full Markdown (all sections) stays server-rendered and is
 * copied separately. Pure + framework-free (§12.2 utils). Never emits em/en-dashes.
 */
import type { Ticket } from "../types/ticket";

/** The app deep link that opens the full ticket read-only (spec What). */
function shareUrl(token: string): string {
  return `${window.location.origin}/?ticket=${encodeURIComponent(token)}`;
}

/** Title-case a priority tier (high -> High); null when unset. */
function priorityLabel(priority: Ticket["priority"]): string | null {
  if (!priority) return null;
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function buildShortTicketMarkdown(ticket: Ticket): string {
  const lines: string[] = [];

  if (ticket.user_story) {
    lines.push("## User Story", "", ticket.user_story.trim(), "");
  }

  const criteria = ticket.acceptance_criteria ?? [];
  if (criteria.length > 0) {
    lines.push("## Acceptance Criteria", "");
    criteria.forEach((criterion, index) => {
      lines.push(
        `${index + 1}. **Given** ${criterion.given.trim()}`,
        `   **When** ${criterion.when.trim()}`,
        `   **Then** ${criterion.then.trim()}`,
        "",
      );
    });
  }

  const priority = priorityLabel(ticket.priority);
  const tierLine = [
    ticket.effort ? `**Effort:** ${ticket.effort}` : null,
    priority ? `**Priority:** ${priority}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (tierLine) lines.push(tierLine, "");

  lines.push(`[View full ticket](${shareUrl(ticket.share_token)})`);

  return `${lines.join("\n")}\n`;
}
