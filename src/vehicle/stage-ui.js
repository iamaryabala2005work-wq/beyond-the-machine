// The stage's own controls: the loading readout, the view buttons and Reset view. The markup is in
// index.html (hidden until it applies); this file only shows it and wires it to the viewer's handle.
export function bindStageUI(stage) {
  const status = stage.querySelector('[data-vehicle-status]');
  const value = stage.querySelector('[data-vehicle-progress]');
  const bar = stage.querySelector('[data-vehicle-bar]');
  const controls = stage.querySelector('[data-vehicle-controls]');
  const tag = stage.querySelector('[data-vehicle-standin]');
  let shown = 0;
  let standIn = false;

  return {
    loading() {
      if (!status) return;
      status.hidden = false;
      stage.dataset.vehicleLoading = '';
    },
    progress(p) {
      const pct = Math.round(Math.max(shown, p) * 100);
      shown = pct / 100;
      if (value) value.textContent = `${pct}%`;
      bar?.style.setProperty('--p', shown);
    },
    live(handle) {
      delete stage.dataset.vehicleLoading;
      if (status) status.hidden = true;
      handle.ready.then((info) => {
        standIn = Boolean(info?.manifest?.standIn);
        if (tag && standIn && stage.dataset.vehicleMode === 'live') tag.hidden = false;
      });
      if (!controls) return;
      controls.hidden = false;
      const buttons = [...controls.querySelectorAll('[data-view]')];
      const mark = (name) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
      buttons.forEach((b) => b.addEventListener('click', () => handle.setView(b.dataset.view)));
      controls.querySelector('[data-view-reset]')?.addEventListener('click', () => { handle.reset(); mark(null); });
      handle.onView((name) => mark(name === 'home' ? null : name));
      // zoom steps: aria-disabled (not disabled) at a limit, so keyboard focus never jumps away
      const zoomIn = controls.querySelector('[data-zoom="in"]');
      const zoomOut = controls.querySelector('[data-zoom="out"]');
      const step = (btn, factor) => btn?.addEventListener('click', () => { if (btn.getAttribute('aria-disabled') !== 'true') handle.zoomBy(factor); });
      step(zoomIn, 0.88);
      step(zoomOut, 1 / 0.88);
      handle.onZoom?.(({ canIn, canOut }) => {
        zoomIn?.setAttribute('aria-disabled', String(!canIn));
        zoomOut?.setAttribute('aria-disabled', String(!canOut));
      });
    },
    // the poster is back for a while (the WebGL context was lost): the controls and the stand-in label
    // belong to the 3D car, so they step aside until it returns
    suspend() {
      if (controls) controls.hidden = true;
      if (tag) tag.hidden = true;
    },
    resume() {
      if (controls) controls.hidden = false;
      if (tag && standIn) tag.hidden = false;
    },
    failed() {
      delete stage.dataset.vehicleLoading;
      if (status) status.hidden = true;
    },
  };
}
