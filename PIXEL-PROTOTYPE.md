# Pixel "Bit" identity — prototype notes

**Status: PROTOTYPE / reference only. NOT adopted. Decide later.**
Explored 2026-06-07 in response to a "the design looks generic / lacks a graphic layer" critique.
Nothing in `client/src/` was changed — the real app and its flat design system are untouched.

This doc is a parking spot so the exploration isn't lost. It is **not** part of the design system;
`DESIGN.md` + `client/src/styles.css` remain the single source of truth.

## The idea

Add an ownable graphic layer using a pixel / 8-bit "Bit" motif (the name *Bit*Balance), **without**
breaking `DESIGN.md` rules: dark, flat, no smooth gradient, no 3D shadow, no emoji. Pixel art is
flat by nature, so it fits the rails while giving the app something distinctive.

- Sprites: hand-authored as SVG `<rect>` cells + `shape-rendering: crispEdges` (a small `sprite()`
  helper builds them from a char-map). No raster assets.
- Pixel font (`Press Start 2P`) used sparingly, for game-moment labels only.
- Mascot "Bit" derived from the existing "B" logo.

## Mocks (standalone HTML, served by the vite dev server)

Live at `localhost:5173/<file>` while `npm run dev` runs in `client/`. Files live in `client/public/`:

| File | Surface | Key idea |
| --- | --- | --- |
| `mock-bit.html` | Progress | pixel level medal, segmented XP bar, badge grid, Bit mascot empty-state |
| `mock-bit-dashboard.html` | Dashboard | calories as a game **energy bar**, 7-day chart as an **equalizer**, pixel meal sprites |
| `mock-bit-wrapped.html` | Weekly Wrapped | retro **arcade recap** — RPG class card / HIGH SCORES / WEEK COMPLETE |
| `mock-bit-intake.html` | Intake | identity dialled **down** — clean inputs, pixel only on accents + a `+10 XP` reward toast |

Design point the set proves: one pixel language can scale across an **intensity spectrum** —
calm/functional (Intake) → data (Dashboard) → reward (Progress) → loud (Wrapped).

## Honest cost assessment (why it's parked, not adopted)

The full version **would over-complicate the project** for its current stage (mid-migration, still
porting features per `MIGRATION.md` / `HANDOFF.md`):

1. **Vietnamese font is a blocker.** `Press Start 2P` has no VI diacritic glyphs — "Bữa trưa",
   "Phở Bò", "Đã ghi nhận" fall back to a mismatched font, breaking baseline + the pixel look.
   The app is bilingual EN/VI, so the pixel font is usable for numbers/English only; VI labels
   would need a custom VI-capable pixel font (rare, costly). **Verified visually 2026-06-07.**
2. **A brand-new asset system.** The app currently has zero images (only the favicon). Pixel adds a
   sprite layer to author + maintain — hand-coded maps (tedious) or real pixel art (needs an artist).
3. **Two design languages = ongoing decision tax.** Every new feature would need a "how pixel is
   this" judgment, and the currently-clean flat `DESIGN.md` forks.

## If "generic" needs fixing without this complexity

Most of the generic feel is fixable with ~10% of the effort, staying fully within the flat system:

- Custom empty-state line-art (one-stroke) instead of a grey Font Awesome icon — the blankest screens.
- Lean on data-viz as identity (ring / sparkline / energy bar) using existing tokens.
- A single "Bit" mascot used at a few touch-points — no full sprite set.

## Paths forward (when revisited)

- **Feedback strongly likes pixel** → ship a *contained* version: pixel only at reward moments
  (level-up, streak, Wrapped), numbers/English only to sidestep the VI font issue. Harden into
  `client/src/lib/pixel.js` + a `<PixelSprite>` component; add a "Pixel layer" section to `DESIGN.md`.
- **Feedback is neutral** → do the flat fixes above; keep the current design.
- Either way: the mock files live under `client/public/`, so they **ship if `client/` is built/deployed**.
  Delete them before a production deploy if unwanted.
