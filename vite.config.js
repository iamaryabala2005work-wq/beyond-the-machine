import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { canRun3D, tierFor } from './src/vehicle/gate.js';

// Starts the car's model download in parallel with the 3D code, instead of after it (the code, then the
// manifest, then the model, one after another). For a page with a vehicle stage, this reads the manifest
// named by data-vehicle-model (from public/) and inlines a small script into <head> that, on a device
// that will run the viewer (the same checks stage.js uses, from gate.js), adds a preload for the right
// tier's GLB; the viewer's own request for that URL then picks up the preloaded file.
// The preload waits for the poster (loaded or failed), the page's largest paint: started any earlier,
// the model took bandwidth from it on a slow connection (desktop LCP +0.6 s on Slow 4G). That is also
// when stage.js starts the 3D code. Save-Data, 2g and poster-only devices download nothing.
function vehicleModelPreload() {
  return {
    name: 'vehicle-model-preload',
    transformIndexHtml(html) {
      const manifestUrl = html.match(/data-vehicle-model="([^"]+)"/)?.[1];
      if (!manifestUrl) return html;
      const { src } = JSON.parse(readFileSync(new URL(`./public${manifestUrl}`, import.meta.url), 'utf8'));
      const code = `(()=>{const canRun3D=${canRun3D};const tierFor=${tierFor};if(!canRun3D())return;` +
        `const src=${JSON.stringify(src)};let done=false;const go=()=>{if(done)return;done=true;` +
        `const l=document.createElement('link');l.rel='preload';l.as='fetch';l.crossOrigin='anonymous';` +
        `l.href=src[tierFor()]??src.desktop;document.head.append(l)};` +
        // load and error do not bubble, so they are caught on the way down; window load covers a page without a poster
        `const poster=(e)=>{if(e.target.matches?.('[data-vehicle-poster]'))go()};` +
        `document.addEventListener('load',poster,true);document.addEventListener('error',poster,true);` +
        `addEventListener('load',go)})()`;
      return { html, tags: [{ tag: 'script', children: code, injectTo: 'head' }] };
    },
  };
}

// The skill kit lives in public/assets and is served as plain files, so Vite's own build output goes to
// _app/ to keep the two apart.
export default defineConfig({
  plugins: [vehicleModelPreload()],
  build: {
    assetsDir: '_app',
    // the three.js viewer is a lazy chunk (~160 kB gzip) loaded after first paint, never on the critical path
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: 'index.html', credits: 'credits.html' } },
  },
});
