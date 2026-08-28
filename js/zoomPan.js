import { mountFpsMeter } from './fpsMeter.js';
import { mark } from './perfDebug.js';
import { t } from './i18n.js';

// Shared wheel/button/drag zoom for an SVG sitting inside a fixed-size
// viewport. Zoom/pan works by moving the SVG's own `viewBox` — literally
// re-pointing the vector renderer at a different (and differently sized)
// rectangle of native map coordinates — rather than by scaling a big
// rasterized copy of the whole map via CSS transform.
//
// This used to be a hybrid: cheap CSS `transform: scale()` during
// interaction, with a periodic "rebake" that grew the SVG's actual
// width/height attributes to re-rasterize crisply once input settled. That
// worked, but it meant the browser's backing store for the WHOLE map grew
// with zoom level — at high zoom, repainting anything (even revealing one
// new city dot) cost a full repaint of a raster many times bigger than the
// screen. It also meant zoom had to be capped at all, purely as a side
// effect of that raster-size problem, which never made sense for
// fundamentally-vector data with no intrinsic resolution limit.
//
// Cropping into the vector data via viewBox sidesteps this entirely: the
// rendered raster is always exactly viewport-sized, no matter how far
// zoomed in, because the browser only ever rasterizes what's actually on
// screen. The content stays exactly as sharp at any zoom (it's vector
// paths, redrawn fresh every time, not a stretched bitmap) and repaint cost
// stays roughly constant instead of ballooning with zoom — so there's no
// need for a zoom ceiling here at all.
//
// Hit-testing elsewhere has to read the SVG's *current* viewBox rather than
// assuming it's fixed at the zoom=1 extent — see puzzleBoard.js's and
// cityPinBoard.js's _clientToNative.
export function attachZoomPan(viewport, content, opts = {}) {
  const minZoom = opts.minZoom ?? 0.01;
  const maxZoom = opts.maxZoom ?? Infinity;
  const step = opts.step ?? 1.35;
  const tapThreshold = opts.tapThreshold ?? 6; // px of movement before a press counts as a drag
  const panFromAnywhere = opts.panFromAnywhere ?? false;
  const onTap = opts.onTap; // (originalPointerDownEvent) => void — fired when a press didn't turn into a drag
  // (visibleNativeRect) => void — fired (debounced) after pan/zoom settles,
  // with the currently-visible native-coordinate rect. Boards with lots of
  // small features (city dots) use this to only keep in-view elements in
  // the DOM instead of paying render cost for all of them all the time —
  // see overviewBoard.js's virtualization.
  const onVisibleRectChange = opts.onVisibleRectChange;
  // How long input has to be quiet before the (debounced) visibility notify
  // fires — panning/zooming itself is applied immediately on every event;
  // this only throttles how often boards re-check what's in view.
  const settleDebounceMs = opts.settleDebounceMs ?? 150;

  // The board has already set content's viewBox to its "fit the whole map"
  // extent before calling this (see e.g. overviewBoard.js's _build) — that
  // rectangle, in native map units, is the zoom=1 / pan-home reference
  // frame. Reading it back (rather than requiring a redundant
  // nativeWidth/nativeHeight option) also correctly picks up a non-zero,
  // padded origin like puzzleBoard.js uses.
  const [homeX, homeY, nativeW, nativeH] = (content.getAttribute('viewBox') || '0 0 1 1')
    .trim()
    .split(/\s+/)
    .map(Number);

  const listeners = new Set(); // (zoom) => void, fired whenever the zoom level actually changes
  if (opts.onZoomChange) listeners.add(opts.onZoomChange);

  let zoom = 1;
  let vx = homeX; // top-left of the current viewBox, in native units
  let vy = homeY;

  function currentSize() {
    return { vw: nativeW / zoom, vh: nativeH / zoom };
  }

  // Panning is allowed to carry the view past the map's edge into empty
  // space — you shouldn't be walled off from the border of a state just
  // because it's near the map's own edge, and even at zoom=1 (map exactly
  // filling the view) the camera should still be free to drift, not locked
  // rigidly in place. It's never allowed so far that the map disappears
  // off screen entirely, though: the required overlap is a fraction of
  // whichever is smaller — the view or the map itself — so there's always
  // a visible sliver of map on screen telling you which way to pan back,
  // whether you're zoomed in past the map's edge or zoomed out with the
  // whole map already visible and room to spare.
  const minMapOverlap = opts.minMapOverlap ?? 0.15;
  function clampOrigin(vw, vh) {
    const overlapX = minMapOverlap * Math.min(vw, nativeW);
    const overlapY = minMapOverlap * Math.min(vh, nativeH);
    vx = Math.min(homeX + nativeW - overlapX, Math.max(homeX + overlapX - vw, vx));
    vy = Math.min(homeY + nativeH - overlapY, Math.max(homeY + overlapY - vh, vy));
  }

  function render() {
    const { vw, vh } = currentSize();
    content.setAttribute('viewBox', `${vx.toFixed(6)} ${vy.toFixed(6)} ${vw.toFixed(6)} ${vh.toFixed(6)}`);
  }

  function getVisibleNativeRect() {
    const { vw, vh } = currentSize();
    return { x0: vx, y0: vy, x1: vx + vw, y1: vy + vh };
  }

  let settleTimer = null;
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(
      mark('zoomPan.settle(visibleRect)', () => {
        if (onVisibleRectChange) onVisibleRectChange(getVisibleNativeRect());
      }),
      settleDebounceMs
    );
  }

  const notifyListeners = mark('zoomPan.onZoomChange listeners', () => {
    for (const cb of listeners) cb(zoom);
  });

  function apply(nextZoom, anchorClientX, anchorClientY) {
    nextZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    if (nextZoom === zoom) return;
    focusToken++; // supersede any in-flight animateFocus loop

    const rect = viewport.getBoundingClientRect();
    const ax = anchorClientX != null ? anchorClientX - rect.left : viewport.clientWidth / 2;
    const ay = anchorClientY != null ? anchorClientY - rect.top : viewport.clientHeight / 2;

    // Native-space point currently under the anchor, so it stays put.
    const before = currentSize();
    const nativeAtAnchorX = vx + (ax / viewport.clientWidth) * before.vw;
    const nativeAtAnchorY = vy + (ay / viewport.clientHeight) * before.vh;

    zoom = nextZoom;
    const after = currentSize();
    vx = nativeAtAnchorX - (ax / viewport.clientWidth) * after.vw;
    vy = nativeAtAnchorY - (ay / viewport.clientHeight) * after.vh;
    clampOrigin(after.vw, after.vh);
    render();
    scheduleSettle();
    notifyListeners();
  }

  // Jumps to a specific spot on the map (native canvas coordinates) at a
  // given zoom, centering it in the viewport — used by the overview
  // side-panel list to "fly to" a clicked state/city, as opposed to
  // apply()'s anchor-preserving zoom used for wheel/button zooming.
  function focusOn(nativeX, nativeY, targetZoom) {
    focusToken++; // supersede any in-flight animateFocus loop
    zoom = Math.min(maxZoom, Math.max(minZoom, targetZoom ?? zoom));
    const { vw, vh } = currentSize();
    vx = nativeX - vw / 2;
    vy = nativeY - vh / 2;
    clampOrigin(vw, vh);
    render();
    scheduleSettle();
    for (const cb of listeners) cb(zoom);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  // Smoothly pans/zooms the camera from wherever it currently is to center
  // on (nativeX, nativeY) at targetZoom, over durationMs — the animated
  // counterpart to focusOn()'s instant jump. Used by nameStateBoard.js's
  // "Назови штат"/"Назови страну" to carry the camera toward each round's
  // newly-highlighted piece rather than snapping there, so the player can
  // visually track which direction/how far it moved.
  //
  // The center point is interpolated linearly, but zoom is interpolated
  // multiplicatively (start * (target/start)^e) rather than linearly —
  // zoom is a "how many times bigger" quantity, so a linear blend would
  // move disproportionately fast at the low-zoom end and crawl at the
  // high-zoom end of any big zoom change (e.g. a tiny country after a
  // huge one). The multiplicative blend keeps the zoom change feeling
  // like a constant rate throughout.
  let focusToken = 0;
  function animateFocus(nativeX, nativeY, targetZoom, durationMs) {
    const token = ++focusToken;
    targetZoom = Math.min(maxZoom, Math.max(minZoom, targetZoom));
    const { vw: vw0, vh: vh0 } = currentSize();
    const startCx = vx + vw0 / 2;
    const startCy = vy + vh0 / 2;
    const startZoom = zoom;
    const t0 = performance.now();
    const step = (now) => {
      if (token !== focusToken) return; // superseded by a newer focus or manual interaction
      const t = Math.min(1, (now - t0) / durationMs);
      const e = easeInOutCubic(t);
      const curCx = startCx + (nativeX - startCx) * e;
      const curCy = startCy + (nativeY - startCy) * e;
      zoom = startZoom * (targetZoom / startZoom) ** e;
      const { vw, vh } = currentSize();
      vx = curCx - vw / 2;
      vy = curCy - vh / 2;
      clampOrigin(vw, vh);
      render();
      notifyListeners();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        scheduleSettle();
      }
    };
    requestAnimationFrame(step);
  }

  // Convenience wrapper around animateFocus()/focusOn() that frames a
  // native-space bounding box (e.g. a piece's own `bbox`) instead of a
  // bare point + zoom — computes the box's center and the zoom that fits
  // it (plus padding, so surrounding context stays visible) itself.
  function focusOnBBox(bbox, opts = {}) {
    const [minX, minY, maxX, maxY] = bbox;
    const w = Math.max(maxX - minX, 1e-6);
    const h = Math.max(maxY - minY, 1e-6);
    const cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    // pad=3 means the padded frame is 4x the piece's own size, i.e. the
    // piece occupies at most 1/(1+pad) = 25% of the viewport along its
    // own constraining dimension — comfortably under a 50% ceiling even
    // once the answer-bar offset below and real-world rendering slop
    // (stroke width, the hint glow's filter bleed) are accounted for.
    const pad = opts.pad ?? 3;
    const paddedW = w * (1 + pad);
    const paddedH = h * (1 + pad);
    let targetZoom = Math.min(nativeW / paddedW, nativeH / paddedH);
    // Clamped independently of the board's own min/maxZoom — without a
    // cap, a tiny piece (e.g. a small country next to a continent-sized
    // one) would zoom in far enough to feel jarring/disorienting for an
    // automatic camera move, even though a player deliberately zooming
    // that far by hand is fine.
    targetZoom = Math.min(opts.maxFocusZoom ?? 6, Math.max(opts.minFocusZoom ?? 0.75, targetZoom));
    // Shifts the focus point DOWN by half of opts.avoidBottomPx (screen
    // pixels, converted to native units at the target zoom) so the piece
    // lands centered in the part of the viewport that's actually free to
    // look at, not the full viewport including whatever a bottom-anchored
    // overlay (e.g. nameStateBoard.js's answer bar) is covering.
    if (opts.avoidBottomPx) {
      const vh = nativeH / targetZoom;
      cy += (opts.avoidBottomPx / 2) * (vh / viewport.clientHeight);
    }
    if (opts.animate === false) focusOn(cx, cy, targetZoom);
    else animateFocus(cx, cy, targetZoom, opts.durationMs ?? 700);
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
    focusToken++; // supersede any in-flight animateFocus loop before capturing the pan baseline below
    const { vw, vh } = currentSize();
    pan = {
      startX: ev.clientX,
      startY: ev.clientY,
      startVX: vx,
      startVY: vy,
      vw,
      vh,
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
    vx = pan.startVX - dx * (pan.vw / viewport.clientWidth);
    vy = pan.startVY - dy * (pan.vh / viewport.clientHeight);
    clampOrigin(pan.vw, pan.vh);
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

  clampOrigin(nativeW, nativeH);
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
    focusOnBBox,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {
      focusToken++; // stop any in-flight animateFocus loop
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
//
// fpsMountEl: where to mount the FPS readout (see fpsMeter.js) — defaults
// to `wrap` itself, but every caller should pass its own #board-container
// instead. `wrap` is deliberately oversized by "cover" fit (every mode but
// puzzle) and gets cropped, so a position:absolute readout anchored to
// ITS top-left corner (see #fps-meter's CSS) can land off-screen at wide
// aspect ratios — the same trap .zoom-controls/.scale-bar/.name-answer-bar
// etc. had, fixed the same way (see nameStateBoard.js's matching comment).
export function createZoomWrap(baseWidth, baseHeight, fpsMountEl) {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-wrap';
  wrap.style.width = baseWidth + 'px';
  wrap.style.height = baseHeight + 'px';

  const viewport = document.createElement('div');
  viewport.className = 'zoom-viewport';
  wrap.appendChild(viewport);

  // Moves the single persistent FPS readout into the real visible area —
  // it migrates from board to board this way instead of floating over the
  // whole page (see fpsMeter.js).
  mountFpsMeter(fpsMountEl || wrap);

  return { wrap, viewport };
}

// Small floating +/reset/- button cluster wired to a zoomPan controller,
// with a live "100%" / "300%" readout between the buttons.
export function createZoomControls(zoomCtl) {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-controls';
  wrap.innerHTML = `
    <button type="button" class="zoom-btn" data-action="in" title="${t('zoomIn')}">+</button>
    <span class="zoom-level" title="${t('currentZoom')}"></span>
    <button type="button" class="zoom-btn" data-action="reset" title="${t('resetZoom')}">⟲</button>
    <button type="button" class="zoom-btn" data-action="out" title="${t('zoomOut')}">−</button>
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
    labelEl.textContent = `${fmt(km)} ${t('kmUnit')} / ${fmt(mi)} mi`;
  };
  update(zoomCtl.getZoom());
  zoomCtl.subscribe(update);

  return wrap;
}
