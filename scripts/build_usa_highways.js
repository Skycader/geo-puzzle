// Builds the "Шоссе" overlay layer for the USA level — the primary (1-2
// digit route number) Interstates. Overview mode only, for now — see
// js/overviewBoard.js.
//
// Source: US Census Bureau TIGER/Line 2023 "Primary Roads, National"
// shapefile (public domain, official government data) — NOT Natural
// Earth's ne_10m_roads, which this project used at first but turned out to
// have real, large (tens to hundreds of km) missing stretches in the
// middle of otherwise-continuous Interstates (confirmed for I-35 between
// Fort Worth and Waco, TX, among others — a road doesn't just end in the
// desert, that was a genuine hole in the source data, not a real-world
// gap). TIGER is the Census Bureau's own topologically-built national road
// network, so same-numbered segments actually meet at shared endpoints
// (small — sub-km — offsets remain here and there, from parallel divided-
// carriageway centerlines and business-loop spurs sharing a route number,
// but nothing on the old scale).
//
// Pipeline (already run once, see scripts/data/ for the result — redo only
// if the raw TIGER file is re-downloaded):
//   1. Download https://www2.census.gov/geo/tiger/TIGER2023/PRIMARYROADS/tl_2023_us_primaryroads.zip
//      and unzip into scripts/data/tl_2023_us_primaryroads/
//   2. npx mapshaper -i scripts/data/tl_2023_us_primaryroads/tl_2023_us_primaryroads.shp -proj wgs84 -o format=geojson precision=0.0001 scripts/data/tl_primaryroads_full.geojson
//      (the shapefile's own .prj is NAD83 geographic, not quite WGS84, but
//      the difference is centimeter-scale — irrelevant at this map's
//      resolution — so `-proj wgs84` is a safe, close-enough reprojection)
//   3. npx mapshaper -i scripts/data/tl_primaryroads_full.geojson -filter 'RTTYP == "I"' -simplify 1% -o format=geojson precision=0.0001 scripts/data/tl_interstates_filtered.geojson force
//      (1% was chosen by hand, same reasoning as scripts/build_usa_terrain.js's
//      2% — TIGER's raw intersection-level vertex density is far beyond
//      what this map's ~960-unit-wide canvas can show; this keeps the
//      final output around 1MB instead of several, with no visible loss)
//
// Only scripts/data/tl_interstates_filtered.geojson (the filtered, ~4.5MB
// result) is checked into the repo — the 38MB raw zip, the unzipped
// shapefile, and the 69MB whole-country intermediate from step 2 are NOT,
// same "keep only the pre-filtered result" convention as every other big
// source dataset this project uses (e.g. scripts/build_usa_terrain.js's
// na-ecoregions-*.geojson).
//
// Regenerate: node scripts/build_usa_highways.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'tl_interstates_filtered.geojson');
const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));

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
const STATES_SRC = path.join(__dirname, 'data', 'us-states.geojson');
const statesGeo = JSON.parse(fs.readFileSync(STATES_SRC, 'utf8'));
const SKIP = new Set(['Puerto Rico', 'District of Columbia', 'Alaska', 'Hawaii']);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of statesGeo.features) {
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
// Shifts the WHOLE canvas so Alaska/Canada/Hawaii (now at their true
// position, not a corner inset) don't land negative — exact value from
// build_usa_level.js's own console.error output; must match exactly or
// highway lines drift off the (also-shifted) state borders.
const GLOBAL_SHIFT_X = 856.7122654651434;
const GLOBAL_SHIFT_Y = 715.4619231706608;
function toCanvas([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN + GLOBAL_SHIFT_X, (y - minY) * scale + MARGIN + GLOBAL_SHIFT_Y];
}

// Great-circle distance (km) between two [lon,lat] points — TIGER's dbf
// has no pre-computed length field (unlike Natural Earth's `length_km`),
// so this is summed over each segment's own vertices instead.
//
// Known quirk: divided highways are often TWO separate near-parallel
// LineStrings in TIGER (one per direction of travel), both carrying the
// same route number — this sums both, so the resulting lengthKm typically
// comes out close to 2x the real one-way mileage. Left as-is: nothing in
// js/ actually reads lengthKm today (grep confirms), and de-duplicating
// near-coincident parallel lines well enough to trust the number again
// isn't worth the complexity for a value nothing displays.
const EARTH_RADIUS_KM = 6371;
function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function lineLengthKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return km;
}

