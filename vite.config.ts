// `vitest/config` re-exports Vite's defineConfig with the `test` key typed, so the
// dev server and the test runner stay described by a single file.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages' /<repo>/ subpath,
  // on itch.io's sandboxed iframe, and on a plain local file server.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    // The simulation is pure TypeScript with no `three` or DOM dependency, so the
    // fast node environment is all we need. Browser-level checks come from the
    // Playwright smoke test added in a later phase.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
