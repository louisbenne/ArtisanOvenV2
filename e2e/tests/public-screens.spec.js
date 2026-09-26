'use strict';

// Every public v1 screen, at phone (390) and desktop (1280) widths.
// TARGET=v1 records the baseline; TARGET=v2 must match it (≤ 0.1 % pixels).
// Admin + kitchen screens are added with Phase 5 (their API shapes are ported then).

const { test, expect } = require('@playwright/test');
const { mockV1, stubThirdParty } = require('../support/mock-v1');
const { getStatus } = require('../fixtures/v1-api');
const { tokens } = require('../fixtures/data');
const { PARENT_ACCESS_CODE } = require('../fixtures/v1-api');

test.afterAll(async () => { if (TARGET === 'v2') await require('../fixtures/seed-v2').close(); });

const TARGET = process.env.TARGET || 'v1';
const NOW = new Date('2026-10-01T10:00:00+01:00');   // Thursday, ordering week

async function open(page, url, { scenario = 'open' } = {}) {
  await page.clock.setFixedTime(NOW);
  if (TARGET === 'v1') await mockV1(page, { scenario });
  if (TARGET === 'v2') {
    await stubThirdParty(page);
    await require('../fixtures/seed-v2').seed();   // real backend, canonical data
    // Status scenarios other than 'open' are states of the week (deadline, sold
    // out); the backend's status logic is covered by its own tests.
    if (scenario !== 'open') {
      await page.route('**/api/status**', r => r.fulfill({ json: getStatus(scenario) }));
    }
  }
  await page.goto(url);
  await settle(page);
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  // Some v1 flows smooth-scroll to a result; sticky/fixed elements then depend on
  // where the scroll happened to be. Screenshot from the top, once scrolling stops.
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => window.scrollY === 0);
}

const shot = (page, name) => expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });

test.describe('home', () => {
  test('open', async ({ page }) => { await open(page, '/'); await shot(page, 'home-open'); });
  test('few left', async ({ page }) => { await open(page, '/', { scenario: 'fewLeft' }); await shot(page, 'home-few-left'); });
  test('closed by deadline', async ({ page }) => {
    await open(page, '/', { scenario: 'closedDeadline' }); await shot(page, 'home-closed-deadline');
  });
});

test('fully booked page', async ({ page }) => {
  await open(page, '/fully-booked.html', { scenario: 'soldOut' });
  await shot(page, 'fully-booked');
});

test.describe('order page', () => {
  test('open', async ({ page }) => { await open(page, '/order.html'); await shot(page, 'order-open'); });
  test('closed', async ({ page }) => {
    await open(page, '/order.html', { scenario: 'closedDeadline' }); await shot(page, 'order-closed');
  });
});

test.describe('payment page', () => {
  test('empty', async ({ page }) => { await open(page, '/Payment.html'); await shot(page, 'payment-empty'); });

  test('found via email link (order + token)', async ({ page }) => {
    await open(page, `/Payment.html?order=3&token=${tokens.lunch3}`);
    await expect(page.locator('#order-result-section')).toBeVisible();
    await shot(page, 'payment-found');
  });

  test('not found', async ({ page }) => {
    await open(page, '/Payment.html');
    await page.fill('#order-query-input', 'nobody@example.com');
    await page.click('#lookup-btn');
    await expect(page.locator('#lookup-feedback')).not.toBeEmpty();
    await settle(page);
    await shot(page, 'payment-not-found');
  });
});

test('events list', async ({ page }) => { await open(page, '/events.html'); await shot(page, 'events'); });

test.describe('event order page', () => {
  test('order mode', async ({ page }) => {
    await open(page, '/event-order.html?event=summer-fair-2026');
    await expect(page.locator('#event-order-form')).toBeVisible();
    await shot(page, 'event-order-form');
  });

  test('register interest mode', async ({ page }) => {
    await open(page, '/event-order.html?event=autumn-bbq-2026');
    await expect(page.locator('#register-interest-form')).toBeVisible();
    await shot(page, 'event-order-interest');
  });

  test('order placed', async ({ page }) => {
    await open(page, '/event-order.html?event=summer-fair-2026');
    await page.fill('#payer-name', 'Nina Shaw');
    await page.fill('#payer-email', 'nina@example.com');
    await page.click('#btn-submit-order');
    await expect(page.locator('#success-container')).toBeVisible();
    await settle(page);
    await shot(page, 'event-order-success');
  });
});

test.describe('parent order page', () => {
  test('access gate', async ({ page }) => { await open(page, '/parent-order.html'); await shot(page, 'parent-gate'); });

  test('order form', async ({ page }) => {
    await open(page, '/parent-order.html');
    await page.fill('#parent-access-code', PARENT_ACCESS_CODE);
    await page.click('#parent-access-submit');
    await expect(page.locator('#parent-order-screen')).toBeVisible();
    await settle(page);
    await shot(page, 'parent-form');
  });

  test('order placed', async ({ page }) => {
    await open(page, '/parent-order.html');
    await page.fill('#parent-access-code', PARENT_ACCESS_CODE);
    await page.click('#parent-access-submit');
    // v1 fills name, email and children from a hard-coded profile (parent-order.js).
    await page.selectOption('#parent-profile', { index: 1 });
    await page.click('#parent-submit-order');
    await expect(page.locator('#parent-success-screen')).toBeVisible();
    await settle(page);
    await shot(page, 'parent-success');
  });
});

test('terms', async ({ page }) => { await open(page, '/terms.html'); await shot(page, 'terms'); });
