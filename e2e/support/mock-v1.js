'use strict';

// Routes every backend call a v1 page makes to the fixture responses, and
// replaces third-party frames so screenshots are deterministic.

const { respond, getStatus } = require('../fixtures/v1-api');

const GOOGLE_FORM_STUB = `<!doctype html><html><body style="margin:0;font:16px sans-serif;
  background:#f1ebe1;height:1400px;display:flex;align-items:flex-start;justify-content:center">
  <p style="margin-top:48px;color:#555">[Google Form — third-party frame, stubbed for screenshots]</p></body></html>`;

async function paramsOf(request) {
  const url = new URL(request.url());
  const params = Object.fromEntries(url.searchParams);
  const body = request.postData();
  if (body) {
    try { Object.assign(params, JSON.parse(body)); }
    catch { Object.assign(params, Object.fromEntries(new URLSearchParams(body))); }
  }
  return params;
}

async function mockV1(page, { scenario = 'open' } = {}) {
  const json = obj => ({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
  await page.route('https://v1-api.mock/**', async route => route.fulfill(json(respond(await paramsOf(route.request()), scenario))));
  await page.route('https://script.google.com/**', async route => route.fulfill(json(respond(await paramsOf(route.request()), scenario))));
  await page.route('**/api/status**', route => route.fulfill(json(getStatus(scenario))));
  await page.route('https://docs.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: GOOGLE_FORM_STUB }));
}

module.exports = { mockV1 };
