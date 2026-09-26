'use strict';

// Order numbers exactly like v1 (V2_MASTER_PLAN §4B).
//   lunch:          order_number 12  → order_ref '12'   → shown '#12'  (restarts each session)
//   event / parent: order_number 101 → order_ref 'E101' → shown 'E101' (shared, never resets)
// Kitchen pickup IDs: '12-1', 'E101-2'. Admin routes use internal ids, never these.

// Must be called inside the transaction that holds the session row lock.
async function nextLunchNumber(tx, sessionId) {
  const [row] = await tx`
    UPDATE ordering_sessions SET next_lunch_number = next_lunch_number + 1
    WHERE  id = ${sessionId}
    RETURNING next_lunch_number - 1 AS n`;
  return row.n;
}

async function nextENumber(tx) {
  const [row] = await tx`
    UPDATE order_number_counters SET next_value = next_value + 1
    WHERE  name = 'E'
    RETURNING next_value - 1 AS n`;
  return row.n;
}

// Allocates the next number for this order type → { orderNumber, orderRef }.
async function allocate(tx, orderType, sessionId) {
  const orderNumber = orderType === 'lunch'
    ? await nextLunchNumber(tx, sessionId)
    : await nextENumber(tx);
  return { orderNumber, orderRef: refFor(orderType, orderNumber) };
}

const refFor = (orderType, n) => (orderType === 'lunch' ? String(n) : `E${n}`);

// Customer-facing label: '#12' or 'E101'.
const displayRef = ref => (/^E/i.test(ref) ? ref.toUpperCase() : `#${ref}`);

const pickupId = (ref, index) => `${ref}-${index}`;

// Parse what a customer types into the lookup box: '12', '#12', 'e101', 'E-101'.
// v1 also accepted legacy 'AO-'/'A0-' prefixes. Returns null for anything else
// (e.g. an email address).
function parseRef(input) {
  const s = String(input || '').trim().toUpperCase().replace(/^(AO|A0)-/, '').replace(/^#/, '');
  if (/^\d+$/.test(s)) return { kind: 'lunch', ref: String(parseInt(s, 10)) };
  const e = s.match(/^E-?(\d+)$/);
  if (e) return { kind: 'e', ref: `E${parseInt(e[1], 10)}` };
  return null;
}

module.exports = { allocate, refFor, displayRef, pickupId, parseRef };
