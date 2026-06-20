import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths allow the production bundle to load from Electron's file:// URL.
  base: './',
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    strictPort: false,
  },
});
