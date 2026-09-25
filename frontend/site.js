'use strict';
/* site.js — shared frontend behaviour for all public pages.
   Each init function is gated on the presence of its anchor element, so
   this file is safe to include on every page. */

const API = window.ORDER_API_URL || '/api';
const CACHE_KEY   = 'ao_session_status';
const CACHE_TTL   = 2 * 60 * 1000;  // 2 minutes

// ── Run on every page ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateFooterYear();
  initAvailabilityTracker();
  initOrderLookup();
  initOrderEventsBanner();
  initCopyButtons();
  initPizzaForm();
  initPWAServiceWorker();
});

// ── Footer year ───────────────────────────────────────────────────────────────
function updateFooterYear() {
  document.querySelectorAll('.js-year').forEach(el => {
    el.textContent = new Date().getFullYear();
  });
}

// ── Availability Tracker ──────────────────────────────────────────────────────
function initAvailabilityTracker() {
  const tracker = document.getElementById('availability-tracker');
  if (!tracker) return;

  // Paint instantly from cache, then refresh in background.
  const cached = readCache();
  if (cached) renderTracker(cached);

  fetchStatus().then(data => {
    if (data) renderTracker(data);
  });

  // Poll every 20 seconds while the tab is visible.
  let poll;
  function startPoll() {
    poll = setInterval(async () => {
      if (document.hidden) return;
      const data = await fetchStatus();
      if (data) renderTracker(data);
    }, 20_000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(poll);
    else { fetchStatus().then(d => d && renderTracker(d)); startPoll(); }
  });
  startPoll();

  // Refresh on focus.
  window.addEventListener('focus', () => fetchStatus().then(d => d && renderTracker(d)));
}

async function fetchStatus() {
  try {
    const res  = await fetch(`${API}/sessions/current`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const data = await res.json();
    writeCache(data);
    return data;
  } catch { return null; }
}

function renderTracker(data) {
  const {
    orderingOpen, serviceTitle, currentPizzas = 0, maxPizzas = 0, remainingPizzas = 0
  } = data;

  const title = document.getElementById('tracker-title');
  const pill  = document.getElementById('tracker-pill');
  const bar   = document.getElementById('tracker-bar');
  const foot  = document.getElementById('tracker-footer');

  if (title) title.textContent = serviceTitle || '';

  const pct = maxPizzas > 0 ? Math.min(100, (currentPizzas / maxPizzas) * 100) : 0;
  if (bar) {
    bar.style.width = pct + '%';
    bar.className = 'progress-bar' + (pct >= 100 ? ' full' : pct >= 75 ? ' low' : '');
  }

  if (pill) {
    if (!orderingOpen) {
      pill.className = 'status-pill closed';
      pill.textContent = 'Orders Closed';
    } else if (remainingPizzas <= 4) {
      pill.className = 'status-pill low';
      pill.textContent = `Only ${remainingPizzas} left!`;
    } else {
      pill.className = 'status-pill open';
      pill.textContent = 'Orders Open';
    }
  }

  if (foot) {
    foot.textContent = orderingOpen
      ? `${currentPizzas} of ${maxPizzas} pizzas claimed — ${remainingPizzas} remaining`
      : `${currentPizzas} of ${maxPizzas} pizzas — ordering closed`;
  }

  // Disable CTA buttons if ordering is closed.
  document.querySelectorAll('.js-order-btn').forEach(btn => {
    if (!orderingOpen) {
      btn.classList.add('disabled');
      btn.setAttribute('aria-disabled', 'true');
    } else {
      btn.classList.remove('disabled');
      btn.removeAttribute('aria-disabled');
    }
  });
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY) || localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

function writeCache(data) {
  try {
    const raw = JSON.stringify({ ts: Date.now(), data });
    sessionStorage.setItem(CACHE_KEY, raw);
    localStorage.setItem(CACHE_KEY, raw);
  } catch {}
}

// ── Order Lookup ──────────────────────────────────────────────────────────────
function initOrderLookup() {
  const form = document.getElementById('order-lookup-form');
  if (!form) return;

  // Auto-lookup from URL params (?order=L-0001&token=<uuid>)
  const params = new URLSearchParams(location.search);
  if (params.get('order') && params.get('token')) {
    doLookup(params.get('order'), params.get('token'));
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = document.getElementById('order-query')?.value?.trim();
    if (q) doLookup(q);
  });
}

let lookupAbort;
async function doLookup(query, token) {
  const section = document.getElementById('order-result-section');
  if (!section) return;

  lookupAbort?.abort();
  lookupAbort = new AbortController();

  section.hidden = false;
  section.innerHTML = '<div class="skeleton" style="height:120px;border-radius:8px"></div>';

  try {
    const url = new URL(`${API}/orders/lookup`, location.origin);
    url.searchParams.set('query', query);
    if (token) url.searchParams.set('token', token);

    const res  = await fetch(url, { signal: lookupAbort.signal });
    const data = await res.json();

    if (!data.success) {
      section.innerHTML = `<div class="alert alert-error">${data.message || 'Order not found.'}</div>`;
      return;
    }
    renderOrderResult(section, data.order);
  } catch (err) {
    if (err.name !== 'AbortError') {
      section.innerHTML = '<div class="alert alert-error">Something went wrong — please try again.</div>';
    }
  }
}

