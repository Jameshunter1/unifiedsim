import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      // Keep the API same-origin in dev so EventSource needs no CORS dance.
      '/api': {
        target: 'http://127.0.0.1:8730',
        changeOrigin: true,
      },
    },
  },
});
