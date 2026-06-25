import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the Fastify server so the browser hits one origin.
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
