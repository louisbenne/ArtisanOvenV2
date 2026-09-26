# Execution Plan — from today to a production-ready v2

Companion to `V2_MASTER_PLAN.md` (the *what*). This file is the *order of work*, the
corrections found while checking the plan against the code, and the decisions still
needed. Update the status column as branches land.

**Mission (unchanged):** v2 looks exactly like v1 — built from v1's own files in
`docs/v1-reference/` — and does everything v1 does, on Node + Express + PostgreSQL.

---

## 1. Corrections to the master plan (verified 26 Sept 2026)

| # | Finding | Effect on the plan |
|---|---|---|
| C1 | **Bug 0 (not in §0.3):** `wrapAsync` in `server.js` never wrapped any `/api` handler (it read `router._router.stack`). Every thrown error — even a 404 from order lookup — was an unhandled rejection that **killed the Node process**. Combined with bug 1 this crash-looped the live stack. | Fixed in `hotfix-crashloop`, with bug 1. Regression tests land with the test harness. |
| C2 | Bug 2 doesn't return a 500 as §0.3 says — before C1 it hung, then crashed the server. | Severity higher; fix order unchanged. |
| C3 | Compose service is `backend`; plan/CLAUDE.md say `api`. | Renamed to `api` in the Docker-stack task. |
| C4 | Dev stack wants `localhost:8080`, but the running prod stack binds `127.0.0.1:8080` for Tailscale Funnel. | Funnel entry moves to `127.0.0.1:8081`; dev keeps 8080. |
| C5 | Two env files (root `.env`, `infra/.env` with stale `mutti` values). | One `infra/.env` (task 9). |
| C6 | CLAUDE.md says `domain/orderCodes.js`, plan §4B says `domain/orderNumbers.js`. | Use `orderNumbers.js`; fix CLAUDE.md. |
| C7 | `backup.sh` keeps 30 days; plan says 14. | Use 14 (task 9). |
| C8 | `001_init` must also work on databases that already have the tables (the live stack). | Migration runner baselines existing DBs. |
| C9 | No `gh` CLI and no `make` on the Windows machine. | Wrappers are root `package.json` scripts (`npm run dev`, …). Branches are pushed; PRs opened from the GitHub compare link. |
| C10 | Windows `core.autocrlf=true` would silently rewrite v1 files to CRLF. | `.gitattributes` marks `public/**` and `docs/v1-reference*/**` as `-text` (byte-exact). |
| C11 | Tailscale Funnel only serves `*.ts.net` names — it cannot serve `artisanoven.shop`. | Funnel = staging URL. Production domain needs Cloudflare Tunnel or port-forward (decision H1). |
| C12 | `supertest` would be a new dependency. | Not needed: tests use Node 20's built-in `fetch` against the real server on a random port. |
| C13 | **Bug 14 (new):** one rate-limit bucket per IP shared by every limiter, and no `trust proxy` — behind Caddy the *whole site* shared ~10 orders/min. | Fixed in B5: per-limiter buckets, `trust proxy` for private hops. |
| C14 | **Bug 15 (new, hidden behind bug 2):** any omitted optional field (e.g. `termsAcceptedAt`) was `undefined`, which postgres.js rejects → 500. | Fixed in B5: `transform: { undefined: null }` in the DB client. |
| C15 | `node --watch` gets no file events from a Windows folder bind-mounted into Docker. | Dev uses `npm run dev:restart` instead. |
| C16 | **Bug 16 (new, critical):** one unauthenticated Socket.IO message with a malformed token crashed the server (uuid query error in socket auth, outside Express). Malformed bearer tokens also gave 500s. | Fixed in B10 and deployed immediately: UUID validation before any token query, socket auth try/catch, last-resort `unhandledRejection` logger. |

## 2. Branch / PR workflow

- One task = one branch = one PR, **stacked**: each branch starts from the previous one
  so work never waits on review. Merge in the order below; GitHub retargets each PR
  automatically as its parent merges.
- Nothing is pushed to `main`. Every PR body: what changed, how it was tested, what's missing.
- The live stack on this PC runs from the newest branch that passed its tests.

## 3. Work queue

Status: ⬜ todo · 🟨 in progress · ✅ pushed (awaiting merge) · 🟩 merged

### Stage A — Restore service
| # | Branch | Scope | Status |
|---|---|---|---|
| A0 | `hotfix-crashloop` | Bug 0 + bug 1 minimal fix; live site back | ✅ |

### Stage B — Phase 0: stabilise, Docker, tests
| # | Branch | Scope | Status |
|---|---|---|---|
| B1 | `phase-0-repo-prep` | CLAUDE.md, docs, PARITY.md, this plan, v1 snapshot, `v1-reference-extra/index.html` | ✅ |
| B2 | `phase-0-docker-stack` | base/dev/prod compose, `api` rename, Mailpit, npm wrappers, drop Railway, `DB_SSL` opt-in, one `infra/.env`, README | ✅ |
| B3 | `phase-0-test-harness` | `node --test`, fresh DB per run, CI (GitHub Actions + postgres:16), bug 0/1 regression tests | ✅ |
| B4 | `phase-0-migrations` | `migrations/NNN_*.sql` + `schema_migrations`, baseline existing DBs (task 2) | ✅ |
| B5 | `phase-0-lunch-transaction` | Bug 2 + concurrency test (task 3) | ✅ |
| B6 | `phase-0-order-numbers` | §4B: lunch `#N` per session, shared `E` counter (task 10) | ✅ |
| B7 | `phase-0-parent-security` | Bugs 3, 4, 5: `parent_sessions`, `requireParent`, discount `scope` (task 4) | ✅ |
| B8 | `phase-0-aggregates` | Bugs 7, 8, 11 (task 5) | ✅ |
| B9 | `phase-0-idempotency` | Bug 12: `orders.submission_id` (task 6) | ✅ |
| B10 | `phase-0-header-auth` | Bug 13: token only in `Authorization` (task 7) | ✅ |

