# ArtisanOven V2 — Repo Guide

## What this is

A self-hosted pizza ordering system for a student-run enterprise.
Node.js + Express backend, PostgreSQL database, plain HTML/CSS/JS frontend.
No TypeScript, no build step, no ORM.

## Directory layout

```
backend/          Node.js API server
  src/
    db/           schema.sql, migrate.js, index.js (postgres.js pool)
    middleware/   requireAuth, errorHandler, rateLimit
    routes/       one file per feature (orders, sessions, money, …)
    services/     audit, discount, notification
    sockets/      Socket.IO namespaces (/admin, /kitchen)
  server.js       entry point
  scripts/        seed-admin.js, migrate-from-v1.js

frontend/         Public-facing pages (order, payment, events, terms)
  style.css       All brand CSS — import this everywhere
  site.js         Shared JS for public pages

admin/            Admin SPA shell
  admin-shell.css  layout + components (@import frontend/style.css)
  admin-shell.js   auth guard, apiGet/Post/Patch/Delete, socket

infra/            Docker Compose, Caddyfile, backup script
```

## Running locally

```bash
cd backend
cp .env.example .env      # fill in DB_* and PORT
npm install
npm run migrate           # creates tables
node scripts/seed-admin.js  # creates owner + parent gate accounts
npm run dev               # starts with --watch
```

Frontend is served statically — open `frontend/index.html` directly in a browser,
or serve the repo root with `npx serve .`.

## Key design decisions

- **postgres.js** (tagged templates, not Prisma) — no codegen, no build step
- **`sql.begin()`** for order creation — capacity check + counter increment is atomic
- **Ledger-based payments** — `payments` table (positive = payment, negative = refund)
- **Fractional pizza capacity** — 12inch=1.0, Half=0.5, Quarter=0.25 — stored as NUMERIC SUM
- **Role ranks**: owner=4, treasurer=3, kitchen=2, volunteer=1 — `requireAuth(minRole)` in routes
- **`wrapAsync(app)`** in server.js — all async route errors flow to `errorHandler`
- **Raw body** preserved on `/api/webhooks` path for PayPal/WhatsApp HMAC verification

## Database

See `backend/src/db/schema.sql` for the full schema.
Key tables: `ordering_sessions`, `orders`, `order_items`, `payments`, `customers`,
`admin_users`, `admin_sessions`, `discount_codes`, `order_code_counters`.

Re-run migration safely: `npm run migrate` is idempotent (uses `IF NOT EXISTS`).

## Environment variables

See `backend/.env.example`. Required for production:
- `DB_*` — PostgreSQL connection
- `PORT` — API port (default 3001)
- `FRONTEND_URL` — for CORS
- `JWT_SECRET` — used for admin session tokens

Optional (notifications):
- `SMTP_*` — nodemailer email
- `WHATSAPP_*` — Meta Cloud API
- `PAYPAL_*` — webhook verification
