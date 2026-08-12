// Converts a board's native canvas coordinates back to real longitude/
// latitude — used by overviewBoard.js's right-click context menu (shows
// the clicked point's coordinates, and feeds "Открыть в Google Maps"/
// "Скопировать координаты"). Every level uses a different projection, so
// this dispatches by level.id rather than assuming one formula fits all.

const KM_PER_DEGREE_AT_EQUATOR = 111.32;

// levels/world.js and levels/countries.js: simple equirectangular
// (x=lon, y=-lat), same formula scripts/build_world_seas.js's/
// build_countries_level.js's own `project()` uses, just inverted. SCALE
// (native units per degree) isn't stored directly, but it's recoverable
// exactly from kmPerUnit — that's literally how kmPerUnit was derived in
// the first place (kmPerUnit = KM_PER_DEGREE_AT_EQUATOR / SCALE).
function equirectInverse(level, x, y) {
  const scale = KM_PER_DEGREE_AT_EQUATOR / level.kmPerUnit;
  return { lon: x / scale - 180, lat: 90 - y / scale };
}

// levels/usa.js's Alaska/Hawaii insets: independent simple projection,
// not the main Albers one — see scripts/build_usa_level.js's buildInset.
// Inverts: x = (lon-lonMin)*cosLat*s + offsetX; y = (latMax-lat)*s + offsetY.
function insetInverse(projection, x, y) {
  const { lonMin, latMax, cosLat, s, offsetX, offsetY } = projection;
  return { lon: (x - offsetX) / (cosLat * s) + lonMin, lat: latMax - (y - offsetY) / s };
}

// levels/usa.js's main Albers equal-area conic (48 contiguous states +
// DC) — see scripts/build_usa_level.js's `albers()`/`toCanvas()` for the
// forward direction this inverts. Standard Snyder inverse formulas;
// n/C/rho0 are re-derived from the same phi1/phi2/phi0 the forward
// projection used (deterministic, no data dependency — only
// minX/minY/scale actually depend on the real projected state geometry,
// which is why those ARE stored rather than re-derived).
function albersInverse(projection, x, y) {
  const { minX, minY, scale, marginPx, phi1Deg, phi2Deg, phi0Deg, lambda0Deg } = projection;
  const deg2rad = (d) => (d * Math.PI) / 180;
  const phi1 = deg2rad(phi1Deg);
  const phi2 = deg2rad(phi2Deg);
  const phi0 = deg2rad(phi0Deg);
  const lambda0 = deg2rad(lambda0Deg);
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
  const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;

  const ax = (x - marginPx) / scale + minX;
  const ayRet = (y - marginPx) / scale + minY; // already-flipped y from the forward projection

  const rhoCosTheta = ayRet + rho0;
  const rho = Math.sqrt(ax * ax + rhoCosTheta * rhoCosTheta);
  const theta = Math.atan2(ax, rhoCosTheta);
  const phi = Math.asin((C - rho * rho * n * n) / (2 * n));
  const lambda = lambda0 + theta / n;
  return { lon: (lambda * 180) / Math.PI, lat: (phi * 180) / Math.PI };
}

// Alaska/Hawaii's insets sit in their own corner of the USA canvas with no
// overlap with the main Albers map or each other — checking against each
// inset piece's own bbox (already stored per-piece) is enough to route a
// click to the right inverse.
function findInset(level, x, y) {
  return level.pieces.find((p) => p.inset && p.projection && x >= p.bbox[0] && x <= p.bbox[2] && y >= p.bbox[1] && y <= p.bbox[3]);
}

// Returns { lon, lat } in decimal degrees, or null if this level has no
// known projection to invert (shouldn't happen for usa/world/countries,
// but fails closed rather than returning nonsense for some future level).
export function nativeToLonLat(level, x, y) {
  if (level.id === 'usa') {
    const inset = findInset(level, x, y);
    if (inset) return insetInverse(inset.projection, x, y);
    if (level.projection?.type === 'albers') return albersInverse(level.projection, x, y);
    return null;
  }
  if (typeof level.kmPerUnit === 'number') return equirectInverse(level, x, y);
  return null;
}

// "41.9028° N, 12.4964° E" style — used for both the context menu's
// header and the clipboard-copy text.
export function formatLonLat({ lon, lat }) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}
