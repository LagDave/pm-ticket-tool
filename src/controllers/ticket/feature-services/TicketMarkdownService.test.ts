/**
 * TicketMarkdownService tests (§20.1). Pure render — no DB, no mocks. Proves the
 * persisted ticket renders to stable Markdown with a story header, a
 * Given/When/Then block per criterion, and the effort tier + note (spec T5).
 */
import { describe, expect, it } from "vitest";
import { TicketMarkdownService } from "./TicketMarkdownService";

const SAMPLE = {
  userStory: "As a PM, I want a ticket, So that I can hand it off.",
  acceptanceCriteria: [
    { given: "a completed session", when: "I generate", then: "a draft persists" },
    { given: "an edit", when: "I save", then: "the version bumps" },
  ],
  effort: "M" as const,
  contextSummary: "Turn saved decisions into a durable ticket.",
};

describe("TicketMarkdownService", () => {
  it("renders the story header, the effort tier, and the context", () => {
    const md = TicketMarkdownService.render(SAMPLE);

    expect(md).toContain("## User Story");
    expect(md).toContain("As a PM, I want a ticket, So that I can hand it off.");
    expect(md).toContain("## Effort");
    expect(md).toContain("**M**");
    // The fixed "verify with engineering" note guards against effort overconfidence (spec Risk).
    expect(md.toLowerCase()).toContain("verify with engineering");
    expect(md).toContain("## Context");
    expect(md).toContain("Turn saved decisions into a durable ticket.");
  });

  it("renders one Given/When/Then block per criterion", () => {
    const md = TicketMarkdownService.render(SAMPLE);

    const givens = md.match(/\*\*Given\*\*/g) ?? [];
    const whens = md.match(/\*\*When\*\*/g) ?? [];
    const thens = md.match(/\*\*Then\*\*/g) ?? [];
    expect(givens).toHaveLength(2);
    expect(whens).toHaveLength(2);
    expect(thens).toHaveLength(2);
    expect(md).toContain("the version bumps");
  });

  it("is deterministic for the same input (copy button matches rendered_markdown)", () => {
    expect(TicketMarkdownService.render(SAMPLE)).toBe(
      TicketMarkdownService.render(SAMPLE),
    );
  });
});
