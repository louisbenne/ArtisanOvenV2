-- 003 — parent sessions are separate from admin sessions (bugs 3, 4, 5).
-- Before: the parent access code issued an ADMIN session for a 'parent_gate'
-- pseudo-user with role volunteer, so any parent could read every customer's
-- details and delete orders. And any public order could use MUTTI (50% off).

CREATE TABLE parent_sessions (
  token        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code  TEXT        NOT NULL REFERENCES access_codes(code) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX parent_sessions_expires_idx ON parent_sessions (expires_at);

-- Remove the pseudo-user (its admin sessions cascade away with it).
UPDATE audit_log SET admin_user_id = NULL
WHERE  admin_user_id IN (SELECT id FROM admin_users WHERE username = 'parent_gate');
UPDATE payments SET recorded_by = NULL
WHERE  recorded_by IN (SELECT id FROM admin_users WHERE username = 'parent_gate');
DELETE FROM admin_users WHERE username = 'parent_gate';

-- Discount scope: 'public' codes may be typed on public orders; 'parent_gate'
-- codes are only ever applied server-side to parent orders.
ALTER TABLE discount_codes
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'public' CHECK (scope IN ('public', 'parent_gate'));
UPDATE discount_codes SET scope = 'parent_gate'
WHERE  code = 'MUTTI' OR code IN (SELECT linked_discount_code FROM access_codes WHERE linked_discount_code IS NOT NULL);
