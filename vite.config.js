import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { canRun3D, tierFor } from './src/vehicle/gate.js';
import { postersHash, stampedHash } from './scripts/posters/stamp.mjs';

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
      // WebKit (Safari, and every browser on iOS) never hands a preload made `as=fetch` to the viewer's fetch():
      // it downloaded the model twice (2.2 MB each, measured), so there the viewer's own request is the only one.
      const code = `(()=>{const canRun3D=${canRun3D};const tierFor=${tierFor};if(!canRun3D()||/^Apple/.test(navigator.vendor))return;` +
        // the preload only helps while it is ahead of the viewer: once the viewer's code is in (a warm cache), the
        // viewer is already asking for the model itself and a preload now would go unused
        `const src=${JSON.stringify(src)};let done=false;const go=()=>{if(done)return;done=true;` +
        `if(performance.getEntriesByType('resource').some(e=>/\\/viewer-[^/]*\\.js$/.test(e.name)))return;` +
        `const l=document.createElement('link');l.rel='preload';l.as='fetch';l.crossOrigin='anonymous';` +
        `l.href=src[tierFor()]??src.desktop;document.head.append(l)};` +
        // load and error do not bubble, so they are caught on the way down; window load covers a page without a poster.
        // The poster can load well before it is painted (render-blocking CSS still pending), so the model waits for
        // the paint itself: the poster's largest-contentful-paint entry where the browser reports one (2 s at most,
        // in case the poster is not the largest paint), else two frames after load.
        `let watching=false;const painted=()=>{if(watching)return;watching=true;` +
        `if(!PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')){requestAnimationFrame(()=>requestAnimationFrame(go));return}` +
        `const t=setTimeout(go,2000);new PerformanceObserver((l,o)=>{if(l.getEntries().some(e=>e.element?.matches?.('[data-vehicle-poster]'))){o.disconnect();clearTimeout(t);go()}})` +
        `.observe({type:'largest-contentful-paint',buffered:true})};` +
        `const poster=(e)=>{if(e.target.matches?.('[data-vehicle-poster]'))painted()};` +
        `document.addEventListener('load',poster,true);document.addEventListener('error',poster,true);` +
        `addEventListener('load',painted)})()`;
      return { html, tags: [{ tag: 'script', children: code, injectTo: 'head' }] };
    },
  };
}

// The car's still images (public/vehicle/posters, public/share.jpg) are renders of the 3D model
// (scripts/render-posters.mjs). A build first checks that they were rendered from the current model,
// manifest and drawing code (scripts/posters/stamp.mjs), and re-renders them when not; if that is not
// possible here (no browser with WebGL), the build stops rather than ship posters of another car.
// `vite` (dev) only warns.
function postersUpToDate() {
  const stale = () => stampedHash() !== postersHash();
  return {
    name: 'posters-up-to-date',
    configureServer() {
      if (stale()) console.warn('[posters] out of date with the model: run `npm run posters`');
    },
    buildStart() {
      // build only (buildStart also runs when a dev server starts), and never from inside a render
      if (this.meta.watchMode || process.env.POSTERS_RENDERING || !stale()) return;
      console.log('[posters] out of date with the model: rendering them again');
      const run = spawnSync(process.execPath, ['scripts/render-posters.mjs'], { stdio: 'inherit', env: { ...process.env, POSTERS_RENDERING: '1' }, timeout: 300000 });
      if (run.status !== 0 || stale()) {
        this.error('the posters are out of date with the model and could not be rendered here. Run `npm run posters` where Google Chrome is installed and commit public/vehicle/posters and public/share.jpg.');
      }
    },
  };
}

// Absolute URLs for link previews and search: %SITE% in the pages becomes the production origin (canonical,
// og:url, the sitemap) and %SELF% this deployment's own origin (the share image, so a preview's card shows that
// preview's image). SITE_URL wins when set (the site's own domain); on Vercel the system variables give the
// rest. Also writes robots.txt and sitemap.xml; a preview's robots.txt asks crawlers to stay out.
function siteMeta() {
  const env = process.env;
  const https = (host) => host && `https://${host.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const site = https(env.SITE_URL) || https(env.VERCEL_PROJECT_PRODUCTION_URL) || 'https://beyond-the-machine-codcect.vercel.app';
  const preview = env.VERCEL_ENV === 'preview';
  const self = (preview && https(env.VERCEL_BRANCH_URL || env.VERCEL_URL)) || site;
  const pages = ['/', '/credits.html'];
  return {
    name: 'site-meta',
    transformIndexHtml: (html) => html.replaceAll('%SITE%', site).replaceAll('%SELF%', self),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: preview
        ? 'User-agent: *\nDisallow: /\n'
        : `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n` });
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        pages.map((p) => `  <url><loc>${site}${p}</loc><lastmod>${today}</lastmod></url>\n`).join('') + '</urlset>\n' });
    },
  };
}

// The skill kit lives in public/assets and is served as plain files, so Vite's own build output goes to
// _app/ to keep the two apart.
export default defineConfig({
  plugins: [postersUpToDate(), vehicleModelPreload(), siteMeta()],
  build: {
    assetsDir: '_app',
    // the three.js viewer is a lazy chunk (~160 kB gzip) loaded after first paint, never on the critical path
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: 'index.html', credits: 'credits.html' } },
  },
});
