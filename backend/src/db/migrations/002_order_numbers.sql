-- 002 — order numbers exactly like v1 (V2_MASTER_PLAN §4B).
--   lunch:          #1, #2, … restarting every ordering session
--   event + parent: one shared, never-resetting counter shown as E101, E102, …
-- Replaces public_order_code (L-0001 / E-0001 / P-0001) and order_code_counters.

ALTER TABLE ordering_sessions ADD COLUMN next_lunch_number INTEGER NOT NULL DEFAULT 1;

CREATE TABLE order_number_counters (
  name       TEXT    PRIMARY KEY,           -- 'E' = shared event + parent counter
  next_value INTEGER NOT NULL
);
-- v1 seeds its counter at ≥ 100; the v1 data import sets it to NEXT_ORDER_NUMBER.
INSERT INTO order_number_counters (name, next_value) VALUES ('E', 100);

ALTER TABLE orders
  ADD COLUMN order_number INTEGER,          -- 12   (lunch)  or 101  (event/parent)
  ADD COLUMN order_ref    TEXT;             -- '12'          or 'E101'

-- Backfill any existing (pre-launch) orders in creation order.
WITH lunch AS (
  SELECT id, row_number() OVER (PARTITION BY session_id ORDER BY created_at, id) AS n
  FROM orders WHERE order_type = 'lunch'
)
UPDATE orders o SET order_number = lunch.n, order_ref = lunch.n::text
FROM lunch WHERE o.id = lunch.id;

WITH e AS (
  SELECT id, 99 + row_number() OVER (ORDER BY created_at, id) AS n
  FROM orders WHERE order_type IN ('event', 'parent')
)
UPDATE orders o SET order_number = e.n, order_ref = 'E' || e.n
FROM e WHERE o.id = e.id;

UPDATE ordering_sessions s
SET next_lunch_number = COALESCE(
  (SELECT MAX(order_number) + 1 FROM orders WHERE session_id = s.id AND order_type = 'lunch'), 1);

UPDATE order_number_counters
SET next_value = GREATEST(100, COALESCE(
  (SELECT MAX(order_number) + 1 FROM orders WHERE order_type IN ('event', 'parent')), 100))
WHERE name = 'E';

ALTER TABLE orders
  ALTER COLUMN order_number SET NOT NULL,
  ALTER COLUMN order_ref    SET NOT NULL;

-- Lunch numbers are unique within a session; E refs are unique forever.
CREATE UNIQUE INDEX orders_lunch_number_uniq ON orders (session_id, order_number)
  WHERE order_type = 'lunch';
CREATE UNIQUE INDEX orders_e_ref_uniq ON orders (order_ref)
  WHERE order_type IN ('event', 'parent');

ALTER TABLE orders DROP COLUMN public_order_code;
DROP TABLE order_code_counters;
