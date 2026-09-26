-- 001 — initial schema (the v2 foundation).
-- Idempotent on purpose: databases created before the migrations system existed
-- already have these tables, and 001 is recorded as applied on their first run.

-- ─── Customers ────────────────────────────────────────────────────────────────
-- Replaces v1's repeated free-text name/email per row with a real entity.
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT,
  phone_e164      TEXT,                     -- +447911123456 — required for WhatsApp
  whatsapp_opt_in BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_idx ON customers (lower(email));

-- ─── Ordering Sessions ────────────────────────────────────────────────────────
-- Replaces v1's global serviceDate/maxPizzas settings and the "Start New Week"
-- row-deletion wipe. A new session = a new row; old sessions and their orders
-- stay queryable forever, enabling real historical reporting.
CREATE TABLE IF NOT EXISTS ordering_sessions (
  id              SERIAL  PRIMARY KEY,
  service_date    DATE    NOT NULL,
  service_title   TEXT    NOT NULL,         -- "Tuesday 15th Sept"
  max_pizzas      INTEGER NOT NULL,
  ordering_open   BOOLEAN NOT NULL DEFAULT TRUE,   -- manual override
  auto_close_at   TIMESTAMPTZ,                     -- computed real timestamp (fixes v1 fragility #6)
  reopens_at      TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Events ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                      SERIAL  PRIMARY KEY,
  name                    TEXT    NOT NULL,
  event_date              DATE,
  event_time              TEXT,
  location                TEXT,
  status                  TEXT    NOT NULL DEFAULT 'Open',
  customer_instructions   TEXT,
  email_subject_override  TEXT,
  email_message_override  TEXT,
  register_interest_mode  BOOLEAN NOT NULL DEFAULT FALSE,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Discount Codes & Access Codes ────────────────────────────────────────────
-- Replaces v1's three-separate-code-paths mess (fragility #8):
-- hardcoded STMSCS, hardcoded MUTTI, hardcoded email allow-list.
-- One table, one lookup, no magic strings anywhere else in the app.
CREATE TABLE IF NOT EXISTS discount_codes (
  code            TEXT    PRIMARY KEY,
  description     TEXT,
  percent_off     INTEGER,                  -- e.g. 15 for 15%
  flat_off_pence  INTEGER,                  -- alternative: flat £ amount in pence
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  max_uses        INTEGER,                  -- NULL = unlimited
  times_used      INTEGER NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ
);

-- The parent-order gate code is now just an access code linked to a discount.
-- No hardcoded "MUTTI", no hardcoded email allow-list.
CREATE TABLE IF NOT EXISTS access_codes (
  code                 TEXT PRIMARY KEY,
  purpose              TEXT NOT NULL CHECK (purpose IN ('parent_gate')),
  linked_discount_code TEXT REFERENCES discount_codes(code),
  active               BOOLEAN NOT NULL DEFAULT TRUE
);

-- ─── Orders & Order Items ─────────────────────────────────────────────────────
-- Replaces Form Responses 1, Event Customers, and Internal Parent Orders —
-- one unified shape for all three order types (fragility #3).
-- The entire BRANCHES column-index system disappears: "how many pizzas" is
-- simply how many order_items rows exist for this order.
CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL  PRIMARY KEY,
  public_order_code TEXT    UNIQUE NOT NULL,    -- L-0001 / E-0001 / P-0001
  order_type        TEXT    NOT NULL CHECK (order_type IN ('lunch','event','parent')),
  session_id        INTEGER REFERENCES ordering_sessions(id),
  event_id          INTEGER REFERENCES events(id),
  customer_id       UUID    REFERENCES customers(id),
  subtotal_pence    INTEGER NOT NULL,
  discount_code     TEXT    REFERENCES discount_codes(code),
  discount_pence    INTEGER NOT NULL DEFAULT 0,
  total_pence       INTEGER NOT NULL,
  payment_method    TEXT    CHECK (payment_method IN ('bank_transfer','paypal','cash')),
  payment_status    TEXT    NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  allergy_flag      BOOLEAN NOT NULL DEFAULT FALSE,
  allergy_notes     TEXT,
  notes             TEXT,
  access_token      UUID    NOT NULL DEFAULT gen_random_uuid(), -- "view my order" link
  terms_accepted_at TIMESTAMPTZ,             -- enforced server-side; null = rejected
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_session_idx   ON orders (session_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS orders_customer_idx  ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_type_idx      ON orders (order_type);
CREATE INDEX IF NOT EXISTS orders_token_idx     ON orders (access_token);

CREATE TABLE IF NOT EXISTS order_items (
  id               SERIAL  PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  child_name       TEXT,
  child_class      TEXT,
  size             TEXT    NOT NULL CHECK (size IN ('12inch','Half12inch','Quarter12inch')),
  topping          TEXT,
  unit_price_pence INTEGER NOT NULL,
  prepared         BOOLEAN NOT NULL DEFAULT FALSE,   -- kitchen tick-off (a real column, not localStorage)
  prepared_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- ─── Payments Ledger ─────────────────────────────────────────────────────────
-- Replaces v1's single Paid/Unpaid checkbox with a real ledger.
-- Partial payments, refunds (negative amount), PayPal auto-reconciliation.
-- An order's payment_status is derived from SUM(payments) vs total_pence.
CREATE TABLE IF NOT EXISTS payments (
  id            SERIAL  PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  amount_pence  INTEGER NOT NULL,           -- positive = payment, negative = refund
  method        TEXT    CHECK (method IN ('bank_transfer','paypal','cash','other')),
  reference     TEXT,                       -- bank ref / PayPal transaction ID
  source        TEXT    NOT NULL DEFAULT 'admin'
                CHECK (source IN ('admin','paypal_webhook')),
  recorded_by   INTEGER,                    -- FK to admin_users added after that table exists
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note          TEXT
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);

-- ─── Event Interest ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_interest (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES events(id),
  name        TEXT,
  email       TEXT,
  phone_e164  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Admin Users & Sessions ───────────────────────────────────────────────────
-- Replaces the single shared password (fragility #5).
-- Real per-admin accounts with roles; sessions are individually revocable.
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL  PRIMARY KEY,
  username      TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,           -- bcrypt
  role          TEXT    NOT NULL CHECK (role IN ('owner','treasurer','kitchen','volunteer')),
  phone_e164    TEXT,                       -- for kitchen-alert WhatsApp pings
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id INTEGER     NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions (admin_user_id);

-- Add the FK that payments needs (admin_users now exists).
-- Guarded so re-running the schema (every container start) doesn't fail.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_recorded_by_fkey') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_recorded_by_fkey
      FOREIGN KEY (recorded_by) REFERENCES admin_users(id)
      NOT VALID;  -- NOT VALID so it doesn't scan existing rows on first run
  END IF;
END $$;

-- ─── Audit Log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            SERIAL  PRIMARY KEY,
  admin_user_id INTEGER REFERENCES admin_users(id),
  action        TEXT    NOT NULL,
  target_table  TEXT,
  target_id     TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (admin_user_id);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (created_at DESC);

-- ─── Message Log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_log (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id),
  channel     TEXT    NOT NULL CHECK (channel IN ('email','whatsapp')),
  template    TEXT    NOT NULL,
  recipient   TEXT,
  status      TEXT    NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','sent','delivered','read','failed')),
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_log_order_idx ON message_log (order_id);

-- ─── Site Settings ────────────────────────────────────────────────────────────
-- One row, typed columns, instead of an unversioned JSON blob (fragility #4).
-- The CHECK (id = 1) constraint enforces the singleton pattern at the DB level.
CREATE TABLE IF NOT EXISTS site_settings (
  id                      INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  orders_team_email       TEXT        NOT NULL DEFAULT 'louis@benne.co.uk',
  orders_team_whatsapp    TEXT,
  capacity_disclaimer     TEXT,
  deadline_message        TEXT,
  fully_booked_message    TEXT        NOT NULL DEFAULT 'We''re fully booked for this session.',
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Order Code Counters ──────────────────────────────────────────────────────
-- Atomic per-type counters, decoupled from row position.
-- Orders can now be safely hard-deleted without renumbering anyone else.
CREATE TABLE IF NOT EXISTS order_code_counters (
  order_type TEXT    PRIMARY KEY CHECK (order_type IN ('lunch','event','parent')),
  next_val   INTEGER NOT NULL DEFAULT 1
);

-- ─── Seed ─────────────────────────────────────────────────────────────────────
INSERT INTO order_code_counters (order_type) VALUES ('lunch'),('event'),('parent')
  ON CONFLICT DO NOTHING;

INSERT INTO discount_codes (code, description, percent_off, active)
  VALUES
    ('STMSCS', 'Staff/sibling discount', 15, TRUE),
    ('MUTTI',  'Internal parent 50% discount', 50, TRUE)
  ON CONFLICT DO NOTHING;

INSERT INTO site_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
