# Design

Visual system for the PM tool. Register: **product**. Personality: **editorial,
precise, futuristic**. North star: Vercel/Geist-grade restraint — near-monochrome,
serif + mono pairing, a single disciplined accent, atmosphere from depth and type
rather than color.

## Theme

Dual theme, **dark default**, user-toggled and persisted (localStorage
`pm-theme`), applied via `data-theme` on `<html>`. Dark is the working default
(focused sessions, low ambient light); light is a true editorial paper, not a
gray. Depth comes from a static, near-monochrome CSS vignette — no animated /
WebGL backdrop (removed by preference; motion was unwanted).

## Color

Strategy: **Restrained** — tinted near-monochrome neutrals + one accent ≤10% of
the surface. The accent (warm orange) is reserved for the single primary action,
the recommended option, and the active indicator. Everything else is neutral.

### Dark (default)
- `--canvas` `#08090d`, `--canvas-2` `#0c0e14` — deep near-black, faint cool tint.
- `--surface` `#12141c`, `--surface-2` `#181b25`, `--surface-3` `#1f2330`.
- `--line` `#262a36`, `--line-2` `#343a4a`.
- `--ink` `#f4f5f8`, `--muted` `#9aa0b0`, `--faint` `#686e7e`.
- `--accent` `#ff751f` (soft `#ff8f47`, deep `#c2541a`).

### Light (editorial paper)
- `--canvas` `#f6f6f4`, `--canvas-2` `#fbfbfa`, `--surface` `#ffffff`,
  `--surface-2` `#f1f1ee`, `--surface-3` `#e9e9e5` — true off-white at near-zero
  chroma, not cream/sand.
- `--line` `#e2e2dd`, `--line-2` `#cfcfc8`.
- `--ink` `#15161a`, `--muted` `#5b5d66`, `--faint` `#8a8c94` (all ≥ AA on paper).
- `--accent` `#e05c12` (slightly deepened so it holds contrast on white).

Contrast verified to AA in both themes for body, muted body, and placeholders.

## Typography

- **Display:** Fraunces (serif) — headings, titles. Tight tracking
  (`-0.02em`), `text-wrap: balance`. The editorial voice.
- **Body:** Sora (geometric sans) — paragraphs, controls. Paired on a real
  contrast axis (serif × geometric), never two similar sans.
- **Technical accent:** mono (`ui-monospace, SFMono, Menlo`) — status badges,
  meta lines, keys, the "futuristic" register. Small, uppercase-optional,
  tracked. This is the futurism: monospace as instrument labels, not neon.
- Body measure capped 65–75ch; display clamp max ≤ 6rem.

## Motion

- **Framer Motion** — the sole motion layer: React component transitions
  (loaders, dropdowns, modals, list reveals). Restrained by design.
- No ambient/background motion (a WebGL backdrop + GSAP were tried and removed —
  the moving background was unwanted). Three.js/GSAP are not dependencies.
- Ease-out (expo/quart). No bounce/elastic. Every effect has a
  `prefers-reduced-motion` fallback.

## Components

- Buttons: `--primary-button` (accent, the one warm action), `--secondary-button`
  (neutral outline). Header actions are a compact single row.
- Cards/surfaces: full borders only — **no side-stripe accents** (banned).
- Status: mono badges, neutral; state is shown by label + subtle tone, not color
  bars.
- Modals: portal to `document.body`, full-viewport blurred backdrop, animated in.
- Dropdowns: custom `Select` (themed, animated, portal-safe) — no native control.
- One loader (`ThinkingLoader`) everywhere.

## Layout

- Centered editorial column (`--shell-width`), generous vertical rhythm, varied
  (not uniform) spacing. Flex for 1D, grid only for true 2D.
- Semantic z-index scale: backdrop (-1) → content → dropdown → modal-backdrop →
  modal → toast.
