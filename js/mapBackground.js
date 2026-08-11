const SVG_NS = 'http://www.w3.org/2000/svg';

// Non-interactive outline layer used as geographic context — shared by the
// city quiz/pin-placement boards (states, default styling) and the sea
// boards (countries, via `pathClass: 'world-bg-path'` — a solid, contrasted
// land tone instead of the faint blue wash tuned for sitting behind
// interactive state shapes; see style.css's .world-bg-path comment).
export function buildStateBackground(pieces, opts = {}) {
  const pathClass = opts.pathClass || 'state-bg-path';
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'state-bg-layer');
  for (const p of pieces) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('class', pathClass + (p.inset ? ' state-bg-inset' : ''));
    g.appendChild(path);
  }
  return g;
}