### Stage C — Phase 1: v1's frontend, verbatim
| # | Branch | Scope | Status |
|---|---|---|---|
| C1 | `phase-1-public` | v1 files → `public/` byte-identical (home page from `0c2a41c^`), v1 URLs/aliases/cache headers, `live.html` → `/`, old v2 UI → `legacy-v2-ui/`, CI byte-check script | ⬜ |
| C2 | `phase-1-fixtures-baseline` | Fixture dataset (v1 JSON + v2 seed), Playwright baseline screenshots of every v1 screen | ⬜ |

### Stage D — Backend data the v1 pages need (Phase 4 tasks 1–3, 8 pulled forward)
| # | Branch | Scope | Status |
|---|---|---|---|
| D1 | `phase-4-settings-schedule` | Settings columns + `domain/schedule.js` (Europe/London, BST/GMT tests) | ⬜ |
| D2 | `phase-4-status` | `GET /api/status` with v1 fields + cache | ⬜ |
| D3 | `phase-4-events` | slugs, description, deadline, qty, Closed/deadline checks | ⬜ |
| D4 | `phase-4-small-endpoints` | discount check, version, change password | ⬜ |

### Stage E — Phase 2 + 3: public site on v2
| # | Branch | Scope | Status |
|---|---|---|---|
| E1 | `phase-2-api-js` | `public/js/api.js` (v1-shaped), rewire fetch call sites only, legacy `Payment.html?order=&token=` links | ⬜ |
| E2 | `phase-2-sold-out` | §4A sold-out mode + 5 tests | ⬜ |
| E3 | `phase-3-order-form` | Native lunch form from v1 classes (replaces Google Form iframe) | ⬜ |

### Stage F — Remaining parity, admin, kitchen, emails
| # | Branch | Scope | Status |
|---|---|---|---|
| F1 | `phase-4-parent-orders` | Multi-child parent orders, gated discount, rotation | ⬜ |
| F2 | `phase-4-payments-dashboard` | mark-paid/unpaid ledger, dashboard endpoint | ⬜ |
| F3 | `phase-4-new-week` | Start New Week (archive + summary email) | ⬜ |
| F4 | `phase-4-exports` | xlsx (v1 layout), checklist HTML, pickup IDs | ⬜ |
| F5 | `phase-5-admin` | v1 `admin.html` wired to REST (password-only login as v1, v2-only cards) | ⬜ |
| F6 | `phase-5-kitchen` | v1 kitchen board, server ticks + socket sync | ⬜ |
| F7 | `phase-6-emails` | Every v1 email template, provider from env | ⬜ |

### Stage G — Data, hardening, go-live
| # | Branch | Scope | Status |
|---|---|---|---|
| G1 | `phase-7-migration` | xlsx import with v1 `BRANCHES`, `--dry-run` reconciliation | ⬜ |
| G2 | `phase-8-hardening` | helmet/CSP, CORS lock, rate limits, formula-injection guard | ⬜ |
| G3 | `phase-8-production` | `docs/PRODUCTION_SETUP.md`, deploy script with health-check rollback, off-machine backups, uptime monitor | ⬜ |
| G4 | — | Phase 9: staging rehearsal week → Monday cutover (Louis-driven, runbook in master plan) | ⬜ |

## 4. Path to production

1. **Now → end of Stage B:** live stack on this PC keeps running at the Funnel URL
   (staging). Every restart is safe from A0 onward.
2. **Stage C–E:** staging URL shows v1's exact public pages running on v2. Team can
   start placing test orders.
3. **Stage F:** admin + kitchen usable; emails land in Mailpit in dev, real provider on staging.
4. **Stage G:** production override, backups off-machine, monitoring, rehearsal week,
   then DNS cutover on a Monday. v1 stays available for rollback for a full term.

## 5. Decisions needed from Louis

| # | Question | Default if no answer | Needed by |
|---|---|---|---|
| D2 | Email: Gmail SMTP app password, or Resend/Postmark with SPF/DKIM? | Build provider-agnostic SMTP; ask before F7 goes live | F7 |
| D3/D6/D5/D9 | Master-plan recommendations (v1 admin look, hide toppings, webhooks off, Monday cutover) | **Accepted as recommended** | — |
| D8 | Admin login | ✅ **Decided by Louis: password only, no username** (like v1). Backend accepts a bare password (`phase-4-password-only-login`). | done |
| P1 | Checklist PDF: Playwright/Chromium vs pdfkit (new dependency) | Ask at F4 | F4 |
| H1 | Production domain route: Cloudflare Tunnel (**recommended** — no open ports, home IP can change) vs router port-forward | Ask at G3 | G3 |
| M1 | v1 workbook export (.xlsx, all tabs) + `NEXT_ORDER_NUMBER` script property | Needed at cutover | G1 |
| S1 | Change the admin password generated on 26 Sept and the `PARENTGATE` code | — | now |
