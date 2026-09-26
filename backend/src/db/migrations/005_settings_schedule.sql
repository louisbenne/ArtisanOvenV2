-- 005 — v1's settings and a real weekly schedule (V2_MASTER_PLAN Phase 4 task 1).
-- v1 hardcoded "closed Sunday 21:00 → Tuesday 13:00" inside
-- isPastAutoClosingDeadline, ignoring its own day settings (v1 fragility #6).
-- Here the window is data: closed from close_weekday/close_time until
-- reopen_weekday/reopen_time, every week, in Europe/London time.
-- Weekdays are ISO: 1 = Monday … 7 = Sunday. Times are 'HH:MM' (24h).

ALTER TABLE site_settings RENAME COLUMN capacity_disclaimer TO capacity_message;

ALTER TABLE site_settings
  ADD COLUMN service_notice_date TEXT,
  ADD COLUMN next_opening_text   TEXT,
  ADD COLUMN auto_close_enabled  BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN close_weekday       SMALLINT NOT NULL DEFAULT 7  CHECK (close_weekday  BETWEEN 1 AND 7),
  ADD COLUMN close_time          TEXT     NOT NULL DEFAULT '21:00' CHECK (close_time  ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  ADD COLUMN reopen_weekday      SMALLINT NOT NULL DEFAULT 2  CHECK (reopen_weekday BETWEEN 1 AND 7),
  ADD COLUMN reopen_time         TEXT     NOT NULL DEFAULT '13:00' CHECK (reopen_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  ADD COLUMN service_weekday     SMALLINT NOT NULL DEFAULT 2  CHECK (service_weekday BETWEEN 1 AND 7);

-- v1's default wording where nothing has been set yet.
UPDATE site_settings SET
  capacity_message     = COALESCE(capacity_message, 'We have a limited number of orders while we gauge our capacity. Once we get into full swing, we’ll be able to open up to more orders.'),
  deadline_message     = COALESCE(deadline_message, 'Orders will close at 9:00 PM on Sunday evenings, giving us time to prepare for Tuesday.'),
  fully_booked_message = CASE WHEN fully_booked_message = 'We''re fully booked for this session.'
                              THEN 'We''re fully booked for this session. Please check back next time.'
                              ELSE fully_booked_message END,
  next_opening_text    = COALESCE(next_opening_text, 'Tuesday at 4:00 PM')
WHERE id = 1;

-- The per-session auto_close_at timestamp is superseded by the weekly schedule.
ALTER TABLE ordering_sessions DROP COLUMN auto_close_at;
ALTER TABLE ordering_sessions DROP COLUMN reopens_at;
