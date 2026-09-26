'use strict';

// v1 Apps Script responses for the canonical dataset (fixtures/data.js).
// Each builder mirrors the matching action in docs/v1-reference/apps-script.js
// (getStatus ~L835, getOrder ~L797 + lookupOrder ~L2782, getEvents ~L411,
// createEventOrder ~L537, parentAuth ~L395, createParentOrder ~L683).
// Only public actions for now; admin/kitchen shapes land with Phase 5.

const data = require('./data');

const PRICE = { '12inch': 8, 'Half12inch': 5, 'Quarter12inch': 3 };
const CAPACITY = { '12inch': 1, 'Half12inch': 0.5, 'Quarter12inch': 0.25 };
const LABEL = { '12inch': '12" Pizza', 'Half12inch': 'Half a 12" Pizza', 'Quarter12inch': 'Quarter of a 12" Pizza' };
const PAYPAL_ME_BASE = 'https://paypal.me/ArtisanOven';
const PAYPAL_NCP_LINK = 'https://www.paypal.com/ncp/payment/LXZKSSG3QEFJA';
const PARENT_ACCESS_CODE = 'FAMILY26';
const round2 = n => Math.round(n * 100) / 100;

function lunchTotals(order) {
  const subtotal = order.pizzas.reduce((s, [size]) => s + PRICE[size], 0);
  const discountAmount = order.discount === 'STMSCS' ? round2(subtotal * 0.15) : 0;
  return { subtotal, discountAmount, total: Math.max(0, round2(subtotal - discountAmount)) };
}

const currentPizzas = () =>
  data.lunchOrders.reduce((s, o) => s + o.pizzas.reduce((t, [size]) => t + CAPACITY[size], 0), 0) +
  data.parentOrders.reduce((s, o) => s + o.items.reduce((t, [size, qty]) => t + CAPACITY[size] * qty, 0), 0);

// Scenarios: 'open' (14/20), 'fewLeft' (2.5 left), 'closedDeadline', 'soldOut'.
function getStatus(scenario = 'open') {
  const s = data.settings;
  const current = { fewLeft: 17.5, soldOut: 20 }[scenario] ?? currentPizzas();
  const maxPizzas = s.maxPizzas;
  const remaining = Math.max(0, maxPizzas - current);
  const isPastDeadline = scenario === 'closedDeadline';
  const orderingOpen = s.orderingEnabled && !isPastDeadline && remaining > 0;
  const closedMessage = !s.orderingEnabled ? 'Ordering is currently closed by the administrator.'
    : isPastDeadline ? `Ordering for this week has closed (${s.autoCloseDay} ${s.autoCloseTime}).`
    : remaining <= 0 ? s.fullyBookedMessage
    : `${remaining} pizzas remaining.`;
  return {
    success: true,
    orderingOpen,
    orderingEnabled: s.orderingEnabled,
    isPastDeadline,
    currentPizzas: current,
    maxPizzas,
    remainingPizzas: remaining,
    currentOrders: data.lunchOrders.length,
    serviceDate: s.serviceDate,
    serviceTitle: s.serviceTitle,
    serviceNoticeDate: s.serviceNoticeDate,
    nextOpeningTime: s.nextOpeningTime,
    capacityMessage: s.capacityMessage,
    deadlineMessage: s.deadlineMessage,
    closedMessage,
    sessionId: 'session_fixture',
    closingSchedule: `${s.autoCloseDay} at ${s.autoCloseTime}`,
  };
}

