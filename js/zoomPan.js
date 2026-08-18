import { mountFpsMeter } from './fpsMeter.js';
import { mark } from './perfDebug.js';

// Shared wheel/button/drag zoom for an SVG sitting inside a fixed-size
// viewport. Two rendering modes share the work, switched between as needed
// (see `mode` below):
//
//   - 'scroll' — the resting state, and the one active while PANNING. The
//     SVG's viewBox is pinned to the map's full native extent forever, its
//     CSS width/height are set to the real pixel size that extent occupies
//     at the current zoom, and the visible crop is just whatever part of
//     that one pre-rendered raster viewport.scrollLeft/scrollTop happens
//     to reveal. .zoom-viewport is `overflow: hidden` — no native
//     scrollbar UI, since real Chrome/Windows setups turned out to still
//     auto-hide/fade one regardless of CSS overrides — but scrollLeft/Top
//     are still driven programmatically, and a custom always-visible
//     scrollbar (see the pan-scrollbar-* elements/onNativeScroll below)
//     drives the exact same property a native one would. Either way,
//     panning becomes a **scroll**: the browser translates an already-
//     rasterized bitmap, the exact same well-worn path used to scroll any
//     ordinary webpage, instead of re-rasterizing vector paths every
//     frame.
//   - 'crop' — active only during an in-progress ZOOM gesture (wheel,
//     button, or animateFocus). viewBox crops directly into the visible
//     native rect, content fills 100% of the viewport, and every single
//     step re-commits that crop immediately — full, direct re-
//     rasterization on every frame, no interpolation/optimization at all.
//     Deliberately basic: an earlier version of this mode instead applied
//     a cheap CSS `transform: translate()/scale()` between real commits to
//     approximate in-between zoom levels — cheaper, but visibly buggy in
//     practice (misjudged math, real reported artifacts) and not worth
//     debugging right now. Zoom pays full cost per frame until it's
//     revisited; only pan (via 'scroll' mode below) stays optimized.
//
// The reason two modes exist instead of one: an earlier version of this
// file tried making 'scroll'-style full-extent rendering the ONLY mode,
// unconditionally growing the SVG's width/height with zoom — the backing
// store then ballooned at high zoom (repainting even one new city dot cost
// a full repaint of a raster many times bigger than the screen), and it
// forced an artificial zoom ceiling that never made sense for
// resolution-less vector data. Keeping 'crop' mode for the actual zoom
// gesture, and only ever fully expanding into 'scroll' mode once a zoom
// has settled on its FINAL level, avoids ever needing an oversized
// mid-zoom raster — see MAX_SCROLL_BACKING_PX below for the other half of
// that guard (an explicit cap, for when even the settled raster would be
// too big to be worth it).
//
// Hit-testing elsewhere should go through the returned `clientToNative()`
// rather than reading the SVG's own viewBox attribute directly — the
// mapping depends on which mode is currently active, and clientToNative()
// (built from vx/vy/zoom, the always-current logical camera state) handles
// both. See puzzleBoard.js's, cityPinBoard.js's and overviewBoard.js's
// _clientToNative, all now thin wrappers around it.
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

  // "cover"-fit scale (native units -> CSS px), re-derived the same way
  // game.js's _computeScale(..., cover=true) computes it: the LARGER of
  // the two axis ratios, so the map fills the now-correctly-sized
  // viewport edge-to-edge with no letterboxing, cropping the other axis
  // instead. viewport.clientWidth/clientHeight are safe to read once and
  // treat as constant — createZoomWrap() already caps .zoom-wrap/
  // .zoom-viewport to the real container size, and that size doesn't
  // change for the lifetime of a board.
  const homeScale = Math.max(viewport.clientWidth / nativeW, viewport.clientHeight / nativeH);
  // The native-space rect actually visible at rest (zoom=1) — smaller than
  // nativeW x nativeH in whichever axis "cover" fit crops, since that axis
  // renders at MORE px/native-unit than the viewport can show all of.
  // (Equal to nativeW/nativeH when the level's aspect ratio happens to
  // match the viewport's, same as any board using "contain" fit instead —
  // homeScale reduces to a single unambiguous ratio there too.)
  const homeVw = viewport.clientWidth / homeScale;
  const homeVh = viewport.clientHeight / homeScale;

  let zoom = 1;
  // Centered within the full native extent, not pinned to homeX/homeY —
  // matches how the old oversized-.zoom-wrap layout used to center that
  // same cropped slice via flexbox instead. clampOrigin below still uses
  // the FULL nativeW/nativeH as its bounds, so — unlike the old layout-
  // level crop, which hid this slice unconditionally — panning (drag or
  // the native scrollbars) can now actually reach it.
  let vx = homeX + (nativeW - homeVw) / 2;
  let vy = homeY + (nativeH - homeVh) / 2;

  // Panning is allowed to carry the view past the map's edge into empty
  // space — you shouldn't be walled off from the border of a state just
  // because it's near the map's own edge, and even at zoom=1 (map exactly
  // filling the view) the camera should still be free to drift, not locked
  // rigidly in place. It's never allowed so far that the map disappears
  // off screen entirely, though: the required overlap is a fraction of
  // whichever is smaller — the view or the map itself — so there's always
  // a visible sliver of map on screen telling you which way to pan back,
  // whether you're zoomed in past the map's edge or zoomed out with the
  // whole map already visible and room to spare. Deliberately tiny (was
  // 0.15) so the map can be dragged nearly all the way off-screen — a big
  // empty-space "padding" to pan into, not just a small drift allowance.
  const minMapOverlap = opts.minMapOverlap ?? 0.03;
  // 'scroll' mode's blank margin (native units), baked directly into the
  // rendered canvas — see enterScrollMode() below. Native scrollLeft/Top
  // can never go negative or past scrollWidth/Height (the browser just
  // clamps it back, silently fighting clampOrigin's intent every frame),
  // so the only way for the "almost off-screen" padding above to actually
  // be reachable while native-scroll panning is to make the padding part
  // of the scrollABLE content itself — empty space rendered right into the
  // SVG's own (expanded) viewBox — rather than an out-of-bounds scroll
  // position. Sized to the zoom=1 case (the largest clampOrigin ever
  // allows); at higher zoom the reachable range shrinks but the padding
  // doesn't, which just means some of it goes unused — harmless.
  const padX = homeVw * (1 - minMapOverlap);
  const padY = homeVh * (1 - minMapOverlap);
  // 'scroll' mode's canvas origin, in native units — top-left of the
  // padded viewBox enterScrollMode() renders, i.e. what scrollLeft/Top=0
  // corresponds to. vx=padOriginX is the leftmost position clampOrigin can
  // ever produce at zoom=1 (homeX + overlapX - homeVw, and overlapX ->0 as
  // minMapOverlap ->0), so scrollLeft never needs to go negative to reach
  // it.
  const padOriginX = homeX - padX;
  const padOriginY = homeY - padY;
  function clampOrigin(vw, vh) {
    const overlapX = minMapOverlap * Math.min(vw, nativeW);
    const overlapY = minMapOverlap * Math.min(vh, nativeH);
    vx = Math.min(homeX + nativeW - overlapX, Math.max(homeX + overlapX - vw, vx));
    vy = Math.min(homeY + nativeH - overlapY, Math.max(homeY + overlapY - vh, vy));
  }

  // Cap on 'scroll' mode's pre-rendered raster size (CSS px, per axis),
  // padding included. Past this, a settled zoom level falls back to
  // staying in 'crop' mode instead of expanding into 'scroll' — trading
  // away native-scroll pan at extreme zoom in exchange for never asking
  // the browser to rasterize an arbitrarily huge bitmap. 4000px
  // comfortably covers the zoom range anyone would actually sit at;
  // maxZoom/step already keep occasional excursions past it rare.
  const MAX_SCROLL_BACKING_PX = 4000;
  function scrollModeFits() {
    return (
      (nativeW + 2 * padX) * homeScale * zoom <= MAX_SCROLL_BACKING_PX &&
      (nativeH + 2 * padY) * homeScale * zoom <= MAX_SCROLL_BACKING_PX
    );
  }

  let mode = 'scroll';

  function currentSize() {
    return { vw: homeVw / zoom, vh: homeVh / zoom };
  }

  // The resting/crisp state: content grows to the current zoom level's full
  // native extent PLUS the padX/padY blank margin on every side (real re-
  // rasterization, at whatever resolution that implies), and the visible
  // crop becomes purely a matter of viewport scroll position. Cheap to pan
  // out of afterwards (see renderPan()) — this is the only mode where
  // panning costs nothing beyond a scroll.
  function enterScrollMode() {
    content.style.width = `${((nativeW + 2 * padX) * homeScale * zoom).toFixed(3)}px`;
    content.style.height = `${((nativeH + 2 * padY) * homeScale * zoom).toFixed(3)}px`;
    content.setAttribute('viewBox', `${padOriginX} ${padOriginY} ${nativeW + 2 * padX} ${nativeH + 2 * padY}`);
    viewport.scrollLeft = (vx - padOriginX) * homeScale * zoom;
    viewport.scrollTop = (vy - padOriginY) * homeScale * zoom;
    mode = 'scroll';
  }

  // The ONLY zoom render path now — a full, direct, immediate re-commit of
  // the crop viewBox on every single frame (see the top-of-file comment on
  // why the previous cheap-transform-preview optimization was pulled).
  // Also used, unconditionally, as the pan render path at extreme zoom
  // (see renderPan()) — there's no transform to keep in sync with vx/vy
  // there either now, so it's always safe to just call this directly.
  // Explicit '100%' rather than reverting to '' (the SVG's own width/
  // height attributes) — those attributes are the ORIGINAL "cover"-fit
  // oversized pixel size (see createZoomWrap's comment), which no longer
  // matches this now-correctly-sized viewport at all.
  function enterCropMode() {
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    content.style.width = '100%';
    content.style.height = '100%';
    const { vw, vh } = currentSize();
    content.setAttribute('viewBox', `${vx.toFixed(6)} ${vy.toFixed(6)} ${vw.toFixed(6)} ${vh.toFixed(6)}`);
    mode = 'crop';
  }

  // The render path while panning: a native scroll, not a CSS transform —
  // see the top-of-file comment for why that matters. Falls back to
  // enterCropMode()'s direct re-commit at extreme zoom, where 'scroll'
  // mode's raster would be too big to be worth entering (see
  // MAX_SCROLL_BACKING_PX).
  function renderPan() {
    if (!scrollModeFits()) {
      enterCropMode();
      return;
    }
    if (mode !== 'scroll') enterScrollMode();
    viewport.scrollLeft = (vx - padOriginX) * homeScale * zoom;
    viewport.scrollTop = (vy - padOriginY) * homeScale * zoom;
  }

  // Coalesces render calls to at most one per animation frame — a raw
  // input event stream (pointermove especially, on a high-polling-rate
  // mouse) can fire faster than the display refreshes; without this, each
  // one would immediately write to scrollLeft/viewBox even though only
  // the LAST write before the next paint ever actually shows up. vx/vy
  // themselves still update synchronously on every event (cheap, pure
  // arithmetic) — only the actual DOM-touching render is deferred, so by
  // the time the rAF fires it always reflects the latest input anyway.
  let pendingRenderFn = null;
  let rafScheduled = false;
  function scheduleFrame(renderFn) {
    pendingRenderFn = renderFn;
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      const fn = pendingRenderFn;
      pendingRenderFn = null;
      fn();
    });
  }

  function getVisibleNativeRect() {
    const { vw, vh } = currentSize();
    return { x0: vx, y0: vy, x1: vx + vw, y1: vy + vh };
  }

  let settleTimer = null;
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(
      mark('zoomPan.settle(commit+visibleRect)', () => {
        // enterCropMode() already leaves a crisp, fully-committed viewBox
        // after every frame now (no transform to bake back in) — the only
        // thing left to do here is upgrade to 'scroll' mode once a zoom
        // gesture has settled on its final level, so the NEXT pan gets the
        // cheap native-scroll path instead of staying in 'crop'.
        if (mode === 'crop' && scrollModeFits()) enterScrollMode();
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
    scheduleFrame(enterCropMode);
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
    if (scrollModeFits()) enterScrollMode();
    else enterCropMode();
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
      enterCropMode();
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
    let targetZoom = Math.min(homeVw / paddedW, homeVh / paddedH);
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
      const vh = homeVh / targetZoom;
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

  // Keeps vx/vy in sync when the user drags the native scrollbar thumb
  // directly, rather than through onPointerMoveRaw's grab-and-drag path —
  // that's a real, separate input source now that .zoom-viewport shows
  // real draggable scrollbars (see style.css), and vx/vy has to stay
  // correct for clampOrigin, zoom-anchor math, clientToNative() hit-
  // testing and onVisibleRectChange virtualization to keep working.
  // Ignored outside 'scroll' mode: enterCropMode() itself resets
  // scrollLeft/Top to 0 as part of shrinking content back down, which
  // fires this same event but isn't a user pan.
  function onNativeScroll() {
    updateScrollbars();
    if (mode !== 'scroll') return;
    vx = padOriginX + viewport.scrollLeft / (homeScale * zoom);
    vy = padOriginY + viewport.scrollTop / (homeScale * zoom);
    scheduleSettle();
  }
  viewport.addEventListener('scroll', onNativeScroll, { passive: true });

  // Custom, always-visible pan scrollbars — the browser's own native ones
  // (via `overflow: scroll` + a ::-webkit-scrollbar override) turned out
  // to still auto-hide/fade on real Chrome/Windows setups regardless of
  // that CSS (a "fluent"/overlay scrollbar mode some Chrome builds force
  // no matter what author styling says). Plain divs instead, driving
  // viewport.scrollLeft/scrollTop directly — onNativeScroll() above picks
  // up the change exactly as if a real scrollbar had produced it, so
  // nothing else in this file needs to know these aren't native. Appended
  // as siblings of `viewport` (its parent, .zoom-wrap, never scrolls) so
  // they stay pinned to the map's own edges instead of scrolling away with
  // the content — same reasoning as .zoom-controls staying a sibling
  // rather than a child.
  const hThumb = document.createElement('div');
  hThumb.className = 'pan-scrollbar-thumb pan-scrollbar-h';
  const vThumb = document.createElement('div');
  vThumb.className = 'pan-scrollbar-thumb pan-scrollbar-v';
  viewport.parentElement.appendChild(hThumb);
  viewport.parentElement.appendChild(vThumb);

  function updateScrollbars() {
    const trackW = viewport.clientWidth;
    const trackH = viewport.clientHeight;
    const contentW = viewport.scrollWidth;
    const contentH = viewport.scrollHeight;
    const thumbW = Math.min(trackW, Math.max(24, (trackW * trackW) / contentW));
    const thumbH = Math.min(trackH, Math.max(24, (trackH * trackH) / contentH));
    const maxScrollX = Math.max(1, contentW - trackW);
    const maxScrollY = Math.max(1, contentH - trackH);
    hThumb.style.width = `${thumbW}px`;
    hThumb.style.left = `${(viewport.scrollLeft / maxScrollX) * (trackW - thumbW)}px`;
    vThumb.style.height = `${thumbH}px`;
    vThumb.style.top = `${(viewport.scrollTop / maxScrollY) * (trackH - thumbH)}px`;
  }

  // A currently in-flight thumb drag's own cleanup, so destroy() can bail
  // out of it cleanly instead of leaking the window-level listeners below.
  let activeThumbDragCleanup = null;

  function makeThumbDraggable(thumbEl, axis) {
    thumbEl.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation(); // don't also let this fall through into onPointerDown's map-drag
      focusToken++; // supersede any in-flight animateFocus loop
      const startClient = axis === 'x' ? ev.clientX : ev.clientY;
      const startScroll = axis === 'x' ? viewport.scrollLeft : viewport.scrollTop;
      const trackLen = axis === 'x' ? viewport.clientWidth : viewport.clientHeight;
      const contentLen = axis === 'x' ? viewport.scrollWidth : viewport.scrollHeight;
      const maxScroll = Math.max(1, contentLen - trackLen);
      const thumbLen = Math.min(trackLen, Math.max(24, (trackLen * trackLen) / contentLen));
      const travel = Math.max(1, trackLen - thumbLen);
      thumbEl.classList.add('dragging');
      const move = (mv) => {
        const deltaClient = (axis === 'x' ? mv.clientX : mv.clientY) - startClient;
        const next = Math.min(maxScroll, Math.max(0, startScroll + deltaClient * (maxScroll / travel)));
        scheduleFrame(() => {
          if (axis === 'x') viewport.scrollLeft = next;
          else viewport.scrollTop = next;
        });
      };
      const up = () => {
        thumbEl.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        activeThumbDragCleanup = null;
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      activeThumbDragCleanup = up;
    });
  }
  makeThumbDraggable(hThumb, 'x');
  makeThumbDraggable(vThumb, 'y');

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
    scheduleFrame(renderPan);
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

  clampOrigin(homeVw, homeVh);
  enterScrollMode();
  // 'scroll' events fire asynchronously — updateScrollbars() wouldn't run
  // in time for first paint otherwise (same reasoning as the immediate
  // onVisibleRectChange call right below).
  updateScrollbars();
  // Fire once immediately (not debounced) so virtualized content shows up
  // on first paint instead of waiting out the debounce.
  if (onVisibleRectChange) onVisibleRectChange(getVisibleNativeRect());

  // Maps a client (screen) point to native map coordinates, from the
  // always-current logical camera state (vx/vy/zoom) rather than reading
  // the SVG's own viewBox attribute — correct regardless of which
  // rendering mode is currently active, or whether a gesture is mid-flight
  // with the real viewBox not yet caught up. See the top-of-file comment.
  function clientToNative(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const { vw, vh } = currentSize();
    return {
      x: vx + ((clientX - rect.left) / viewport.clientWidth) * vw,
      y: vy + ((clientY - rect.top) / viewport.clientHeight) * vh,
    };
  }

  return {
    zoomIn: () => apply(zoom * step),
    zoomOut: () => apply(zoom / step),
    reset: () => apply(1),
    getZoom: () => zoom,
    focusOn,
    focusOnBBox,
    clientToNative,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {
      focusToken++; // stop any in-flight animateFocus loop
      clearTimeout(settleTimer);
      activeThumbDragCleanup?.(); // in case destroy() runs mid-drag
      hThumb.remove();
      vThumb.remove();
      content.style.width = '';
      content.style.height = '';
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('scroll', onNativeScroll);
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
// baseWidth/baseHeight is the board's "cover"-fit size (game.js's
// _computeScale(..., cover=true)) — deliberately bigger than the real
// visible area in one dimension so the map fills edge-to-edge with no
// letterboxing. Capping the WRAP itself to fpsMountEl's (always
// #board-container in practice) actual clientWidth/clientHeight, instead
// of using baseWidth/baseHeight directly, keeps .zoom-wrap/.zoom-viewport
// sized to the REAL visible area — the oversized cover-fit amount still
// happens (zoomPan.js re-derives it from nativeW/nativeH vs. this now-
// correctly-sized viewport, and renders it as scrollable content in
// 'scroll' mode), it just no longer leaks into the wrap's own box. Without
// this, .zoom-viewport's native scrollbars — and anything else anchored to
// its own edges — end up positioned outside the visible, clipped screen
// area; see the matching comment in style.css's .zoom-viewport rule. A
// board using "contain" fit (puzzle, and identifyStateBoard/
// neighborBoard's own internal fitScale) already has baseWidth/Height <=
// the container's size, so Math.min here is a no-op for them.
export function createZoomWrap(baseWidth, baseHeight, fpsMountEl) {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-wrap';
  const capW = fpsMountEl?.clientWidth ? Math.min(baseWidth, fpsMountEl.clientWidth) : baseWidth;
  const capH = fpsMountEl?.clientHeight ? Math.min(baseHeight, fpsMountEl.clientHeight) : baseHeight;
  wrap.style.width = capW + 'px';
  wrap.style.height = capH + 'px';

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
