# Artisan Oven V2 — Master Build Plan

**Goal:** v2 looks pixel-identical to v1 and does everything v1 does, but the backend
is completely different (Node + Express + PostgreSQL, no Google Forms / Sheets / Apps Script).
**Builder:** Claude Code, one phase-task at a time, with Louis reviewing each PR.
**Status date:** 26 Sept 2026 (v1 = live in production, v2 repo at commit `40ad407`).

---

## 0. Where things actually stand

### 0.1 v2 is further along than "just started"

The v2 repo already has a real backend: Express server, a sensible PostgreSQL schema
(unified orders, order items, payments ledger, sessions, per-admin accounts with roles,
audit log), a central route table, Socket.IO for the kitchen, a Dockerfile and Railway
config. **That foundation is worth keeping.** This plan finishes it rather than starting over.

### 0.2 But the frontend is not v1

v2's `frontend/` and `admin/` are a *redesign "in the v1 style"*, not v1's files:

- `style.css` is a 619-line rewrite (v1's is 2,940 lines). Different colour values
  (v2 cream `#FAF8F5` vs v1 `#F7F3EC`), different CSS variable names, different
  font-family name (`BaarSophia` vs `"Baar Sophia"`).
- There is **no `fonts/` folder** in v2, so the brand font 404s.
- The admin is 8 small new pages (~1,500 lines total) replacing v1's 4,298-line
  `admin.html` + `admin_events.js`. Many v1 buttons have no v2 equivalent (see §4).
- The parent order page only allows one pizza (v1 allows many children/pizzas).

Since the requirement is "exact look of v1", the plan **replaces v2's frontend with v1's
actual files** and rewires only their network calls (§2).

### 0.3 Critical bugs in the current v2 backend (verified)

Items marked ✔ were reproduced by running v2's own schema and SQL against a real
PostgreSQL engine (PGlite).

| # | Problem | Impact |
|---|---|---|
| 1 ✔ | `schema.sql` is **not** idempotent: `ALTER TABLE payments ADD CONSTRAINT …` fails on the second run ("constraint already exists"). The Dockerfile runs migrate on every boot and `migrate.js` exits 1 on failure. | After the first successful deploy, **every restart/redeploy crash-loops** — server never starts. |
| 2 ✔ | `orders.create` uses `SELECT … GROUP BY … FOR UPDATE`. Postgres rejects this ("FOR UPDATE is not allowed with GROUP BY clause"). | **Every lunch order fails with a 500.** |
| 3 | `parentAuth` issues a token by inserting into `admin_sessions` for a `parent_gate` user whose role is `volunteer` (and whose password hash is copied from the owner's). | Anyone with the parent access code gets **admin volunteer access**: can list every customer's name/email, delete orders, resend emails. |
| 4 | `/api/orders` accepts any active discount code from the request body, and `/api/parent-orders` has no auth check. | **Any member of the public can apply MUTTI (50% off).** |
| 5 | `parent-order.html` posts `orderType: 'parent'` to `/api/orders`, which only accepts `lunch`/`event`. | **Parent orders always fail** (400). |
| 6 | Frontend ↔ backend mismatches: `order.html` calls `/api/discount/check` (doesn't exist); `settings.html` calls `/admin/audit` (route is `/admin/audit-log`), `GET /admin/settings/discounts/:code` and `GET /admin/users/:id` (don't exist). | Discount check, audit log, edit-discount and edit-user are broken. |
| 7 | `adminList` and `money.summary` `LEFT JOIN` payments together with items/other payments, then `SUM`. | Amount-paid and income figures are **multiplied** by item/payment counts. |
| 8 | `adminByEvent` sets `req.query.eventId` but `adminList` never filters on it. | Event order filter shows all event orders. |
| 9 | Confirmation emails link to `payment.html?q=…&token=…` but `payment.html` ignores `token`. v1's emails link to `Payment.html?order=N&token=…`. | "View my order" links don't use the secure token; **every v1 link already in parents' inboxes will break** at cutover. |
| 10 | `migrate-from-v1.js` expects columns `Name, Email, Size, Topping, Paid` — v1 has none of these (its layout is the positional `BRANCHES` scheme). | Migration script cannot import real v1 data. |
| 11 | Discount `times_used` increments every time a payment is recorded on an already-paid order. | Limited-use codes run out early. |
| 12 | Idempotency key stored inside `notes` (`sub:…`) and matched with `LIKE`. | Junk text shows on admin/kitchen screens; slow and fragile. |
| 13 | `requireAuth` accepts `?_token=` in the query string. | Admin tokens leak into logs/history (the same flaw v1 had). |

### 0.4 Also found in v1 that the documentation doesn't mention

- **v1's current `index.html` is the fully-booked page, not the normal home page.** On
  23 Sept (commit `0c2a41c`) the home page was manually swapped for the "Thank You Everyone
  for Ordering!" page. `fully-booked.html` is now a byte-identical copy of it (dynamic "next
  opening time" from settings + a PAY FOR YOUR ORDER button). **The normal home page (hero,
  availability tracker, I WANT TO ORDER / I NEED TO PAY cards) only exists in git history**:
  `git show 0c2a41c^:index.html`. `live.html` is an earlier draft of the fully-booked page
  with the date hardcoded ("Tuesday the 29th") and no pay button.
- **Order numbers:** lunch orders are `#1, #2, …` and **restart at #1 every week**
  (Start New Week deletes the response rows: "so next form submission is on row 2 = Order 1").
  Event **and** parent orders share one global counter printed as `E` + number (`E101`),
  seeded at ≥ 100 and never reset (`getNextOrderNumber` in `apps-script.js`).
- `kitchen-board.js` actually builds the board from `adminLogin` + `adminGetSettings` +
  `adminGetOrders` and keeps ticks in `localStorage`; the documented `kitchenLoad/Save/Status`
  actions exist in the backend but the page doesn't call them. **v1 code is the source of truth.**
- `ArtisanOven Documentation.zip` sits in the v1 repo root.

---

## 1. Strategy in one paragraph

**Transplant, don't redesign.** Copy v1's frontend files byte-for-byte into v2's `public/`
folder, served from the same URLs. Add one new file, `public/js/api.js`, that talks to the
new REST backend and hands each page data in exactly the shape v1's Apps Script used to
return — so page code and CSS stay untouched and the look is guaranteed identical. Finish
and harden the existing v2 backend until every v1 action has a working equivalent (§4).
Prove "same look" with automated screenshot diffs of v1 vs v2 using identical fixture data,
and prove "same behaviour" with end-to-end flow tests. Migrate v1's data (keeping old order
tokens so emailed links still work), run both systems in parallel on a staging domain for a
dress-rehearsal week, then cut over DNS on a Monday when ordering is closed anyway.

