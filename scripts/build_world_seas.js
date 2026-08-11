// Builds the "Моря и океаны" level: projects Natural Earth's public-domain
// 110m marine-areas layer (scripts/data/world-marine-polys.geojson) onto a
// simple equirectangular world map, in the same {id, ru, name, cx, cy, bbox,
// d} piece shape as levels/usa.js's states — so the two new sea game modes
// (js/seaIdentifyBoard.js, js/seaQuizBoard.js) can reuse identifyStateBoard.js's
// /quizBoard.js's logic almost unchanged, just pointed at this level's
// `pieces` instead.
//
// `land` is the country-boundary layer (scripts/data/world-countries-simplified.geojson
// — Natural Earth's most detailed 10m admin-0 countries, mapshaper-simplified
// ~9% to keep file size reasonable — see scripts/data/README below) built in
// the SAME rich {id, name, ru, cx, cy, bbox, area, d} piece shape as `pieces`,
// not just {id, d}: today it's only used as non-interactive background
// context (js/mapBackground.js's buildStateBackground, called from
// js/seaQuizBoard.js and js/seaIdentifyBoard.js), but carrying full country
// identity data means a future "countries" level/mode can reuse `level.land`
// directly as its own `pieces` array, the same way this file already reuses
// levels/usa.js's shape.
//
// To regenerate the simplified country source from scratch:
//   curl -sL -o world-countries-10m.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//   npx mapshaper world-countries-10m.geojson -simplify 8% keep-shapes -clean -o world-countries-simplified.geojson
// (the raw 10m download is ~13MB and isn't kept in the repo — only its
// ~2MB simplified output is — so re-download it first if regenerating)
// Then: node scripts/build_world_seas.js
const fs = require('fs');
const path = require('path');

const MARINE_SRC = path.join(__dirname, 'data', 'world-marine-polys.geojson');
const LAND_SRC = path.join(__dirname, 'data', 'world-countries-simplified.geojson');
const marine = JSON.parse(fs.readFileSync(MARINE_SRC, 'utf8'));
const land = JSON.parse(fs.readFileSync(LAND_SRC, 'utf8'));

// Equirectangular (x=lon, y=-lat) — deliberately simpler than Mercator: one
// multiply-and-add per axis, no trig, no pole-singularity to guard against.
// The tradeoff is real but acceptable for a casual quiz, not a scientific
// tool: longitude spacing is compressed at high latitudes in real life but
// NOT in this projection, so shapes near the poles (Arctic/Southern Ocean)
// read visually wider than true-to-life, and a single kmPerUnit constant
// (below, derived from the EQUATOR's km-per-degree) will overstate real
// distances at high latitudes for the same reason — same class of
// simplification the project already accepts elsewhere (e.g. neighborBoard.js's
// approximate border-glow) rather than a scientific-grade projection.
const SCALE = 3.2; // native units per degree
function project(lon, lat) {
  return [(lon + 180) * SCALE, (90 - lat) * SCALE];
}
const CANVAS_W = 360 * SCALE;
const CANVAS_H = 180 * SCALE;
const KM_PER_DEGREE_AT_EQUATOR = 111.32;
const KM_PER_UNIT = KM_PER_DEGREE_AT_EQUATOR / SCALE;

