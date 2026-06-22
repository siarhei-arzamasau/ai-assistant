import { defineConfig } from 'vitest/config';

export default defineConfig({
  // JSX uses the automatic runtime via the `jsx: "react-jsx"` setting in
  // tsconfig.json, which Vitest's transformer reads — no React import needed.
  test: {
    // Default to the Node environment (backend + pure-logic tests). Component
    // tests opt into jsdom with a `// @vitest-environment jsdom` file docblock.
    environment: 'node',
    // Exposes afterEach as a global so React Testing Library auto-cleans the
    // DOM between component tests.
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