**Why an adapter (`api.js`) and not a fake `?action=` endpoint?** A shim that mimics Apps
Script would keep v1's worst habits (GET requests that change data, passwords in URLs).
With `api.js` the wire protocol is clean REST, and the translation lives in one testable file.

---

## 2. Target architecture

```
                                  Docker Compose — identical stack for testing and production
Browser (v1 HTML/CSS, unchanged)  ┌───────────────────────────────────────────────────────┐
┌──────────────────────────────┐  │ caddy   HTTPS for artisanoven.shop → api:3000         │
│ index / fully-booked /       │  │   │                                                   │
│ order / Payment / events /   │──┼─▶ api (Express)                                       │
│ event-order / parent-order / │  │     /api/*      REST routes                           │
│ terms / admin / kitchen      │◀─┼──   /socket.io  /admin, /kitchen                      │
│ (PWA manifests + SWs as v1)  │  │     /           index.html OR fully-booked.html (§4A) │
└──────────────────────────────┘  │     static      public/ (same origin)                 │
                                  │     domain/     pricing, schedule, discounts, numbers │
                                  │   │                                                   │
                                  │ db  PostgreSQL 16 (volume) ── backup: nightly pg_dump │
                                  └───────────────────────────────────────── off-machine ─┘
   Testing: your laptop, `docker compose up`.   Production: your own server or PC (D1).
```

Same origin for site + API removes all CORS issues and the v1 `config.js`/`/api/status`
proxy tricks (the status endpoint is simply fast now, with a short in-memory cache).
The same `docker-compose.yml` runs everywhere; production only adds an override file
(real domain, secrets, restart policies, backups).

---

## 3. Decisions Louis needs to make

Claude Code should stop and ask if it reaches a phase that depends on an unanswered one.
Recommendations in **bold**.

