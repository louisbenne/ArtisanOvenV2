# ARTISAN OVEN — Complete System Documentation & Rebuild Reference

**Prepared as a v1 → v2 reconstruction reference.** This document explains, function by function and button by button, exactly how the current live system (v2.5.0, build 2026.09.05) works, so that it can be redesigned and rebuilt from scratch without losing any functionality. It is paired with `ArtisanOven-v1-source-reference.zip`, which contains the exact original source files so you have literal working code to copy from, not just a description of it.

> **Why this document exists:** the current system (`README.md`'s own words) was "built through rapid, iterative, conversation-driven development" by AI, with no up-front design. Features were bolted on over time (school lunches → special events → internal parent orders → kitchen board → PWA installs), and it now shows classic signs of accretion: business logic keyed off raw spreadsheet **column numbers** instead of named fields, one 600-line `if/else` chain instead of a router, four different "order types" (Form Responses rows, Event Customers rows, Internal Parent Orders rows, and — nowhere — a real orders table) each with their own bespoke lookup/email/delete code, and settings stored as a hand-rolled JSON blob in Apps Script Properties. Section 16 catalogs these problems explicitly so your v2 rebuild can design them away rather than reproduce them.

---

## Table of Contents

1. [System Overview & Business Context](#1-system-overview--business-context)
2. [Architecture & Data Flow](#2-architecture--data-flow)
3. [Complete Repository File Map](#3-complete-repository-file-map)
4. [Data Model — Every Google Sheet, Every Column](#4-data-model--every-google-sheet-every-column)
5. [The Google Form & Its Branching Logic](#5-the-google-form--its-branching-logic)
6. [Frontend Pages — Purpose, Elements & Behaviour](#6-frontend-pages--purpose-elements--behaviour)
7. [Shared Frontend Script (`script.js`)](#7-shared-frontend-script-scriptjs)
8. [Admin Dashboard — Every Tab, Every Button](#8-admin-dashboard--every-tab-every-button)
9. [Backend API Reference — Every Action](#9-backend-api-reference--every-action)
10. [Core Business Logic Algorithms](#10-core-business-logic-algorithms)
11. [Email System — Every Template](#11-email-system--every-template)
12. [Security & Auth Model](#12-security--auth-model)
13. [PWA / Service Workers / Manifests](#13-pwa--service-workers--manifests)
14. [Local Dev Server & `config.js`](#14-local-dev-server--configjs)
15. [CI/CD & Deployment](#15-cicd--deployment)
16. [Known Fragility Points — Why v1 Breaks Over Time](#16-known-fragility-points--why-v1-breaks-over-time)
17. [Recommended v2 Architecture & Starter Code](#17-recommended-v2-architecture--starter-code)

---

## 1. System Overview & Business Context

**Artisan Oven** is a student-run pizza business at a school. Every Tuesday, students at "Class 12" make wood-fired pizzas that are sold to families as a school lunch. The system also handles one-off **special events/catering** (school fairs, etc.) and an internal **discounted ordering flow for the organisers' own parents/staff**.

Three human-facing goals drive the whole system:

1. **Take orders without overselling.** There's a hard weekly pizza capacity (e.g. 20–22 pizzas). The site must show live remaining capacity and stop new orders once full or once a deadline passes (Sunday 9pm, in the current config).
2. **Get paid.** Orders are unpaid at submission; parents pay afterwards by Bank Transfer, PayPal, or Cash. The system must let a parent find their order (by email or order number) and see how much they owe and how to pay, and must let admins mark orders paid/unpaid.
3. **Get the right pizza to the right kid.** On the day, students in the kitchen need a checklist, grouped by class, of who ordered what, with allergy flags — and a way to tick items off as they're cooked/collected.

On top of the weekly lunch flow there are two secondary order types that reuse most of the same plumbing:
- **Special Events** — one-off catering orders (fairs, BBQs) with their own event pages, own sheet tabs, own order-ID prefix (`E###`).
- **Internal Parent Orders** — a private, access-code-gated ordering page for the founders' own family/friends, which automatically applies a 50% "MUTTI" discount code and is not visible to the general public.

---

## 2. Architecture & Data Flow

```
┌──────────────┐  iframe   ┌──────────────┐  on submit  ┌───────────────────┐
│  order.html  │──────────▶│ Google Form  │────────────▶│ Form Responses 1  │
└──────┬───────┘           └──────────────┘              │  (Google Sheet)   │
       │  fetch                                          └─────────┬─────────┘
       │  ?action=getStatus                                        │ onFormSubmit trigger
       ▼                                                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                Google Apps Script Web App ("apps-script.js")              │
│  doGet/doPost → single JSON API · settings · capacity math ·              │
│  discount engine · confirmation emails · admin auth & CRUD                │
│  Sheets: Form Responses 1 · Admin_Settings · Admin Log ·                  │
│  Pizza Order Update · Discount Codes · Events · Event Customers ·         │
│  Internal Parent Orders · Kitchen_Board_State                            │
│  State: Script Properties (settings JSON, admin/parent codes) ·          │
│  CacheService (2-min getStatus cache, session tokens)                    │
└──────────────────────┬──────────────────────────────────────────────────┘
                        │ same ?action=... query API, token-authenticated
     ┌──────────────────┼───────────────────┬───────────────────┬──────────────┐
     ▼                  ▼                   ▼                   ▼              ▼
 index.html      Payment.html          admin.html          kitchen.html   events.html /
 (status +       (order lookup +      (token login,        (read live      event-order.html /
 choice cards)    payment info)        full CRUD           order sheet,    parent-order.html
                                       dashboard)           tick off
                                                             pizzas)
```

Key architectural facts:

- **There is no traditional database.** The Google Sheet bound to the Apps Script project *is* the database. Every sheet tab is a table; every row is a record.
- **There is no server-side framework/router.** `apps-script.js` exposes exactly one HTTP entrypoint, `doGet(e)` (with `doPost` just forwarding into `doGet`), which reads an `action` query parameter and runs through ~40 sequential `if (action === '...')` blocks until one matches.
- **The frontend is 100% static HTML/CSS/vanilla JS**, hosted for free on GitHub Pages under the custom domain `artisanoven.shop`. There is no build step, no bundler, no framework.
- **A thin optional Node/Express proxy (`server.js`)** exists purely to (a) serve the static files, (b) provide a `/api/status` endpoint that caches the Apps Script `getStatus` response in memory for a few seconds so the homepage loads instantly, and (c) inject a `/config.js` script that exposes the Apps Script URL and a pre-fetched status blob to the page before any client JS runs. GitHub Pages itself has **no server**, so in the GitHub Pages deployment this proxy simply isn't used and the frontend calls the Apps Script URL directly.
- **Auth is a single shared password**, not per-user accounts. The "admin password" *is* the "admin token" — there is no session expiry, no hashing, no rotation except a manual "change password" action.
- **All communication is via `fetch()` GET requests with query-string parameters**, returned as `application/json`. There is no POST body usage in practice (`doPost` just merges any body/query params and calls `doGet`), likely because Apps Script Web Apps handle CORS more simply for GET/JSONP-like usage from `fetch`.

---

## 3. Complete Repository File Map

| File | Role |
|---|---|
| `index.html` | Landing page: hero, live availability tracker, "Order" / "Pay" choice cards |
| `order.html` | Order page: embeds the Google Form in an iframe, shows live availability, special-events banner |
| `Payment.html` | Order lookup (by email or order #) + all three payment methods + PayPal buttons |
| `events.html` | Lists active special events (fetched from backend), links into `event-order.html` |
| `event-order.html` | Order form for a specific special event (dynamic pizza-size/qty rows), or "register interest" form |
| `parent-order.html` + `parent-order.js` | Access-code-gated internal ordering flow with automatic 50% discount |
| `kitchen.html` + `kitchen-board.js` | Password-gated kitchen checklist: import live orders, group by class, tick off pizzas |
| `admin.html` | The full admin dashboard (single 4,289-line file: HTML + inline JS) |
| `admin_events.js` | Extracted JS module for the admin dashboard's Events tab (used by `admin.html`) |
| `terms.html` | Terms & Conditions page |
| `style.css` | Global stylesheet — CSS custom properties for the "Artisan Oven" forest/terracotta theme |
| `script.js` | Shared frontend behaviour: availability tracker polling, order lookup, copy buttons, PWA registration |
| `apps-script.js` | **The entire backend** — deployed to Google Apps Script (root copy, kept in sync with `apps-script/Code.gs` via CI) |
| `apps-script/Code.gs`, `apps-script/appsscript.json`, `apps-script/.clasp.json` | The actual clasp-managed Apps Script project pushed by CI |
| `server.js` | Optional local/production Express proxy (status cache + config injection + static hosting) |
| `package.json` | `npm run dev` / `npm start` → `node server.js`; `npm run lint` → `node --check` on all JS files |
| `.env.example` | Documents the one env var the Express server reads: `ORDER_API_URL` |
| `*-manifest.json` (`admin-`, `kitchen-`, `parent-`) | PWA manifests so Admin/Kitchen/Parent pages can be "Added to Home Screen" as standalone apps |
| `*-sw.js` (`admin-`, `kitchen-`, `parent-`) | Matching service workers (cache-then-network for the app shell) |
| `*-assets/` | PWA icons per sub-app |
| `fonts/BaarSophia.{woff,ttf}` | Self-hosted brand display font |
| `CNAME` | `artisanoven.shop` — GitHub Pages custom domain config |
| `metadata.json` | Site metadata (name/description) |
| `.github/workflows/deploy-pages.yml` | CI: rsync everything except `.git`/`.github`/`apps-script` into `_site/`, deploy to GitHub Pages on push to `main` |
| `.github/workflows/deploy-apps-script.yml` | CI: on changes under `apps-script/`, `clasp push --force` then `clasp deploy` to the existing deployment ID |
| `GEMINI.md` | Instructions for the AI coding agent that has been maintaining this repo (branch-per-issue, PR-only workflow, human review required) |
| `ArtisanOven License` | MIT license |

---

## 4. Data Model — Every Google Sheet, Every Column

The Apps Script project is **bound to one Google Sheet** (the same file the Google Form writes into). All of the following are tabs inside that one spreadsheet.

### 4.1 `Form Responses 1` (the Google Form's native response sheet — the "orders" table for school lunches)

This is the single most important, and single most fragile, part of the whole system: **the backend reads/writes this sheet by raw column index**, not by header name (aside from a few `findHeaderIndex` helper lookups used only for the discount columns). Column order is exactly whatever order the Google Form's questions are in, **so re-ordering or editing a Form question silently breaks the backend.**

Confirmed real headers (0-indexed, i.e. column A = 0) from a live export:

| Idx | Header | Notes |
|---|---|---|
| 0 | Timestamp | Google Forms auto-column |
| 1 | Any allergies or special remarks? | `Yes`/`No` |
| 2 | Allergies or special remarks | free text, HTML-stripped on read |
| 3 | How many people require margarita pizza? | `"1"`–`"5"` (as a labelled option); digit is extracted with `extractDigit()` |
| 4–6 | Pizza 1 / Name of person consuming this pizza / What class is this child in? | the **1-pizza branch** |
| 7–9, 10–12, 13–15 | Pizza 1(2) / Pizza 2 / Pizza 3 blocks | the **3-pizza branch** |
| 16–30 | Pizza 1(3)…Pizza 5 blocks | the **5-pizza branch** |
| 31–42 | Pizza 1(4)…Pizza 4(2) blocks | the **4-pizza branch** |
| 43–48 | Pizza 1(5), Pizza 2(4) blocks | the **2-pizza branch** |
| 49 / 51 | Payment Method / Payment Method 2 | duplicated because the form has two conditional payment-method questions (see §5); code reads `firstNonEmpty(row[49], row[51])` |
| 50 / 52 | payer name fields (also duplicated per branch) | `firstNonEmpty(row[50], row[52])` |
| 53 | "What is their name and class?" | legacy/unused catch-all field |
| 54 | payer email | scanned generically — `extractPayerEmail()` actually just scans **every cell** in the row for something that matches an email regex, it doesn't trust a specific column |
| 55 | Staff Discount Code | free-text discount code entry |
| 56 | T&Cs accepted checkbox | not enforced server-side |
| 57–59 | `12 Inch Pizza`, `Column 54`, `Column 1` | dead/legacy columns from earlier form iterations, unused |
| 60 | **SENT** | hidden flag column, `CONFIRMATION_SENT_COL`. Set to `'SENT'` once the confirmation email fires; also can be `'FAILED: <error>'` |
| 61 | *(Order Token)* | `ORDER_TOKEN_COL` — a UUID generated the first time a confirmation is sent, used so the emailed "view order" link doesn't require the customer's email as a shared secret |
| 62 | *(Payment Status)* | `PAYMENT_STATUS_COL` — manually set by admin (`Paid` / blank) |
| 63 | *(Is Deleted)* | `IS_DELETED_COL` — soft-delete flag (`'TRUE'`), rows are **never actually deleted**, only flagged |
| 66–72 | `DISCOUNT CODE`, `Discount Code`, `Discount Amount (£)`, `Total After Discount (£)`, `Discount Reason` | discount engine columns, appended by `ensureDiscountColumns()` the first time it runs |

**The "Order ID" for a lunch order is simply its 1-based sheet row number minus 1** (i.e. `orderId = rowNumber - 1`, so the Google Form's row 2 = Order #1). This is why deleting rows is never done — it would renumber every order below it and break every already-emailed order link. Soft-delete via the hidden flag column is the only safe way to remove an order.

**The "how many pizzas" branching**: the form's answer to question 3 selects one of five *disjoint* blocks of (size, name, class) triples elsewhere in the row — see `BRANCHES` in §10.1. Only the block matching the selected count is populated; the rest are blank.

### 4.2 `Pizza Order Update` (generated/derived — human-readable operational report)

Fully rebuilt from scratch by `rebuildCleanSheets()` every time an order is placed, deleted, or the admin requests a refresh. Not a source of truth — purely a formatted report, and also the file emailed as `.xlsx` after every change (`emailXlsxSnapshot`). Layout (all in one sheet, stacked vertically with merged section-title rows):

```
CURRENT ACTIVE SESSION: <serviceDate>                (merged title row)

ORDER SUMMARY                                          (merged title row)
Order ID | Payer Name | Discount Code | Payment Method | Paid | Allergy Flag |
  Allergy Details | No. of Pizzas | Pizza Details (Pickup ID - Child - Class - Size)
... one row per order (current session only) ...

PIZZA ORDERS                                           (merged title row)
Order ID | Payer Name | Discount Code | Payment Method | Paid | Allergy Flag |
  Allergy Details | Pizza Item ID | Pickup ID | Child Name | Class | Size
... one row PER PIZZA (not per order) ...

SESSION SUMMARY (<serviceDate>)
Pizza Order Summary
Size | Count            (one row per pizza size, e.g. 12inch, Half12inch, Quarter12inch)
Total Active Pizzas | <n>
Max Capacity Limit | <n>
Active Orders (Current Session) | <n>
Orders with allergies | <n>
Orders paid | <n>
Orders NOT yet paid | <n>

ORDER TOTALS & PAYMENT STATUS
Order ID | Payer Name | Discount Code | Email | Amount Owed (£) | Confirmation Emailed
... one row per order ...

INTERNAL PARENT ORDERS                                 (appended by appendParentOrdersToUpdateSheet)
  (same three sub-tables again, but sourced from the Internal Parent Orders sheet)
```

**"Pickup ID"** is the human-facing per-pizza ID shown in the kitchen (e.g. `23-1`, `23-2` for order #23's first and second pizza) — format is `<orderId>-<pizzaIndexWithinOrder>`.

### 4.3 `Admin_Settings` (human-readable mirror of the real settings, which actually live in Script Properties)

Rebuilt from scratch by `syncSettingsToSheet()` every time settings change. **This sheet is write-only from the admin's perspective — editing it directly does nothing**, because `getSettings()`/`saveSettings()` only ever read/write the `ARTISAN_SETTINGS` key in `PropertiesService.getScriptProperties()`. Columns: `SETTING KEY | VALUE | LAST UPDATED`. Rows mirror every field in the settings object (see §10.2 for the full schema).

### 4.4 `Admin Log` (audit trail)

Columns: `Timestamp | Action | Details | Actor`. Every privileged admin action calls `logAdminAction(action, details)` which appends a row. `getAdminLogs()` returns only the most recent 20, newest first, for display in the dashboard. Actor is always the hardcoded string `'Admin'` (no per-admin identity exists).

### 4.5 `Discount Codes`

Columns: `Code | Type | Value | MaxUses | TimesUsed | Active | ExpiresOn`. Auto-seeded on first use with two rows:
- `STMSCS`, percent, `15`, unlimited uses, active — the public staff/sibling discount code.
- `MUTTI`, percent, `50`, unlimited uses, active — the internal-parent-order discount code.

Both `STMSCS` and `MUTTI` are **also hardcoded directly in `getDiscount()`**, so even if these sheet rows are deleted or edited, those two codes keep working at their hardcoded 15%/50% rates — the sheet only matters for *additional*, custom codes an admin adds later. Discount codes support: percent or flat (`type` = `percent` vs anything else = flat £ amount off), a max-uses cap, an active/inactive toggle, and an expiry date.

### 4.6 `Events` (special-events catalogue, admin-managed)

Columns: `Event ID | Event Name | Description | Event Date | Event Time | Location | Status | Ordering Deadline | Customer Instructions | Email Subject | Email Message | Active | Register Interest | Created At`.

- `Event ID` is either admin-supplied or auto-slugified from the name plus a 4-digit timestamp suffix (`name.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now().toString().slice(-4)`).
- `Status` is free text (`Open` / `Closed` conventionally) — `Closed` blocks new orders for that event server-side.
- `Active` is the boolean that controls whether the event shows up publicly at all (`getEvents`/`getEvent`).
- `Register Interest` is a boolean toggle: when true, the public event page shows a "Register your interest" form instead of a full pizza-ordering form (used for events where menu/capacity isn't finalised yet). Historically this flag was encoded as an HTML comment tag inside the `Customer Instructions` field (`<!--AO_REG_INTEREST:1-->` / `:0`, or the older `[MODE:REGISTER_INTEREST]` marker) before a dedicated column existed; **the backend still checks for and strips these legacy markers on every read**, for backward compatibility with events created before the column was added.
- A default seed event (`summer-fair-2026`) is created automatically the first time `setupEventSheets()` runs on an empty sheet.

### 4.7 `Event Customers` (all special-event orders, across all events, in one table)

Columns: `Timestamp | Order ID | Event ID | Event Name | Event Date | Customer Name | Customer Email | Payment Method | Order Contents JSON | Total (£) | Payment Status | Order Status | Confirmation Status | Customer Notes | Order Token | Deleted | Submission ID`.

- `Order ID` for events always has the prefix **`E`** followed by a global incrementing counter shared across *all* event orders (see §10.4 `getNextOrderNumber`).
- `Order Contents JSON` is a JSON array like `[{"size":"12inch","qty":1,"unitPrice":8}]`.
- `Submission ID` is a client-generated idempotency key (`sub_<random>_<timestamp>`) cached server-side for 5 minutes to reject accidental double-submits.
- Every event, in addition to a row here, also gets its own **dedicated per-event sheet tab** (see 4.7b) — so event data is duplicated across two places.

### 4.7b Per-event dedicated tabs (`Event - <Event Name>`, ≤31 chars, one per event)

Created by `createOrGetEventOrdersSheet()`. Columns: `Timestamp | Order ID | Customer Name | Customer Email | Pizzas Ordered | Total (£) | Payment Method | Payment Status | Notes & Dietary | Status`. This is a simplified, human-skimmable duplicate of the same order, styled with the forest-green header theme, intended for manually opening the sheet and reading it — the admin dashboard itself reads from `Event Customers`, not from these tabs.

### 4.8 `Internal Parent Orders` (private, discount-gated orders)

Columns: `Timestamp | OrderId | ParentName | ParentEmail | ChildName | Class | ItemsJson | OriginalTotal | DiscountAmount | FinalTotal | PaymentMethod | PaymentStatus | OrderStatus | ConfirmationStatus | Notes | Token | Deleted | OrderType`.

- `OrderId` shares the **same global counter and `E` prefix** as special-event orders (`getNextOrderNumber()` is one shared counter for both).
- `OrderType` is always the literal string `'INTERNAL_PARENT'`.
- The 50% `MUTTI` discount is applied **unconditionally and automatically** server-side on every internal parent order — the customer never enters or sees a discount code.
- Placing an internal parent order also triggers `rebuildCleanSheets()` + `emailXlsxSnapshot()`, exactly like a public order does, keeping the "Pizza Order Update" export always current.

### 4.9 `Kitchen_Board_State` (server-persisted kitchen checklist)

Columns: `SESSION TITLE | BOARD DATA JSON | COMPLETED JSON | META JSON | UPDATED AT`. **Only ever one data row** (row 2) — `saveKitchenBoardState()` overwrites row 2 in place under a script lock. This lets the kitchen board sync "which pizzas have been ticked off" across multiple devices/tabs in real time (polled via `kitchenStatus`, pulled via `kitchenLoad`, pushed via `kitchenSave`). `BOARD DATA JSON` is an array of per-pizza items identical in shape to the parsed rows of the "Pizza Order Update" sheet (see the real example in the source export — every item carries `pickupId`, `orderId`, `childName`, `className`, `classNumber`, `size`, `capacity`, `paymentMethod`, `paymentIcon` (an emoji), `paid`, `allergyFlag`, `allergyDetails`, `payerName`).

### 4.10 Per-event "Register Interest - `<event>`" tabs

Created on demand by the `registerInterest` action. Columns: `Timestamp | Customer Name | Customer Email | Notes / Details`. One tab per event that has ever received an interest registration (title truncated to 31 chars, prefixed `Register Interest - `).

---

## 5. The Google Form & Its Branching Logic

The public order form (`https://forms.gle/puzgQL6aayoc7f589` → embedded via iframe in `order.html`) is a **multi-section, branching Google Form**:

1. **Section 1:** "Any allergies or special remarks?" (Yes/No). If Yes, a follow-up free-text question appears ("Allergies or special remarks").
2. **Section 2:** "How many people require margarita pizza?" — a single-select 1 through 5.
3. **Branch (Google Forms "Go to section based on answer"):** the form jumps to **one of five different sections**, each containing exactly N repetitions of a `(Pizza size dropdown, Name of person consuming this pizza, What class is this child in?)` triple, where N is the number chosen in Section 2. Each branch's questions are literally separate/duplicated form fields (hence header names like `Pizza 1 2`, `Pizza 1 3`, `Pizza 1 4`, `Pizza 1 5` in the response sheet — Google Forms auto-deduplicates identical question titles by appending a number).
   - Pizza size options are: `Whole 12-inch pizza — £8`, `Half a 12-inch pizza — £5`, `Quarter of a 12-inch pizza — £3`.
4. **Section (all branches converge):** "Payment Method" (Bank Transfer / PayPal / Cash via child at lunchtime pickup) and "What is your name/ payer's name?" — again duplicated into two near-identical questions because of how the branch sections were built (hence the `firstNonEmpty(row[49], row[51])` pattern server-side).
5. **Final section:** payer email, an optional staff/sibling discount code field, and a required "I have accepted and read the T&Cs" checkbox (link to `terms.html`).

**This is why `BRANCHES` in the backend is a hardcoded lookup table of literal column indices per branch** — the form's structure, not a clean data model, dictates the schema. If you rebuild this in v2, replace the branching-form with a proper repeatable line-item order form (see §17) and this entire fragile mapping disappears.

---

## 6. Frontend Pages — Purpose, Elements & Behaviour

Every public page shares: `style.css` theme, `script.js` (footer year, availability tracker, order lookup, copy buttons, PWA registration), a sticky WhatsApp floating link, and a footer with `Email / School Lunches / © year · GitHub link · T&Cs link · Admin link`.

### 6.1 `index.html` — Landing Page
- **Hero**: tagline + hand-drawn SVG underline.
- **"Next Date of Service" banner**: static placeholder text, live-overwritten by `getStatus`'s `serviceNoticeDate`.
- **Availability Tracker** (`#availability-tracker`): title (`serviceTitle`), status pill (`Orders Open` / `Only N Left!` / `Fully Booked` / `Orders Closed`), a horizontal progress bar (`currentPizzas`/`maxPizzas`), "`X of Y pizzas claimed`" / "`Z pizzas remaining`" footer text, an admin-editable capacity disclaimer, and an admin-editable deadline banner ("Orders will close at **9:00 PM on Sunday evenings**…").
- **Inline hydration script**: before `script.js` even loads, a tiny inline `<script>` block reads `window.INITIAL_STATUS` (injected server-side by `/config.js` on the Express deployment) or a `sessionStorage`/`localStorage` cache, and paints the tracker instantly — this is purely a perceived-performance trick so the tracker never shows a loading flash on repeat visits.
- **Two choice cards** (buttons): **"I WANT TO ORDER"** → `order.html`; **"I NEED TO PAY"** → `Payment.html`. Both are disabled (greyed, text changes to "FULLY BOOKED", href becomes `javascript:void(0)`) automatically by `script.js` when `getStatus` reports `orderingOpen: false`.

### 6.2 `order.html` — Order Page
- Same availability tracker as the homepage.
- **Special Events banner** (`#order-events-banner`): hidden by default; `script.js`'s `initOrderEventsBanner()` fetches `getEvents`, and if any active event exists (excluding a couple of hardcoded legacy demo IDs), shows a banner linking to `events.html`.
- **The Google Form**, embedded via `<iframe>` at `min-height: 1400px`.
- **"Order submitted?" section**: manual "← BACK TO ARTISAN OVEN" button (the Google Form doesn't redirect anywhere on its own; the parent has to click this themselves after submitting).
- **`#closed-message`**: hidden by default; shown instead of the form iframe when ordering is closed, with the admin-configured `fullyBookedMessage`/`closedMessage` text.
- Detecting a real submission: `script.js` listens for the **second** `load` event on the form iframe (the first load is the initial page render; Google Forms reloads the iframe internally after a successful submit), and on that second load, force-refreshes the availability status twice (500ms and 2500ms later) so the tracker updates without the parent needing to refresh the page.

### 6.3 `Payment.html` — Payment / Order Lookup Page
- **"Find Your Order"** form: single text input (email or order number) + **"Find My Order"** button. Wired to the exact same `initOrderLookup()` logic as `script.js` uses elsewhere (shared element IDs), calling `?action=getOrder&query=...`.
- **URL auto-lookup**: if the page is loaded with `?order=<id>&token=<uuid>` (i.e. clicked from a confirmation email link), it auto-fills and auto-submits the lookup using the secure per-order token instead of requiring the parent to type anything.
- **Result card** (`#order-result-section`, hidden until a successful lookup): order # badge, customer name, itemised list of pizzas (each with child name/class and price), any discount line, total, a **"Pay with PayPal (£X)"** button (`paypal.me/ArtisanOven/<amount>`), and a **secondary PayPal checkout button** (the fixed `paypal.com/ncp/payment/...` link). The generic "all payment options" panel is then re-parented underneath the result card once a lookup succeeds, so the parent sees Bank Transfer details (account name/sort code/account number) directly beneath their own total.
- **Static payment methods panel** (always visible before a lookup): Bank Transfer details, PayPal (both the `.me` link and the secure checkout link), and Cash instructions — this is a direct rendering of the same `PAYMENT_INFO_BLOCK` text used in confirmation emails.

### 6.4 `events.html` — Special Events List
- Fetches `getEvents`, renders one card per active event: name, description, date/time/location, and either an **"Order Now →"** button (`event-order.html?event=<id>`) or, if `registerInterest` is true for that event, a **"Register Interest"** label/button instead.
- Falls back to a `localStorage`-cached copy of the last successful fetch (`AO_LOCAL_EVENTS`) for instant paint on repeat visits, refreshed in the background.

### 6.5 `event-order.html` — Single Event Order / Interest Form
- Reads `?event=<id>` from the URL, calls `getEvent` to render the event's name/date/location/instructions.
- **If `registerInterest` is true**: shows a simple form (Name, Email, Notes) and a **"Register Interest"** submit button → `registerInterest` action.
- **Otherwise**, shows a real order form:
  - Dynamic **line-item rows**, each with a pizza-size `<select>` (Whole/Half/Quarter, live-updating a per-row £ subtotal) and a qty stepper, plus a **remove-row** (×) button per row (disabled when only one row remains).
  - **"+ Add another pizza"** button appends another row.
  - A running **total** recalculated on every input change.
  - Name, Email, Payment Method (radio: Bank Transfer / PayPal / Cash), and Notes/dietary fields.
  - **"Place Order"** submit button → `createEventOrder` action, with a client-generated `submissionId` (`sub_<rand>_<timestamp>`) sent for idempotency.
  - On success: shows an order-confirmation panel with the order ID and total (mirrors the confirmation email).

### 6.6 `parent-order.html` / `parent-order.js` — Internal Parent Ordering
- **Gate screen**: a single access-code input + **"Enter"** button → `parentAuth` action. On success, the returned session token is held in memory (and the app switches to the order screen); on failure, an inline error is shown.
- **Order screen**: parent name/email, then a **dynamic list of "child" rows** — each row has Child Name, Class, and a pizza selector; a **"+ Add another child"** button (`addChildRow()`) appends rows; each row computes its own subtotal, rolled into a running total (`updateTotals()`), always shown **after the automatic 50% MUTTI discount** is applied so the parent sees their real total.
  - Payment Method selector (Bank/PayPal/Cash) and Notes field.
  - **"Place Order"** button → `createParentOrder` action (sends the same session token for re-verification server-side).
- **Success screen**: order ID + discounted total + a "done" state.
- Registers `parent-sw.js` as its service worker on load (only this page does, so it doesn't clash with the admin/kitchen service workers).

### 6.7 `kitchen.html` / `kitchen-board.js` — Kitchen Checklist Board
This is the most operationally important page on the day of service. It is **password-gated behind the same admin token** (`kitchen-auth-modal` prompts for the admin passcode, verified via any admin-token-checked action).

- **Two ways to load data**:
  1. **"Import from server"** button — calls `kitchenLoad` (fetches the last-saved `Kitchen_Board_State` row from the sheet, if any admin previously saved one), or
  2. **"Upload file"** button — lets the user pick the emailed `Pizza_Orders_Live.xlsx` file directly from disk and parses it **client-side using SheetJS (`XLSX.js`)**, scanning for the `"PIZZA ORDERS"` section header and reconstructing the same item list without needing network access at all. This is an intentional offline fallback for when the kitchen wifi is unreliable.
- **The board** (`#kitchen-list`): one row per **pizza** (not per order), each showing child name, class + size, a payment-method emoji (🏦 bank / 🅿️ PayPal / 💵 cash / 📝 other), an ⚠️ allergy badge if flagged, tappable to open a detail panel. Tapping a row toggles a checkmark/strikethrough "complete" state.
- **Progress counter**: "`X / Y pizzas ready`" live count in the header.
- **"⏱ Set cutoff" timer button**: opens a small time-picker, then counts down and colour-shifts (normal → amber under 10 min → red under 2 min) — used to time a batch of pizzas in the oven.
- **Detail modal** (`#kitchen-detail`): tapping a pizza row's expand affordance shows the full order context (all pizzas in that same order, so the kitchen can see "this family also ordered 2 more").
- **Persistence**: completed-pizza state is kept in **`localStorage`, keyed per session title**, so refreshing the page doesn't lose progress, and is **also pushed to the server** (`kitchenSave`) so a second device (e.g. a phone at the collection table and a tablet at the oven) can both see live tick-off state; `kitchenStatus` is polled periodically to detect remote changes without re-downloading the whole board.
- Filter/sort controls exist in the underlying JS (`filter`, `sort` state variables — filter by class/all, sort by class/payment/etc.) surfaced as UI controls in `kitchen.html`.

### 6.8 `terms.html` — Terms & Conditions
Static content page, 14 numbered sections covering: acceptance of orders, "handmade products" price/availability disclaimer, payment terms, school-lunch-specific terms, **special-event reservation terms** (a specially call-out box near the top — non-refundable if cancelled after the deadline, e.g.), no-shows/unclaimed pizzas, collection & food safety, allergens (explicit "we cannot guarantee no cross-contamination" disclaimer — important for a food business run partly by students), refunds, acceptable use, privacy ("How our website and ordering system work" sub-section explaining the Google Form → Sheet → Apps Script pipeline in plain English to parents), governing law, and a contact section.

---

## 7. Shared Frontend Script (`script.js`)

One file, loaded (deferred) on every public page, doing five independent jobs gated on the presence of matching DOM elements (so it's safe to include everywhere):

1. **`initOrderLookup()`** — wires up `#order-lookup-form` (used identically on `Payment.html`, and would work on any page with those element IDs): validates non-empty input, cancels any in-flight lookup via `AbortController`, calls `?action=getOrder`, and renders the result into `#order-result-section` — including subtracting 1000 from any legacy 4-digit order IDs and stripping a legacy `AO-`/`A0-` prefix, both leftovers of an earlier order-numbering scheme.
2. **`initAvailabilityTracker()`** — the single most complex function in the frontend. Implements: (a) instant paint from `window.INITIAL_STATUS` or a **2-minute-TTL** `sessionStorage`/`localStorage` cache, (b) a two-tier fetch — try the local Express `/api/status` proxy first (2.5s timeout) and fall back to the Apps Script URL directly (5s timeout) if that fails or isn't present (so the exact same static files work whether or not the Express proxy exists), (c) a 20-second background poll loop that pauses while the tab is hidden, (d) re-fetch-on-focus and re-fetch-on-visibilitychange handlers, (e) re-fetch when an order button is clicked (last-chance freshness check right before navigating to the form), and (f) disabling the "Place an Order" buttons and swapping in the closed-message block when the API reports `orderingOpen:false`.
3. **`initOrderEventsBanner()`** — fetches `getEvents`, shows/hides the events banner on the order page, with a `localStorage` cache (`AO_LOCAL_EVENTS`) for instant paint and a hardcoded exclude-list of a couple of legacy demo event IDs/names that should never show even if left `active` in the sheet by mistake.
4. **`initCopyButtons()`** — a single delegated click listener for any `.copy-btn[data-copy]` anywhere on the page (used for "copy bank details", "copy order number", etc.), using the async Clipboard API with an `execCommand('copy')` fallback for older/insecure contexts, and a brief `.copied` CSS class toggle for the "Copied!" visual confirmation.
5. **`initPWAServiceWorker()`** — registers `parent-sw.js` only when the current path contains `parent-order`/`parent`, so each PWA sub-app (`admin-sw.js`, `kitchen-sw.js`, `parent-sw.js`) only ever registers itself on its own page and they don't fight over the service worker scope.

There's also an unused-but-present `initIOSBottomNav()` helper that builds an iOS-style bottom tab bar (Home/Order/Pay/Kitchen/Admin) — present in the file but not currently invoked from `runInit()`, i.e. dead code left over from an earlier UI experiment (see §16).

---

## 8. Admin Dashboard — Every Tab, Every Button

`admin.html` is a single self-contained page (login gate + 4 tabs + several modals), token-authenticated against the one shared admin password.

### 8.1 Login Screen
- Password `<input>` (with a **show/hide eye-icon toggle button**) + **"Log In"** submit button.
- On mount, silently fires a `no-cors` "ping" fetch to the Apps Script URL purely to pre-warm Google's cold-start latency before the admin even finishes typing their password.
- On submit: calls `adminAuth`; on success stores the password itself as the session token (see §12) and shows the dashboard; on failure shows an inline error banner.

### 8.2 Tab: **Dashboard & Settings**
**Live metric cards** (auto-refreshing via a live-sync poll, `startLiveSync()`):
- **Status badge** — `● OPEN` / `● CLOSED` with a hint line ("Public orders are being accepted" etc.)
- **Pizzas claimed** — `current / max` with a "remaining" hint
- **Service date** card — current `serviceTitle` + session ID
- **Orders count** card — active response count this session
- **Cash income** card, **Bank income** card, **Total income** card, **Current (reconciled) income** card — each computed both server-side (`calculateCurrentSessionStats`) and re-derived client-side (`recalculateAllIncomeMetrics()`) from the already-loaded order list, so the dashboard stays numerically consistent even between full refreshes when an admin ticks a payment checkbox.

**"Order Settings" form** — fields: Max Pizzas (number), Ordering Status (radio: Open/Closed — the manual override), Auto-Close Enabled (checkbox), Auto-Close Day (select) + Auto-Close Time (text, `HH:MM` pattern-validated), submit button **"Save Settings"**. → `adminUpdateSettings`.

**"Website Text" form** — Service Date, Service Title, Service Notice Date, Capacity Disclaimer (textarea), Deadline Message (textarea, supports HTML e.g. `<strong>`), Fully Booked Message, Orders Team Email(s) (comma-separated), submit button **"Save Website Text"**. → same `adminUpdateSettings` action, different field subset.

**Audit Log card** (collapsible via a header click or the toggle button) — table of the last 20 admin actions (`Timestamp | Action | Details`), populated from `adminGetSettings`'s bundled `logs` array.

**"Start New Ordering Period" card** — New Service Date input, New Max Pizzas input, **"Start New Week"** danger button, which opens a **confirmation modal** (shows the target date/capacity back to the admin, requires an explicit **"Yes, Start New Week"** click) before calling `adminStartNewSession`. This is the most destructive action in the whole system — it deletes all rows in `Form Responses 1` (after emailing a full archive snapshot first) and resets the session counter, effectively wiping the week's orders. It does **not** touch Events, Internal Parent Orders, or the Discount Codes sheet.

**"Change Password" form** — Current Password, New Password (min 4 chars), submit button **"Update Password"**. → `adminChangePassword`. Changing the password immediately invalidates every other logged-in admin session everywhere (because the password *is* the token — see §12), which is a deliberate simplicity trade-off but a sharp edge if two admins are both logged in.

**"Log Out" button** (bottom of the whole dashboard) → `adminLogout` (clears the client token; server-side this mostly just clears an optional cache entry since the primary auth is the password itself, which obviously can't be "invalidated" per-session).

### 8.3 Tab: **School Lunch Orders**
- **Live Orders Checklist panel**: an `<iframe>` rendering server-generated HTML (`adminGetOrdersChecklist` → `renderOrdersChecklistHtml`) — a printable, class-grouped, tick-box checklist visually matching the emailed PDF. Buttons: **"Refresh Checklist"**, **"Print"** (triggers the iframe's native print dialog), **"Email to Team"** → `emailOrdersPdf` (renders the same HTML to a PDF blob via `HtmlService`+`Utilities.newBlob(...).getAs('application/pdf')` and emails it to the configured `ordersTeamEmail` list).
- **Summary bar**: Total Orders / Total Pizzas / Pending Payment / Paid, computed client-side from the loaded order list.
- **Search box**: live client-side filter across customer name, student name, email, and class.
- **Order cards** (one per order, from `adminGetOrders`, newest 250 shown), each with:
  - A **"Paid" checkbox** toggle → `adminUpdatePaidStatus`.
  - A **payment-method button** cycling/selecting Bank Transfer / PayPal / Cash → `adminUpdatePaymentMethod`.
  - A **"Resend" button** → `adminResendConfirmation` (clears the SENT flag and re-sends).
  - A **delete (trash) button** → `adminDeleteOrder` (soft-delete; asks for confirmation first).
  - Clicking the email address opens the **email dispatcher modal** pre-filled for that customer/order.

### 8.4 Tab: **Parent Orders** (Internal Parent Orders)
Structurally identical to the Orders tab (summary bar, search, cards with paid-toggle/resend/delete), but sourced from `adminGetParentOrders`/`Internal Parent Orders` and always showing the applied MUTTI discount and original vs. final total.

### 8.5 Tab: **Events**
Two sub-tabs (`switchEventsSubTab('manage' | 'orders')`):

**Manage sub-tab**:
- List of all events (`adminGetEvents`), each card with: name/date/time/location/status, an **Active toggle**, a **Register-Interest-mode toggle** (`toggleEventRegisterInterest`), an **Edit button** (opens the event modal, pre-filled), and a **Delete button** (opens a confirm modal → `adminDeleteEvent`).
- **"+ New Event" button** opens the same modal empty → `saveEvent()` → `adminSaveEvent`. Modal fields: Name, Date, Time, Location, Status (select), Customer Instructions, Email Subject override, Email Message override, Active checkbox.
- **"Interested People" list** (below the events list) — shows everyone who used the "Register Interest" form for any event, grouped/labelled by event name, pulled from `adminGetRegisterInterest`.

**Orders sub-tab**:
- Event picker dropdown (`populateEventDropdown`) to filter which event's orders are shown, or "All Events".
- Summary bar (Total Orders / Pizzas / Pending / Paid) scoped to the selected event.
- Order cards identical in shape/behaviour to the lunch-order cards (paid toggle, resend, delete), sourced from `adminGetEventOrders`.

### 8.6 Global: Email Dispatcher Modal
Opened from any order card's email/resend affordance, or standalone. Two modes (toggle buttons **"Customer"** / **"Internal"**):
- **Customer mode**: pick a recipient (dropdown of loaded customers, or type an email/order-ID directly), pick an email type — **Confirmation** (re-sends the standard order-confirmation email for that order type), **Ready for Collection** (a distinct templated email, with an optional custom message), or **Custom** (free subject + message) — then a live preview panel (recipient / subject / payload) before hitting **"Send"** → `adminSendAutomatedEmail`.
- **Internal mode**: **"Operational Summary"** (a formatted HTML digest of lunch + parent order stats, optionally with admin notes appended) or **"Live Spreadsheet (.xlsx)"** (forces an immediate `rebuildCleanSheets` + emails the `Pizza_Orders_Live.xlsx` attachment) — both target the configured internal team address by default but can be redirected to any address typed in.

### 8.7 Global generic confirm modal
A single reusable danger-confirm dialog (icon + title + body + Cancel/Confirm buttons) used by every destructive action across the dashboard (`confirmAction({title, body, confirmText, danger})`), so deletions/resets never fire on a single click.

---

## 9. Backend API Reference — Every Action

Every request is `GET <APPS_SCRIPT_EXEC_URL>?action=<name>&...params`. Responses are always JSON with at minimum `{ success: boolean }`; unauthorized admin actions return `{ success:false, unauthorized:true, message:'Access denied. Incorrect password.' }`. Actions are matched case-insensitively (`actionLower`) as well as by exact camelCase, for backward compatibility with older frontend builds.

### Public / unauthenticated
| Action | Params | Behaviour |
|---|---|---|
| `getVersion` | — | Returns `{version, build, name}` |
| `getStatus` | `_t` (cache-buster) | Returns live capacity/availability (see §10.2); **cached 120s server-side** unless `_t` present |
| `getOrder` | `query` (email or order #), `token` (optional) | Looks up a lunch, event, or internal-parent order (in that priority order — see §10.5 `lookupOrder`) |
| `getEvents` | — | List of all **active** events |
| `getEvent` | `eventId` | Single event's public detail |
| `registerInterest` | `eventId`, `customerName`, `customerEmail`, `notes` | Appends to `Register Interest - <event>` sheet |
| `createEventOrder` | `eventId`, `customerName`, `customerEmail`, `paymentMethod`, `items` (JSON array), `notes`, `submissionId` | Creates an `E###` order, sends confirmation |
| `parentAuth` | `code` | Validates against the parent access code; returns a 12-hour session token |
| `createParentOrder` | `token`, `parentName`, `parentEmail`, `childName`, `class`, `items`, `paymentMethod`, `notes`, `submissionId` | Re-verifies token, applies MUTTI discount, creates order, sends both parent + internal notification emails, rebuilds sheets |

### Admin (require `token` = the current admin password)
| Action | Params | Behaviour |
|---|---|---|
| `adminAuth` | `code`/`password` | Validates against admin password; token IS the password |
| `kitchenLoad` | `token` | Returns the persisted `Kitchen_Board_State` row |
| `kitchenStatus` | `token` | Returns just the `updatedAt` timestamp, for cheap polling |
| `kitchenSave` | `token`, `payload` (JSON, ≤500KB) | Overwrites the persisted board state under a script lock |
| `adminGetSettings` | `token` | Full settings + live stats + last-20 audit log |
| `adminGetOrders` | `token` | Combined lunch + parent orders (parent orders normalized into the same shape) |
| `adminGetParentOrders` | `token` | Parent orders only, raw shape |
| `adminSetParentAccessCode` | `token`, `parentAccessCode` | Rotates the parent gate code |
| `adminUpdateSettings` | `token`, any settings fields (or `settingsJson`) | Partial update, merged over existing settings |
| `adminGetOrdersChecklist` | `token` | Server-rendered checklist HTML for the iframe |
| `emailOrdersPdf` | `token` | Renders + emails the checklist as PDF to `ordersTeamEmail` |
| `adminStartNewSession` | `token`, `newServiceDate`, `newMaxPizzas` | Archives + wipes `Form Responses 1`, resets session |
| `adminResendConfirmation` | `token`, `orderId`, `source` (`lunch`/`parent`/`event`) | Force-resends that order's confirmation |
| `adminSendAutomatedEmail` | `token`, `category` (`customer`/`internal`), `type`, `recipient`/`orderId`, `subject`, `message` | Dispatches any of the templated or custom emails |
| `adminUpdatePaidStatus` | `token`, `orderId`, `status`, `source` | Sets payment status; also increments discount-code usage if newly marked Paid |
| `adminUpdatePaymentMethod` | `token`, `orderId`, `paymentMethod` | Writes an override row into `Pizza Order Update` |
| `adminDeleteOrder` | `token`, `orderId`, `source` | Soft-deletes (flags), never removes the row |
| `adminGetEvents` | `token` | Full event list incl. inactive, for management |
| `adminSaveEvent` | `token`, all event fields | Create-or-update by `eventId` |
| `adminGetRegisterInterest` | `token` | All "interested" people across every event |
| `adminDeleteEvent` | `token`, `eventId` | **Hard-deletes** the row from `Events` (unlike orders) |
| `adminGetEventOrders` | `token`, `eventId` (optional filter) | Event order list |
| `adminChangePassword` | `token`, `currentPassword`, `newPassword` | Rotates the shared admin password |
| `adminLogout` | `token` | Clears cache entry (mostly a no-op given the auth model) |

`doPost(e)` exists only for completeness/CORS-preflight compatibility: it merges any form-encoded or JSON body into the same `params` object and forwards straight into `doGet`. **In practice every call in the frontend is a GET.**

---

## 10. Core Business Logic Algorithms

### 10.1 Pizza-branch column mapping (`BRANCHES`)

```javascript
// Column index (0-based) blocks for each "how many pizzas" branch: [sizeCol, nameCol, classCol]
var BRANCHES = {
  '1': [[4, 5, 6]],
  '2': [[43, 44, 45], [46, 47, 48]],
  '3': [[7, 8, 9], [10, 11, 12], [13, 14, 15]],
  '4': [[31, 32, 33], [34, 35, 36], [37, 38, 39], [40, 41, 42]],
  '5': [[16, 17, 18], [19, 20, 21], [22, 23, 24], [25, 26, 27], [28, 29, 30]]
};
var PRICE_MAP = { '12inch': 8, 'Half12inch': 5, 'Quarter12inch': 3 };
```
Every place that needs "the list of pizzas in this order" (confirmation emails, admin order list, kitchen checklist, capacity math, lookups) repeats the same pattern: read `qtyDigit = extractDigit(row[3])`, look up `BRANCHES[qtyDigit]`, and for each `[sizeCol,nameCol,classCol]` triple, skip it if both size and name are blank (meaning that slot wasn't used), otherwise emit one pizza line-item.

### 10.2 Settings schema & capacity math

```javascript
function getDefaultSettings() {
  return {
    serviceDate: 'Tuesday 15th September 2026',
    serviceTitle: 'Tuesday 15th Sept Availability',
    serviceNoticeDate: 'Tuesday Lunchtime — starting 15th of August',
    maxPizzas: 20,
    orderingEnabled: true,
    autoCloseEnabled: true,
    autoCloseDay: 'Sunday',
    autoCloseTime: '21:00',
    capacityMessage: '...',
    deadlineMessage: '...',
    fullyBookedMessage: "We're fully booked for this session. Please check back next time.",
    ordersTeamEmail: 'louis@benne.co.uk,marlowb11@icloud.com',
    sessionStartRow: 2,           // which row in Form Responses 1 the current session begins at
    sessionId: 'session_init',
    sessionStartDate: new Date().toISOString()
  };
}
```
Settings persist as one JSON blob under the Script Property key `ARTISAN_SETTINGS`; `saveSettings()` merges partial updates over the existing object and re-syncs the human-readable `Admin_Settings` sheet mirror. **Pizza "capacity" is fractional**, not a simple order count: a whole pizza = `1.0`, half = `0.5`, quarter = `0.25` (`getPizzaCapacityValue`), rounded to the nearest quarter (`normalizePizzaCapacity`). `remainingPizzas = max(0, maxPizzas - currentPizzas)`; ordering is open iff `orderingEnabled && !isPastAutoClosingDeadline() && remainingPizzas > 0`.

### 10.3 Auto-close deadline logic

```javascript
function isPastAutoClosingDeadline(settings) {
  if (!settings.autoCloseEnabled) return false;
  var dayOfWeek = /* 1=Mon..7=Sun, Europe/London tz */;
  var currentTimeVal = hour*60 + minute;
  var closeTimeVal = closeHour*60 + closeMinute; // from settings.autoCloseTime
  if (dayOfWeek === 7 && currentTimeVal >= closeTimeVal) return true; // Sunday after close time
  if (dayOfWeek === 1) return true;                                   // all of Monday
  if (dayOfWeek === 2 && currentTimeVal < 13*60) return true;         // Tuesday before 1pm
  return false;
}
```
Note this schedule (Sun evening → Mon all day → Tue morning) is **hardcoded to a Tuesday service day** even though `autoCloseDay`/`autoCloseTime` are configurable settings — the day names in the settings UI don't actually parametrize this function; only the close *time* on Sunday does. This is a real bug/limitation to fix in v2 (see §16).

### 10.4 Order-ID generation

- **Lunch orders**: `orderId = sheetRowNumber - 1` (row 2 → Order #1). No stored counter — it's implicit in sheet position. This is why lunch orders are *never* hard-deleted.
- **Event & Internal-Parent orders** share one global counter, prefixed `E`:
```javascript
function getNextOrderNumber() {
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  var current = parseInt(props.getProperty('NEXT_ORDER_NUMBER'), 10);
  if (!current) current = seedOrderCounter(); // seeds to max(100, lastRow+1)
  props.setProperty('NEXT_ORDER_NUMBER', String(current + 1));
  return 'E' + current;
}
```

### 10.5 Order lookup priority (`lookupOrder`)

Given a search string (email or order ID) and optional secure token:
1. If the ID looks like an event/parent order (`/^E/i`), try `lookupEventOrder` then `lookupInternalParentOrder` first.
2. Otherwise scan `Form Responses 1` for a match by **token** (highest priority, exact), then by **email** (case-insensitive), then by **bare order number** (only if no token was supplied at all, to avoid ID-guessing attacks succeeding without a token — though in practice order IDs are small sequential integers so this is weak protection, see §16).
3. If nothing found and an email was given, fall back to event orders, then internal parent orders, by the same email.

### 10.6 Discount engine

```javascript
function getDiscount(rawCode, subtotal) {
  var code = rawCode.trim().toUpperCase();
  if (code === 'STMSCS') return { valid:true, code, type:'percent', value:15,
    discountAmount: round(subtotal*0.15), newTotal: max(0, round(subtotal*0.85)) };
  if (code === 'MUTTI' /* or legacy aliases */) return { valid:true, code:'MUTTI', type:'percent', value:50,
    discountAmount: round(subtotal*0.50), newTotal: max(0, round(subtotal*0.50)) };
  // else: look up the "Discount Codes" sheet — supports percent or flat £,
  // MaxUses/TimesUsed cap, Active flag, ExpiresOn date.
}
```
`getOrderDiscountInfo(row, headers, subtotal)` figures out *which* code (if any) applies to a given lunch-order row: it checks the `Discount Code` column first, then scans the whole row for the literal strings `STMSCS`/`INTERNAL_PARENT_50`/`INTERNAL_PARENT`, then — as a last resort — checks whether the payer's email is in the hardcoded `PARENT_EMAILS` allow-list, in which case the internal 50% discount is silently applied even without a code. `incrementDiscountUsage()` bumps the `TimesUsed` counter only at the moment an order is marked **Paid** by an admin (not at order time), so unpaid/cancelled orders never consume a limited-use code's cap.

### 10.7 Payment method & payment status resolution

Two independent, layered heuristics:
- **`detectPaymentMethodFromRow`**: (1) look for a header literally containing "payment method"/"preferred payment"/etc. and use that cell; (2) else scan every cell in the row for an exact match against known method strings; (3) else check the two known Google Form payment columns (49/51); (4) else scan every cell again for substring matches; (5) default `'Bank Transfer'`. An admin-set override in the `Pizza Order Update` sheet (keyed by Order ID) always takes precedence over all of this when present.
- **`resolvePaymentStatus`**: an explicit admin-set manual status always wins; otherwise falls back to `customerReportedPaid()`, which scans headers for anything matching `/have you paid|already paid|paid for|payment (made|sent|completed)/` and reads a Yes/True answer from that cell (a "have you already paid?" form question that doesn't actually exist in the current live Form, so this path is effectively dead code today, but the fallback exists for forward-compatibility).

### 10.8 Full session stats (`calculateCurrentSessionStats`)

Iterates every non-blank, non-deleted row from `sessionStartRow` to the end of `Form Responses 1`, accumulating: total pizzas/orders, split by payment method (cash vs. bank/other) × by paid-status (all vs. paid-only), summing **post-discount** totals throughout. Then does the exact same accumulation a second time over `Internal Parent Orders`, adding those numbers into the same running totals (excluding rows flagged Deleted or with a terminal status like `failed`/`refunded`/`void`). This function backs every number on the Dashboard tab's metric cards.

---

## 11. Email System — Every Template

All emails are sent via `MailApp.sendEmail({to, subject, body, htmlBody, attachments})` — both a plain-text `body` and a styled `htmlBody` are always provided together for client compatibility. Shared brand HTML pattern: a forest-green (`#4F6359`/`#1F3A2E`) header band with "ARTISAN OVEN" letter-spaced, a cream (`#FAF8F5`) body card, signed off "Marlow, Louis, and Quinton". The shared `PAYMENT_INFO_BLOCK` (bank details / PayPal links / cash instructions) is interpolated into every order-related email.

| Trigger | Function | Subject | Recipient | Contains |
|---|---|---|---|---|
| Lunch order submitted (form trigger) | `sendOrderConfirmationForRow` | *"Your Pizza Order Confirmation & Payment Details (#N)"* | payer's email | Order #, secure view-order link (`Payment.html?order=N&token=...`), itemised pizzas, discount line if any, total, full payment info, collection instructions, WhatsApp group link |
| Event order placed | `sendEventConfirmation` | event's configured subject, or default | customer email | Same shape as above but scoped to that event; supports an event-specific custom message injected from the `Events` sheet's `Email Message` column |
| Internal parent order placed | `sendParentOrderConfirmation` (to parent) + `sendInternalParentOrderNotification` (to `YOUR_EMAIL`, plain-text ops alert) | *"...Parent Order Confirmation (#N)"* / *"NEW INTERNAL PARENT ORDER — Order #N"* | parent + internal | Original total, discount amount, final total, payment method, notes |
| Admin clicks "Ready for Collection" | `sendCustomerOrderReadyEmail` | *"...Your Pizza Order #N is Ready for Collection!"* | customer | Optional custom message, collection reminder |
| Admin sends a custom message | `sendCustomerCustomEmail` | admin-typed subject (default provided) | customer | Free-form message body |
| Order/form-submit trigger, and various admin actions | `emailXlsxSnapshot` | *"Pizza Order Update - Live Spreadsheet"* | `ordersTeamEmail` or specified | The rebuilt `Pizza Order Update` sheet, exported live as a `.xlsx` attachment (via a temporary spreadsheet copy + Drive export URL, then trashed) |
| Admin requests, or automatically before a "Start New Week" wipe | `sendInternalSummaryEmail` | *"Artisan Oven — Operational Summary (<date>)"* | any address | Rich HTML digest: lunch order stats box, parent order stats box, combined totals box, optional admin notes |
| Admin clicks "Email to Team" on the Orders tab | `emailOrdersPdf` (uses `renderOrdersChecklistHtml`) | *"Orders - <session label>"* | `ordersTeamEmail` | The same class-grouped tick-box checklist as the live iframe, rendered to PDF via `HtmlService` + `getAs('application/pdf')` |

All order-confirmation emails are **idempotent**: a hidden "SENT"/"Confirmation Status" flag column per order type prevents double-sending, and each is protected by a `LockService` script lock so two near-simultaneous triggers (e.g. a form-submit trigger racing an admin "resend" click) can't both fire.

---

## 12. Security & Auth Model

- **Admin auth**: a single shared secret stored under Script Property `ADMIN_ACCESS_CODE` (default `ArtisanOvenAdmin2026!`, meant to be changed on first setup). There is **no session/token distinct from the password itself** — `generateAdminToken()` literally returns the current password, and `verifyAdminToken(supplied)` just string-compares `supplied === expected`. This means: no session expiry, no logout-elsewhere, no per-admin identity or audit attribution (the log always says `Actor: 'Admin'`), and the password travels in every single request's query string (mitigated somewhat by HTTPS, but still visible in Apps Script execution logs).
- **Parent (internal-order) auth**: a separate shared secret (`PARENT_ACCESS_CODE`), but this one *does* issue a real ephemeral session token via `CacheService` (12-hour TTL, `Utilities.getUuid()`), which is the more correct pattern — worth generalizing to Admin auth too in v2.
- **Order-lookup auth**: effectively "security by low-value target + obscurity" — a bare order number is a small sequential integer with no rate limiting; the per-order UUID `token` (mailed to the customer) is the only real secret, but a lookup **by email** requires no token at all, meaning anyone who knows (or guesses) a parent's email and that they order can see their order and total. Acceptable for a small trusted-school context, not acceptable to carry forward unchanged if the business scales.
- **Input sanitisation**: `sanitizeForSheet()` prefixes a leading `'` onto any cell value starting with `=+-@` to prevent Google Sheets formula-injection from user-supplied text (a real and non-obvious attack vector against spreadsheet-backed systems). Applied to every field written from a public form (event orders, parent orders, interest registrations) — but notably **not** applied to the values coming from the native Google Form response row itself (Google Forms' own sheet-writing path isn't going through this code, so it's already been written directly by Google before Apps Script ever sees it).
- **CORS**: Apps Script Web Apps deployed as "Anyone" execute-as have permissive CORS by default for simple `fetch` GETs; no explicit CORS headers are set in this code (`ContentService` output naturally allows this).

---

## 13. PWA / Service Workers / Manifests

Three of the internal-facing pages are installable as standalone home-screen apps:

| App | Manifest | Service Worker | Icons |
|---|---|---|---|
| Admin | `admin-manifest.json` (`start_url: ./admin.html`) | `admin-sw.js` (cache name `ao-admin-v4`) | `admin-assets/` (192/512/apple-touch) |
| Kitchen | `kitchen-manifest.json` | `kitchen-sw.js` | `kitchen-assets/kitchen-icon.svg` |
| Parent | `parent-manifest.json` | `parent-sw.js` | `parent-assets/parent-icon.svg` |

Each service worker follows the identical pattern: **precache an app shell on install** (`caches.open(CACHE, ...).addAll([...core files...])`), **clean up old cache versions on activate**, and **network-first-with-cache-fallback on fetch** for same-origin GET requests only (any cross-origin request, e.g. to the Apps Script API, passes straight through uncached, since that data must always be live). Bumping the cache name constant (e.g. `ao-admin-v4` → `v5`) is the mechanism used to force all installed PWA instances to pick up a new app shell on next load.

---

## 14. Local Dev Server & `config.js`

`server.js` is a small Express app (see full source in the reference bundle) whose entire purpose is:
1. Serve every static file in the repo, with cache headers tuned per file type (`no-cache` for HTML/service-workers/manifests so updates always land immediately; `max-age=86400, immutable` for fonts; `max-age=3600` for everything else).
2. **Block direct access** to anything matching `/^\./`, `*.gs/.ts/.env/.bak/.config/.lock/.log/.md`, or the specific filenames `server.js/package.json/package-lock.json/metadata.json/apps-script.js` (returns bare 404), and blocks the whole `/apps-script` path — so the backend source and secrets never get accidentally served as a static asset.
3. Expose `GET /api/status`: an in-memory, ~6-second-fresh, stale-while-revalidate cache in front of the real `getStatus` Apps Script call, with a single in-flight de-duplicated fetch (`pendingFetchPromise`) so a burst of simultaneous visitors doesn't cause a burst of upstream calls.
4. Expose `GET /config.js`: dynamically generates a tiny JS snippet setting `window.ORDER_API_URL`, `window.STATUS_API_URL = "/api/status"`, and — if a cached status is already warm — `window.INITIAL_STATUS`, all read by every page's `<script src="/config.js">` tag before any other script runs, and by `script.js`'s tracker-hydration logic.
5. Provide clean lower/upper-case route aliases for every page (`/order`, `/Order.html`, etc. all resolve to `order.html`).

**On the GitHub Pages deployment there is no server at all** — `/config.js` and `/api/status` simply 404, and every page's own fallback logic (`ORDER_API_URL` hardcoded default in `script.js`, direct Apps Script fetch fallback) takes over transparently. The Express server is purely an *optional* self-hosted enhancement layer, not a requirement.

---

## 15. CI/CD & Deployment

**Frontend → GitHub Pages** (`.github/workflows/deploy-pages.yml`): on every push to `main`, rsync the whole repo (minus `.git`, `.github`, `apps-script`) into `_site/`, then use `actions/upload-pages-artifact` + `actions/deploy-pages`. No build step — it's a pure static-file copy.

**Backend → Google Apps Script** (`.github/workflows/deploy-apps-script.yml`): triggered only on pushes that touch `apps-script/**`. Installs `@google/clasp`, restores a `CLASPRC_JSON` secret as `~/.clasprc.json` (a pre-authorized OAuth credential for a Google account with edit access to the bound sheet/script), runs `clasp push --force` (uploads `apps-script/Code.gs` + `appsscript.json`), creates a new named version (`clasp version "GitHub Actions <sha>"`), and deploys it to the **existing** deployment ID (`clasp deploy --deploymentId <APPS_SCRIPT_DEPLOYMENT_ID>`) so the live Web App URL never changes.

**Important asymmetry to fix in v2**: the root-level `apps-script.js` (which is what a developer actually edits day-to-day, judging by its more advanced version number/newer code) is **not itself deployed by CI** — only `apps-script/Code.gs` is. The repo's own diff shows the two files have drifted (the root file is ~160 lines ahead). Someone has to manually copy `apps-script.js` → `apps-script/Code.gs` before the Apps Script CI pipeline will pick up recent changes. This is a real, live footgun (see §16) and should be collapsed into one canonical file with one deploy path in v2.

**AI-agent workflow** (`GEMINI.md`): documents a strict human-in-the-loop policy for the AI coding agent that maintains this repo — always branch-per-issue, always PR (never push/merge to `main` directly), always explain the change/tests/limitations in the PR body, never touch payment/auth/customer-data code without extra care, never commit secrets.

---

## 16. Known Fragility Points — Why v1 Breaks Over Time

This section exists specifically to inform the v2 redesign — these are the structural reasons the current system becomes harder to change safely as more features get bolted on:

1. **Positional, not named, spreadsheet columns.** The entire `Form Responses 1` parsing pipeline (`BRANCHES`, hardcoded column numbers 0–72) breaks the moment anyone edits a question in the Google Form — reordering, inserting, or renaming a question shifts every column index downstream and silently corrupts every read. There's no schema validation or column-name lookup for the bulk of the fields (only the discount columns use `findHeaderIndex`).
2. **One 600-line sequential `if/else` dispatcher** (`doGet`) instead of a route table. Every new feature adds another `if (action === '...')` block near wherever felt natural at the time; there's no consistent place new actions "belong," no shared request-validation middleware (auth-checking is copy-pasted at the top of ~25 different blocks), and no way to unit-test one action without loading the entire 4,700-line file.
3. **Three parallel "order" concepts that don't share a schema**: `Form Responses 1` rows (lunch), `Event Customers` rows (events), `Internal Parent Orders` rows (parent). Every cross-cutting feature (admin order list, lookup, delete, resend, payment status) has to be implemented three times with three different column layouts, three different ID formats (`row-1` vs `E###` vs `E###`-shared-counter), and three different soft-delete column positions. Bugs fixed in one path routinely aren't fixed in the other two (e.g. `customerReportedPaid` heuristic only exists for lunch orders).
4. **Settings live in Script Properties as an unversioned JSON blob**, with a "mirror" sheet (`Admin_Settings`) that looks editable but silently does nothing if edited directly — a strong candidate for confusing a future maintainer.
5. **Auth = shared static password = session token**, with no expiry, no per-admin identity, and a password rotation that invalidates every concurrent session with no warning. Fine for 2–3 trusted volunteers; won't scale to a bigger admin team without real accounts.
6. **The auto-close deadline logic is hardcoded to a Tuesday service day** inside `isPastAutoClosingDeadline`, even though the admin UI presents `autoCloseDay` as a configurable dropdown — changing that setting to any day other than Sunday (for the "closes at" day) silently does nothing, because the day-of-week branching (`dayOfWeek===7`, `===1`, `===2`) is literal, not derived from the setting.
7. **Two divergent copies of the backend** (`apps-script.js` at repo root vs. `apps-script/Code.gs`, the one CI actually deploys) that must be manually kept in sync — a very easy way to deploy stale logic without realising it.
8. **Discount codes are partly hardcoded, partly sheet-driven** (`STMSCS`/`MUTTI` short-circuit inside `getDiscount()` regardless of what the `Discount Codes` sheet says), and the internal-parent discount can *also* be silently granted via a hardcoded email allow-list (`PARENT_EMAILS`) independent of any code at all — three different code paths that all need to agree, and don't have a single source of truth.
9. **Dead/legacy code accumulation**: unused columns in the form response sheet (`12 Inch Pizza`, `Column 54`, `Column 1`), a whole unused `initIOSBottomNav()` function, legacy order-ID-prefix-stripping logic in `script.js` for an order-numbering scheme (`AO-1000+n`) that no longer exists, and legacy `<!--AO_REG_INTEREST:1-->` HTML-comment markers still being parsed on every event read years after a proper `Register Interest` column was added.
10. **No automated tests.** `npm run lint` only runs `node --check` (a syntax check) on the JS files — there is no functional test coverage for the capacity math, discount engine, or email templates, so regressions are only caught in production.

---

## 17. Recommended v2 Architecture & Starter Code

You don't have to keep the "Google Sheet as database" architecture, but if you want the *fastest, lowest-risk* rebuild — one a small volunteer team can still operate without needing a hosting bill or a real ops burden — the pragmatic move is: **keep Google Sheets + Apps Script, fix the internal architecture.** Below is a concrete skeleton for that; a "go further" option (a small real backend) follows it.

### 17.1 Fix #1 — A proper router instead of one big `if` chain

```javascript
// v2/router.js  (Apps Script — one file, but organised as a lookup table)
var ROUTES = {
  getStatus:        { auth: 'none',   handler: handleGetStatus },
  getOrder:         { auth: 'none',   handler: handleGetOrder },
  adminGetOrders:   { auth: 'admin',  handler: handleAdminGetOrders },
  adminUpdatePaidStatus: { auth: 'admin', handler: handleAdminUpdatePaidStatus },
  // ...one line per action, easy to scan, easy to add to...
};

function doGet(e) {
  var params = normalizeParams(e);
  var action = String(params.action || '').trim();
  var route = ROUTES[action];
  if (!route) return json({ success: false, message: 'Unknown action: ' + action });

  if (route.auth === 'admin' && !verifyAdminToken(params.token)) {
    return json({ success: false, unauthorized: true, message: 'Access denied.' });
  }
  if (route.auth === 'parent' && !verifyParentSessionToken(params.token)) {
    return json({ success: false, message: 'Access denied.' });
  }

  try {
    return json(route.handler(params));
  } catch (err) {
    Logger.log(action + ' error: ' + err);
    return json({ success: false, message: 'Server error: ' + err.toString() });
  }
}
function doPost(e) { return doGet(e); } // unchanged behaviour, still fine
```
This alone gets you: auth-checking in exactly one place, a single glanceable list of every endpoint, and handler functions that are independently testable (each just takes `params` and returns a plain object — `json()` wrapping happens once, centrally).

### 17.2 Fix #2 — One unified `Orders` sheet instead of three schemas

Give every order — lunch, event, or internal-parent — the **same row shape**, with a `type` column distinguishing them, and **line items as a JSON array** instead of positional columns:

```
Orders sheet columns:
OrderId | Type | Timestamp | CustomerName | CustomerEmail | ChildrenJson |
ItemsJson | Subtotal | DiscountCode | DiscountAmount | Total |
PaymentMethod | PaymentStatus | ConfirmationStatus | Notes | Token | Deleted |
EventId (blank for lunch/parent) | SessionId (which week/session this belongs to)
```
```javascript
// Example row as an object, before flattening to a sheet row:
{
  orderId: "L-0042",              // one ID scheme for ALL order types: <TypeLetter>-<zeroPaddedCounter>
  type: "lunch",                  // "lunch" | "event" | "parent"
  timestamp: new Date().toISOString(),
  customerName: "Jane Smith",
  customerEmail: "jane@example.com",
  children: [{ name: "Alex", className: "Class 5" }],
  items: [{ size: "12inch", qty: 1, unitPrice: 8, childIndex: 0 }],
  subtotal: 8, discountCode: "", discountAmount: 0, total: 8,
  paymentMethod: "Bank Transfer", paymentStatus: "Pending Payment",
  confirmationStatus: "PENDING", notes: "", token: Utilities.getUuid(),
  deleted: false, eventId: "", sessionId: "session_2026-09-29"
}
```
Every downstream feature (admin list, lookup, delete, resend, payment toggle, capacity math, kitchen checklist) is now **one function each**, parametrized by `type` only where genuinely different (e.g. email subject line), instead of three near-duplicate implementations. A single incrementing counter per type (`L-`, `E-`, `P-`) replaces "lunch ID = row number" (which also means you can finally hard-delete safely — order links use the stored `token`/`orderId` field, not sheet position).

### 17.3 Fix #3 — A real (small) order form instead of a branching Google Form

Replace the 5-branch Google Form with **your own line-item HTML form** (`event-order.html` already proves this pattern works well — the internal-parent and event flows use exactly this "add another row" UI). One form, submitted via `fetch()` straight to your Apps Script `createOrder` action, replaces the entire fragile `BRANCHES` column-index system:

```html
<!-- v2 order form pattern (already proven in event-order.html) -->
<div id="pizza-rows"></div>
<button type="button" id="add-row">+ Add another pizza</button>
<script>
function addPizzaRow() {
  const row = document.createElement('div');
  row.className = 'pizza-row';
  row.innerHTML = `
    <input type="text" class="child-name" placeholder="Child's name" required>
    <input type="text" class="child-class" placeholder="Class" required>
    <select class="pizza-size">
      <option value="12inch">Whole 12" — £8</option>
      <option value="Half12inch">Half 12" — £5</option>
      <option value="Quarter12inch">Quarter 12" — £3</option>
    </select>
    <button type="button" class="remove-row">×</button>`;
  document.getElementById('pizza-rows').appendChild(row);
}
document.getElementById('add-row').addEventListener('click', addPizzaRow);
addPizzaRow(); // start with one row

async function submitOrder(e) {
  e.preventDefault();
  const items = [...document.querySelectorAll('.pizza-row')].map(row => ({
    childName: row.querySelector('.child-name').value,
    className: row.querySelector('.child-class').value,
    size: row.querySelector('.pizza-size').value
  }));
  const url = new URL(ORDER_API_URL);
  url.searchParams.set('action', 'createOrder');
  url.searchParams.set('type', 'lunch');
  url.searchParams.set('items', JSON.stringify(items));
  url.searchParams.set('payerName', document.getElementById('payer-name').value);
  url.searchParams.set('payerEmail', document.getElementById('payer-email').value);
  url.searchParams.set('paymentMethod', document.getElementById('payment-method').value);
  url.searchParams.set('submissionId', 'sub_' + crypto.randomUUID());
  const res = await fetch(url.toString());
  const data = await res.json();
  // render confirmation using data.orderId / data.total, same as today
}
</script>
```
This also removes the whole "confirmation email only fires from a Sheet `onFormSubmit` trigger, so historical-row-age heuristics are needed to avoid bulk-resending on deploy" problem (§ `sendOrderConfirmationForRow`'s 24-hour-age guard) — your own endpoint sends the confirmation synchronously, in the same request that creates the order, with no trigger involved at all.

### 17.4 Fix #4 — Real per-admin sessions instead of a shared static password

Reuse the pattern the *parent* flow already gets right (`CacheService`-backed ephemeral token), and extend it with per-admin identity for a proper audit trail:

```javascript
// v2/auth.js
var ADMINS_PROP = 'ADMIN_USERS_JSON'; // { "alice": "<hashed password>", "bob": "..." }

function verifyAdminLogin(username, password) {
  var admins = JSON.parse(PropertiesService.getScriptProperties().getProperty(ADMINS_PROP) || '{}');
  var expectedHash = admins[username];
  if (!expectedHash) return null;
  var suppliedHash = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
  );
  if (suppliedHash !== expectedHash) return null;

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('admin_session_' + token, username, 8 * 60 * 60); // 8h TTL
  return token;
}

function verifyAdminToken(token) {
  if (!token) return null;
  return CacheService.getScriptCache().get('admin_session_' + token); // returns username, or null
}

// then in logAdminAction(action, details, actorUsername) — real attribution, at last.
```

### 17.5 Fix #5 — Fix the auto-close logic to actually honour the configured day

```javascript
var DAY_NAME_TO_ISO = { Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6, Sunday:7 };

function isPastAutoClosingDeadline(settings) {
  if (!settings.autoCloseEnabled) return false;
  var closeDayIso = DAY_NAME_TO_ISO[settings.autoCloseDay] || 7;
  var serviceDayIso = DAY_NAME_TO_ISO[settings.serviceDayOfWeek] || 2; // NEW: make the service day itself a setting too
  var now = new Date();
  var dayOfWeek = parseInt(Utilities.formatDate(now, 'Europe/London', 'u'), 10);
  var minutesNow = parseInt(Utilities.formatDate(now,'Europe/London','HH'),10)*60
                  + parseInt(Utilities.formatDate(now,'Europe/London','mm'),10);
  var [closeHour, closeMinute] = (settings.autoCloseTime || '21:00').split(':').map(Number);
  var closeMinutes = closeHour * 60 + closeMinute;

  // Generalised: "past deadline" = on/after closeDay+closeTime, until serviceDay's cutoff hour
  if (dayOfWeek === closeDayIso && minutesNow >= closeMinutes) return true;
  var daysBetween = (serviceDayIso - closeDayIso + 7) % 7; // e.g. Sun(7)->Tue(2) = 2 days between
  for (var d = 1; d < daysBetween; d++) {
    if (dayOfWeek === ((closeDayIso + d - 1) % 7) + 1) return true; // every full day in between is closed
  }
  if (dayOfWeek === serviceDayIso && minutesNow < 13 * 60) return true; // still closed until midday on service day
  return false;
}
```

### 17.6 Migration path

Because both old and new schemas can coexist in the same Sheet during a transition:
1. Ship the v2 `apps-script.js` alongside the existing sheets, with a **one-time migration function** that reads every legacy `Form Responses 1` / `Event Customers` / `Internal Parent Orders` row and writes it into the new unified `Orders` sheet using the existing `BRANCHES`/parsing code (still needed, but now only for this one-off migration, not for every future read).
2. Point the frontend's `order.html` at the new custom form (17.3) instead of the Google Form iframe; keep the old Google Form live but unlinked as a fallback for one season.
3. Once a full season has run cleanly on the new schema, delete the legacy sheets/columns and the migration function.

This gets you a working, structurally sound v2 without a full platform rewrite, while preserving every feature documented in Sections 6–13 above.
