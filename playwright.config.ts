import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end run.
 *
 * Kept out of `npm run check` on purpose: that command is meant to be fast enough to
 * run on every save, and this one builds the game and drives a browser for a minute.
 * `npm run test:e2e` runs it; CI runs it once per push.
 *
 * The GPU flags are not optional. CI machines have no GPU, and without being told to
 * fall back to SwiftShader, Chromium refuses WebGL entirely and every test fails on a
 * blank canvas — a failure that looks exactly like a broken renderer.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  // A cold vite build plus a real run; the default 30s is not enough for the first.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      // Honoured when the environment already provides a browser, so a preinstalled
      // Chromium is used instead of downloading a second copy of it. Left off
      // entirely when unset — passing `undefined` is not the same as omitting it.
      ...(process.env.CHROMIUM_PATH === undefined
        ? {}
        : { executablePath: process.env.CHROMIUM_PATH }),
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // The built bundle rather than the dev server: the smoke test exists to check what
  // actually ships, and the dev server serves a different module graph.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