| # | Decision | Options | Needed by |
|---|---|---|---|
| D1 | Hosting | ✅ **Decided:** Docker Compose for all development and testing; production on Louis's own server or PC using the same Compose stack. Railway config is removed. Still open for Phase 8: how the machine is reached from the internet (router port-forward + Caddy auto-HTTPS, or a tunnel — see Phase 8). | done |
| D2 | Outgoing email | Gmail SMTP with an app password on the current account (smallest change) vs a transactional provider (Resend / Postmark / SES) with SPF/DKIM on `artisanoven.shop` (**better deliverability**). | Phase 6 |
| D3 | Admin UI | **Port v1 `admin.html` look exactly**, adding v2-only features (users/roles, payments ledger, audit) as extra cards in v1 styling. Alternative: keep v2's new admin pages (breaks "exact look"). | Phase 5 |
| D4 | Order numbers | ✅ **Decided: exactly like v1.** Lunch `#1, #2…` restarting each week; event + parent orders share one `E` counter (`E101`), continuing from v1's last number. Spec in §4B. | done |
| D5 | WhatsApp + PayPal webhooks | v2 has stubs. **Launch without them** (v1 didn't have them); enable after cutover. | Phase 8 |
| D6 | Toppings | v1 is margherita-only. **Hide `topping` in v2 for launch**; keep the column for later. | Phase 3 |
| D7 | Fully-booked page | ✅ **Decided:** when all pizzas are gone, the home page automatically becomes v1's fully-booked page, using the same HTML file (`fully-booked.html`). `live.html` (old hardcoded draft) just redirects to `/`. Spec in §4A. | done |
| D8 | Admin login | v1 = one shared password. v2 = username + password per person. **Accept the one sanctioned change: a username field on the v1 login screen.** | Phase 5 |
| D9 | Cutover date | **A Monday** (v1 is closed all Monday by its own schedule). | Phase 9 |

---

## 4. Parity matrix (v1 action → v2 endpoint)

Copy this into `docs/PARITY.md` in Phase 0 and keep it updated in every PR.
Status now: ✅ works · ⚠️ partial/buggy · ❌ missing/broken.

### Public

| v1 action / feature | v2 endpoint (target) | Now | Fix in |
|---|---|---|---|
| `getStatus` (tracker, pills, messages) | `GET /api/status` → v1-shaped object | ⚠️ `/sessions/current` lacks `serviceNoticeDate`, `nextOpeningTime`, `capacityMessage`, `deadlineMessage`, `closedMessage`, `closingSchedule`, `currentOrders`, `isPastDeadline` | P4 |
| Google Form lunch order | `POST /api/orders` `{type:'lunch'}` | ❌ SQL error (bug 2) | P0, P3 |
| `getOrder` (email / order # / token) | `GET /api/orders/lookup?q=&token=` | ⚠️ token ignored by page, response shape differs, legacy `?order=N&token=` links | P2 |
| `getEvents` / `getEvent` | `GET /api/events`, `GET /api/events/:slug` | ⚠️ no `description`, `ordering_deadline`, string slug IDs | P4 |
| `registerInterest` | `POST /api/events/:slug/interest` | ✅ (param names differ: handled in `api.js`) | P2 |
| `createEventOrder` | `POST /api/orders` `{type:'event'}` | ⚠️ no `qty`, no Closed-status/deadline check, no dedicated confirmation | P4 |
| `parentAuth` | `POST /api/parent/auth` → parent session | ❌ security hole (bug 3) | P0 |
| `createParentOrder` | `POST /api/parent/orders` (parent session required) | ❌ 400 + no auth (bugs 4, 5) | P0, P4 |
| `getVersion` | `GET /api/version` | ❌ | P4 |
| Discount code on lunch form | `POST /api/discounts/check` | ❌ (page calls missing route) | P4 |
| **Sold-out mode:** home page automatically becomes the fully-booked page (§4A) | `/` serves `fully-booked.html` while sold out; `/order.html` redirects to `/` | ❌ (v1 did this by hand on 23 Sept) | P1, P2, P4 |
| **Order numbers like v1** (§4B): lunch `#N` restarting weekly, shared `E101` counter for events + parents | `domain/orderNumbers.js` | ❌ v2 uses `L-0001` / `E-0001` / `P-0001` | P0 |

### Admin & kitchen

| v1 action / button | v2 endpoint (target) | Now | Fix in |
|---|---|---|---|
| `adminAuth` / `adminLogin` | `POST /api/admin/login` | ✅ | — |
| `adminLogout` | `POST /api/admin/logout` | ✅ | — |
| `adminChangePassword` | `POST /api/admin/me/password` | ❌ | P4 |
| `adminGetSettings` (settings + live stats + last 20 log rows) | `GET /api/admin/dashboard` | ⚠️ spread over 3 routes, fields missing | P4 |
| `adminUpdateSettings` (both forms) | `PATCH /api/admin/settings` + `PATCH /api/admin/sessions/current` | ⚠️ | P4 |
| `adminStartNewSession` ("Start New Week") | `POST /api/admin/sessions` (archive, don't wipe; email summary + xlsx first) | ⚠️ no archive emails | P4 |
| `adminGetOrders` / `adminGetParentOrders` | `GET /api/admin/orders?type=` | ⚠️ inflated totals (bug 7) | P0 |
| `adminUpdatePaidStatus` (checkbox) | `POST /api/admin/orders/:id/mark-paid` and `/mark-unpaid` (ledger entries) | ⚠️ ledger only, no one-tap toggle | P4 |
| `adminUpdatePaymentMethod` | `PATCH /api/admin/orders/:id` | ✅ backend / ❌ UI | P5 |
| `adminDeleteOrder` (soft) | `DELETE /api/admin/orders/:id` | ✅ backend / ❌ UI | P5 |
| `adminResendConfirmation` | `POST /api/admin/orders/:id/resend` | ✅ (inconsistent id vs code) | P4 |
| `adminSendAutomatedEmail` (Confirmation / Ready for Collection / Custom / Operational Summary / Live xlsx) | `POST /api/admin/comms/send` + `/internal-summary` + `/xlsx` | ⚠️ confirmation/ready only | P6 |
| `adminGetOrdersChecklist` (iframe, Print) | `GET /api/admin/checklist.html` | ❌ | P4 |
| `emailOrdersPdf` | `POST /api/admin/checklist/email` | ❌ | P6 |
| `emailXlsxSnapshot` (after every change) | `GET /api/admin/exports/orders.xlsx` + debounced email | ❌ | P4, P6 |
| `adminGetEvents` / `adminSaveEvent` / `adminDeleteEvent` / Active + Register-Interest toggles | `/api/admin/events…` | ✅ (missing fields) | P4 |
| `adminGetEventOrders` (per-event filter) | `GET /api/admin/orders?type=event&event=` | ❌ filter ignored (bug 8) | P0 |
| `adminGetRegisterInterest` | `GET /api/admin/events/interest` | ✅ | — |
| `adminSetParentAccessCode` | `PUT /api/admin/settings/parent-access-code` | ⚠️ create only | P4 |
| Discount codes (v1: sheet tab) | `/api/admin/settings/discounts…` | ⚠️ bug 6, 11 | P0, P4 |
| Kitchen board (tick, progress, allergy, detail modal, cutoff timer, filter/sort, xlsx offline upload) | `GET /api/admin/kitchen/board`, `PATCH /api/admin/kitchen/items/:id`, socket `/kitchen` | ⚠️ backend ✅, v1 UI not ported | P5 |
| Audit log | `GET /api/admin/audit-log` | ✅ backend, page calls wrong URL | P0 |
| **New in v2:** admin users/roles, payments ledger, money report, CSV export | existing routes | ✅ backend | P5 (UI in v1 style) |

### Emails (§11 of the v1 docs)

| v1 email | v2 template file | Now |
|---|---|---|
| Lunch order confirmation (#N, secure link, items, discount, total, payment block, collection info, WhatsApp group link) | `email/templates/order-confirmation.js` | ⚠️ generic, not v1 design |
| Event order confirmation (+ event subject/message overrides) | `event-confirmation.js` | ❌ |
| Parent order confirmation + internal "NEW INTERNAL PARENT ORDER" alert | `parent-confirmation.js`, `internal-parent-alert.js` | ❌ |
| Ready for Collection (+ optional message) | `ready-for-collection.js` | ⚠️ |
| Custom message | `custom.js` | ❌ |
| Live spreadsheet (.xlsx attachment) | `xlsx-snapshot.js` | ❌ |
| Operational Summary (lunch box, parent box, totals, admin notes) | `internal-summary.js` | ❌ |
| Orders checklist PDF | `checklist-pdf.js` | ❌ |

---

## 4A. Sold-out mode — the home page becomes the fully-booked page (decided)

**What Louis wants:** when all the pizzas are gone, the fully-booked page appears as the main
page automatically, using the same HTML file v1 uses. No more swapping files by hand.

**Source files**
- Normal home page → `public/index.html` = v1's `git show 0c2a41c^:index.html`
  (tracker + order/pay cards). *Not* v1's current `index.html`.
- Fully-booked page → `public/fully-booked.html` = v1's current `fully-booked.html`, unchanged
  except its one `fetch('/api/status')` call site, which moves into `api.js` (golden rule 2).
- `live.html` → 302 redirect to `/` so any old link lands on whatever is current.

**Trigger:** exactly v1's own "Fully Booked" condition — the current session has
`remainingPizzas <= 0` (fractional: 0.25 left still counts as open, like v1).
A deadline close (Sunday 9 pm) is **not** sold out: the normal home page stays with its
"Orders Closed" pill, because the fully-booked wording ("we were fully booked") would be wrong.

**Server behaviour**
- `GET /` and `GET /index.html` → serve `fully-booked.html` while sold out, otherwise
  `index.html`. Same URL, no redirect, `Cache-Control: no-cache` so it flips instantly.
- `GET /order.html` (and its aliases) → 302 to `/` while sold out (what v1 did by hand on
  23 Sept in `server.js`). `Payment.html` always works — the fully-booked page links to it.
- `/fully-booked.html` stays directly reachable so admins can preview it.
- The sold-out check reads the same cached status as `/api/status` (cache cleared on every
  order, deletion, capacity change and new week), so it costs nothing per request.

**Browser behaviour (no manual refresh needed)**
- `/api/status` gains `soldOut` (plus `nextOpeningTime` and `ordersTeamEmail`, which the
  fully-booked page reads).
- `api.js` exposes `watchSoldOut({ reloadWhen: true | false })`. The home page already polls
  status every 20 s; when `soldOut` becomes true it calls `location.replace('/')`. The
  fully-booked page gets one added `<script>` line to poll every 60 s and reload when
  `soldOut` becomes false (admin raised capacity, an order was deleted, or a new week started).
- Admin dashboard shows a small "Site is showing: Fully booked page" indicator (v1 card style).

**Admin control:** the "next opening time" text shown on the page stays an admin setting
(as in v1 since 23 Sept), pre-filled from the weekly schedule so it's right by default.

**Tests (Playwright + API)**
1. Fill capacity exactly → `/` returns the fully-booked HTML; `/order.html` redirects to `/`.
2. Delete one order → `/` returns the home page again.
3. Home page open in a browser, last pizza sold via API → page switches within one poll.
4. Deadline passed but pizzas left → `/` still serves the home page with "Orders Closed".
5. Visual: fully-booked page matches the v1 baseline screenshot.

---

## 4B. Order numbers exactly like v1 (decided)

| Order type | v1 format | Rule |
|---|---|---|
| Lunch | `#1`, `#2`, … | Restarts at 1 for each new ordering session (Start New Week). |
| Event | `E101`, `E102`, … | One global counter shared with parent orders, never resets. |
| Parent (internal) | `E103`, … | Same shared counter as events. |

Implementation rules for Claude Code:
- Replace `order_code_counters` / `L-0001` style codes with: `ordering_sessions.next_lunch_number`
  (incremented inside the same transaction that locks the session row for the capacity check),
  and one shared counter row for `E` numbers.
- Store `orders.order_number` (integer) and `orders.order_ref` (`'12'` or `'E101'`). Unique
  constraints: `(session_id, order_number)` for lunch; `order_ref` globally for E orders.
- Everything customer-facing shows v1's formats: `#12` for lunch, `E101` for events/parents
  (emails, Payment page, confirmation panels). Kitchen pickup IDs stay `12-1`, `12-2`,
  `E101-1`.
- **Lookup by bare number** (`12`) searches the **current session only** — the same result v1
  gave, since v1 deleted old weeks. Email links always carry the token, so a link from an old
  week still opens the right order (an improvement: in v1 those links died every week).
- Admin routes take the internal database id, never the display number, so a repeated `#12`
  across weeks can never hit the wrong order.
- Migration (Phase 7): current-week lunch orders keep their v1 numbers and the session counter
  continues after the highest; the `E` counter continues from v1's `NEXT_ORDER_NUMBER`.

---

## 5. The phases

Each phase lists the goal, the tasks, the "done when" checks, and a prompt you can paste into
Claude Code. Do phases in order; tasks inside a phase can be separate PRs.

**Standard opening for every Claude Code session** (paste first):

```
Read CLAUDE.md, docs/V2_MASTER_PLAN.md (the phase we are on), and docs/PARITY.md.
Use plan mode first: show me your plan for this task and wait for my OK before editing.
Work on a new branch named phase-<n>-<short-name>. Open a PR when tests pass.
```

---

### Phase 0 — Stabilise, Docker test stack and safety net (≈2–3 days)

**Goal:** the current backend boots reliably, the critical bugs are gone, and there's a test
harness so nothing regresses from here on.

Tasks
1. **Repo prep.** Add `CLAUDE.md` (the new one), this plan as `docs/V2_MASTER_PLAN.md`,
   `docs/ArtisanOven_System_Documentation.md`, and `docs/PARITY.md` (from §4). Copy the v1 repo
   (minus `.git` and the zip) into `docs/v1-reference/` as a read-only snapshot.
2. **Migrations system.** Replace single `schema.sql` with `src/db/migrations/001_init.sql …`
   plus a `schema_migrations` table so each file runs exactly once. Make `001` the current
   schema with the payments FK created idempotently. Fixes bug 1.
3. **Lunch order transaction.** Lock the session row with `SELECT … FROM ordering_sessions …
   FOR UPDATE` first, then compute current capacity in a separate aggregate query. Fixes bug 2.
4. **Parent security.** New `parent_sessions` table + `requireParent` middleware; delete the
   `parent_gate` pseudo-user; `/api/parent/orders` requires a parent session. Add
   `discount_codes.scope` (`public` | `parent_gate`); public orders reject gated codes; parent
   orders get the gated discount applied server-side from the access code. Fixes bugs 3, 4, 5.
5. **Aggregation bugs.** Rewrite `adminList` and `money.summary` using sub-queries/CTEs for
   payments and items (never two one-to-many joins under one `SUM`). Implement the event filter.
   Only increment discount usage on the *transition* to paid. Fixes bugs 7, 8, 11.
6. **Idempotency.** `orders.submission_id TEXT UNIQUE`; duplicate submit returns the original
   order. Remove `sub:` from notes. Fixes bug 12.
7. **Auth tokens only in `Authorization` header** (sockets use handshake auth). Fixes bug 13.
8. **Test harness.** `node --test` + `supertest`, running against the real Postgres 16 container
   from task 9 (PGlite only as a quick no-Docker fallback). GitHub Actions runs the same tests
   with a `postgres:16` service on every PR.
9. **Docker is the standard way to run and test v2 (D1).** Keep `infra/docker-compose.yml` as the
   base (db, api, backup) and split it into:
   - `infra/docker-compose.dev.yml` — for testing on your laptop: site + API on
     `http://localhost:8080` (no TLS), **Mailpit** container that catches every outgoing email
     (web inbox at `http://localhost:8025`, so emails can be checked without sending anything
     real), fixture data seeded on first start, `docker compose … run --rm api npm test`.
   - `infra/docker-compose.prod.yml` — for the production machine (Phase 8): Caddy with
     `SITE_ADDRESS=artisanoven.shop`, restart policies, backups.
   - One-word wrappers in a root `Makefile` or `package.json`: `dev`, `test`, `e2e`, `logs`,
     `reset-db`, `prod-up`, `prod-deploy`.
   - Delete `railway.json`; make DB SSL opt-in (`DB_SSL=true`) instead of the Railway-only
     `rejectUnauthorized: false`; use one `.env` location (`infra/.env`) and an up-to-date
     `.env.example`; update README.
10. **Order numbers like v1 (§4B).** Migration + `domain/orderNumbers.js`; replace the
   `L-/E-/P-` code generator; per-session lunch counter incremented under the session row lock;
   shared `E` counter for events and parents.

Done when
- `make dev` (or the npm equivalent) brings up the whole stack from a clean checkout;
  `docker compose restart api` five times in a row never fails; migrations run twice cleanly.
- A test order's confirmation email appears in Mailpit.
- Tests exist and pass for: lunch order happy path, capacity full (409), concurrent orders
  never exceed capacity, parent token rejected on `/api/admin/*`, MUTTI rejected on public
  orders, totals not inflated with multiple items + multiple payments, lunch numbers restart
  at 1 after a new session while `E` numbers keep counting.

Prompt
```
Phase 0 of docs/V2_MASTER_PLAN.md. Start with task 1 (repo prep), task 9 (Docker dev/test
stack with Mailpit) and task 8 (test harness), so every later fix lands with a
failing-then-passing test. Then fix bugs 1–5, 7, 8 and 11–13 from section 0.3 exactly as
tasks 2–7 describe, and implement v1-style order numbers (task 10, spec in §4B).
Bug 6 goes away when v1's UI replaces the v2 pages; bugs 9 and 10 belong to Phases 2 and 7.
Do not touch frontend/ or admin/ in this phase. One PR per task.
```

---

### Phase 1 — Bring v1's frontend in, verbatim, and capture the visual baseline (≈1 day)

**Goal:** v2 serves v1's exact files from v1's exact URLs, and we have reference screenshots
of every v1 screen to compare against forever after.

Tasks
1. Create `public/` containing v1's `order.html`, `Payment.html`, `events.html`,
   `event-order.html`, `parent-order.html`, `parent-order.js`, `terms.html`, `kitchen.html`,
   `kitchen-board.js`, `admin.html`, `admin_events.js`, `style.css`, `script.js`,
   `fully-booked.html`, `fonts/`, `admin-assets/`, `kitchen-assets/`, `parent-assets/`, all
   three manifests and service workers, `metadata.json`. **Byte-identical copies.**
   **Careful with the home page (see §0.4 and §4A):** `public/index.html` must be the normal
   home page from `git show 0c2a41c^:index.html` in the v1 repo, *not* v1's current
   `index.html` (which is the fully-booked page). Save that historical file as
   `docs/v1-reference-extra/index.html` with a README noting the commit it came from.
   `live.html` is not copied; it becomes a redirect to `/`.
2. Serve `public/` at the site root from Express with v1's cache headers (no-cache for HTML,
   SWs, manifests; long cache for fonts) and v1's route aliases (`/order`, `/Order.html`,
   `/payment.html` → `Payment.html`, etc. — see v1 `server.js`), plus `/live` and `/live.html`
   → 302 to `/`. Keep blocking dotfiles. (The automatic sold-out switch of `/` is added in
   Phase 2, once real status data exists.)
3. Move v2's current `frontend/` and `admin/` to `legacy-v2-ui/` (not served). They're a
   reference for API calls only and get deleted in Phase 10.
4. **Fixture data** (`e2e/fixtures/`): one canonical dataset — a session at 14 / 20 pizzas,
   ~8 lunch orders (mixed sizes, one with allergies, some paid), one open event with 3 orders,
   one register-interest event, two parent orders, a few audit rows. Express it twice: as
   v1 Apps Script JSON responses and as v2 DB seed rows.
5. **Visual baseline.** Playwright serves `docs/v1-reference/` statically, intercepts every
   Apps Script request with `page.route()` and answers from the v1 fixture JSON, and
   screenshots every screen at 390 px (phone) and 1280 px (desktop): home (open / few left /
   closed by deadline), **fully-booked page**, order, Payment (empty, found with token, not
   found), events,
   event-order (order mode, interest mode, success), parent-order (gate, form, success),
   terms, kitchen (login, board, detail modal, timer), admin (login, each tab, each modal).
   Freeze fonts/animations and the clock so shots are deterministic.

Done when
- Every file in `public/` outside `public/js/` is byte-identical to its counterpart in
  `docs/v1-reference/` (or `docs/v1-reference-extra/` for `index.html`). A small script
  checks this in CI from now on, with an allow-list for the sanctioned edits in later phases.
- `http://localhost:8080/` in the Docker dev stack shows the normal v1 home page (tracker
  and order/pay cards), and `/fully-booked.html` shows the "Thank You Everyone" page.
- Baseline screenshots committed in `e2e/__screenshots__/v1/`.

Prompt
```
Phase 1 of docs/V2_MASTER_PLAN.md. Read §0.4 and §4A first: the home page comes from v1
commit 0c2a41c^, not v1's current index.html. Copy the listed v1 files into public/ byte-for-byte,
serve them at v1's URLs with v1's cache headers and aliases, park the old v2 UI in
legacy-v2-ui/, build the fixture dataset, and create the Playwright baseline suite that
screenshots every v1 screen listed in Phase 1 task 5 using mocked Apps Script responses.
Do not modify any copied file.
```

---

### Phase 2 — The adapter: `public/js/api.js` + rewire the public pages (≈2–3 days)

**Goal:** the public pages run against v2's backend with zero visual change.

Tasks
1. Write `public/js/api.js` exposing: `getStatus`, `lookupOrder(query, token)`, `getEvents`,
   `getEvent(slug)`, `registerInterest`, `createEventOrder`, `createLunchOrder`,
   `checkDiscount`, `parentAuth`, `createParentOrder`, `getVersion`, `watchSoldOut`. Each returns **exactly the
   v1 JSON shape** (e.g. `getStatus` returns `orderingOpen, currentPizzas, maxPizzas,
   remainingPizzas, currentOrders, serviceDate, serviceTitle, serviceNoticeDate,
   nextOpeningTime, capacityMessage, deadlineMessage, closedMessage, closingSchedule, …`).
   Pence → pounds and order-code display formatting (D4) happen here only.
2. Replace the fetch call sites (and only those lines) in `script.js`, `Payment.html`,
   `events.html`, `event-order.html`, `parent-order.js`. Remove the Apps Script URL constant and
   the `/api/status` → Apps Script two-tier fallback (same origin now); keep the instant-paint
   cache, 20 s polling, focus/visibility refetch — they're behaviour, not plumbing.
3. **Legacy links.** `Payment.html?order=23&token=<uuid>` (v1 emails) and v2's
   `?q=…&token=…` both auto-lookup by token. Token alone is enough; keep v1's "strip `AO-`
   prefix" handling.
4. Unit-test `api.js` mapping functions with the fixture data (v2 response in → v1 shape out).
5. **Sold-out mode (§4A).** Server switch for `/` and `/order.html`, `soldOut` /
   `nextOpeningTime` / `ordersTeamEmail` in the status response, `api.watchSoldOut()`, and the
   fully-booked page's single `fetch('/api/status')` moved into `api.js` plus its one-line poll.
   All five §4A tests.

Done when
- Playwright runs the same screens against v2 (real backend seeded with the v2 fixture rows)
  and the diff vs the v1 baseline is ≤ 0.1 % pixels per screen (except timestamps masked).
- Clicking a v1-format confirmation link opens the right order.
- Selling the last pizza in the Docker stack turns `/` into the fully-booked page with no
  manual step, and freeing a pizza turns it back.

Prompt
```
Phase 2 of docs/V2_MASTER_PLAN.md. Create public/js/api.js as the single browser client,
returning v1-shaped JSON (use docs/v1-reference/apps-script.js as the spec for each shape).
Rewire only the fetch call sites in the public pages, and implement sold-out mode exactly
as §4A specifies (task 5). Then add the "v2" Playwright project
that screenshots the same screens against the seeded v2 backend and compares to the v1
baseline. Any visual diff above threshold is a bug in api.js or the backend, not a reason
to edit HTML/CSS.
```

---

### Phase 3 — Replace the Google Form with a native lunch order form (≈2 days)

**Goal:** the only unavoidable UI change — `order.html` loses the Google Form iframe and gains a
native form that looks like it was always part of v1.

Tasks
1. Build the form **only from existing v1 CSS classes and components**, reusing
   `event-order.html`'s proven line-item pattern (rows with × remove, "+ Add another pizza",
   running total). Place it exactly where the iframe was.
2. Ask the same questions, in the same order, as the Google Form (§5 of the v1 docs):
   allergies Yes/No → free text if Yes; one row per pizza with size (Whole £8 / Half £5 /
   Quarter £3), child's name, class; payment method (Bank Transfer / PayPal / Cash via child
   at pickup); payer name; payer email; optional staff/sibling discount code (live-checked via
   `checkDiscount`); required T&Cs checkbox linking to `terms.html`. Cap at 5 pizzas like v1
   unless Louis says otherwise.
