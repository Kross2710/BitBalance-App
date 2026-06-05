# BitBalance-App

Vue 3 + Express + iOS Swift companion app. Separated from the PHP/RMIT monorepo
on 2026-06-05. The PHP project lives at `~/Projects/BitBalance/`.

- `client/` — Vue 3 + Vite frontend (`npm run dev` at `localhost:5173`)
- `server/` — Express API (`npm run dev` at `localhost:3000`), MySQL backend
- `ios-swift/` — SwiftUI iOS app (calls the Express server). **Direction under review (2026-06-05):
  the mobile app is now being considered as React Native instead of SwiftUI** — treat the Swift
  code/docs as the previous approach, not a committed target, until this is settled.

## No emoji

Do **not** use emoji anywhere in this project. This applies to:

- **Code & comments** — JS, CSS, Swift.
- **Commit messages, PR titles/descriptions, and branch names.**
- **User-facing UI copy** — page text, button labels, notifications. Use Font Awesome `fa-solid` icons instead.
- **Generated output and chat/AI responses** rendered to users.

## Project structure

### client/ (Vue 3 + Vite)

- `client/src/styles.css` — design tokens (`:root` CSS variables). **Single source of truth for all tokens.**
- `client/src/main.js` — app entry, Pinia + router setup
- `client/src/router.js` — route definitions
- `client/src/stores/auth.js` — auth state (Pinia)
- `client/src/lib/api.js` — axios wrapper; pass `{ background: true }` for requests that should not drive the top loading bar
- `client/src/lib/loadingBar.js` + `client/src/components/LoadingBar.vue` — global top loading bar, deferred ~280ms
- `client/src/views/` — page-level components
- `client/src/components/` — shared components
- `client/src/layouts/` — `AppLayout.vue` (main nav), `AdminLayout.vue`

### server/ (Express)

- `server/src/index.js` — app entry, middleware, route mounts
- `server/src/db.js` — MySQL pool
- `server/src/routes/` — route files (`auth`, `intake`, `dashboard`, `friends`, `profile`, `wrapped`, `pt`, `aiCoach`, `admin`, …)
- `server/src/lib/` — business logic (xp, streak, achievements, barcode, uploads, …)
- `server/src/middleware/` — `auth.js` (**session-based**, NOT JWT — reads the user row from the
  express-session + remember-me cookie via `currentUserRow(req)`), `rateLimit.js`, `tz.js`

### ios-swift/

- `ios-swift/BitBalance/` — Xcode project; calls the Express server via `APIClient.swift`.
  **Note (2026-06-05): mobile direction is being reconsidered toward React Native** — this Swift
  project may be superseded; confirm the chosen stack before extending it.

## Usernames / identity convention

- **`user_id`** (int, auto_increment) is the primary key for all foreign keys.
- **`user_name`** is a Discord-style handle (`Name#1234`), UNIQUE. Used for friend search.
- **`first_name`** is the display name for greetings. Never show the raw handle as a greeting.
- Handles contain `#` — never put `user_name` raw in a URL path. Pass `user_id` in links.

## Design system (Vue)

Single source of truth: `client/src/styles.css` + `DESIGN.md`.

Tone: **dark, flat, compact.**
- Accent: `#4ade80`
- Border: `1px solid var(--border)` — no `0 4px 0` 3D shadow
- Padding tight (`20px` card / `12–16px` list), `max-width: 820px`
- Font Awesome `fa-solid` icons, no emoji
- No Duolingo-style `#58CC02` / `#FF9600`, no chunky 3D shadow, no long scroll

### Mobile-first

Design and verify at **375px wide** first. Tap targets >= 44px. Core action (log a meal) must need fewest taps.

### Loading & feedback UX

- **Skeleton placeholders** for a view's own data load — reserves layout height, no CLS jump. See `DashboardView`, `IntakeView`, `FriendsView`.
- **Global top loading bar** only for genuinely slow work (route changes, AI Coach, Wrapped). Deferred ~280ms so fast calls never flash it.
- **Never double-signal.** If a surface already has its own skeleton, call `api.get(url, { background: true })`.
- Background calls (do NOT drive the bar): nav-badge refresh, friends/chat polls, type-ahead searches, `dashboard/day` data.

## Quick checklist before building a feature

- [ ] New view? Read `DESIGN.md` + `client/src/styles.css` first.
- [ ] Show loading? Skeleton for content, bar only for slow async work. Never both.
- [ ] Uploading files? Check server `upload_max` config; store URL-relative path in DB.
- [ ] New API route? Wire auth middleware and add rate-limit where appropriate.
- [ ] Referencing a user? Use `user_id` in URLs/params, `user_name` only in POST body / display.
