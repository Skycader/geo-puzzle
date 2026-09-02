// Builds levels/usaLakes.js — real polygon shapes for the USA level's
// major named lakes (see game-plans.md's "Крупные озёра США" — first pass
// covers the 5 Great Lakes + Great Salt Lake/Tahoe/Mead), projected
// through the EXACT same Albers projection + normalization as
// scripts/build_usa_level.js/build_usa_places.js so a lake's outline lines
// up with state borders and (today's now-redundant) place dots. Output
// pieces are the same {id, name, ru, cx, cy, bbox, area, d} shape as
// states/seas/countries — `area` is a REAL number computed from the
// projected geometry (Albers Conic Equal-Area preserves area), not a
// nominal placeholder like js/overviewBoard.js's places ever had.
//
// Source: Natural Earth's public-domain ne_10m_lakes layer, pre-filtered
// down to just these 8 (scripts/data/us-major-lakes.geojson, ~140KB
// instead of the full ~5MB/1355-lake world download). To regenerate that
// filtered file from scratch:
//   curl -sL -o ne_10m_lakes.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson
//   (then filter features by .properties.name to the 8 target lakes and
//   write out just those as a FeatureCollection — see git history for the
//   exact one-off filter script used the first time.)
//
// Regenerate: node scripts/build_usa_lakes.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'us-major-lakes.geojson');
const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// ---- same Albers projection as build_usa_level.js/build_usa_places.js ----
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

// ---- re-derive the exact same contiguous-US bbox/scale/margin/shift as
// build_usa_places.js (must match exactly — same source states file, same
// constants — or lakes would drift off their real position relative to
// the state borders already baked into levels/usa.js). ----
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
const GLOBAL_SHIFT_X = 856.7122654651434; // build_usa_level.js's own console.error output
const GLOBAL_SHIFT_Y = 636.0468616448984;
function toCanvasMain([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN + GLOBAL_SHIFT_X, (y - minY) * scale + MARGIN + GLOBAL_SHIFT_Y];
}
const EARTH_RADIUS_KM = 6371;
const kmPerUnit = EARTH_RADIUS_KM / scale; // same formula as build_usa_level.js's own kmPerUnit

// ---- geometry helpers — no antimeridian handling needed (unlike
// build_world_seas.js's), since none of these 8 lakes crosses the date
// line ----
function ringToPath(ring) {
  return (
    'M ' +
    ring
      .map((pt) => {
        const [x, y] = toCanvasMain(pt);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' L ') +
    ' Z'
  );
}
function geometryToPath(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringToPath).join(' ');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly.map(ringToPath).join(' ')).join(' ');
  return '';
}
function geometryBbox(geometry) {
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  forEachRing(geometry, (ring) => {
    for (const pt of ring) {
      const [x, y] = toCanvasMain(pt);
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  });
  return [bx0, by0, bx1, by1];
}
// Shoelace, outer ring only (a hole for a small island inside the lake
// doesn't meaningfully change "how big does this lake read as" — same
// call build_world_seas.js's own ringArea already makes). Native units²,
// -> km² via kmPerUnit² at the call site below — a REAL number, not a
// placeholder: Albers Conic Equal-Area preserves area by construction, so
// shoelace on the PROJECTED coordinates gives an accurate real-world
// figure, the same technique states' own `area` field already uses (see
// build_usa_level.js).
function ringArea(ring) {
  const pts = ring.map(toCanvasMain);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
function geometryArea(geometry) {
  if (geometry.type === 'Polygon') return ringArea(geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((sum, poly) => sum + ringArea(poly[0]), 0);
  return 0;
}
// True area-weighted polygon centroid (not a bbox midpoint) — several of
// these lakes are elongated/irregular enough (Michigan, Erie, Huron's
// Georgian Bay appendage) that a bbox-center label point could land near
// shore rather than actually inside the lake. Outer ring only, same
// reasoning as ringArea above.
function ringCentroid(ring) {
  const pts = ring.map(toCanvasMain);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}
function geometryCentroid(geometry) {
  // Largest ring by area, same "avoid landing in a gap between multiple
  // parts" reasoning as build_countries_level.js's dominantPartCentroid —
  // in practice all 8 of these are a single Polygon, not MultiPolygon.
  if (geometry.type === 'Polygon') return ringCentroid(geometry.coordinates[0]);
  let best = null, bestArea = -1;
  for (const poly of geometry.coordinates) {
    const a = ringArea(poly[0]);
    if (a > bestArea) { bestArea = a; best = poly[0]; }
  }
  return ringCentroid(best);
}

const IDS = {
  'Lake Superior': 'lake_superior',
  'Lake Michigan': 'lake_michigan',
  'Lake Huron': 'lake_huron',
  'Lake Erie': 'lake_erie',
  'Lake Ontario': 'lake_ontario',
  'Great Salt Lake': 'great_salt_lake',
  'Lake Tahoe': 'lake_tahoe',
  'Lake Mead': 'lake_mead',
};
// Natural Earth's own name_ru is already correct/idiomatic for every one
// of these 8 (verified against the same RU Wikipedia titles used for
// levels/usa/places-info.json's wiki cards) except Lake Superior, where NE
// has "Верхнее озеро" but this game's own places list (and Wikipedia's
// actual article title, "Верхнее (озеро)") uses the shorter "Озеро
// Верхнее" — kept consistent with that existing naming instead.
const RU_OVERRIDE = { 'Lake Superior': 'Озеро Верхнее' };

const lakes = geo.features
  .map((f) => {
    const name = f.properties.name;
    const id = IDS[name];
    if (!id) throw new Error(`Unexpected lake in ${SRC}: ${name} — update IDS or re-filter the source file`);
    const ru = RU_OVERRIDE[name] || f.properties.name_ru || name;
    const centroid = geometryCentroid(f.geometry);
    return {
      id,
      name,
      ru,
      cx: +centroid.x.toFixed(1),
      cy: +centroid.y.toFixed(1),
      bbox: geometryBbox(f.geometry).map((v) => +v.toFixed(1)),
      area: Math.round(geometryArea(f.geometry) * kmPerUnit * kmPerUnit),
      d: geometryToPath(f.geometry),
    };
  })
  .sort((a, b) => b.area - a.area);

console.error(
  'lakes',
  lakes.map((l) => `${l.id}: ${l.area.toLocaleString()} km²`),
);

let out = `// Auto-generated by scripts/build_usa_lakes.js — projects Natural Earth's\n`;
out += `// major-lakes layer with the exact same Albers projection + normalization\n`;
out += `// as scripts/build_usa_level.js/build_usa_places.js, so these line up with\n`;
out += `// levels/usa.js. \`area\` is real (computed from the projected geometry, not\n`;
out += `// a placeholder).\n`;
out += `// Regenerate: node scripts/build_usa_lakes.js\n`;
out += `export default [\n`;
for (const l of lakes) {
  out += `  {\n`;
  out += `    id: '${l.id}',\n`;
  out += `    name: '${l.name.replace(/'/g, "\\'")}',\n`;
  out += `    ru: '${l.ru.replace(/'/g, "\\'")}',\n`;
  out += `    cx: ${l.cx},\n`;
  out += `    cy: ${l.cy},\n`;
  out += `    bbox: [${l.bbox.join(', ')}],\n`;
  out += `    area: ${l.area},\n`;
  out += `    d: '${l.d}',\n`;
  out += `  },\n`;
}
out += `];\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaLakes.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
