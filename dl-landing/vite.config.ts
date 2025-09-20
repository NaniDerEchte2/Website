import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',        // NICHT 0.0.0.0
    strictPort: true,
    cors: {
      origin: /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/
    },
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin' }
  },
  preview: { cors: false },
  build: { sourcemap: false }  // weniger Leckrisiko
});
