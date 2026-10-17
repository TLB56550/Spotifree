import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4242' },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 800 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
  },
});
