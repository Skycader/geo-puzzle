const SVG_NS = 'http://www.w3.org/2000/svg';

// Non-interactive state-outline layer used as geographic context behind
// city markers — shared by the city quiz and pin-placement boards.
export function buildStateBackground(pieces) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'state-bg-layer');
  for (const p of pieces) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('class', 'state-bg-path' + (p.inset ? ' state-bg-inset' : ''));
    g.appendChild(path);
  }
  return g;
}
