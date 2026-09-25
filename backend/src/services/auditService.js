'use strict';

const sql = require('../db');

async function logAudit({ adminUserId, action, targetTable, targetId, details }) {
  await sql`
    INSERT INTO audit_log (admin_user_id, action, target_table, target_id, details)
    VALUES (
      ${adminUserId  ?? null},
      ${action},
      ${targetTable  ?? null},
      ${targetId     ?? null},
      ${details      ? JSON.stringify(details) : null}
    )
  `;
}

module.exports = { logAudit };
