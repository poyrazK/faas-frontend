import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Pure functions and server-rendered component contracts need no DOM.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
