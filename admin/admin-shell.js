'use strict';
/* Admin shell — auth guard, sidebar nav, Socket.IO client.
   Included on every admin page. Each page sets window.ADMIN_PAGE to its name
   so the active sidebar link highlights correctly. */

const API_BASE = window.ORDER_API_URL || '/api';

// ── Auth guard ────────────────────────────────────────────────────────────────
const token    = localStorage.getItem('ao_admin_token');
const userRole = localStorage.getItem('ao_admin_role');
const userName = localStorage.getItem('ao_admin_user');

// Pages that don't need a guard.
const PUBLIC_ADMIN_PAGES = ['login'];

if (!PUBLIC_ADMIN_PAGES.includes(window.ADMIN_PAGE) && !token) {
  location.href = 'login.html';
}

// Role visibility: hide elements the current role can't access.
document.querySelectorAll('[data-min-role]').forEach(el => {
  const required = el.dataset.minRole;
  if (!hasRole(required)) el.hidden = true;
});

function hasRole(required) {
  const RANK = { owner: 4, treasurer: 3, kitchen: 2, volunteer: 1 };
  return (RANK[userRole] || 0) >= (RANK[required] || 0);
}

// Highlight active sidebar link.
document.addEventListener('DOMContentLoaded', () => {
  const page = window.ADMIN_PAGE;
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach(a => {
    if (a.dataset.page === page) a.classList.add('active');
  });

  // Fill username/role in sidebar.
  document.querySelectorAll('.js-admin-user').forEach(el => el.textContent = userName || '');
  document.querySelectorAll('.js-admin-role').forEach(el => el.textContent = userRole || '');

  // Mobile menu toggle.
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.querySelector('.admin-sidebar')?.classList.toggle('open');
  });
});

// ── API helper ────────────────────────────────────────────────────────────────
async function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path, location.origin);
  Object.entries(params).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { clearAuth(); location.href = 'login.html'; }
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method:  'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (res.status === 401) { clearAuth(); location.href = 'login.html'; }
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(API_BASE + path, {
    method:  'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (res.status === 401) { clearAuth(); location.href = 'login.html'; }
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(API_BASE + path, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { clearAuth(); location.href = 'login.html'; }
  return res.json();
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function clearAuth() {
  localStorage.removeItem('ao_admin_token');
  localStorage.removeItem('ao_admin_role');
  localStorage.removeItem('ao_admin_user');
}

// ── Socket.IO client ──────────────────────────────────────────────────────────
let socket;
function connectSocket(namespace = '/admin') {
  if (typeof io === 'undefined') return;
  socket = io(namespace, { auth: { token }, transports: ['websocket'] });
  socket.on('connect_error', () => {});
  return socket;
}

// ── Logout ────────────────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  if (e.target.closest('#logout-btn')) {
    await apiPost('/admin/logout', {});
    clearAuth();
    location.href = 'login.html';
  }
});

// ── Expose globals ────────────────────────────────────────────────────────────
window.aoAdmin = { apiGet, apiPost, apiPatch, apiDelete, connectSocket, hasRole, token, userRole };
