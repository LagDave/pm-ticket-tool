/**
 * Generate-bits prompt template (spec T10). The server owns this copy-paste prompt
 * so the importer's accepted JSON schema lives in EXACTLY ONE place (§4.2): the
 * shape embedded here is the same shape importBitsSchema accepts. A PM copies the
 * prompt into a SEPARATE Claude Code session pointed at the app's repo; that
 * session reconnoiters the codebase, describes the app at the PRODUCT level, and
 * writes the resulting JSON to a file the PM then uploads through the import
 * endpoint.
 *
 * This is a pure builder — no DB, no req/res (it lives in feature-utils alongside
 * the typed error + response builders, §6.3). The controller calls it and returns
 * { prompt } through the standard envelope.
 *
 * Why product-lens, not code-structure: the bits GROUND the interview/ticket in
 * what the app IS as a product (its screens, platforms, integrations, hard
 * constraints) — not how its files are laid out. A file listing would bloat the
 * context window without grounding a single product question, so the prompt
 * steers the recon away from code structure and toward observable product facts.
 */
import { BIT_KINDS } from "../../../validation/projectBit";
import { SETTLED_BIT_KINDS } from "../../../types/project";

/**
 * The exact JSON the importer accepts, rendered as a fenced example so the other
 * session emits a file the import endpoint will validate without reshaping. Kept
 * in sync with importBitsSchema by construction: it embeds the live BIT_KINDS
 * union, so adding a kind there updates this example automatically (single source,
 * §4.2).
 */
function buildSchemaBlock(): string {
  const kindUnion = BIT_KINDS.join("|");
  return [
    "```json",
    "{",
    '  "bits": [',
    "    {",
    `      "kind": "${kindUnion}",`,
    '      "bit_key": "short-stable-label",',
    '      "summary": "one or two sentences describing the fact at the product level"',
    "    }",
    "  ]",
    "}",
    "```",
  ].join("\n");
}

/**
 * The kind taxonomy, rendered so the other session knows what each kind means and
 * which kinds are SETTLED facts (the ones that most strongly ground the interview).
 * Mirrors the spec's bit taxonomy table; SETTLED kinds are flagged from the shared
 * constant so this stays in sync with the engine (§4.2).
 */
function buildTaxonomyBlock(): string {
  const meanings: Record<string, string> = {
    constraint: "a hard limit or decision (e.g. 'web only', 'must support SSO')",
    tech_stack: "what it is built with (e.g. 'React SPA + Express + Postgres')",
    inventory: "what exists today (e.g. 'screens: home, dashboard, settings')",
    feature: "a capability summary (e.g. 'auth: email/password + Google')",
    integration: "an external system (e.g. 'Twilio SMS, SendGrid, Stripe')",
  };
  const lines = BIT_KINDS.map((kind) => {
    const settled = SETTLED_BIT_KINDS.includes(kind) ? " [SETTLED — strongest grounding]" : "";
    return `- ${kind}${settled}: ${meanings[kind] ?? ""}`;
  });
  return lines.join("\n");
}

/**
 * Build the full generate-bits prompt for a named project. The instruction set
 * tells a SEPARATE Claude Code session to:
 *  - recon the repository it is pointed at,
 *  - describe the app at the PRODUCT level (what it does, platforms, the real
 *    screen/route inventory, integrations, hard constraints) — NOT code structure
 *    and NOT a file listing,
 *  - favor constraint/tech_stack/inventory bits for settled facts,
 *  - emit the EXACT JSON schema above, and
 *  - WRITE that JSON to a file on disk for upload.
 */
export function buildBitPrompt(projectName: string): string {
  return [
    `# Generate project-context bits for "${projectName}"`,
    "",
    "You are pointed at the source repository of an application. Reconnoiter the",
    "codebase, then describe the app as a PRODUCT — what it does and what it is made",
    "of — as a set of typed 'bits'. These bits ground a separate product-requirements",
    "tool, so accuracy at the product level matters more than completeness about code.",
    "",
    "## What to capture (product lens, NOT code structure)",
    "- WHAT THE APP DOES: its core capabilities and the jobs it does for its users.",
    "- PLATFORMS: web, mobile (iOS/Android), desktop, CLI, API — whatever it actually ships.",
    "- THE REAL SCREEN / ROUTE INVENTORY: the actual pages, screens, or routes that exist",
    "  today (read the router / route definitions to enumerate them) — the things a user",
    "  can navigate to, named as a user would recognize them.",
    "- INTEGRATIONS: external systems it talks to (payment, email, SMS, auth providers,",
    "  storage, third-party APIs).",
    "- HARD CONSTRAINTS: settled decisions and limits (e.g. 'web only', 'must support SSO',",
    "  'single-tenant', 'offline-capable').",
    "",
    "## What NOT to capture",
    "- Do NOT describe code structure, folder layout, class hierarchies, or build tooling.",
    "- Do NOT produce a file listing or per-file summary.",
    "- Do NOT invent capabilities the code does not support; describe what IS there.",
    "",
    "## Bit kinds",
    buildTaxonomyBlock(),
    "",
    "Favor constraint / tech_stack / inventory for SETTLED facts — those are the facts the",
    "requirements interview treats as already decided, so they are the most valuable to",
    "get right. Use feature / integration for capabilities and external systems.",
    "",
    "## Output format (EXACT — this is what the importer accepts)",
    "Produce a single JSON object with a top-level `bits` array. Each bit has exactly",
    "`kind`, `bit_key`, and `summary`. `kind` MUST be one of the kinds above. `bit_key`",
    "is a short, stable, human-readable label (it is cosmetic — dedup is by meaning, not",
    "key). `summary` is one or two plain sentences. Do not add other fields.",
    "",
    buildSchemaBlock(),
    "",
    "## Deliver it",
    "WRITE the JSON to a file on disk (for example `project-bits.json`) so it can be",
    "uploaded — do not only print it to the chat. Keep it to the facts that hold today;",
    "the importer reconciles overlap with any bits the project already has, so you do not",
    "need to avoid duplicates by hand.",
  ].join("\n");
}
