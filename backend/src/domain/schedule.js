'use strict';

// Weekly ordering schedule in Europe/London (the server runs in UTC).
// Ordering is closed from (close_weekday, close_time) until (reopen_weekday,
// reopen_time), every week — v1's "Sunday 21:00 → Tuesday 13:00" by default,
// but driven by settings instead of hardcoded days (v1 fragility #6).
// Weekdays are ISO: 1 = Monday … 7 = Sunday. Times 'HH:MM'.

const TZ = 'Europe/London';
const DAYS = [null, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const MINUTES_PER_WEEK = 7 * 24 * 60;

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Wall-clock parts of an instant in London.
function londonParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: WEEKDAY[p.weekday],
  };
}

// London wall time → the UTC instant (handles BST/GMT).
function londonToUtc(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = t => {
    const p = londonParts(new Date(t));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  let t = guess - offsetAt(guess);
  const second = guess - offsetAt(t);   // re-check across a DST boundary
  if (second !== t) t = second;
  return new Date(t);
}

const toMinutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const minuteOfWeek = (weekday, minutes) => (weekday - 1) * 24 * 60 + minutes;

// Is `now` inside the weekly closed window?
function isPastDeadline(settings, now = new Date()) {
  if (!settings.auto_close_enabled) return false;
  const p = londonParts(now);
  const current = minuteOfWeek(p.weekday, p.hour * 60 + p.minute);
  const start = minuteOfWeek(settings.close_weekday, toMinutes(settings.close_time));
  const end   = minuteOfWeek(settings.reopen_weekday, toMinutes(settings.reopen_time));
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;   // window wraps past Sunday midnight
}

// Next instant (strictly after `from`) that is `weekday` at 'HH:MM' London time.
function nextOccurrence(weekday, hhmm, from = new Date()) {
  const p = londonParts(from);
  const [h, m] = hhmm.split(':').map(Number);
  const daysAhead = (weekday - p.weekday + 7) % 7;
  for (const extra of [0, 7]) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + daysAhead + extra));
    const at = londonToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, m);
    if (at > from) return at;
  }
}

// v1's getStatus text: "Sunday at 21:00".
const closingSchedule = s => `${DAYS[s.close_weekday]} at ${s.close_time}`;

function describe(settings, now = new Date()) {
  const pastDeadline = isPastDeadline(settings, now);
  return {
    isPastDeadline:  pastDeadline,
    closesAt:        settings.auto_close_enabled ? nextOccurrence(settings.close_weekday, settings.close_time, now) : null,
    reopensAt:       settings.auto_close_enabled ? nextOccurrence(settings.reopen_weekday, settings.reopen_time, now) : null,
    closingSchedule: closingSchedule(settings),
    closeDayName:    DAYS[settings.close_weekday],
  };
}

const isValidTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isValidWeekday = d => Number.isInteger(d) && d >= 1 && d <= 7;

module.exports = { DAYS, londonParts, londonToUtc, isPastDeadline, nextOccurrence, closingSchedule, describe,
                   isValidTime, isValidWeekday };