3. Server side: `POST /api/orders` validates everything, enforces T&Cs, capacity (fractional),
   deadline, public-scope discounts; sends the confirmation email in the same request flow
   (queued, not blocking). The confusing v1 "second iframe load" detection and manual "Back to
   Artisan Oven" dance is replaced by an on-page confirmation panel styled like the event-order
   success panel (order #, total, payment details, link to `Payment.html`).
4. Keep the closed/fully-booked swap (`#closed-message`) behaviour identical.

Done when
- New baseline screenshots of the native form approved by Louis (this is the one screen that
  can't be pixel-compared to v1).
- E2E: place order → 201 → tracker updates within a poll → confirmation logged → lookup by
  email finds it with correct total and discount.

Prompt
```
Phase 3 of docs/V2_MASTER_PLAN.md. Replace the Google Form iframe in public/order.html with a
native form built only from existing v1 CSS classes, reusing event-order.html's line-item
pattern. Mirror the Google Form's questions and order exactly (Phase 3 task 2). Show me
screenshots at 390px and 1280px before opening the PR.
```

---

### Phase 4 — Backend parity: everything v1 does that v2 doesn't yet (≈4–6 days)

**Goal:** every row in the parity matrix has a working backend endpoint with tests.

Tasks (each can be its own PR)
1. **Settings & schedule.** Add to `site_settings`: `service_notice_date`, `capacity_message`,
   `deadline_message`, `fully_booked_message`, `next_opening_text`, `orders_team_email`, and a
   weekly schedule: `service_weekday`, `close_weekday`, `close_time`, `reopen_weekday`,
   `reopen_time`, `auto_close_enabled`. `domain/schedule.js` computes `auto_close_at`,
   `reopens_at` and the human `closingSchedule` text in Europe/London (tests across the BST/GMT
   change on 25 Oct 2026). This properly fixes v1 fragility #6 (the hardcoded Tuesday).
2. **`GET /api/status`** in v1 shape (via `api.js` mapping), 5–10 s in-memory cache, cache
   busted on any order or settings change.
3. **Events.** Add `slug` (unique, auto from name like v1), `description`, `ordering_deadline`.
   Public routes use slugs (v1 URLs `event-order.html?event=summer-fair-2026` keep working).
   Event orders: support `qty` (expand to item rows), reject when `status='Closed'` or past
   deadline.
4. **Parent orders.** Multi-child/multi-pizza like v1; gated discount auto-applied; parent +
   internal notification emails; access code rotation endpoint.
5. **Payments UX.** `mark-paid` records a ledger entry for the outstanding balance with the
   order's method; `mark-unpaid` records a reversing entry (never deletes ledger rows). Admin
   routes consistently use the internal order id, never the display number (§4B).
6. **Dashboard endpoint** returning v1's metric cards in one call: status, pizzas claimed,
   service date, order count, cash / bank / total / reconciled income (lunch + parent, like
   `calculateCurrentSessionStats`), last 20 audit rows.
7. **Start New Week.** Archives the session (no deletion — history is kept), but first emails
   the operational summary + xlsx exactly like v1 did. New session inherits schedule settings
   and lunch numbering restarts at #1 (§4B).
8. **Change password** (self), **version** endpoint, **discount check** endpoint.
9. **Exports.** `exports/xlsx.js` (exceljs) producing the "Pizza Order Update" workbook with
   v1's section layout — including the `PIZZA ORDERS` header row — so v1's kitchen offline
   xlsx upload parser keeps working. `checklist.js` renders v1's class-grouped tick-box HTML;
   PDF via headless Chromium (Playwright) or pdfkit — ask before adding the dependency.
10. Pickup IDs for the kitchen in v1 format `<order#>-<n>` (e.g. `42-1`, `E107-2`).

Done when every backend row in §4 is ✅ with at least one integration test each.

Prompt
```
Phase 4 of docs/V2_MASTER_PLAN.md, task <N> only. Use docs/v1-reference/apps-script.js as the
behavioural spec for this feature (find the matching action and replicate its logic and
response data, not its code structure). Add a numbered migration for any schema change.
Write integration tests first. Update docs/PARITY.md rows you complete.
```

---

### Phase 5 — Port the v1 admin dashboard and kitchen board (≈4–5 days)

**Goal:** `admin.html` and `kitchen.html` look exactly like v1 and every button works.

Tasks
1. **Extract, don't restyle.** Move `admin.html`'s inline `<script>` into `public/js/admin/*.js`
   modules (auth, dashboard, orders, parent-orders, events, email-dispatcher, confirm-modal)
   with **no markup/CSS changes**. Swap Apps Script calls for `api.js` admin functions
   (`api.admin.*`) that send `Authorization: Bearer`.
2. **Login (sanctioned change, D8):** add a username input above v1's password field, same
   classes. Keep the show/hide eye toggle. Drop the cold-start "ping".
3. Wire every tab and button per §8 of the v1 docs: metric cards (live via `/admin` socket
   instead of polling), Order Settings form, Website Text form, audit log, Start New Week with
   confirm modal, Change Password, School Lunch Orders (checklist iframe, Refresh, Print,
   Email to Team, summary bar, search, per-order Paid checkbox / payment method / Resend /
   Delete / email click → dispatcher), Parent Orders tab, Events tab (manage + orders sub-tabs,
   toggles, modal, interested people), Email Dispatcher modal (both modes), generic confirm modal.
4. **v2-only features as new cards in v1 styling** (reuse existing card/table/button classes):
   Admin Users & Roles (owner), Payments ledger view per order (treasurer), Money report +
   CSV export, Discount codes manager. Hide cards the logged-in role can't use.
5. **Kitchen.** Port `kitchen.html` + `kitchen-board.js` look exactly: auth modal, list
   grouped by class, payment emoji, ⚠️ allergy badge, tap to tick, `X / Y pizzas ready`,
   cutoff timer (amber < 10 min, red < 2 min), detail modal, filter/sort. Ticks go to the
   server (`PATCH /api/admin/kitchen/items/:id`) and sync live via the `/kitchen` socket,
   keeping `localStorage` as an offline queue. Keep the xlsx "Upload file" offline fallback.
6. Bump service-worker cache names (`ao-admin-v4` → `v5`, kitchen/parent likewise) so installed
   PWAs pick up the new shell; keep `start_url`s unchanged.

Done when
- Admin + kitchen screenshots match the v1 baseline (login screen excepted, approved manually).
- E2E: admin marks an order paid → dashboard income updates live in a second browser; kitchen
  tick on one device appears on another within 1 s.

Prompt
```
Phase 5 of docs/V2_MASTER_PLAN.md, task <N>. The v1 admin/kitchen markup and CSS in public/
must not change except for the username field (task 2) and the new cards (task 4, built only
from existing v1 classes). Wire every button listed in §8 of
docs/ArtisanOven_System_Documentation.md. Run the admin visual suite before opening the PR.
```

---

### Phase 6 — Emails that look like v1's (≈2 days)

**Goal:** every email in §4's email table, visually matching v1 (forest-green header band,
"ARTISAN OVEN" letter-spaced, cream card, shared payment-info block, "Marlow, Louis, and
Quinton" sign-off), each with HTML + plain-text parts.

Tasks
1. Port v1's HTML from `apps-script.js` into `services/email/templates/*.js` (pure functions:
   data in → `{subject, html, text}`). Shared `layout.js` and `paymentInfoBlock.js`.
2. Delivery through the provider chosen in D2; `message_log` makes every send idempotent
   (unique on order + template unless the admin explicitly resends).
3. The "Live spreadsheet" email is debounced (e.g. at most once per 10 minutes after changes)
   instead of v1's after-every-order blast — confirm with Louis.
4. Snapshot tests: render each template with fixture data and compare the HTML to a
   committed snapshot; Playwright screenshot of each rendered email for a quick visual check.

Prompt
```
Phase 6 of docs/V2_MASTER_PLAN.md. Port every email template from docs/v1-reference/
apps-script.js into backend/src/services/email/templates/, keeping v1's HTML look and wording.
Use the provider configured by env vars (see D2). Add snapshot tests per template.
```

---

### Phase 7 — Migrating v1's data (≈2 days)

**Goal:** on cutover day, v2 contains everything that's still live in v1, and every link a
parent already has keeps working.

Tasks
1. Rewrite `scripts/migrate-from-v1.js` to read a **full workbook export** of the v1 spreadsheet
   (File → Download → .xlsx, all tabs), not a CSV. Parse `Form Responses 1` with v1's own
   `BRANCHES` column mapping and `extractDigit` / `firstNonEmpty` rules, from
   `sessionStartRow` onward; plus `Event Customers`, `Internal Parent Orders`, `Events`,
   `Register Interest - *` tabs, `Discount Codes`, and settings (from `Admin_Settings`).
2. Preserve: v1 order tokens → `orders.access_token`; order numbers unchanged (current-week
   lunch `#N`, `E###` for events/parents — §4B); paid status → one ledger entry with
   `source='v1_migration'` (add to the CHECK); soft-deleted rows skipped; the session's lunch
   counter continues after the highest migrated number and the shared `E` counter continues
   from v1's `NEXT_ORDER_NUMBER` Script Property (read it from the Apps Script editor at
   cutover and pass it as `--next-e-number`).
