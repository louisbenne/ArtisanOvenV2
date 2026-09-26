# ArtisanOven V2 — Rules for Claude Code

Read this file fully at the start of every session. The full build plan is in
`docs/V2_MASTER_PLAN.md`; the live parity checklist is `docs/PARITY.md`.

## Mission (one sentence)

V2 must **look exactly like v1 and do exactly what v1 does**, but run on a new
backend (Node + Express + PostgreSQL) instead of Google Forms / Sheets / Apps Script.

## Golden rules

1. **The frontend is frozen.** Everything under `public/` is a verbatim copy of v1.
   Do not change markup, class names, CSS, copy text, images or fonts unless the
   task explicitly names the file and the change. Allowed edits: replacing a
   `fetch(...)` call site with a call into `public/js/api.js`, adding the
   `api.watchSoldOut()` script line to `index.html` / `fully-booked.html`, and the
   three sanctioned UI changes listed in the master plan (native lunch order form,
   admin login username field, new admin cards for v2-only features).
2. **All network calls from the browser go through `public/js/api.js`.** No page
   may call `fetch` against the backend directly. `api.js` returns objects in the
   exact shape the v1 page code already expects, so page logic stays untouched.
3. **v1 is the specification.** `docs/v1-reference/` is a read-only snapshot of
   the v1 repo. When `docs/ArtisanOven_System_Documentation.md` and the v1 code
   disagree, the v1 code wins. Never edit anything in `docs/v1-reference/`.
4. **URLs stay identical to v1.** `/`, `/order.html`, `/Payment.html` (capital P —
   old confirmation emails link to it), `/events.html`, `/event-order.html?event=`,
   `/parent-order.html`, `/kitchen.html`, `/admin.html`, `/terms.html`,
   `/fully-booked.html`. Installed PWAs and emailed links depend on these paths.
   **Home page source:** `public/index.html` is v1's normal home page from commit
   `0c2a41c^` (kept in `docs/v1-reference-extra/`), NOT v1's current `index.html`,
   which is the fully-booked page.
5. **Money is integer pence** everywhere in the backend. Convert to pounds only in
   `api.js` / email templates.
6. **Capacity is fractional**: whole = 1.0, half = 0.5, quarter = 0.25.
   Prices: whole £8, half £5, quarter £3. Single source: `backend/src/domain/pricing.js`.
7. **Times are Europe/London.** The server runs in UTC; all schedule logic
   (auto-close, reopen, service day) must go through `backend/src/domain/schedule.js`.
8. **Never trust the client** for price, discount, capacity, order type or role.
9. **Tests before done.** A task is not finished until `npm test` (backend) and the
   relevant Playwright suite in `e2e/` pass. Add tests for every bug you fix.
10. **Workflow:** one task = one branch = one PR. Never push to `main`. In the PR
    body: what changed, how it was tested, what is still missing. Tick the
    matching rows in `docs/PARITY.md` in the same PR.
11. **Ask before:** adding a dependency, changing the DB schema outside a new
    migration file, touching auth/payments/discount logic beyond the task,
    deleting anything from `public/`, or changing `infra/` production files.
12. **Secrets:** never commit `.env`, tokens, passwords or real customer data.
    Fixtures use fake names and `@example.com` emails only.

## Directory layout (target)

```
public/                 v1 frontend, verbatim (served as the site root)
  js/api.js             the ONLY browser→backend client (v1-shaped responses)
  js/admin/*.js         admin.html inline JS, extracted into modules (Phase 5)
backend/
  server.js
  src/db/               index.js (postgres.js), migrate.js, migrations/NNN_*.sql
  src/domain/           pricing.js, schedule.js, discounts.js, orderNumbers.js
  src/routes/           one file per feature, all registered in routes/index.js
  src/middleware/       requireAuth, requireParent, errorHandler, rateLimit
  src/services/         email/, notifications, audit, exports (xlsx, checklist, pdf)
  src/sockets/
  scripts/              seed-admin.js, migrate-from-v1.js
  test/                 unit + API integration tests
infra/                  docker-compose.yml (+ .dev.yml, .prod.yml), Caddyfile, backup.sh
e2e/                    Playwright: visual diff vs v1, end-to-end flows, fixtures
docs/
  V2_MASTER_PLAN.md     the plan
  PARITY.md             v1 feature → v2 status checklist (keep updated)
  v1-reference/         read-only v1 snapshot (v1 repo at HEAD)
  v1-reference-extra/   v1 files recovered from git history (normal home page)
  ArtisanOven_System_Documentation.md
```

## Commands

Docker Compose is the standard way to run and test everything (production runs the same
stack on Louis's own server/PC with `infra/docker-compose.prod.yml`).

Wrappers live in the root `package.json` (no `make` on the Windows machine).
Compose projects: `ao-dev` (dev/test) and `ao-prod` (production) — they can run side by side.

```bash
npm run dev        # dev stack in the foreground (dev:up = detached, dev:restart = reload code, dev:down = stop)
                   #   site + API  → http://localhost:8080   (dev admin: admin / admin)
                   #   Mailpit     → http://localhost:8025   (every outgoing email lands here)
npm test           # backend unit + integration tests inside the api container (real Postgres 16)
npm run e2e        # Playwright visual + flow tests against the dev stack
npm run reset-db   # drop the dev volume, re-migrate, re-seed
npm run logs       # follow dev api logs
npm run prod:up    # build + start production (Caddy HTTPS, restart policies, backups)
npx playwright test --update-snapshots   # ONLY when Louis asks to re-baseline v1 screenshots
```

All settings/secrets live in `infra/.env` (template: `infra/.env.example`).
Never point the dev stack at real SMTP credentials; emails go to Mailpit.

## Key design decisions (keep)

- postgres.js tagged templates, no ORM, no build step, no TypeScript.
- Unified `orders` + `order_items` for lunch / event / parent orders.
- Payments ledger (`payments`, negative = refund); `payment_status` derived from it.
- Per-admin accounts with roles: owner(4) > treasurer(3) > kitchen(2) > volunteer(1).
- Parent sessions are **separate** from admin sessions (`parent_sessions` table).
- Discount codes have a `scope` (`public` | `parent_gate`); gated codes are only
  applied server-side to parent orders, never accepted from a public request.
- **Order numbers exactly like v1** (plan §4B): lunch `#1, #2…` restarting every new
  session; events and parent orders share one never-resetting counter shown as `E101`.
  Admin routes use internal ids, never display numbers. Kitchen pickup IDs `12-1`, `E101-2`.
- **Sold-out mode** (plan §4A): when the current session has `remainingPizzas <= 0`, `/`
  serves `public/fully-booked.html` (same file, unchanged look) and `/order.html` redirects
  to `/`. A deadline close is NOT sold out. Pages flip automatically via `api.watchSoldOut()`.
- Socket.IO `/admin` and `/kitchen` namespaces replace v1's polling.
