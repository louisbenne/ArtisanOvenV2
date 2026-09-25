'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');

async function applyDiscount(code, subtotalPence) {
  const [row] = await sql`
    SELECT code, percent_off, flat_off_pence, active, max_uses, times_used, expires_at
    FROM   discount_codes
    WHERE  upper(code) = ${code.trim().toUpperCase()}
  `;

  if (!row)         throw new HttpError(400, 'Discount code not found.');
  if (!row.active)  throw new HttpError(400, 'Discount code is no longer active.');
  if (row.expires_at && new Date() > new Date(row.expires_at)) {
    throw new HttpError(400, 'Discount code has expired.');
  }
  if (row.max_uses !== null && row.times_used >= row.max_uses) {
    throw new HttpError(400, 'Discount code has reached its usage limit.');
  }

  let discountPence = 0;
  if (row.percent_off) {
    discountPence = Math.round(subtotalPence * row.percent_off / 100);
  } else if (row.flat_off_pence) {
    discountPence = Math.min(row.flat_off_pence, subtotalPence);
  }

  return {
    code:          row.code,
    discountPence,
    finalPence:    Math.max(0, subtotalPence - discountPence),
  };
}

// Called when admin marks an order paid — increments usage counter once.
async function incrementUsage(code) {
  await sql`
    UPDATE discount_codes SET times_used = times_used + 1 WHERE code = ${code}
  `;
}

module.exports = { applyDiscount, incrementUsage };
