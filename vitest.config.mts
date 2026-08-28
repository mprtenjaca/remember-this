import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Domain tests run against a fixed timezone so anchor/DST math is deterministic.
process.env.TZ = 'Europe/Zagreb';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