3. `--dry-run` prints a reconciliation report: order count, pizza count, totals, paid/unpaid
   counts per type — must equal v1's dashboard numbers exactly before a real run.
4. Test against an anonymised copy of a real export (names/emails replaced).

Prompt
```
Phase 7 of docs/V2_MASTER_PLAN.md. Rewrite backend/scripts/migrate-from-v1.js to import a v1
.xlsx workbook export using v1's real BRANCHES layout (docs/v1-reference/apps-script.js is the
spec). Implement --dry-run with the reconciliation report first. Never commit real data.
```

---

### Phase 8 — Hardening, hosting and redirects (≈1–2 days)

Tasks
1. Security: `helmet` with a CSP that allows only what v1 pages load (PayPal links, WhatsApp
   link, Google Fonts if any, SheetJS CDN for kitchen or vendor it); CORS locked to the site
   origin; rate limits on lookup, login, parent auth, order creation; `sanitizeForSheet`
   equivalent in the xlsx export (formula injection still matters in spreadsheets).
2. **Production machine (D1: your own server or PC).** Same Compose stack as testing, plus
   `docker-compose.prod.yml`. Claude Code writes `docs/PRODUCTION_SETUP.md` as a step-by-step
   checklist covering:
   - **Always on:** sleep/hibernate disabled, "power on after power loss" in BIOS, Docker
     starts at boot, every service `restart: unless-stopped`. A cheap UPS is worth it if the
     machine is at home.
   - **Reachable as `artisanoven.shop`** — pick one:
     (a) router port-forward 80/443 to the machine + DNS A record (plus dynamic DNS if the
     home IP changes); Caddy then gets HTTPS certificates automatically;
     (b) a tunnel, so no ports are opened: Cloudflare Tunnel supports custom domains;
     Tailscale Funnel is already wired into the current Caddyfile, but check its docs for
     custom-domain support before relying on it.
   - **Backups:** the existing nightly `pg_dump` container, with 14-day rotation, **plus a copy
     off the machine** (e.g. `rclone` to a cloud drive) — a backup on the same disk isn't a
     backup. Restore rehearsed once into the dev stack.
   - **Monitoring:** a free uptime checker hitting `/health` every few minutes and alerting
     your phone; `docker compose logs` retained with rotation.
   - **Deploying updates:** one script: `git pull` → `docker compose … up -d --build`
     (migrations run automatically, now safe) → health check → automatic roll back to the
     previous image if the health check fails.
   - **Secrets** only in `infra/.env` on the machine, never in git; OS and Docker updates monthly.
