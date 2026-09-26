/* ArtisanOven v2 — the lunch order form on order.html (replaces v1's Google Form).
 * Same questions, same order as v1's form: allergies → up to 5 pizzas (size,
 * child's name, class) → payment method → payer name → email → optional staff /
 * sibling discount code → T&Cs. Talks to the backend only through AO_API (api.js).
 */
(function () {
  'use strict';

  var PRICES = { '12inch': 8, 'Half12inch': 5, 'Quarter12inch': 3 };
  var MAX_PIZZAS = 5;
  var discount = null;          // last valid discount check result
  var discountTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return '£' + Number(n).toFixed(2); };

  function rows() { return Array.prototype.slice.call(document.querySelectorAll('#lunch-pizza-rows .pizza-item-row')); }

  function items() {
    return rows().map(function (row) {
      return {
        size: row.querySelector('.pizza-size-select').value,
        childName: row.querySelector('.child-name-input').value.trim(),
        childClass: row.querySelector('.child-class-input').value.trim(),
      };
    });
  }

  function subtotal() { return items().reduce(function (s, i) { return s + (PRICES[i.size] || 0); }, 0); }

  function refreshRows() {
    var list = rows();
    list.forEach(function (row, i) {
      row.querySelector('.pizza-row-label').textContent = 'Pizza ' + (i + 1);
      var btn = row.querySelector('.remove-pizza-btn');
      var only = list.length === 1;
      btn.disabled = only;
      btn.style.opacity = only ? '0.4' : '1';
      btn.style.cursor = only ? 'not-allowed' : 'pointer';
    });
    var add = $('lunch-add-pizza');
    add.style.display = list.length >= MAX_PIZZAS ? 'none' : '';
    updateTotals();
  }

  function updateTotals() {
    rows().forEach(function (row) {
      row.querySelector('.pizza-row-subtotal').textContent = money(PRICES[row.querySelector('.pizza-size-select').value] || 0);
    });
    var sub = subtotal();
    var off = discount && discount.valid ? Math.min(sub, recalcDiscount(sub)) : 0;
    $('lunch-discount-line').style.display = off > 0 ? 'flex' : 'none';
    $('lunch-discount-amount').textContent = '−' + money(off);
    $('lunch-total').textContent = money(sub - off);
  }

  // The check returned a discount for the pizzas at that moment; scale it if the
  // basket has changed since (the server recalculates on submit anyway).
  function recalcDiscount(sub) {
    if (!discount || !discount.subtotalPence) return 0;
    return (discount.discountPence / discount.subtotalPence) * sub;
  }

  function addRow() {
    if (rows().length >= MAX_PIZZAS) return;
    var tpl = $('lunch-pizza-row-template');
    var row = tpl.content.firstElementChild.cloneNode(true);
    $('lunch-pizza-rows').appendChild(row);
    wireRow(row);
    refreshRows();
    row.querySelector('.child-name-input').focus();
  }

  function wireRow(row) {
    row.querySelector('.pizza-size-select').addEventListener('change', function () { updateTotals(); scheduleDiscountCheck(); });
    row.querySelector('.remove-pizza-btn').addEventListener('click', function () {
      if (rows().length > 1) { row.remove(); refreshRows(); scheduleDiscountCheck(); }
    });
  }

  function scheduleDiscountCheck() {
    clearTimeout(discountTimer);
    discountTimer = setTimeout(checkDiscount, 400);
  }

  function checkDiscount() {
    var code = $('lunch-discount-code').value.trim();
    var fb = $('lunch-discount-feedback');
    if (!code) { discount = null; fb.style.display = 'none'; updateTotals(); return; }
    AO_API.checkDiscount(code, items()).then(function (d) {
      if (code !== $('lunch-discount-code').value.trim()) return;   // typed on since
      discount = d.valid ? d : null;
      fb.style.display = 'block';
      fb.style.color = d.valid ? 'var(--basil)' : 'var(--terracotta)';
      fb.textContent = d.valid ? 'Discount code ' + d.code + ' applied.' : (d.message || 'Discount code not found.');
      updateTotals();
    });
  }

  function showError(msg) {
    var el = $('lunch-order-error');
    el.textContent = msg;
    el.style.display = 'block';
    el.scrollIntoView({ block: 'center' });
  }

  function validate() {
    var allergy = document.querySelector('input[name="lunch-allergy"]:checked');
    if (!allergy) return 'Please tell us whether there are any allergies or special remarks.';
    if (allergy.value === 'Yes' && !$('lunch-allergy-notes').value.trim()) return 'Please describe the allergies or special remarks.';
    if (items().some(function (i) { return !i.childName || !i.childClass; })) return 'Please give the name and class for each pizza.';
    if (!$('lunch-payer-name').value.trim()) return 'Please enter your name.';
    var email = $('lunch-payer-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
    if (!$('lunch-terms').checked) return 'Please accept the Terms & Conditions to place your order.';
    return null;
  }

  var submissionId = null;

  function submit(e) {
    e.preventDefault();
    $('lunch-order-error').style.display = 'none';
    var problem = validate();
    if (problem) return showError(problem);

    var allergy = document.querySelector('input[name="lunch-allergy"]:checked').value;
    submissionId = submissionId || ('sub_' + Math.random().toString(36).slice(2, 12) + '_' + Date.now());
    var btn = $('lunch-submit');
    btn.disabled = true;
    btn.textContent = 'PLACING ORDER...';

    AO_API.createLunchOrder({
      allergyNotes: allergy === 'Yes' ? $('lunch-allergy-notes').value.trim() : '',
      items: items(),
      paymentMethod: $('lunch-payment-method').value,
      payerName: $('lunch-payer-name').value.trim(),
      payerEmail: $('lunch-payer-email').value.trim(),
      discountCode: $('lunch-discount-code').value.trim(),
      termsAccepted: $('lunch-terms').checked,
      submissionId: submissionId,
    }).then(function (d) {
      if (!d.success) {
        btn.disabled = false;
        btn.textContent = 'PLACE ORDER';
        return showError(d.message || 'Your order could not be placed. Please try again.');
      }
      $('lunch-success-order-id').textContent = '#' + d.orderRef;
      $('lunch-success-total').textContent = money(d.total);
      $('lunch-success-payment-link').href = 'Payment.html?order=' + encodeURIComponent(d.orderRef) +
                                             '&token=' + encodeURIComponent(d.token);
      // Hide the form itself: v1's script.js re-shows #order-form-container on
      // every status refresh while ordering is open.
      $('lunch-order-form').style.display = 'none';
      $('lunch-success-container').style.display = 'block';
      $('lunch-success-container').scrollIntoView({ block: 'start' });
      window.dispatchEvent(new Event('focus'));   // script.js refreshes the tracker on focus
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = 'PLACE ORDER';
      showError('Network error — please check your connection and try again.');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!$('lunch-order-form')) return;
    rows().forEach(wireRow);
    refreshRows();
    $('lunch-add-pizza').addEventListener('click', addRow);
    document.querySelectorAll('input[name="lunch-allergy"]').forEach(function (r) {
      r.addEventListener('change', function () {
        $('lunch-allergy-details').style.display = r.value === 'Yes' && r.checked ? 'block' : 'none';
      });
    });
    $('lunch-discount-code').addEventListener('input', scheduleDiscountCheck);
    $('lunch-order-form').addEventListener('submit', submit);
  });
})();
