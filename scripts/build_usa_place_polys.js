// Builds levels/usaPlacePolys.js — real polygon shapes for areal "places"
// (mountain ranges, national parks) that used to be dishonest point pins.
// Same Albers projection + normalization as scripts/build_usa_lakes.js /
// build_usa_places.js so outlines line up with state borders.
//
// Source: scripts/data/us-place-polys.geojson (filtered + clipped-to-US-land
// Natural Earth — regenerate via scripts/filter_usa_place_polys.js).
//
// Regenerate: node scripts/filter_usa_place_polys.js && node scripts/build_usa_place_polys.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'us-place-polys.geojson');
const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));

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
let minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity;
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
const MARGIN = 3;
const GLOBAL_SHIFT_X = 856.7122654651434;
const GLOBAL_SHIFT_Y = 636.0468616448984;
function toCanvasMain([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN + GLOBAL_SHIFT_X, (y - minY) * scale + MARGIN + GLOBAL_SHIFT_Y];
}
const EARTH_RADIUS_KM = 6371;
const kmPerUnit = EARTH_RADIUS_KM / scale;

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
  let bx0 = Infinity,
    by0 = Infinity,
    bx1 = -Infinity,
    by1 = -Infinity;
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
function ringCentroid(ring) {
  const pts = ring.map(toCanvasMain);
  let a = 0,
    cx = 0,
    cy = 0;
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
  if (geometry.type === 'Polygon') return ringCentroid(geometry.coordinates[0]);
  let best = null,
    bestArea = -1;
  for (const poly of geometry.coordinates) {
    const a = ringArea(poly[0]);
    if (a > bestArea) {
      bestArea = a;
      best = poly[0];
    }
  }
  return ringCentroid(best);
}

// Hand-built ocean polygon — not in Natural Earth, and must NOT be clipped
// to US land (filter_usa_place_polys.js). Classic vertices from the Russian
// Wikipedia blurb / places-info.json: Miami, Bermuda, San Juan (PR).
const HAND_FEATURES = [
  {
    type: 'Feature',
    properties: {
      id: 'bermuda_triangle',
      name: 'Bermuda Triangle',
      ru: 'Бермудский треугольник',
      kind: 'range', // violet place-poly wash (not a park)
    },
    geometry: {
      type: 'Polygon',
      // Closed ring, lon/lat. CW to match other USA place-polys' fill winding.
      coordinates: [
        [
          [-80.1918, 25.7617], // Miami
          [-64.7505, 32.3078], // Bermuda
          [-66.1057, 18.4655], // San Juan
          [-80.1918, 25.7617],
        ],
      ],
    },
  },
];

const places = [...geo.features, ...HAND_FEATURES]
  .map((f) => {
    const { id, name, ru, kind } = f.properties;
    if (!id || !name || !ru || !kind) throw new Error(`Bad place-poly feature props: ${JSON.stringify(f.properties)}`);
    const centroid = geometryCentroid(f.geometry);
    return {
      id,
      name,
      ru,
      kind, // 'range' | 'park' — overview style fork
      cx: +centroid.x.toFixed(1),
      cy: +centroid.y.toFixed(1),
      bbox: geometryBbox(f.geometry).map((v) => +v.toFixed(1)),
      area: Math.round(geometryArea(f.geometry) * kmPerUnit * kmPerUnit),
      d: geometryToPath(f.geometry),
    };
  })
  .sort((a, b) => b.area - a.area);

console.error(
  'place polys',
  places.map((p) => `${p.id} (${p.kind}): ${p.area.toLocaleString()} km²`),
);

let out = `// Auto-generated by scripts/build_usa_place_polys.js — areal places\n`;
out += `// (ranges/parks) from Natural Earth, same Albers projection as\n`;
out += `// scripts/build_usa_lakes.js / build_usa_places.js.\n`;
out += `// Regenerate: node scripts/filter_usa_place_polys.js && node scripts/build_usa_place_polys.js\n`;
out += `export default [\n`;
for (const p of places) {
  out += `  {\n`;
  out += `    id: '${p.id}',\n`;
  out += `    name: '${p.name.replace(/'/g, "\\'")}',\n`;
  out += `    ru: '${p.ru.replace(/'/g, "\\'")}',\n`;
  out += `    kind: '${p.kind}',\n`;
  out += `    cx: ${p.cx},\n`;
  out += `    cy: ${p.cy},\n`;
  out += `    bbox: [${p.bbox.join(', ')}],\n`;
  out += `    area: ${p.area},\n`;
  out += `    d: '${p.d}',\n`;
  out += `  },\n`;
}
out += `];\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaPlacePolys.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