3. Error monitoring (e.g. Sentry free tier) and structured logs — ask before adding.
4. Legacy URL redirects and `CNAME`/domain setup; `robots.txt`; keep `terms.html` wording.
5. WhatsApp / PayPal webhooks remain disabled behind env flags (D5).

---

### Phase 9 — Parallel run and cutover (1 week elapsed)

1. **Staging on the real production machine:** run the prod stack with
   `SITE_ADDRESS=v2.artisanoven.shop` so the rehearsal also tests the machine, the network
   route, HTTPS and backups. v1 keeps running untouched on `artisanoven.shop`.
2. **Dress rehearsal week:** the team places fake orders on staging for a full cycle — open,
   fill to capacity, auto-close Sunday 9 pm (London time), kitchen board on two devices,
   payments marked, Start New Week. Compare every screen against v1 side by side.
3. **Cutover runbook (a Monday, D9):**
   - Sunday ≥ 21:00 v1 closes by itself. Monday morning: set v1 `orderingEnabled=false`
     as a belt-and-braces measure.
   - Export v1 workbook → migrate `--dry-run` → reconcile → real run.
   - Add `artisanoven.shop` to Caddy's `SITE_ADDRESS` and point its DNS (or tunnel route) at
     the production machine; keep the GitHub Pages deploy of v1 available.
   - Smoke test: status, one real order by a team member, lookup via an old v1 email link,
     admin login for each role, kitchen board, fully-booked switch (temporarily set max
     pizzas to the current count, check `/`, set it back).
   - Open the new session for Tuesday service.
