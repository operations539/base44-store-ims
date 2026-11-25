import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sandbox preview only: allow the proxy host the platform forwards to this dev
// server. Unset/any other value of BASE44_PREVIEW_MODE keeps Vite's defaults.
const previewHosts = [];
if (process.env.BASE44_PREVIEW_MODE === '1' && process.env.BASE44_SANDBOX_HOST_DOMAIN) {
  previewHosts.push(`.${process.env.BASE44_SANDBOX_HOST_DOMAIN}`);
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    ...(previewHosts.length ? { allowedHosts: previewHosts } : {}),
    // API is proxied so the SPA and the API share one origin (session cookie).
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://api:8000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