function renderOrderResult(container, order) {
  const sizeLabel = { '12inch': 'Whole 12"', 'Half12inch': 'Half 12"', 'Quarter12inch': 'Quarter 12"' };
  const methodLabel = { 'bank_transfer': 'Bank Transfer', 'paypal': 'PayPal', 'cash': 'Cash' };

  const rows = order.items.map(i => `
    <tr>
      <td>${escHtml(i.childName || '—')}</td>
      <td>${escHtml(i.childClass || '—')}</td>
      <td>${sizeLabel[i.size] || i.size}</td>
      <td>£${i.price.toFixed(2)}</td>
    </tr>`).join('');

  const paypal_url = `https://paypal.me/ArtisanOven/${order.total.toFixed(2)}GBP`;

  container.innerHTML = `
    <div class="order-result">
      <div class="flex justify-between items-center">
        <h3 class="font-brand">Order ${escHtml(order.id)}</h3>
        <span class="badge ${order.paymentStatus === 'paid' ? 'badge-green' : order.paymentStatus === 'partial' ? 'badge-amber' : 'badge-red'}">
          ${order.paymentStatus}
        </span>
      </div>
      <p class="text-muted text-sm mt-sm">${escHtml(order.customerName)}</p>

      <table class="order-items-table">
        <thead>
          <tr><th>Child</th><th>Class</th><th>Pizza</th><th>Price</th></tr>
        </thead>
        <tbody>
          ${rows}
          ${order.discount ? `<tr><td colspan="3" style="font-size:.9em;color:var(--text-400)">Discount (${escHtml(order.discountCode)})</td><td>−£${order.discount.toFixed(2)}</td></tr>` : ''}
          <tr class="total-row"><td colspan="3">Total</td><td>£${order.total.toFixed(2)}</td></tr>
          ${order.amountPaid > 0 && order.paymentStatus !== 'paid'
            ? `<tr><td colspan="3" style="color:var(--forest-600)">Paid so far</td><td>£${order.amountPaid.toFixed(2)}</td></tr>
               <tr style="font-weight:600;color:var(--terra-600)"><td colspan="3">Still owed</td><td>£${(order.total - order.amountPaid).toFixed(2)}</td></tr>`
            : ''}
        </tbody>
      </table>

      <div class="payment-info">
        <h4 style="margin-bottom:var(--space-md)">How to pay</h4>

        <div class="payment-method-section">
          <h4>🏦 Bank Transfer</h4>
          <div class="bank-details">
            <div>Account: <strong>Artisan Oven</strong> <button class="copy-btn" data-copy="Artisan Oven">copy</button></div>
            <div>Sort code: <strong>00-00-00</strong> <button class="copy-btn" data-copy="00-00-00">copy</button></div>
            <div>Acc. no: <strong>00000000</strong> <button class="copy-btn" data-copy="00000000">copy</button></div>
            <div>Reference: <strong>${escHtml(order.id)}</strong> <button class="copy-btn" data-copy="${escHtml(order.id)}">copy</button></div>
          </div>
        </div>

        <div class="payment-method-section">
          <h4>🅿 PayPal</h4>
          <a href="${paypal_url}" class="btn btn-outline mt-sm" target="_blank" rel="noopener">
            Pay £${order.total.toFixed(2)} via PayPal →
          </a>
        </div>

        <div class="payment-method-section">
          <h4>💵 Cash</h4>
          <p class="text-sm text-muted">Send cash with your child at lunchtime — please use an envelope labelled with Order ${escHtml(order.id)}.</p>
        </div>
      </div>
    </div>`;
}

// ── Events Banner ─────────────────────────────────────────────────────────────
function initOrderEventsBanner() {
  const banner = document.getElementById('order-events-banner');
  if (!banner) return;

  fetch(`${API}/events`)
    .then(r => r.json())
    .then(data => {
      if (!data.success || !data.events?.length) return;
      banner.removeAttribute('hidden');
    })
    .catch(() => {});
}

// ── Copy Buttons ──────────────────────────────────────────────────────────────
function initCopyButtons() {
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.copy-btn[data-copy]');
    if (!btn) return;
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 1500);
  });
}

