import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
