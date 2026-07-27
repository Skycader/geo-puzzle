// Shared wheel/button zoom for an SVG sitting inside a fixed-size,
// overflow:auto viewport. Zooming resizes the SVG's actual width/height
// attributes (not a CSS transform) so the viewport's native scrollbars
// correctly reveal the extra content — panning is just browser-native
// scrolling, no custom drag math needed. Hit-testing elsewhere keeps
// working unchanged because it's always computed from the SVG's live
// getBoundingClientRect(), which already reflects the current size.
export function attachZoomPan(viewport, content, opts = {}) {
  const baseWidth = opts.baseWidth;
  const baseHeight = opts.baseHeight;
  const minZoom = opts.minZoom ?? 1;
  const maxZoom = opts.maxZoom ?? 5;
  const step = opts.step ?? 1.35;
  const tapThreshold = opts.tapThreshold ?? 6; // px of movement before a press counts as a drag
  const panFromAnywhere = opts.panFromAnywhere ?? false;
  const onTap = opts.onTap; // (originalPointerDownEvent) => void — fired when a press didn't turn into a drag

  let zoom = 1;

  function apply(nextZoom, anchorClientX, anchorClientY) {
    nextZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    if (nextZoom === zoom) return;

    const rect = viewport.getBoundingClientRect();
    const ax = anchorClientX != null ? anchorClientX - rect.left : viewport.clientWidth / 2;
    const ay = anchorClientY != null ? anchorClientY - rect.top : viewport.clientHeight / 2;

    const oldW = baseWidth * zoom;
    const oldH = baseHeight * zoom;
    const fracX = (viewport.scrollLeft + ax) / oldW;
    const fracY = (viewport.scrollTop + ay) / oldH;

    zoom = nextZoom;
    const newW = baseWidth * zoom;
    const newH = baseHeight * zoom;
    content.setAttribute('width', Math.round(newW));
    content.setAttribute('height', Math.round(newH));
    viewport.scrollLeft = fracX * newW - ax;
    viewport.scrollTop = fracY * newH - ay;
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
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
      moved: false,
      downEvent: ev,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }
  function onPointerMove(ev) {
    if (!pan) return;
    const dx = ev.clientX - pan.startX;
    const dy = ev.clientY - pan.startY;
    if (!pan.moved) {
      if (Math.hypot(dx, dy) < tapThreshold) return;
      pan.moved = true;
      pan.downEvent.preventDefault();
      viewport.classList.add('panning');
    }
    viewport.scrollLeft = pan.startScrollLeft - dx;
    viewport.scrollTop = pan.startScrollTop - dy;
  }
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

  return {
    zoomIn: () => apply(zoom * step),
    zoomOut: () => apply(zoom / step),
    reset: () => apply(1),
    getZoom: () => zoom,
    destroy: () => {
      viewport.removeEventListener('wheel', onWheel);
      content.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    },
  };
}

// A fixed-size, non-scrolling wrapper around a scrollable zoom viewport.
// Zoom control buttons get appended as its sibling (not the viewport's
// child) so they stay pinned to the corner instead of scrolling away with
// the map content when the player pans/zooms.
export function createZoomWrap(baseWidth, baseHeight) {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-wrap';
  wrap.style.width = baseWidth + 'px';
  wrap.style.height = baseHeight + 'px';

  const viewport = document.createElement('div');
  viewport.className = 'zoom-viewport';
  wrap.appendChild(viewport);

  return { wrap, viewport };
}

// Small floating +/reset/- button cluster wired to a zoomPan controller.
export function createZoomControls(zoomCtl) {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-controls';
  wrap.innerHTML = `
    <button type="button" class="zoom-btn" data-action="in" title="Приблизить">+</button>
    <button type="button" class="zoom-btn" data-action="reset" title="Сбросить масштаб">⟲</button>
    <button type="button" class="zoom-btn" data-action="out" title="Отдалить">−</button>
  `;
  wrap.querySelector('[data-action="in"]').addEventListener('click', () => zoomCtl.zoomIn());
  wrap.querySelector('[data-action="reset"]').addEventListener('click', () => zoomCtl.reset());
  wrap.querySelector('[data-action="out"]').addEventListener('click', () => zoomCtl.zoomOut());
  return wrap;
}
