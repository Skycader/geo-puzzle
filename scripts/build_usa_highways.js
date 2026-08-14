// Builds the "Шоссе" overlay layer for the USA level — the 71 primary
// Interstates (1-2 digit route numbers; the hundreds of 3-digit auxiliary
// loops/spurs are deliberately excluded, same "just the backbone, not
// every last bypass" scope the user asked for). Overview mode only, for
// now — see js/overviewBoard.js.
//
// Source: Natural Earth's public-domain ne_10m_roads, pre-filtered down to
// scripts/data/usa-interstates.geojson (sov_a3==='USA', type==='Major
// Highway', level==='Interstate', name matching /^\d{1,2}$/ — that last
// filter is what actually separates "I-90" from a 3-digit auxiliary route
// AND from a same-numbered non-interstate "Major Highway" like US Route 50
// (level: 'Federal', not 'Interstate' — confirmed no "50"/"60" survive
// this filter, matching the real Interstate System's well-known numbering
// gap). Regenerate the source extract itself only if ne_10m_roads.geojson
// is re-downloaded; this script just projects what's already there.
//
// Coverage caveat: Natural Earth's 10m roads layer doesn't have complete,
// current Interstate coverage — this extract has 59 of the real 71 (some
// newer/shorter routes like I-2, I-22, I-41, I-73 aren't present in the
// source data at all). Good enough for a first pass; filling the rest
// would need a different, heavier data source (e.g. US Census TIGER/Line).
//
// Regenerate: node scripts/build_usa_highways.js
const fs = require('fs');
const path = require('path');

const STATES_SRC = path.join(__dirname, 'data', 'us-states.geojson');
const HIGHWAYS_SRC = path.join(__dirname, 'data', 'usa-interstates.geojson');
const geo = JSON.parse(fs.readFileSync(STATES_SRC, 'utf8'));
const highways = JSON.parse(fs.readFileSync(HIGHWAYS_SRC, 'utf8'));

// ---- re-derive the exact same contiguous-US bbox/scale/margin as
// build_usa_level.js (and build_usa_cities.js/build_usa_places.js) — must
// match exactly or these lines land offset from the real state borders.
const deg2rad = (d) => (d * Math.PI) / 180;
const phi1 = deg2rad(29.5);
const phi2 = deg2rad(45.5);
const phi0 = deg2rad(23);
const lambda0 = deg2rad(-96);
const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;
function albers([lon, lat]) {
  const lambda = deg2rad(lon);
  const phi = deg2rad(lat);
  const theta = n * (lambda - lambda0);
  const rho = Math.sqrt(C - 2 * n * Math.sin(phi)) / n;
  const x = rho * Math.sin(theta);
  const y = rho0 - rho * Math.cos(theta);
  return [x, -y];
}
function forEachRing(geometry, fn) {
  if (geometry.type === 'Polygon') geometry.coordinates.forEach((ring) => fn(ring));
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach((ring) => fn(ring)));
}
const SKIP = new Set(['Puerto Rico', 'District of Columbia', 'Alaska', 'Hawaii']);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of geo.features) {
  if (SKIP.has(f.properties.name)) continue;
  forEachRing(f.geometry, (ring) => {
    for (const pt of ring.map(albers)) {
      const [x, y] = pt;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
}
const TARGET_W = 960;
const scale = TARGET_W / (maxX - minX);
const MARGIN = 3; // must match build_usa_level.js's own MARGIN exactly
function toCanvas([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN, (y - minY) * scale + MARGIN];
}

// ---- project + group by route number ----
// One <path> per highway (all its segments as separate M..L subpaths, no
// Z — these are open lines, not closed shapes) rather than one per
// segment: 59 DOM elements instead of 1001.
const byNumber = new Map(); // name -> { subpaths: string[], lengthKm, bbox, rawPoints }
function addLine(coords, name, lengthKm) {
  const pts = coords.map(toCanvas);
  if (pts.length < 2) return;
  const d = 'M ' + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ');
  if (!byNumber.has(name)) byNumber.set(name, { subpaths: [], lengthKm: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity], rawPoints: [] });
  const entry = byNumber.get(name);
  entry.subpaths.push(d);
  entry.lengthKm += lengthKm || 0;
  entry.rawPoints.push(...pts);
  for (const [x, y] of pts) {
    entry.bbox[0] = Math.min(entry.bbox[0], x);
    entry.bbox[1] = Math.min(entry.bbox[1], y);
    entry.bbox[2] = Math.max(entry.bbox[2], x);
    entry.bbox[3] = Math.max(entry.bbox[3], y);
  }
}
// Candidate points for placing the shield icon at runtime (see
// overviewBoard.js's _updateHighwayShields — it tests each of these
// against the current visible rect and picks whichever qualifying one is
// closest to the view's center, so a shield is always somewhere near the
// middle of whatever stretch of the highway is on screen). Decimated —
// I-90 alone has ~600 raw vertices, and shield placement doesn't need
// anywhere near that density, just enough candidates that some point is
// always reasonably close to wherever the camera happens to be.
const MAX_SHIELD_CANDIDATES = 40;
function decimate(pts, maxPoints) {
  if (pts.length <= maxPoints) return pts;
  const stride = pts.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(pts[Math.floor(i * stride)]);
  return out;
}
for (const f of highways.features) {
  const { name, length_km } = f.properties;
  if (f.geometry.type === 'LineString') addLine(f.geometry.coordinates, name, length_km);
  else if (f.geometry.type === 'MultiLineString') for (const line of f.geometry.coordinates) addLine(line, name, length_km);
}

// Sorted numerically ("2" before "10") rather than the default
// alphabetical string sort — purely cosmetic (output order), doesn't
// affect rendering, but makes the generated file/console output easier to
// scan by hand.
const routes = [...byNumber.entries()]
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([number, e]) => ({
    id: `i${number}`,
    number, // "90" — rendered as "I-90" in the UI, kept bare here since
    // that's how the source data has it and how a future label would need
    // to build "I-" + number for the ru vs number-only for the tooltip
    d: e.subpaths.join(' '),
    lengthKm: Math.round(e.lengthKm),
    bbox: e.bbox.map((v) => +v.toFixed(1)),
    points: decimate(e.rawPoints, MAX_SHIELD_CANDIDATES).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]),
  }));

console.error('interstates:', routes.length);
console.error(routes.map((r) => `I-${r.number} (${r.lengthKm} km)`).join(', '));

let out = `// Auto-generated by scripts/build_usa_highways.js from Natural Earth's\n`;
out += `// public-domain 10m roads layer, filtered to the primary (1-2 digit)\n`;
out += `// Interstate System routes. See the build script's own comments for\n`;
out += `// the filtering rules and known coverage gaps.\n`;
out += `// Regenerate: node scripts/build_usa_highways.js\n`;
out += `export default ${JSON.stringify(routes, null, 2)};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaHighways.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
