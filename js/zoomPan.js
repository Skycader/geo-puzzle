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

  return {
    zoomIn: () => apply(zoom * step),
    zoomOut: () => apply(zoom / step),
    reset: () => apply(1),
    getZoom: () => zoom,
    destroy: () => viewport.removeEventListener('wheel', onWheel),
  };
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
