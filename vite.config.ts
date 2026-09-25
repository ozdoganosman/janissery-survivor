import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the same build works under GitHub Pages' /<repo>/ prefix.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~600 kB; one chunk is simpler than splitting a single-page game.
    chunkSizeWarningLimit: 900,
  },
  test: {
    // The simulation has no DOM or WebGL dependency, so plain Node is enough and fast.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
