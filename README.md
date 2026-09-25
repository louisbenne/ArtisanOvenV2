# Artisan Oven V2

**https://artisanoven.shop**

Self-hosted pizza ordering system for a student-run enterprise.
Replaces the Google Forms / Sheets / Apps Script stack with a proper
Node.js + PostgreSQL backend, real-time kitchen board, and three
installable PWA apps.

---

## Stack

| Layer | Tech |
|---|---|
| API | Node.js + Express |
| Database | PostgreSQL (postgres.js tagged templates) |
| Real-time | Socket.IO (`/admin` + `/kitchen` namespaces) |
| Frontend | Plain HTML / CSS / JS — no build step |
| Infra | Docker Compose + Caddy reverse proxy |

## Apps

| App | Path | Audience |
|---|---|---|
| Order form | `/frontend/` | Students placing lunch / event orders |
| Parent portal | `/frontend/parent-order.html` | Internal parents with access code |
| Admin | `/admin/` | Staff (orders, money, events, comms, settings) |
| Kitchen board | `/admin/kitchen.html` | Kitchen volunteers — real-time tick-off |

Each app ships as an installable PWA with its own manifest and service worker.

## Quick start

```bash
cd backend
cp .env.example .env      # fill in DB_* and JWT_SECRET
npm install
npm run migrate           # creates tables
node scripts/seed-admin.js  # creates owner account
npm run dev               # starts on PORT (default 3001)
```

Serve the frontend statically:

```bash
npx serve .               # repo root → localhost:3000
```

Or use the Docker Compose stack in `infra/` which wires Caddy, Postgres, Redis, and the API together.

## Environment variables

See `backend/.env.example`. Required:

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection |
| `PORT` | API port (default 3001) |
| `FRONTEND_URL` | CORS origin (`https://artisanoven.shop`) |
| `JWT_SECRET` | Admin session tokens |

Optional (notifications):

| Variable | Purpose |
|---|---|
| `SMTP_*` | Outbound email via nodemailer |
| `WHATSAPP_*` | Meta Cloud API |
| `PAYPAL_*` | Webhook signature verification |

## Key design decisions

- **Unified orders table** — lunch, event, and parent orders share one `orders` + `order_items` schema. No more separate sheets.
- **Ledger payments** — `payments` table (positive = payment, negative = refund). `payment_status` is derived from `SUM(payments)`.
- **Fractional pizza capacity** — 12inch=1.0, Half=0.5, Quarter=0.25 summed as NUMERIC.
- **Atomic order codes** — `order_code_counters` table; `UPDATE … RETURNING next_val - 1` inside a transaction guarantees no gaps under concurrency.
- **Role hierarchy** — owner(4) → treasurer(3) → kitchen(2) → volunteer(1). `requireAuth(minRole)` in every admin route.
- **`sql.begin()` transactions** — capacity check + counter increment + order insert are atomic.

## V1 migration

```bash
node backend/scripts/migrate-from-v1.js --csv export.csv
```

Expects columns: `Name`, `Email`, `Size`, `Topping`, `Paid`, `Notes`.

## Directory layout

```
backend/
  src/
    db/           schema.sql, migrate.js, postgres.js pool
    middleware/   requireAuth, errorHandler, rateLimit
    routes/       one file per feature
    services/     audit, discount, notification
    sockets/      Socket.IO namespaces
  server.js
  scripts/        seed-admin.js, migrate-from-v1.js

frontend/         Public-facing pages
admin/            Admin SPA shell
infra/            Docker Compose, Caddyfile, backup script
```
