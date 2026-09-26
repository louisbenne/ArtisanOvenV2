-- 006 — events the way v1 has them (Phase 4 task 3).
--   slug:              v1's "Event ID" (e.g. summer-fair-2026) — public URLs use it:
--                      event-order.html?event=summer-fair-2026
--   description:       shown on the events list
--   ordering_deadline: free text shown to admins (v1 does not enforce it)
--   event_date:        free text like v1 ("Saturday 10th October 2026")

ALTER TABLE events
  ADD COLUMN slug              TEXT,
  ADD COLUMN description       TEXT,
  ADD COLUMN ordering_deadline TEXT;

ALTER TABLE events ALTER COLUMN event_date TYPE TEXT USING event_date::text;

UPDATE events SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || id
WHERE slug IS NULL;

ALTER TABLE events ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX events_slug_uniq ON events (lower(slug));
