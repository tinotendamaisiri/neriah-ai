// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Proxy API calls to the Azure Functions backend during local dev
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        // TODO: update target to APIM URL for staging/prod builds via env var
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
