import { defineConfig } from 'vitest/config';

// Single node-environment config for the whole monorepo. The web spine is
// tested via react-dom/server (renderToStaticMarkup) so no jsdom/browser is
// needed — click-to-expand uses native <details>, which is observable in
// static markup. Browser-driven e2e (Playwright) is intentionally deferred.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // §11.8 no-network rule: tests must not reach the network.
    // Integration tests that need `sem` self-skip (see ingest).
  },
  esbuild: {
    jsx: 'automatic',
  },
});
