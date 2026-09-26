-- 004 — idempotent order submission (bug 12).
-- The client-generated submission id used to be appended to orders.notes as
-- "sub:<id>" and matched with LIKE — junk text on admin/kitchen screens, slow,
-- and racy. Now a real column with a unique constraint.

ALTER TABLE orders ADD COLUMN submission_id TEXT;

-- Move existing markers out of notes.
UPDATE orders
SET submission_id = substring(notes FROM 'sub:([^ |]+)'),
    notes = NULLIF(btrim(regexp_replace(notes, '\s*\|?\s*sub:[^ |]+\s*', '', 'g'), ' |'), '')
WHERE notes LIKE '%sub:%';

ALTER TABLE orders ADD CONSTRAINT orders_submission_id_key UNIQUE (submission_id);
