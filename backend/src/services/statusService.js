'use strict';

// Live ordering status in EXACTLY v1's getStatus shape (docs/v1-reference/
// apps-script.js, action 'getStatus'), built from v2's own data — plus the
// v2 additions soldOut and ordersTeamEmail (plan §4A).
// Cached for a few seconds; invalidate() is called on every order, deletion,
// settings or session change so the page never shows stale capacity for long.

const sql      = require('../db');
const schedule = require('../domain/schedule');

const TTL_MS = 5_000;
let cached = null;   // { at, value }

const quarter = n => Math.round(n * 4) / 4;   // v1 normalizePizzaCapacity

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];
const ordinal = d => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd'
                        : d % 10 === 3 && d !== 13 ? 'rd' : 'th');

// DATE → v1's wording, e.g. "Tuesday 29th September 2026".
function formatServiceDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  return `${day} ${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

async function build(now = new Date()) {
  const [settings] = await sql`SELECT * FROM site_settings WHERE id = 1`;
  const [session]  = await sql`
    SELECT id, service_date, service_title, max_pizzas, ordering_open
    FROM   ordering_sessions WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1`;

  let currentPizzas = 0, currentOrders = 0;
  if (session) {
    const [row] = await sql`
      SELECT
        COALESCE(SUM(CASE i.size WHEN '12inch' THEN 1.0 WHEN 'Half12inch' THEN 0.5
                                 WHEN 'Quarter12inch' THEN 0.25 ELSE 1.0 END), 0)::float AS pizzas,
        COUNT(DISTINCT o.id) FILTER (WHERE o.order_type = 'lunch')::int                    AS lunch_orders
      FROM   orders o JOIN order_items i ON i.order_id = o.id
      WHERE  o.session_id = ${session.id} AND o.order_type IN ('lunch', 'parent') AND NOT o.is_deleted`;
    currentPizzas = quarter(row.pizzas);
    currentOrders = row.lunch_orders;
  }

  const maxPizzas       = session ? session.max_pizzas : 0;
  const remainingPizzas = Math.max(0, maxPizzas - currentPizzas);
  const orderingEnabled = Boolean(session?.ordering_open);
  const sched           = schedule.describe(settings, now);
  const isPastDeadline  = sched.isPastDeadline;
  const orderingOpen    = orderingEnabled && !isPastDeadline && remainingPizzas > 0;

  // v1's closedMessage precedence: admin-closed > deadline > full > remaining.
  const closedMessage =
    !orderingEnabled ? 'Ordering is currently closed by the administrator.'
    : isPastDeadline ? `Ordering for this week has closed (${sched.closeDayName} ${settings.close_time}).`
    : remainingPizzas <= 0 ? (settings.fully_booked_message || "We're fully booked for this session. Please check back next time.")
    : `${remainingPizzas} pizzas remaining.`;

  return {
    success: true,
    orderingOpen,
    orderingEnabled,
    isPastDeadline,
    currentPizzas,
    maxPizzas,
    remainingPizzas,
    currentOrders,
    serviceDate:       session ? formatServiceDate(session.service_date) : '',
    serviceTitle:      session ? session.service_title : '',
    serviceNoticeDate: settings.service_notice_date || '',
    nextOpeningTime:   settings.next_opening_text || 'Tuesday at 4:00 PM',
    capacityMessage:   settings.capacity_message || '',
    deadlineMessage:   settings.deadline_message || '',
    closedMessage,
    sessionId:         session ? String(session.id) : '',
    closingSchedule:   sched.closingSchedule,
    // v2 additions (plan §4A): sold out = a session exists and no capacity is left.
    // A deadline close is NOT sold out.
    soldOut:           Boolean(session) && remainingPizzas <= 0,
    ordersTeamEmail:   settings.orders_team_email || '',
  };
}

async function get() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await build();
  cached = { at: Date.now(), value };
  return value;
}

function invalidate() { cached = null; }

module.exports = { get, invalidate, build, formatServiceDate };
