import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages is served from /Deckadent/, while Electron needs file-relative assets.
  base: process.env.GITHUB_ACTIONS ? '/Deckadent/' : './',
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    strictPort: false,
  },
});