// TIGER's FULLNAME is free text, not a clean route-number field — variants
// seen in this file include "I- 20", "W I- 20" (directional/business-loop
// prefix), "I- 35E"/"I- 35W" (parallel one-way-ish carriageways through
// Dallas-Fort Worth, merged under plain "35" here same as everything else
// with a matching digit run — same simplification the original Natural
// Earth-based version already made). Only 1-2 digit results are kept —
// 3-digit auxiliary loops/spurs are deliberately out of scope, same as
// before.
function routeNumber(fullname) {
  const m = fullname.match(/I-?\s*(\d+)/);
  return m ? m[1] : null;
}

// ---- project + group by route number ----
// One <path> per highway (all its segments as separate M..L subpaths, no
// Z — these are open lines, not closed shapes) rather than one per
// segment — TIGER splits each Interstate into far more pieces than Natural
// Earth did (intersection-by-intersection), so this matters even more now.
const byNumber = new Map(); // number -> { subpaths: string[], lengthKm, bbox, rawPoints }
function addLine(coords, number) {
  const pts = coords.map(toCanvas);
  if (pts.length < 2) return;
  const d = 'M ' + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ');
  if (!byNumber.has(number)) byNumber.set(number, { subpaths: [], lengthKm: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity], rawPoints: [] });
  const entry = byNumber.get(number);
  entry.subpaths.push(d);
  entry.lengthKm += lineLengthKm(coords);
  entry.rawPoints.push(...pts);
  for (const [x, y] of pts) {
    entry.bbox[0] = Math.min(entry.bbox[0], x);
    entry.bbox[1] = Math.min(entry.bbox[1], y);
    entry.bbox[2] = Math.max(entry.bbox[2], x);
    entry.bbox[3] = Math.max(entry.bbox[3], y);
  }
}
// Candidate points for placing the shield icon at runtime (see
// overviewBoard.js's _updateHighwayShields). Decimated — some routes have
// thousands of raw vertices now (TIGER's intersection-level granularity),
// shield placement doesn't need anywhere near that density.
const MAX_SHIELD_CANDIDATES = 40;
function decimate(pts, maxPoints) {
  if (pts.length <= maxPoints) return pts;
  const stride = pts.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(pts[Math.floor(i * stride)]);
  return out;
}

let skippedNoMatch = 0, skippedLong = 0;
for (const f of geo.features) {
  if (!f.geometry) continue;
  const number = routeNumber(f.properties.FULLNAME || '');
  if (!number) { skippedNoMatch++; continue; }
  if (!/^\d{1,2}$/.test(number)) { skippedLong++; continue; }
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
  for (const line of lines) addLine(line, number);
}
console.error('skipped (no route number match):', skippedNoMatch, '| skipped (3+ digit auxiliary):', skippedLong);

// Sorted numerically ("2" before "10") rather than the default
// alphabetical string sort — purely cosmetic (output order), doesn't
// affect rendering, but makes the generated file/console output easier to
// scan by hand.
const routes = [...byNumber.entries()]
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([number, e]) => ({
    id: `i${number}`,
    number, // "90" — rendered as "I-90" in the UI, kept bare here since
    // that's how a future label would need to build "I-" + number for the
    // ru vs number-only for the tooltip
    d: e.subpaths.join(' '),
    lengthKm: Math.round(e.lengthKm),
    bbox: e.bbox.map((v) => +v.toFixed(1)),
    points: decimate(e.rawPoints, MAX_SHIELD_CANDIDATES).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]),
  }));

console.error('interstates:', routes.length);
console.error(routes.map((r) => `I-${r.number} (${r.lengthKm} km)`).join(', '));

let out = `// Auto-generated by scripts/build_usa_highways.js from the US Census\n`;
out += `// Bureau's public-domain TIGER/Line Primary Roads national shapefile,\n`;
out += `// filtered to Interstate routes with a 1-2 digit number. See the build\n`;
out += `// script's own comments for the filtering rules and why this replaced\n`;
out += `// an earlier Natural Earth-based version.\n`;
out += `// Regenerate: node scripts/build_usa_highways.js\n`;
out += `export default ${JSON.stringify(routes, null, 2)};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaHighways.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
