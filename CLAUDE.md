# CLAUDE.md

## Project focus
Vue 3 / Express / mobile app — the active migration target from BitBalance PHP.
Stack: `client/` (Vue 3 + Vite + Pinia), `server/` (Express + MySQL, **session-based auth**),
`ios-swift/` (SwiftUI). **Mobile direction under review (2026-06-05): now leaning React Native
instead of SwiftUI** — Swift code is the prior approach, not a committed target.

## Design language
- **Single source of truth**: `client/src/styles.css` (`:root` tokens) + `DESIGN.md`.
  Read before building any view or mockup.
- Tone: **dark, flat, compact** — accent `#4ade80`, border `1px var(--border)`, no chunky shadow `0 4px 0`,
  tight padding, `max-width: 820px`, Font Awesome `fa-solid` icons (**no emoji**).
- Do NOT drift toward the PHP/beats style: Duolingo green `#58CC02`, 3D shadows, large padding, emoji, long scroll.
  See "Anti-patterns" in `DESIGN.md`.

## No emoji
Do **not** use emoji anywhere — code, comments, commit messages, branch names, or user-facing UI copy.
Use Font Awesome SVG icons instead.

## Key docs
- `HANDOFF.md` — where to resume migration work
- `MIGRATION.md` — feature port status
- `DESIGN.md` — Vue design system
