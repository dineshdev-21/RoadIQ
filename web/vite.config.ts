import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The build lands in ../static, which FastAPI serves at / and /static, so the
// Python server runs the dashboard with no Node on the machine.
export default defineConfig({
  plugins: [preact()],
  base: '/static/',
  build: { outDir: '../static', emptyOutDir: true, target: 'es2020' },
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/ws': { target: 'ws://127.0.0.1:8010', ws: true },
    },
  },
});
