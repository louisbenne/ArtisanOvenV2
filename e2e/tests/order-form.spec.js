'use strict';

// v2's own lunch order form (replaces v1's Google Form) — end-to-end against the
// real v2 dev stack: fill in → order placed → confirmation → Payment page finds it.
// Runs with TARGET=v2 only (there is no v1 equivalent to compare pixels with).

const { test, expect } = require('@playwright/test');
const { stubThirdParty } = require('../support/mock-v1');

test.skip((process.env.TARGET || 'v1') !== 'v2', 'needs the v2 backend (TARGET=v2)');

test.beforeEach(async ({ page }) => {
  await require('../fixtures/seed-v2').seed();      // 14 of 20 pizzas claimed
  await stubThirdParty(page);
});
test.afterAll(async () => { await require('../fixtures/seed-v2').close(); });

test('a parent places a lunch order and can pay for it', async ({ page }, info) => {
  await page.goto('/order.html');
  await expect(page.locator('iframe')).toHaveCount(0);                  // no Google Form
  await expect(page.locator('#tracker-orders-taken')).toHaveText('14 of 20 pizzas claimed');
  await page.screenshot({ path: info.outputPath('1-empty-form.png'), fullPage: true });

  await page.getByLabel('Yes').check();
  await page.fill('#lunch-allergy-notes', 'No nuts please');
  await page.locator('.child-name-input').nth(0).fill('Oscar');
  await page.locator('.child-class-input').nth(0).fill('Class 5');
  await page.click('#lunch-add-pizza');
  await page.locator('.pizza-size-select').nth(1).selectOption('Half12inch');
  await page.locator('.child-name-input').nth(1).fill('Ruby');
  await page.locator('.child-class-input').nth(1).fill('Class 3');
  await page.selectOption('#lunch-payment-method', 'Cash');
  await page.fill('#lunch-payer-name', 'Sarah Jenkins');
  await page.fill('#lunch-payer-email', 'sarah@example.com');
  await page.fill('#lunch-discount-code', 'stmscs');
  await expect(page.locator('#lunch-discount-feedback')).toHaveText('Discount code STMSCS applied.');
  await expect(page.locator('#lunch-total')).toHaveText('£11.05');          // £13 − 15 %
  await page.screenshot({ path: info.outputPath('2-filled-form.png'), fullPage: true });

  // T&Cs are required.
  await page.click('#lunch-submit');
  await expect(page.locator('#lunch-order-error')).toHaveText('Please accept the Terms & Conditions to place your order.');
  await page.check('#lunch-terms');
  await page.click('#lunch-submit');

  await expect(page.locator('#lunch-success-container')).toBeVisible();
  await expect(page.locator('#lunch-success-order-id')).toHaveText('#8');   // fixtures end at #7
  await expect(page.locator('#lunch-success-total')).toHaveText('£11.05');
  await expect(page.locator('#tracker-orders-taken')).toHaveText('15½ of 20 pizzas claimed');   // v1 shows halves as ½
  await expect(page.locator('#lunch-order-form')).toBeHidden();
  await page.screenshot({ path: info.outputPath('3-confirmation.png'), fullPage: true });

  await page.click('#lunch-success-payment-link');
  await expect(page.locator('#order-result-section')).toBeVisible();
  await expect(page.locator('#result-total-price')).toContainText('11.05');
  await page.screenshot({ path: info.outputPath('4-payment-page.png'), fullPage: true });
});

test('the form refuses a sixth pizza and incomplete rows', async ({ page }) => {
  await page.goto('/order.html');
  for (let i = 0; i < 4; i++) await page.click('#lunch-add-pizza');
  await expect(page.locator('#lunch-pizza-rows .pizza-item-row')).toHaveCount(5);
  await expect(page.locator('#lunch-add-pizza')).toBeHidden();
  await page.getByLabel('No').check();
  await page.fill('#lunch-payer-name', 'Sarah Jenkins');
  await page.fill('#lunch-payer-email', 'sarah@example.com');
  await page.check('#lunch-terms');
  await page.click('#lunch-submit');
  await expect(page.locator('#lunch-order-error')).toHaveText('Please give the name and class for each pizza.');
});

test('MUTTI is not accepted on the public form', async ({ page }) => {
  await page.goto('/order.html');
  await page.fill('#lunch-discount-code', 'MUTTI');
  await expect(page.locator('#lunch-discount-feedback')).toHaveText('Discount code not found.');
});
