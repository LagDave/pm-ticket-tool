# Product

## Register

product

## Users

Product managers (and PM-adjacent operators) at PuzzleHR. They arrive with a
rough, plain-language feature idea and need it turned into a well-scoped
engineering ticket. Their context is a working session — focused, often
mid-thought, wanting to offload structure to the tool rather than fight it. The
job to be done: go from "I want X" to a clear, reviewable ticket (user story,
acceptance criteria, context) through a short AI-led interview, grounded by the
real facts about the target app ("project bits").

## Product Purpose

The PM tool converts informal feature requests into structured tickets via a
guided, two-speed interview. It triages simple vs. scoped requests, asks only
the questions that materially change the outcome, and grounds itself in
project-specific "bits" (stack, constraints, integrations, inventory) so the
output reflects the real system. Success is a ticket a PM trusts enough to hand
to engineering without a rewrite — produced faster and more consistently than
writing it by hand.

## Brand Personality

Editorial, precise, futuristic. The voice is a senior, exacting collaborator:
calm, direct, confident, never chatty or cute. It should feel like a
well-typeset document that happens to think — restraint signals craft, and the
single warm accent is spent deliberately, not sprayed across the surface.

## Anti-references

- **Generic SaaS dashboard** — identical card grids, gradient hero-metric,
  uppercase eyebrow over every section, side-stripe accents.
- **Crypto / web3 neon** — glowing gradients, purple-cyan wash, glassmorphism
  for its own sake, sci-fi as decoration.
- **Corporate enterprise gray** — flat, dense, soulless, forgettable.
- **Overcluttered / loud** — competing accents, heavy ornament, motion that
  distracts from the task.

## Design Principles

- **Restraint is the signal.** One accent, spent rarely. Monochrome does the
  heavy lifting; color means something when it appears.
- **Calm under cognitive load.** The PM is thinking hard; the UI must lower the
  temperature — clear hierarchy, one primary action per screen, no noise.
- **Show the thinking.** When the AI works (triage, reconciliation, generation),
  make the work legible and paced, never a frozen spinner.
- **Editorial over decorative.** Typography and rhythm carry the identity;
  effects (backdrop, motion) are atmosphere, never the message.
- **Speed is a feature.** Atmosphere must never cost responsiveness — heavy
  visuals lazy-load, degrade, and pause; the task stays instant.

## Accessibility & Inclusion

- WCAG 2.1 AA: body text ≥ 4.5:1, large/bold ≥ 3:1, in **both** light and dark
  themes. Placeholders meet the same bar as body text.
- `prefers-reduced-motion`: every animation (component motion, the WebGL
  backdrop, GSAP choreography) has a static or crossfade fallback.
- The WebGL backdrop is decorative only; no information is conveyed by it, and
  it degrades to a static surface on low-end / no-WebGL devices.