// v1 getOrder: token (+ matching id) > email > bare id (only when no token).
function getOrder({ query = '', token = '' }) {
  const q = String(query).trim();
  const email = q.includes('@') ? q.toLowerCase() : '';
  const id = q.toUpperCase().replace(/\s+/g, '');
  const tokenFor = o => (o.number === 3 ? data.tokens.lunch3 : `token-lunch-${o.number}`);

  const lunch = data.lunchOrders.filter(o =>
    (token && String(o.number) === id && tokenFor(o) === token) ||
    (email && o.email === email) ||
    (!token && String(o.number) === id));
  const hit = lunch[lunch.length - 1];
  if (!hit) return { success: false, message: "We couldn't find your order. Please use the link in your order confirmation email." };

  const t = lunchTotals(hit);
  return {
    success: true,
    orderId: String(hit.number),
    customerName: hit.payer,
    email: hit.email,
    paymentMethod: hit.method,
    paid: hit.paid ? 'Yes' : 'No',
    total: t.total,
    totalAfterDiscount: t.total,
    totalFormatted: '£' + t.total.toFixed(2),
    discountCode: hit.discount || '',
    discountAmount: t.discountAmount,
    discountReason: '',
    order: hit.pizzas.map(([size, childName, cls], i) => ({
      item: LABEL[size], sizeKey: size, quantity: 1, childName, class: cls,
      price: PRICE[size], priceFormatted: '£' + PRICE[size].toFixed(2), pickupId: `${hit.number}-${i + 1}`,
    })),
    paypalMeUrl: `${PAYPAL_ME_BASE}/${t.total.toFixed(2)}`,
    paypalNcpUrl: PAYPAL_NCP_LINK,
  };
}

const publicEvent = e => ({
  id: e.id, name: e.name, description: e.description, date: e.date, time: e.time,
  location: e.location, status: e.status || 'Open', registerInterest: e.registerInterest,
  customerInstructions: e.customerInstructions,
});

const getEvents = () => ({ success: true, events: data.events.filter(e => e.active).map(publicEvent) });

function getEvent({ eventId = '', event = '', id = '' }) {
  const want = (eventId || event || id).toLowerCase();
  const e = data.events.find(x => x.id.toLowerCase() === want);
  return e ? { success: true, event: publicEvent(e) } : { success: false, message: 'Event not found' };
}

function createEventOrder({ items = '[]' }) {
  const list = typeof items === 'string' ? JSON.parse(items || '[]') : items;
  const total = list.reduce((s, i) => s + (PRICE[i.size] || 0) * (parseInt(i.qty, 10) || 1), 0);
  return { success: true, orderId: 'E106', total, token: 'token-e106', message: 'Order successfully placed.' };
}

function parentAuth({ code = '', accessCode = '' }) {
  return (code || accessCode).trim() === PARENT_ACCESS_CODE
    ? { success: true, token: 'parent-session-fixture', expiresInSeconds: 43200, message: 'Access granted.' }
    : { success: false, message: 'Access denied.' };
}

function createParentOrder({ items = '[]' }) {
  const list = typeof items === 'string' ? JSON.parse(items || '[]') : items;
  const originalTotal = list.reduce((s, i) => s + (PRICE[i.size] || 0) * (parseInt(i.qty, 10) || 1), 0);
  const discountAmount = round2(originalTotal * 0.5);
  return { success: true, orderId: 'E106', originalTotal, discountAmount, finalTotal: round2(originalTotal - discountAmount),
           token: 'token-e106', message: 'Parent order successfully placed.' };
}

const ACTIONS = {
  getVersion: () => ({ success: true, version: '2.5.2', build: '2026.09.22', name: 'Artisan Oven Backend' }),
  getStatus:  (_p, scenario) => getStatus(scenario),
  getOrder, getEvents, getEvent, createEventOrder, parentAuth, createParentOrder,
  registerInterest: () => ({ success: true, message: 'Interest registered successfully!' }),
};

// params: the request's query/body params; scenario: status scenario name.
function respond(params, scenario) {
  const handler = ACTIONS[params.action];
  return handler ? handler(params, scenario)
                 : { success: false, message: `Unknown action in v1 fixture mock: ${params.action}` };
}

module.exports = { respond, getStatus, PARENT_ACCESS_CODE };
