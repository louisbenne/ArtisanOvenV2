# Artisan Oven V2

Pizza ordering for a student-run enterprise — the v1 site (**https://artisanoven.shop**)
rebuilt on Node.js + PostgreSQL, looking exactly like v1.

- Rules for contributors / Claude Code: [`CLAUDE.md`](CLAUDE.md)
- The plan: [`docs/V2_MASTER_PLAN.md`](docs/V2_MASTER_PLAN.md) · order of work and status:
  [`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md) · feature parity: [`docs/PARITY.md`](docs/PARITY.md)
- v1 reference (read-only): [`docs/v1-reference/`](docs/v1-reference/)

## Stack

| Layer | Tech |
|---|---|
| API | Node.js 20 + Express |
| Database | PostgreSQL 16 (postgres.js tagged templates, no ORM) |
| Real-time | Socket.IO (`/admin` + `/kitchen` namespaces) |
| Frontend | v1's plain HTML / CSS / JS — no build step |
| Infra | Docker Compose (+ Caddy for HTTPS in production) |

## Run it

Needs Docker Desktop and Node/npm (only for the wrapper scripts).

```bash
cp infra/.env.example infra/.env   # set DB_PASS at least
npm run dev                        # http://localhost:8080 · Mailpit http://localhost:8025
npm test                           # tests against a real Postgres 16
```

Production on this machine:

```bash
npm run prod:up                    # Caddy on 80/443 (SITE_ADDRESS in infra/.env)
                                   # + plain-HTTP tunnel entry on 127.0.0.1:8081
```

First admin account (production):

```bash
docker compose -p ao-prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  exec -e ADMIN_PASSWORD='<choose one>' api node scripts/seed-admin.js
```

## Environment variables

All in `infra/.env` — see [`infra/.env.example`](infra/.env.example) for the full list.
Required in production: `DB_PASS`, `SITE_ADDRESS`. Email (`SMTP_*`) is optional —
without it emails are logged instead of sent.

## Directory layout

```
backend/     Express API (server.js, src/{db,domain,routes,middleware,services,sockets}, scripts/)
infra/       docker-compose.yml (+ .dev.yml, .prod.yml), Caddyfile, backup.sh, .env
docs/        plans, parity checklist, v1 documentation and v1 source snapshot
public/      v1's frontend, byte-identical (checked by tools/check-v1-parity.js)
legacy-v2-ui/  the interim v2 UI — not served; reference only, deleted in Phase 10
tools/       repo checks (v1 parity)
```
