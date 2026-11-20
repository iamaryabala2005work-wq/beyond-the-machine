import { defineConfig } from 'vite';

// The skill kit lives in public/assets and is served as plain files, so Vite's own build output goes to
// _app/ to keep the two apart.
export default defineConfig({
  build: {
    assetsDir: '_app',
    // the three.js viewer is a lazy chunk (~160 kB gzip) loaded after first paint, never on the critical path
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: 'index.html', credits: 'credits.html' } },
  },
});