4. **Rollback:** DNS back to GitHub Pages + re-enable v1 ordering. Don't delete the Apps Script,
   the Google Form or the sheet for at least one full term.

---

### Phase 10 — Cleanup (after one clean term)

Delete `legacy-v2-ui/`, dead v1 code that has no behaviour (`initIOSBottomNav`, `AO-`/1000-offset
ID handling once no legacy links remain, legacy register-interest markers), the unused GitHub
Pages and Apps Script workflows, and whichever tunnel/port-forward config wasn't chosen in Phase 8. Update
README and CLAUDE.md to describe the final system.

---

## 6. Testing strategy (what "done" means)

| Layer | Tool | Covers |
|---|---|---|
| Unit | `node --test` | pricing, fractional capacity, discount rules (percent/flat/max-uses/expiry/scope), schedule & auto-close across BST/GMT, order-code formatting, `api.js` mappers |
| API integration | `supertest` + PGlite/Postgres | every route in `routes/index.js`: auth, roles, validation, happy paths, concurrency on capacity |
| Visual regression | Playwright screenshots | every v1 screen, phone + desktop, v2 vs v1 baseline ≤ 0.1 % diff |
| End-to-end flows | Playwright | order → email logged → lookup (email, code, token, legacy link) → mark paid → dashboard → kitchen tick on 2 devices → Start New Week |
| Email | snapshot tests | every template renders with fixture data |
| Migration | dry-run report | reconciles exactly with v1 numbers |

