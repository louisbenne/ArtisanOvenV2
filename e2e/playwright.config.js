'use strict';

// TARGET=v1 (default): screenshot the read-only v1 snapshot with mocked Apps
//   Script responses → writes/compares the baseline in __screenshots__/v1/.
// TARGET=v2 (Phase 2+): screenshot the v2 stack seeded with the same data and
//   compare against the SAME v1 baseline.

const { defineConfig } = require('@playwright/test');

const TARGET = process.env.TARGET || 'v1';

module.exports = defineConfig({
  testDir: './tests',
  snapshotPathTemplate: '{testDir}/../__screenshots__/v1/{arg}-{projectName}{ext}',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL: TARGET === 'v1' ? 'http://127.0.0.1:4100' : (process.env.V2_URL || 'http://api:3000'),
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
  },
  projects: [
    { name: 'phone',   use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: false } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  ],
  webServer: TARGET === 'v1' ? { command: 'node support/v1-server.js', url: 'http://127.0.0.1:4100/', reuseExistingServer: true } : undefined,
});
