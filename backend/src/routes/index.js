'use strict';

// Central route registry — one glanceable list of every endpoint.
// Auth is declared here, not scattered across handler files (fixes v1 fragility #2).

const { Router } = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { rateLimit }   = require('../middleware/rateLimit');

const auth      = require('./auth');
const sessions  = require('./sessions');
const orders    = require('./orders');
const events    = require('./events');
const kitchen   = require('./kitchen');
const money     = require('./money');
const comms     = require('./comms');
const settings  = require('./settings');
const webhooks  = require('./webhooks');

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get( '/sessions/current',       sessions.getCurrent);
router.get( '/orders/lookup',          orders.lookup);
router.get( '/events',                 events.list);
router.get( '/events/:id',             events.get);
router.post('/events/:id/interest',    rateLimit({ max: 5 }), events.registerInterest);
router.post('/orders',                 rateLimit({ max: 10 }), orders.create);
router.post('/parent/auth',            rateLimit({ max: 10 }), auth.parentAuth);
router.post('/parent-orders',          rateLimit({ max: 10 }), orders.createParent);

// ── Webhooks (externally called — verified by signature, not admin token) ────
router.post('/webhooks/paypal',        webhooks.paypal);
router.get( '/webhooks/whatsapp',      webhooks.whatsappVerify);
router.post('/webhooks/whatsapp',      webhooks.whatsappEvent);

// ── Admin auth (no role check — just needs to be authenticated) ───────────────
router.post('/admin/login',            rateLimit({ max: 10 }), auth.adminLogin);
router.post('/admin/logout',           requireAuth(),           auth.adminLogout);

// ── Admin: Orders ─────────────────────────────────────────────────────────────
router.get(   '/admin/orders',               requireAuth('volunteer'), orders.adminList);
router.patch( '/admin/orders/:id',           requireAuth('volunteer'), orders.adminUpdate);
router.delete('/admin/orders/:id',           requireAuth('volunteer'), orders.adminDelete);
router.post(  '/admin/orders/:id/resend',    requireAuth('volunteer'), orders.adminResend);

// ── Admin: Payments ───────────────────────────────────────────────────────────
router.post('/admin/payments',               requireAuth('treasurer'), money.recordPayment);

// ── Admin: Money & Reporting ──────────────────────────────────────────────────
router.get('/admin/money/summary',           requireAuth('treasurer'), money.summary);
router.get('/admin/money/export',            requireAuth('treasurer'), money.export);

// ── Admin: Kitchen ────────────────────────────────────────────────────────────
router.get(  '/admin/kitchen/board',         requireAuth('kitchen'),   kitchen.getBoard);
router.post( '/admin/kitchen/tick',          requireAuth('kitchen'),   kitchen.tick);
router.patch('/admin/kitchen/items/:id',     requireAuth('kitchen'),   kitchen.tickItem);

// ── Admin: Events ─────────────────────────────────────────────────────────────
router.get(   '/admin/events',               requireAuth('volunteer'), events.adminList);
router.get(   '/admin/events/interest',      requireAuth('volunteer'), events.adminInterest);
router.get(   '/admin/events/:id',           requireAuth('volunteer'), events.adminGet);
router.post(  '/admin/events',               requireAuth('owner'),     events.adminCreate);
router.patch( '/admin/events/:id',           requireAuth('owner'),     events.adminUpdate);
router.delete('/admin/events/:id',           requireAuth('owner'),     events.adminDelete);
router.get(   '/admin/orders/event/:id',     requireAuth('volunteer'), orders.adminByEvent);

// ── Admin: Comms ──────────────────────────────────────────────────────────────
router.get( '/admin/comms/log',              requireAuth('volunteer'), comms.log);
router.post('/admin/comms/send',             requireAuth('volunteer'), comms.send);

// ── Admin: Settings ───────────────────────────────────────────────────────────
router.get(  '/admin/settings',              requireAuth('owner'),    settings.get);
router.patch('/admin/settings',              requireAuth('owner'),    settings.update);
router.get(  '/admin/settings/discounts',    requireAuth('owner'),    settings.getDiscounts);
router.post( '/admin/settings/discounts',    requireAuth('owner'),    settings.createDiscount);
router.patch('/admin/settings/discounts/:code', requireAuth('owner'), settings.updateDiscount);
router.get(  '/admin/settings/access-codes', requireAuth('owner'),    settings.getAccessCodes);
router.post( '/admin/settings/access-codes', requireAuth('owner'),    settings.createAccessCode);

// ── Admin: Sessions (weekly periods) ──────────────────────────────────────────
router.get(  '/admin/sessions',              requireAuth('volunteer'), sessions.adminList);
router.post( '/admin/sessions',              requireAuth('owner'),     sessions.adminCreate);
router.patch('/admin/sessions/:id',          requireAuth('owner'),     sessions.adminUpdate);

// ── Admin: Users & Audit (owner only) ─────────────────────────────────────────
router.get(  '/admin/users',                 requireAuth('owner'), auth.listUsers);
router.post( '/admin/users',                 requireAuth('owner'), auth.createUser);
router.patch('/admin/users/:id',             requireAuth('owner'), auth.updateUser);
router.get(  '/admin/audit-log',             requireAuth('owner'), auth.auditLog);

module.exports = router;
