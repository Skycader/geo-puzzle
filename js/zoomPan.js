import { mountFpsMeter } from './fpsMeter.js';
import { mark } from './perfDebug.js';

// Shared wheel/button/drag zoom for an SVG sitting inside a fixed-size
// viewport. Unlike the old approach (resizing the SVG's actual width/height
// attributes so native overflow:auto scrollbars revealed the extra
// content), zoom/pan here is a CSS `transform: translate() scale()` on the
// content — the SVG's width/height attributes are NOT touched on every
// frame. That keeps the browser's rasterized backing store at a constant,
// small size *during interaction* (GPU-composited scaling is nearly free;
// resizing the actual element and re-laying-out on every frame is not —
// that's what caused the framerate drop at high zoom). Panning is custom
// pointer-drag math instead of scrollLeft/scrollTop for the same reason:
// there's no native scrollable content to scroll.
//
// Pure transform scaling has its own cost, though: the browser rasterizes
// the SVG once at its native (small) size and the GPU just stretches that
// raster for the zoom, which blurs text/lines at high zoom and never
// re-sharpens on its own. So this is a hybrid — while actively
// wheeling/dragging, zoom is 100% transform (cheap, can blur transiently);
// once input settles (same debounce as the virtualization callback), a
// one-time "rebake" sets the SVG's actual width/height to match the
// current zoom (re-rasterizing crisply) and folds that into the transform
// as a scale(1), so the *next* increment of zoom starts from a sharp
// baseline instead of stacking blur on blur.
// Hit-testing elsewhere keeps working unchanged because it's always
// computed from the SVG's live getBoundingClientRect(), which reflects a
// CSS transform (or a width/height attribute) identically either way.
export function attachZoomPan(viewport, content, opts = {}) {
  const baseWidth = opts.baseWidth;
  const baseHeight = opts.baseHeight;
  // native-unit -> px at zoom 1, i.e. the board's fit-to-viewport scale.
  // Needed for focusOn() (given native map coordinates) and for the
  // virtualization callback (converting the visible viewport back to
  // native coordinates).
  const baseScale = opts.baseScale ?? 1;
  const minZoom = opts.minZoom ?? 1;
  // Cap on the rebaked raster's largest dimension, in px. This used to be a
  // flat constant (8192) sized against GPU texture limits — but that's the
  // wrong budget to optimize for. Only a viewport-sized window of the baked
  // content is EVER visible at once (the rest is clipped by
  // .zoom-viewport's overflow:hidden); baking the *entire* map at high zoom
  // (up to 8192x8192) meant every repaint after that — even revealing one
  // new city dot — cost the browser a full repaint of a raster dozens of
  // times bigger than the screen, regardless of GPU. Confirmed via real
  // recorded sessions: 300-500ms main-thread stalls landing exactly on
  // whatever DOM mutation happened to follow a rebake to a large size.
  // Bounding the cap to (viewport size * some zoom-in headroom * device
  // pixel ratio) keeps repaint cost roughly constant no matter how far the
  // player zooms, in exchange for CSS-scale blur past that headroom — the
  // same trade this code already made for "extreme" zoom, just kicking in
  // much sooner so typical use stays cheap.
  // The real cost driver turned out to be a continuously-running filter
  // animation (fixed separately in style.css) rather than the bake size
  // itself, so this can afford to be generous — a small headroom made
  // ordinary zoom levels permanently CSS-stretched (blurry at rest, not
  // just transiently while moving), which is its own bug, just a visual one
  // instead of a framerate one.
  const bakeZoomHeadroom = opts.bakeZoomHeadroom ?? 4.5;
  function getMaxBakeDim() {
    if (opts.maxBakeDim) return opts.maxBakeDim;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return Math.max(viewport.clientWidth, viewport.clientHeight) * dpr * bakeZoomHeadroom;
  }
  // Some zoom past the point where the raster stops growing is still fine
  // (graceful CSS-scale blur for a deliberately "further than normal" zoom),
  // but kept close to the headroom so that blur stays the exception, not
  // the default experience at typical zoom levels.
  const maxZoom = Math.min(opts.maxZoom ?? 60, bakeZoomHeadroom * 1.5);
  const step = opts.step ?? 1.35;
  const tapThreshold = opts.tapThreshold ?? 6; // px of movement before a press counts as a drag
  const panFromAnywhere = opts.panFromAnywhere ?? false;
  const onTap = opts.onTap; // (originalPointerDownEvent) => void — fired when a press didn't turn into a drag
  // (visibleNativeRect) => void — fired (debounced) after pan/zoom settles,
  // with the currently-visible native-coordinate rect plus a margin. Boards
  // with lots of small features (city dots) use this to only keep
  // in-view elements in the DOM instead of paying render cost for all of
  // them all the time — see overviewBoard.js's virtualization.
  const onVisibleRectChange = opts.onVisibleRectChange;
  // How long input has to be quiet before the "settle" work (rebake +
  // visibility notify) runs — see the file-level comment.
  const settleDebounceMs = opts.settleDebounceMs ?? 150;

  const listeners = new Set(); // (zoom) => void, fired whenever the zoom level actually changes
  if (opts.onZoomChange) listeners.add(opts.onZoomChange);

  let zoom = 1;
  let bakedZoom = 1; // zoom level actually baked into content's width/height right now
  let panX = 0; // CSS-px offset of content's (0,0) from viewport's (0,0), pre-scale
  let panY = 0;

  content.style.transformOrigin = '0 0';
  // Hints the browser to promote this to its own GPU compositing layer
  // ahead of time, so the first zoom/pan doesn't stutter while that
  // promotion happens.
  content.style.willChange = 'transform';

  function clampPan() {
    const contentW = baseWidth * zoom;
    const contentH = baseHeight * zoom;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    panX = contentW <= vw ? (vw - contentW) / 2 : Math.min(0, Math.max(vw - contentW, panX));
    panY = contentH <= vh ? (vh - contentH) / 2 : Math.min(0, Math.max(vh - contentH, panY));
  }

  function render() {
    // Only the zoom *beyond* what's already baked into width/height needs
    // to come from the CSS scale — see the file-level comment.
    const cssScale = zoom / bakedZoom;
    content.style.transform = `translate(${panX.toFixed(1)}px, ${panY.toFixed(1)}px) scale(${cssScale})`;
  }

  // Re-rasterizes content at the current zoom once input has settled, so
  // the *next* zoom step starts from a sharp baseline instead of the GPU
  // stretching an increasingly-stale raster. translate/scale math above
  // doesn't need to change for this — baseWidth*zoom (the true rendered
  // size) is invariant to how much of that is "baked" vs "CSS-scaled".
  //
  // Only ever grows bakedZoom, never shrinks it: setting width/height is
  // itself exactly the "resize the actual element" cost this whole
  // rewrite exists to avoid, so it's only worth paying when zooming IN
  // needs a sharper raster than what's already baked. Zooming OUT never
  // needs it — shrinking an existing raster via the CSS scale looks fine
  // (unlike stretching one up, which is what causes the blur), so a quick
  // 800%->100% zoom-out settles into a pure `scale(0.125)`-style transform
  // with no re-layout at all, instead of re-baking a huge SVG down to a
  // tiny one just to immediately look identical.
  //
  // Growing is capped at getMaxBakeDim() (viewport-relative, see above):
  // past that, the raster stops growing and the *rest* of the zoom stays a
  // CSS scale — some blur, but the backing store — and therefore the cost
  // of repainting it on every subsequent DOM change — is bounded no matter
  // how far in the player goes.
  function rebakeRaw() {
    if (zoom <= bakedZoom) return;
    const rawW = baseWidth * zoom;
    const rawH = baseHeight * zoom;
    const capRatio = Math.min(1, getMaxBakeDim() / Math.max(rawW, rawH));
    const bakeTarget = zoom * capRatio;
    if (bakeTarget <= bakedZoom) return; // already baked at least this sharp (can happen right at the cap)

    const w = Math.round(baseWidth * bakeTarget);
    const h = Math.round(baseHeight * bakeTarget);
    content.setAttribute('width', w);
    content.setAttribute('height', h);
    bakedZoom = bakeTarget;
    render();
  }
  const rebake = mark('zoomPan.rebake', rebakeRaw);

  let settleTimer = null;
  function scheduleSettle() {
    // Drop-shadow filters (state glows, city marker glows) are expensive to
    // rasterize and must be recomputed on every scale change — cheap for
    // one element, but 50+ states and dozens of city markers all filtered
    // at once turns a rapid wheel-zoom burst into a string of 100-300ms
    // main-thread stalls (confirmed via a real recorded session: unexplained
    // "LONG TASK" entries lining up exactly with zoom bursts, with none of
    // the instrumented JS functions accounting for the time — the cost is
    // in the browser's paint step, invisible to JS timing). Suppressing
    // filter for the duration of the interaction and restoring it once
    // settled (each element already transitions filter back in) avoids
    // paying that cost on every tick.
    viewport.classList.add('zoom-interacting');
    clearTimeout(settleTimer);
    settleTimer = setTimeout(
      mark('zoomPan.settle(rebake+visibleRect)', () => {
        rebake();
        if (onVisibleRectChange) onVisibleRectChange(getVisibleNativeRect());
        viewport.classList.remove('zoom-interacting');
      }),
      settleDebounceMs
    );
  }
  function getVisibleNativeRect() {
    const s = zoom * baseScale; // native-unit -> screen px, at current zoom
    return {
      x0: -panX / s,
      y0: -panY / s,
      x1: (viewport.clientWidth - panX) / s,
      y1: (viewport.clientHeight - panY) / s,
    };
  }

  const notifyListeners = mark('zoomPan.onZoomChange listeners', () => {
    for (const cb of listeners) cb(zoom);
  });

  function apply(nextZoom, anchorClientX, anchorClientY) {
    nextZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    if (nextZoom === zoom) return;

    const rect = viewport.getBoundingClientRect();
    const ax = anchorClientX != null ? anchorClientX - rect.left : viewport.clientWidth / 2;
    const ay = anchorClientY != null ? anchorClientY - rect.top : viewport.clientHeight / 2;

    // native-space point currently under the anchor, so it stays put
    const contentX = (ax - panX) / zoom;
    const contentY = (ay - panY) / zoom;

    zoom = nextZoom;
    panX = ax - contentX * zoom;
    panY = ay - contentY * zoom;
    clampPan();
    render();
    scheduleSettle();
    notifyListeners();
  }

  // Jumps to a specific spot on the map (native canvas coordinates) at a
  // given zoom, centering it in the viewport — used by the overview
  // side-panel list to "fly to" a clicked state/city, as opposed to
  // apply()'s anchor-preserving zoom used for wheel/button zooming.
  function focusOn(nativeX, nativeY, targetZoom) {
    zoom = Math.min(maxZoom, Math.max(minZoom, targetZoom ?? zoom));
    const s = baseScale * zoom;
    panX = viewport.clientWidth / 2 - nativeX * s;
    panY = viewport.clientHeight / 2 - nativeY * s;
    clampPan();
    render();
    scheduleSettle();
    for (const cb of listeners) cb(zoom);
  }

  function onWheel(ev) {
    ev.preventDefault();
    apply(zoom * (ev.deltaY < 0 ? step : 1 / step), ev.clientX, ev.clientY);
  }
  viewport.addEventListener('wheel', onWheel, { passive: false });

  // Grab-and-drag panning. In "panFromAnywhere" mode (quiz map — nothing
  // else there is draggable) a press anywhere starts tracking, and only
  // turns into a pan once the pointer actually moves past a small
  // threshold; a press that never moves fires `onTap` instead, so clicking
  // a state still answers the question. Outside that mode (puzzle board,
  // where pieces have their own drag) panning only starts on bare
  // background (ev.target === content) so it never fights piece dragging.
  let pan = null;
  function onPointerDown(ev) {
    if (ev.button !== 0) return;
    if (!panFromAnywhere && ev.target !== content) return;
    pan = {
      startX: ev.clientX,
      startY: ev.clientY,
      startPanX: panX,
      startPanY: panY,
      moved: false,
      downEvent: ev,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }
  function onPointerMoveRaw(ev) {
    if (!pan) return;
    const dx = ev.clientX - pan.startX;
    const dy = ev.clientY - pan.startY;
    if (!pan.moved) {
      if (Math.hypot(dx, dy) < tapThreshold) return;
      pan.moved = true;
      pan.downEvent.preventDefault();
      viewport.classList.add('panning');
    }
    panX = pan.startPanX + dx;
    panY = pan.startPanY + dy;
    clampPan();
    render();
    scheduleSettle();
  }
  const onPointerMove = mark('zoomPan.onPointerMove', onPointerMoveRaw);
  function onPointerUp() {
    if (!pan) return;
    const wasTap = !pan.moved;
    const downEvent = pan.downEvent;
    viewport.classList.remove('panning');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    pan = null;
    if (wasTap) onTap?.(downEvent);
  }
  content.addEventListener('pointerdown', onPointerDown);

  clampPan();
  render();
  // Fire once immediately (not debounced) so virtualized content shows up
  // on first paint instead of waiting out the debounce.
  if (onVisibleRectChange) onVisibleRectChange(getVisibleNativeRect());

  return {
    zoomIn: () => apply(zoom * step),
    zoomOut: () => apply(zoom / step),
    reset: () => apply(1),
    getZoom: () => zoom,
    focusOn,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {
      clearTimeout(settleTimer);
      viewport.removeEventListener('wheel', onWheel);
      content.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      listeners.clear();
    },
  };
}

// A fixed-size, non-scrolling wrapper around the zoom viewport. Zoom
// control buttons get appended as its sibling (not the viewport's child)
// so they stay pinned to the corner instead of moving with the map content
// when the player pans/zooms.
export function createZoomWrap(baseWidth, baseHeight) {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-wrap';
  wrap.style.width = baseWidth + 'px';
  wrap.style.height = baseHeight + 'px';

  const viewport = document.createElement('div');
  viewport.className = 'zoom-viewport';
  wrap.appendChild(viewport);

  // Moves the single persistent FPS readout into this map frame — it
  // migrates from board to board this way instead of floating over the
  // whole page (see fpsMeter.js).
  mountFpsMeter(wrap);

  return { wrap, viewport };
}

// Small floating +/reset/- button cluster wired to a zoomPan controller,
// with a live "100%" / "300%" readout between the buttons.
export function createZoomControls(zoomCtl) {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-controls';
  wrap.innerHTML = `
    <button type="button" class="zoom-btn" data-action="in" title="Приблизить">+</button>
    <span class="zoom-level" title="Текущий масштаб"></span>
    <button type="button" class="zoom-btn" data-action="reset" title="Сбросить масштаб">⟲</button>
    <button type="button" class="zoom-btn" data-action="out" title="Отдалить">−</button>
  `;
  wrap.querySelector('[data-action="in"]').addEventListener('click', () => zoomCtl.zoomIn());
  wrap.querySelector('[data-action="reset"]').addEventListener('click', () => zoomCtl.reset());
  wrap.querySelector('[data-action="out"]').addEventListener('click', () => zoomCtl.zoomOut());

  const levelEl = wrap.querySelector('.zoom-level');
  const updateLevel = (zoom) => { levelEl.textContent = `${Math.round(zoom * 100)}%`; };
  updateLevel(zoomCtl.getZoom());
  zoomCtl.subscribe(updateLevel);

  return wrap;
}

const KM_PER_MI = 0.621371;

// A passive, Google-Maps-style scale readout pinned to the bottom-left of
// the map: a fixed 100-screen-pixel bracket labeled with how much real
// distance those 100px cover at the current zoom. `baseScale` is the
// board's fit-to-viewport scale (native units -> px at zoom 1); `kmPerUnit`
// converts native canvas units to real-world km (baked in at build time
// from the map's projection — see scripts/build_usa_level.js).
export function createScaleBar(zoomCtl, opts = {}) {
  const baseScale = opts.baseScale || 1;
  const kmPerUnit = opts.kmPerUnit || 0;
  const barPx = 100;

  const wrap = document.createElement('div');
  wrap.className = 'scale-bar';
  wrap.innerHTML = `
    <div class="scale-bar-line"></div>
    <div class="scale-bar-label"></div>
  `;
  const labelEl = wrap.querySelector('.scale-bar-label');

  const update = (zoom) => {
    const effScale = baseScale * zoom;
    const km = (barPx / effScale) * kmPerUnit;
    const mi = km * KM_PER_MI;
    const fmt = (v) => (v < 10 ? v.toFixed(1) : Math.round(v));
    labelEl.textContent = `${fmt(km)} км / ${fmt(mi)} mi`;
  };
  update(zoomCtl.getZoom());
  zoomCtl.subscribe(update);

  return wrap;
}