CI runs unit + integration + visual on every PR. Nothing merges red.

---

## 7. How to drive Claude Code through this

1. **One task per session.** Start each with the standard opening prompt (§5), then the phase
   prompt. Use `/clear` between tasks so old context doesn't leak in.
2. **Plan mode first.** Approve the plan before it edits. Push back if it proposes touching
   `public/` HTML/CSS outside a sanctioned change.
3. **Review the PR, not the chat.** Check: tests added, PARITY.md updated, screenshots attached
   for anything visual, no new dependencies you didn't approve.
4. **When it's unsure about v1 behaviour,** point it at the specific function in
   `docs/v1-reference/apps-script.js` or the page file — the code is the spec.
5. **Keep v1 in production untouched** until Phase 9. No v1 hotfixes should be needed; if one
   is, make it in the v1 repo and re-copy the affected file into `public/` and `docs/v1-reference/`.

**Very first prompt to kick things off:**

```
Read CLAUDE.md and docs/V2_MASTER_PLAN.md end to end. Then, without editing anything:
1) confirm you can reproduce bugs 1 and 2 from section 0.3 with a failing test,
2) list anything in the plan that conflicts with what you see in the repo,
3) propose the PR breakdown for Phase 0.
Wait for my go-ahead.
```

---

## 8. Rough timeline

| Phase | Effort (focused days) | Can overlap with |
|---|---|---|
| 0 Stabilise + Docker + tests | 2–3 | — |
| 1 v1 files + baseline | 1 | 0 |
| 2 Adapter + public pages | 2–3 | 4 |
| 3 Native order form | 2 | 4 |
| 4 Backend parity | 4–6 | 2, 3 |
| 5 Admin + kitchen port | 4–5 | 6 |
| 6 Emails | 2 | 5 |
| 7 Migration | 2 | 5, 6 |
| 8 Hardening | 1–2 | 7 |
| 9 Parallel run + cutover | 1 week elapsed | — |

Roughly 3–4 weeks of evenings/weekends plus the rehearsal week.

---

## 9. Risk register

| Risk | Mitigation |
|---|---|
| Visual drift creeps in | Golden rule 1 + automated screenshot diff on every PR |
| Old emailed links break | Migrate tokens, token-only lookup, keep `Payment.html` capitalisation |
| Installed PWAs keep old shell | Same `start_url`s, bumped SW cache names |
| Overselling under concurrent orders | Row lock on session + capacity check in one transaction; concurrency test |
| Wrong deadline around clock change | All schedule logic in `schedule.js` with Europe/London tests either side of 25 Oct 2026 |
| Emails land in spam | D2 provider with SPF/DKIM; test with real Gmail/Outlook/iCloud inboxes in rehearsal |
| Data loss | Nightly `pg_dump` copied off the machine + tested restore; v1 sheet kept read-only for a term |
| Home server/PC or its internet goes down during the ordering window | Uptime alert to phone; auto-restart on power return; documented "switch DNS back to v1" fallback for the first term; consider a small cloud VPS later running the same Compose stack if outages happen |
| Parent code leaks | Parent sessions can only create parent orders; code rotation from admin; rate limit |
| Cutover goes wrong | Monday window, dry-run reconciliation, DNS rollback to v1 |
