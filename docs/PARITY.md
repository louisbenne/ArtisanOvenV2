# v1 → v2 Parity Checklist

Copied from `V2_MASTER_PLAN.md` §4. **Update the "Now" column in the same PR that
changes a row.** Legend: ✅ works · ⚠️ partial/buggy · ❌ missing/broken.

### Public

| v1 action / feature | v2 endpoint (target) | Now | Fix in |
|---|---|---|---|
| `getStatus` (tracker, pills, messages) | `GET /api/status` → v1-shaped object | ⚠️ `/sessions/current` lacks `serviceNoticeDate`, `nextOpeningTime`, `capacityMessage`, `deadlineMessage`, `closedMessage`, `closingSchedule`, `currentOrders`, `isPastDeadline` | P4 |
| Google Form lunch order | `POST /api/orders` `{type:'lunch'}` | ⚠️ backend works (bug 2 fixed); native form in P3 | P0, P3 |
| `getOrder` (email / order # / token) | `GET /api/orders/lookup?q=&token=` | ⚠️ token ignored by page, response shape differs, legacy `?order=N&token=` links | P2 |
| `getEvents` / `getEvent` | `GET /api/events`, `GET /api/events/:slug` | ⚠️ no `description`, `ordering_deadline`, string slug IDs | P4 |
| `registerInterest` | `POST /api/events/:slug/interest` | ✅ (param names differ: handled in `api.js`) | P2 |
| `createEventOrder` | `POST /api/orders` `{type:'event'}` | ⚠️ no `qty`, no Closed-status/deadline check, no dedicated confirmation | P4 |
| `parentAuth` | `POST /api/parent/auth` → parent session | ❌ security hole (bug 3) | P0 |
| `createParentOrder` | `POST /api/parent/orders` (parent session required) | ❌ 400 + no auth (bugs 4, 5) | P0, P4 |
| `getVersion` | `GET /api/version` | ❌ | P4 |
| Discount code on lunch form | `POST /api/discounts/check` | ❌ (page calls missing route) | P4 |
| **Sold-out mode:** home page automatically becomes the fully-booked page (§4A) | `/` serves `fully-booked.html` while sold out; `/order.html` redirects to `/` | ❌ (v1 did this by hand on 23 Sept) | P1, P2, P4 |
| **Order numbers like v1** (§4B): lunch `#N` restarting weekly, shared `E101` counter for events + parents | `domain/orderNumbers.js` | ❌ v2 uses `L-0001` / `E-0001` / `P-0001` | P0 |

### Admin & kitchen

| v1 action / button | v2 endpoint (target) | Now | Fix in |
|---|---|---|---|
| `adminAuth` / `adminLogin` | `POST /api/admin/login` | ✅ | — |
| `adminLogout` | `POST /api/admin/logout` | ✅ | — |
| `adminChangePassword` | `POST /api/admin/me/password` | ❌ | P4 |
| `adminGetSettings` (settings + live stats + last 20 log rows) | `GET /api/admin/dashboard` | ⚠️ spread over 3 routes, fields missing | P4 |
| `adminUpdateSettings` (both forms) | `PATCH /api/admin/settings` + `PATCH /api/admin/sessions/current` | ⚠️ | P4 |
| `adminStartNewSession` ("Start New Week") | `POST /api/admin/sessions` (archive, don't wipe; email summary + xlsx first) | ⚠️ no archive emails | P4 |
| `adminGetOrders` / `adminGetParentOrders` | `GET /api/admin/orders?type=` | ⚠️ inflated totals (bug 7) | P0 |
| `adminUpdatePaidStatus` (checkbox) | `POST /api/admin/orders/:id/mark-paid` and `/mark-unpaid` (ledger entries) | ⚠️ ledger only, no one-tap toggle | P4 |
| `adminUpdatePaymentMethod` | `PATCH /api/admin/orders/:id` | ✅ backend / ❌ UI | P5 |
| `adminDeleteOrder` (soft) | `DELETE /api/admin/orders/:id` | ✅ backend / ❌ UI | P5 |
| `adminResendConfirmation` | `POST /api/admin/orders/:id/resend` | ✅ (inconsistent id vs code) | P4 |
| `adminSendAutomatedEmail` (Confirmation / Ready for Collection / Custom / Operational Summary / Live xlsx) | `POST /api/admin/comms/send` + `/internal-summary` + `/xlsx` | ⚠️ confirmation/ready only | P6 |
| `adminGetOrdersChecklist` (iframe, Print) | `GET /api/admin/checklist.html` | ❌ | P4 |
| `emailOrdersPdf` | `POST /api/admin/checklist/email` | ❌ | P6 |
| `emailXlsxSnapshot` (after every change) | `GET /api/admin/exports/orders.xlsx` + debounced email | ❌ | P4, P6 |
| `adminGetEvents` / `adminSaveEvent` / `adminDeleteEvent` / Active + Register-Interest toggles | `/api/admin/events…` | ✅ (missing fields) | P4 |
| `adminGetEventOrders` (per-event filter) | `GET /api/admin/orders?type=event&event=` | ❌ filter ignored (bug 8) | P0 |
| `adminGetRegisterInterest` | `GET /api/admin/events/interest` | ✅ | — |
| `adminSetParentAccessCode` | `PUT /api/admin/settings/parent-access-code` | ⚠️ create only | P4 |
| Discount codes (v1: sheet tab) | `/api/admin/settings/discounts…` | ⚠️ bug 6, 11 | P0, P4 |
| Kitchen board (tick, progress, allergy, detail modal, cutoff timer, filter/sort, xlsx offline upload) | `GET /api/admin/kitchen/board`, `PATCH /api/admin/kitchen/items/:id`, socket `/kitchen` | ⚠️ backend ✅, v1 UI not ported | P5 |
| Audit log | `GET /api/admin/audit-log` | ✅ backend, page calls wrong URL | P0 |
| **New in v2:** admin users/roles, payments ledger, money report, CSV export | existing routes | ✅ backend | P5 (UI in v1 style) |

### Emails (§11 of the v1 docs)

| v1 email | v2 template file | Now |
|---|---|---|
| Lunch order confirmation (#N, secure link, items, discount, total, payment block, collection info, WhatsApp group link) | `email/templates/order-confirmation.js` | ⚠️ generic, not v1 design |
| Event order confirmation (+ event subject/message overrides) | `event-confirmation.js` | ❌ |
| Parent order confirmation + internal "NEW INTERNAL PARENT ORDER" alert | `parent-confirmation.js`, `internal-parent-alert.js` | ❌ |
| Ready for Collection (+ optional message) | `ready-for-collection.js` | ⚠️ |
| Custom message | `custom.js` | ❌ |
| Live spreadsheet (.xlsx attachment) | `xlsx-snapshot.js` | ❌ |
| Operational Summary (lunch box, parent box, totals, admin notes) | `internal-summary.js` | ❌ |
| Orders checklist PDF | `checklist-pdf.js` | ❌ |
