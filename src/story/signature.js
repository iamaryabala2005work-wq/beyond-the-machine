// The signature after the story (index.html #signature): "Beyond the machine.", the credit line and the
// pill, revealed once as the section comes into view. Plain document flow: no pinning, no scroll work.
// The reveal itself is CSS (story.css): blur to sharp on desktop, a fade and a rise on the mobile tier,
// a 150 ms fade under reduced motion. Without script, or before this runs, it is simply shown.
export function initSignature() {
  const el = document.querySelector('[data-signature]');
  if (!el || !('IntersectionObserver' in window)) return;
  // only hidden once script can show it again; a section already on screen (a reload mid-page) shows at once
  const r = el.getBoundingClientRect();
  if (r.top < innerHeight && r.bottom > 0) { el.dataset.signature = 'shown'; return; }
  el.dataset.signature = 'hidden';
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    el.dataset.signature = 'shown';
    io.disconnect();
  }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
  io.observe(el);
}
