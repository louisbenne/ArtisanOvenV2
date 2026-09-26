'use strict';

// POST /api/discounts/check — live check for the order form's discount box.
// Public codes only (gated codes like MUTTI look exactly like unknown ones).
// Never trusted for pricing: POST /api/orders re-applies the code itself.

const { applyDiscount } = require('../services/discountService');

const PRICE_PENCE = { '12inch': 800, 'Half12inch': 500, 'Quarter12inch': 300 };

async function check(req, res) {
  const code = String(req.body.code || '').trim();
  if (!code) return res.json({ success: true, valid: false, message: 'Please enter a discount code.' });

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const subtotal = items.reduce((s, i) => s + (PRICE_PENCE[i.size] || 0), 0);
  try {
    const d = await applyDiscount(code, subtotal, { scope: 'public' });
    res.json({ success: true, valid: true, code: d.code, subtotalPence: subtotal,
               discountPence: d.discountPence, totalPence: d.finalPence });
  } catch (err) {
    if (!err.expose) throw err;
    res.json({ success: true, valid: false, message: err.message });
  }
}

module.exports = { check };