function ringToPath(ring) {
  return (
    'M ' +
    ring.map(([lon, lat]) => project(lon, lat).map((n) => n.toFixed(2)).join(',')).join(' L ') +
    ' Z'
  );
}
function geometryToPath(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringToPath).join(' ');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly.map(ringToPath).join(' ')).join(' ');
  return '';
}
function geometryBbox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visitRing = (ring) => {
    for (const [lon, lat] of ring) {
      const [x, y] = project(lon, lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(visitRing);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach(visitRing));
  return [minX, minY, maxX, maxY];
}
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Shoelace, outer ring only (ignores any holes — negligible for a "sort by
// size" column, not a scientific figure) — native unit², converted to km²
// by the caller via KM_PER_UNIT². Same formula as js/utils.js's
// polygonArea (kept inline here rather than imported since this script
// runs under plain Node/CommonJS, not as an ES module like the app code).
function ringArea(ring) {
  const pts = ring.map(([lon, lat]) => project(lon, lat));
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

// The 110m marine layer splits the Pacific and Atlantic into north/south
// halves (both halves share one Russian name in the data, e.g. both
// "North Pacific Ocean" and "South Pacific Ocean" -> "Тихий океан") —
// merged here into one piece each so every piece has a genuinely unique
// name, matching every other entity in this game.
const MERGE_INTO = {
  'North Pacific Ocean': { id: 'pacific_ocean', name: 'Pacific Ocean', ru: 'Тихий океан' },
  'South Pacific Ocean': { id: 'pacific_ocean', name: 'Pacific Ocean', ru: 'Тихий океан' },
  'North Atlantic Ocean': { id: 'atlantic_ocean', name: 'Atlantic Ocean', ru: 'Атлантический океан' },
  'South Atlantic Ocean': { id: 'atlantic_ocean', name: 'Atlantic Ocean', ru: 'Атлантический океан' },
};

const merged = new Map(); // id -> { id, name, ru, dParts: [], bbox, nativeArea }
for (const f of marine.features) {
  const p = f.properties;
  const target = MERGE_INTO[p.name] || { id: slugify(p.name_en || p.name), name: p.name_en || p.name, ru: p.name_ru };
  const d = geometryToPath(f.geometry);
  const bbox = geometryBbox(f.geometry);
  const area = geometryArea(f.geometry);
  if (!merged.has(target.id)) {
    merged.set(target.id, { id: target.id, name: target.name, ru: target.ru, dParts: [], bbox: [Infinity, Infinity, -Infinity, -Infinity], nativeArea: 0 });
  }
  const entry = merged.get(target.id);
  entry.dParts.push(d);
  entry.nativeArea += area;
  entry.bbox[0] = Math.min(entry.bbox[0], bbox[0]);
  entry.bbox[1] = Math.min(entry.bbox[1], bbox[1]);
  entry.bbox[2] = Math.max(entry.bbox[2], bbox[2]);
  entry.bbox[3] = Math.max(entry.bbox[3], bbox[3]);
}

const pieces = [...merged.values()].map((e) => {
  const [minX, minY, maxX, maxY] = e.bbox;
  return {
    id: e.id,
    name: e.name,
    ru: e.ru,
    cx: +((minX + maxX) / 2).toFixed(1),
    cy: +((minY + maxY) / 2).toFixed(1),
    bbox: e.bbox.map((n) => +n.toFixed(1)),
    area: Math.round(e.nativeArea * KM_PER_UNIT * KM_PER_UNIT),
    d: e.dParts.join(' '),
  };
});

// Countries — visual context behind the sea shapes today, but built as full
// {id, name, ru, cx, cy, bbox, area, d} pieces (see header comment) for
// future reuse. ISO_A3 is missing/-99 for ~20 disputed or dependent
// territories (e.g. Kosovo, N. Cyprus, France's ADM0 split) — slugify(NAME)
// covers those, with an index suffix in the rare case two features would
// otherwise collide.
const seenLandIds = new Set();
const landPieces = land.features.map((f, i) => {
  const p = f.properties;
  let id = p.ISO_A3 && p.ISO_A3 !== '-99' ? p.ISO_A3.toLowerCase() : slugify(p.NAME_LONG || p.NAME);
  if (seenLandIds.has(id)) id = `${id}_${i}`;
  seenLandIds.add(id);
  const bbox = geometryBbox(f.geometry);
  const [minX, minY, maxX, maxY] = bbox;
  return {
    id,
    name: p.NAME_LONG || p.NAME,
    ru: p.NAME_RU || p.NAME,
    cx: +((minX + maxX) / 2).toFixed(1),
    cy: +((minY + maxY) / 2).toFixed(1),
    bbox: bbox.map((n) => +n.toFixed(1)),
    area: Math.round(geometryArea(f.geometry) * KM_PER_UNIT * KM_PER_UNIT),
    d: geometryToPath(f.geometry),
  };
});

console.error('seas/oceans:', pieces.length, pieces.map((p) => p.ru).join(', '));
console.error('countries:', landPieces.length);

let out = `// Auto-generated by scripts/build_world_seas.js — projects Natural Earth's\n`;
out += `// public-domain 110m marine-areas layer and 10m admin-0 countries layer\n`;
out += `// (mapshaper-simplified) onto a simple equirectangular world map. See the\n`;
out += `// build script's own comments for the projection tradeoffs (kmPerUnit is\n`;
out += `// an equator-based approximation, not exact at high latitudes).\n`;
out += `// Regenerate: node scripts/build_world_seas.js\n`;
out += `const pieces = ${JSON.stringify(pieces, null, 2)};\n\n`;
out += `const land = ${JSON.stringify(landPieces, null, 2)};\n\n`;
out += `export default {\n`;
out += `  id: 'world',\n`;
out += `  title: 'Моря и океаны',\n`;
out += `  subtitle: '${pieces.length} морей и океанов',\n`;
out += `  canvas: { width: ${CANVAS_W}, height: ${CANVAS_H} },\n`;
out += `  kmPerUnit: ${KM_PER_UNIT},\n`;
out += `  pieces,\n`;
out += `  land,\n`;
out += `  cities: [],\n`;
out += `  places: [],\n`;
out += `};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'world.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
