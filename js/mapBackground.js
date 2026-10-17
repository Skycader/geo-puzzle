const SVG_NS = 'http://www.w3.org/2000/svg';

// Non-interactive outline layer used as geographic context — shared by the
// city quiz/pin-placement boards (states, default styling) and the sea
// boards (countries, via `pathClass: 'world-bg-path'` — a solid, contrasted
// land tone instead of the faint blue wash tuned for sitting behind
// interactive state shapes; see style.css's .world-bg-path comment).
export function buildStateBackground(pieces, opts = {}) {
  const pathClass = opts.pathClass || 'state-bg-path';
  const g = document.createElementNS(SVG_NS, 'g');
  // `opts.title(piece) -> string` makes the layer hoverable: each shape gets a native
  // <title> tooltip (used by Overview to name the countries on the world map).
  // `opts.kind` additionally tags each shape with data-kind/data-id so Overview's
  // right-click handler can tell which one was hit.
  g.setAttribute('class', 'state-bg-layer' + (opts.title ? ' state-bg-layer-interactive' : ''));
  for (const p of pieces) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('class', pathClass + (p.inset ? ' state-bg-inset' : ''));
    if (opts.kind) {
      path.dataset.kind = opts.kind;
      path.dataset.id = p.id;
    }
    if (opts.title) {
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = opts.title(p);
      path.appendChild(title);
    }
    g.appendChild(path);
  }
  return g;
}