// ── Native Pizza Order Form ───────────────────────────────────────────────────
function initPizzaForm() {
  const form = document.getElementById('pizza-order-form');
  if (!form) return;

  const rowsContainer = document.getElementById('pizza-rows');
  const addBtn        = document.getElementById('add-pizza-row');
  const totalEl       = document.getElementById('order-total');

  const PRICES = { '12inch': 8, 'Half12inch': 5, 'Quarter12inch': 3 };

  function addRow() {
    const idx = rowsContainer.querySelectorAll('.pizza-row').length;
    const div = document.createElement('div');
    div.className = 'pizza-row';
    div.innerHTML = `
      <div class="form-group">
        <label>Child's name</label>
        <input type="text" name="child_name[]" placeholder="e.g. Alex" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Class</label>
        <input type="text" name="child_class[]" placeholder="e.g. Class 4" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Pizza size</label>
        <select name="pizza_size[]">
          <option value="12inch">Whole 12″ — £8.00</option>
          <option value="Half12inch">Half 12″ — £5.00</option>
          <option value="Quarter12inch">Quarter 12″ — £3.00</option>
        </select>
      </div>
      <button type="button" class="remove-row" aria-label="Remove this pizza" ${idx === 0 ? 'style="visibility:hidden"' : ''}>×</button>`;
    div.querySelector('select').addEventListener('change', updateTotal);
    div.querySelector('.remove-row').addEventListener('click', () => {
      div.remove();
      updateRemoveButtons();
      updateTotal();
    });
    rowsContainer.appendChild(div);
    updateTotal();
  }

  function updateRemoveButtons() {
    const rows = rowsContainer.querySelectorAll('.pizza-row');
    rows.forEach((row, i) => {
      const btn = row.querySelector('.remove-row');
      btn.style.visibility = rows.length === 1 ? 'hidden' : '';
    });
  }

  function updateTotal() {
    let total = 0;
    rowsContainer.querySelectorAll('select[name="pizza_size[]"]').forEach(sel => {
      total += PRICES[sel.value] || 0;
    });
    if (totalEl) {
      totalEl.textContent = `£${total.toFixed(2)}`;
      // Factor in discount code preview if one's entered.
      const code = form.querySelector('[name="discount_code"]')?.value?.trim().toUpperCase();
      // Full discount validation happens server-side; this is client-side display only.
    }
  }

  if (addBtn) addBtn.addEventListener('click', () => { addRow(); updateRemoveButtons(); });
  addRow(); // start with one row

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';

    try {
      const rows = [...rowsContainer.querySelectorAll('.pizza-row')].map(row => ({
        childName:  row.querySelector('[name="child_name[]"]')?.value?.trim() || null,
        childClass: row.querySelector('[name="child_class[]"]')?.value?.trim() || null,
        size:       row.querySelector('[name="pizza_size[]"]')?.value,
      }));

      const body = {
        orderType:      form.querySelector('[name="order_type"]')?.value || 'lunch',
        payerName:      form.querySelector('[name="payer_name"]').value.trim(),
        payerEmail:     form.querySelector('[name="payer_email"]').value.trim(),
        payerPhone:     form.querySelector('[name="payer_phone"]')?.value?.trim() || null,
        whatsappOptIn:  form.querySelector('[name="whatsapp_opt_in"]')?.checked || false,
        items:          rows,
        allergyFlag:    form.querySelector('[name="allergy_flag"]')?.value === 'yes',
        allergyNotes:   form.querySelector('[name="allergy_notes"]')?.value?.trim() || null,
        discountCode:   form.querySelector('[name="discount_code"]')?.value?.trim() || null,
        paymentMethod:  form.querySelector('[name="payment_method"]:checked')?.value || 'bank_transfer',
        notes:          form.querySelector('[name="notes"]')?.value?.trim() || null,
        termsAcceptedAt: form.querySelector('[name="terms"]')?.checked ? new Date().toISOString() : null,
        submissionId:   'sub_' + Math.random().toString(36).slice(2) + '_' + Date.now(),
      };

      const res  = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!data.success) {
        showFormError(form, data.message || 'Could not place order — please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place Order';
        return;
      }

      // Show confirmation.
      showConfirmation(form, data);
    } catch {
      showFormError(form, 'Network error — please check your connection and try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Place Order';
    }
  });
}

function showFormError(form, msg) {
  let err = form.querySelector('.form-error-banner');
  if (!err) {
    err = document.createElement('div');
    err.className = 'alert alert-error form-error-banner';
    form.prepend(err);
  }
  err.textContent = msg;
  err.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showConfirmation(form, data) {
  const section = document.getElementById('order-confirmation');
  if (section) {
    section.hidden = false;
    const idEl = section.querySelector('.js-order-id');
    if (idEl) idEl.textContent = data.orderId;
    const totalEl = section.querySelector('.js-order-total');
    if (totalEl) totalEl.textContent = `£${data.total.toFixed(2)}`;
    section.scrollIntoView({ behavior: 'smooth' });
  }
  form.hidden = true;
}

// ── PWA service worker ────────────────────────────────────────────────────────
function initPWAServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const path = location.pathname;

  let sw;
  if (path.includes('admin'))  sw = '/admin/admin-sw.js';
  if (path.includes('kitchen')) sw = '/admin/kitchen-sw.js';
  if (path.includes('parent-order')) sw = '/frontend/parent-sw.js';
  if (!sw) return;

  navigator.serviceWorker.register(sw).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
