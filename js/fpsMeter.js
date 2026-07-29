// A tiny always-on FPS readout — for eyeballing whether a given zoom
// level/mode is actually smooth, since "does it feel laggy" is hard to
// judge without a number. The measuring loop is started once and runs for
// the whole session; the single DOM element gets *moved* (not recreated)
// into whichever map frame is currently on screen — see mountFpsMeter(),
// called from zoomPan.js's createZoomWrap so it always lives inside the
// map window itself rather than floating over the whole page.
let el = null;

export function startFpsMeter() {
  el = document.createElement('div');
  el.id = 'fps-meter';
  el.textContent = '… FPS'; // placeholder until the first 500ms window completes

  let frames = 0;
  let windowStart = performance.now();

  function tick(now) {
    frames++;
    const elapsed = now - windowStart;
    if (elapsed >= 500) {
      const fps = Math.round((frames * 1000) / elapsed);
      el.textContent = `${fps} FPS`;
      el.classList.toggle('fps-bad', fps < 30);
      el.classList.toggle('fps-ok', fps >= 30 && fps < 50);
      frames = 0;
      windowStart = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function mountFpsMeter(container) {
  if (el) container.appendChild(el);
}
