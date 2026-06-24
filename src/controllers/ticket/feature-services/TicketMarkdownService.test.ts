/**
 * TicketMarkdownService tests (§20.1). Pure render — no DB, no mocks. Proves the
 * full ticket renders to stable Markdown: the core sections (story, criteria,
 * effort + note, context) plus the enrichment sections and the priority tier, with
 * empty enrichment sections omitted (spec What/T5). Also guards the project copy
 * rule that no em/en-dash is emitted.
 */
import { describe, expect, it } from "vitest";
import { TicketMarkdownService, type RenderableTicket } from "./TicketMarkdownService";

const FULL: RenderableTicket = {
  userStory: "As a PM, I want a ticket, So that I can hand it off.",
  acceptanceCriteria: [
    { given: "a completed session", when: "I generate", then: "a draft persists" },
    { given: "an edit", when: "I save", then: "the version bumps" },
  ],
  effort: "M",
  contextSummary: "Turn saved decisions into a durable ticket.",
  priority: "high",
  details: {
    problemBackground: "PMs lose detail when a ticket shows only four fields.",
    keyDecisions: [
      { label: "Magic-link auth", detail: "Faster than passwords." },
      { label: "15-minute expiry", detail: null },
    ],
    openQuestions: ["Should links be single-use?"],
    successMetrics: ["PMs hand off without follow-up questions."],
    dependencies: ["Transactional email provider"],
    codebaseGrounding: [{ area: "Authentication", note: "A login flow already exists." }],
  },
};

const MINIMAL: RenderableTicket = {
  userStory: "As a dev, I want X, So that Y.",
  acceptanceCriteria: [{ given: "g", when: "w", then: "t" }],
  effort: "S",
  contextSummary: "",
  priority: null,
  details: null,
};

describe("TicketMarkdownService", () => {
  it("renders the core sections: story, effort + note, context", () => {
    const md = TicketMarkdownService.render(FULL);

    expect(md).toContain("## User Story");
    expect(md).toContain("As a PM, I want a ticket, So that I can hand it off.");
    expect(md).toContain("## Effort");
    expect(md).toContain("**M**");
    // The fixed "verify with engineering" note guards effort overconfidence (spec Risk).
    expect(md.toLowerCase()).toContain("verify with engineering");
    expect(md).toContain("## Context");
    expect(md).toContain("Turn saved decisions into a durable ticket.");
  });

  it("renders one Given/When/Then block per criterion", () => {
    const md = TicketMarkdownService.render(FULL);

    expect(md.match(/\*\*Given\*\*/g) ?? []).toHaveLength(2);
    expect(md.match(/\*\*When\*\*/g) ?? []).toHaveLength(2);
    expect(md.match(/\*\*Then\*\*/g) ?? []).toHaveLength(2);
    expect(md).toContain("the version bumps");
  });

  it("renders the enrichment sections and the priority tier + note", () => {
    const md = TicketMarkdownService.render(FULL);

    expect(md).toContain("## Problem / Background");
    expect(md).toContain("## Key Decisions");
    expect(md).toContain("Magic-link auth");
    expect(md).toContain("## Open Questions");
    expect(md).toContain("## Success Metrics");
    expect(md).toContain("## Dependencies");
    expect(md).toContain("## Codebase Grounding");
    expect(md).toContain("Authentication");
    expect(md).toContain("## Priority");
    expect(md).toContain("**High**");
    expect(md.toLowerCase()).toContain("confirm with the team");
  });

  it("never emits an em-dash or en-dash (project copy rule)", () => {
    expect(TicketMarkdownService.render(FULL)).not.toMatch(/[—–]/);
  });

  it("omits empty enrichment sections and Priority/Context when unset", () => {
    const md = TicketMarkdownService.render(MINIMAL);

    expect(md).toContain("## User Story");
    expect(md).toContain("## Acceptance Criteria");
    expect(md).toContain("## Effort");
    expect(md).not.toContain("## Problem / Background");
    expect(md).not.toContain("## Key Decisions");
    expect(md).not.toContain("## Open Questions");
    expect(md).not.toContain("## Success Metrics");
    expect(md).not.toContain("## Dependencies");
    expect(md).not.toContain("## Codebase Grounding");
    expect(md).not.toContain("## Priority");
    expect(md).not.toContain("## Context"); // contextSummary is blank
  });

  it("is deterministic for the same input (copy button matches rendered_markdown)", () => {
    expect(TicketMarkdownService.render(FULL)).toBe(TicketMarkdownService.render(FULL));
  });
});
