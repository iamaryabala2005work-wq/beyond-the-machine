// Which devices get the 3D car, and which model tier. stage.js uses these at runtime, and the build
// (vite.config.js) inlines their source into the page's <head> so the model download can start before
// the 3D code has loaded. They must stay self-contained: no imports, nothing from outside the function.

// Can this device run the viewer? Anything doubtful keeps the poster.
export function canRun3D() {
  if (!('WebGL2RenderingContext' in window)) return false;
  const c = navigator.connection;
  if (c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '')) return false;
  if (navigator.deviceMemory && navigator.deviceMemory < 2) return false;
  return true;
}

export function tierFor() {
  return matchMedia('(max-width: 639px), (pointer: coarse)').matches ? 'mobile' : 'desktop';
}
