import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Node environment only: the units under test are pure functions. Anything
    // needing a DOM would pull in jsdom, which is not warranted yet.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
