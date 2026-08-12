// One-off build script: turns the public-domain PublicaMundi us-states
// GeoJSON into real state-shaped SVG paths for the puzzle, using a proper
// Albers equal-area conic projection for the 48 contiguous states + DC
// (same projection family real US wall maps use), and independent small
// equirectangular insets for Alaska/Hawaii (standard cartographic
// convention — they're never shown at true relative scale/position).
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'us-states.geojson');
const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const NAME_INFO = {
  'Alabama': ['AL', 'Алабама'],
  'Arizona': ['AZ', 'Аризона'],
  'Arkansas': ['AR', 'Арканзас'],
  'California': ['CA', 'Калифорния'],
  'Colorado': ['CO', 'Колорадо'],
  'Connecticut': ['CT', 'Коннектикут'],
  'Delaware': ['DE', 'Делавэр'],
  'Florida': ['FL', 'Флорида'],
  'Georgia': ['GA', 'Джорджия'],
  'Idaho': ['ID', 'Айдахо'],
  'Illinois': ['IL', 'Иллинойс'],
  'Indiana': ['IN', 'Индиана'],
  'Iowa': ['IA', 'Айова'],
  'Kansas': ['KS', 'Канзас'],
  'Kentucky': ['KY', 'Кентукки'],
  'Louisiana': ['LA', 'Луизиана'],
  'Maine': ['ME', 'Мэн'],
  'Maryland': ['MD', 'Мэриленд'],
  'Massachusetts': ['MA', 'Массачусетс'],
  'Michigan': ['MI', 'Мичиган'],
  'Minnesota': ['MN', 'Миннесота'],
  'Mississippi': ['MS', 'Миссисипи'],
  'Missouri': ['MO', 'Миссури'],
  'Montana': ['MT', 'Монтана'],
  'Nebraska': ['NE', 'Небраска'],
  'Nevada': ['NV', 'Невада'],
  'New Hampshire': ['NH', 'Нью-Гэмпшир'],
  'New Jersey': ['NJ', 'Нью-Джерси'],
  'New Mexico': ['NM', 'Нью-Мексико'],
  'New York': ['NY', 'Нью-Йорк'],
  'North Carolina': ['NC', 'Северная Каролина'],
  'North Dakota': ['ND', 'Северная Дакота'],
  'Ohio': ['OH', 'Огайо'],
  'Oklahoma': ['OK', 'Оклахома'],
  'Oregon': ['OR', 'Орегон'],
  'Pennsylvania': ['PA', 'Пенсильвания'],
  'Rhode Island': ['RI', 'Род-Айленд'],
  'South Carolina': ['SC', 'Южная Каролина'],
  'South Dakota': ['SD', 'Южная Дакота'],
  'Tennessee': ['TN', 'Теннесси'],
  'Texas': ['TX', 'Техас'],
  'Utah': ['UT', 'Юта'],
  'Vermont': ['VT', 'Вермонт'],
  'Virginia': ['VA', 'Виргиния'],
  'Washington': ['WA', 'Вашингтон'],
  'West Virginia': ['WV', 'Западная Виргиния'],
  'Wisconsin': ['WI', 'Висконсин'],
  'Wyoming': ['WY', 'Вайоминг'],
};

const deg2rad = (d) => (d * Math.PI) / 180;

// --- Albers equal-area conic, standard CONUS parameters ---
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
  return [x, -y]; // flip so north is up in SVG (y grows downward)
}

function forEachRing(geometry, fn) {
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => fn(ring));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((poly) => poly.forEach((ring) => fn(ring)));
  }
}

// ---- pass 1: project all contiguous-state rings, find bounding box ----
const contiguous = [];
const insets = {};
for (const f of geo.features) {
  const name = f.properties.name;
  if (name === 'Puerto Rico' || name === 'District of Columbia') continue;
  if (name === 'Alaska' || name === 'Hawaii') {
    insets[name] = f;
    continue;
  }
  if (!NAME_INFO[name]) continue;
  contiguous.push(f);
}

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const projectedRings = new Map(); // name -> array of rings (each ring = array of [x,y])
for (const f of contiguous) {
  const rings = [];
  forEachRing(f.geometry, (ring) => {
    const pr = ring.map(albers);
    rings.push(pr);
    for (const [x, y] of pr) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  projectedRings.set(f.properties.name, rings);
}

const TARGET_W = 960;
const bboxW = maxX - minX;
const bboxH = maxY - minY;
const scale = TARGET_W / bboxW;
const TARGET_H = bboxH * scale;
const MARGIN = 18;

// The Albers formulas above operate on a unit sphere (radius 1), so 1
// projected unit there = 1 Earth radius. `scale` converts those units to
// canvas pixels, so dividing it out gives real km per canvas unit — exact
// along the standard parallels (phi1/phi2), a couple percent off farther
// away, same caveat any conic-projection scale bar has.
const EARTH_RADIUS_KM = 6371;
const kmPerUnit = EARTH_RADIUS_KM / scale;

function toCanvas([x, y]) {
  return [(x - minX) * scale + MARGIN, (y - minY) * scale + MARGIN];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) {
    // degenerate ring, fall back to average of points
    const n2 = ring.length;
    const sx = ring.reduce((s, p) => s + p[0], 0) / n2;
    const sy = ring.reduce((s, p) => s + p[1], 0) / n2;
    return [sx, sy, 0];
  }
  return [cx / (6 * a), cy / (6 * a), Math.abs(a)];
}

function buildPieceFromRings(canvasRings) {
  const d = canvasRings
    .map((ring) => 'M ' + ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ') + ' Z')
    .join(' ');

  let totalArea = 0, cx = 0, cy = 0;
  let netArea = 0; // signed sum — unlike totalArea above, holes (opposite winding) subtract instead of adding
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const ring of canvasRings) {
    const [rcx, rcy, area] = ringCentroid(ring);
    totalArea += area;
    netArea += ringArea(ring);
    cx += rcx * area;
    cy += rcy * area;
    for (const [x, y] of ring) {
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  if (totalArea > 0) {
    cx /= totalArea;
    cy /= totalArea;
  } else {
    cx = (bx0 + bx1) / 2;
    cy = (by0 + by1) / 2;
  }
  return { d, cx, cy, bbox: [bx0, by0, bx1, by1], areaNative: Math.abs(netArea) };
}

const pieces = [];
for (const f of contiguous) {
  const name = f.properties.name;
  const [abbr, ru] = NAME_INFO[name];
  const rings = projectedRings.get(name).map((ring) => ring.map(toCanvas));
  const piece = buildPieceFromRings(rings);
  const area = +(piece.areaNative * kmPerUnit * kmPerUnit).toFixed(1);
  pieces.push({ id: abbr, name, ru, ...piece, area });
}

// ---- Alaska / Hawaii: independent equirectangular insets ----
function buildInset(feature, targetW, targetH, offsetX, offsetY) {
  const rings = [];
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  forEachRing(feature.geometry, (ring) => {
    const fixed = ring.map(([lon, lat]) => {
      const l = lon > 0 ? lon - 360 : lon; // unwrap Aleutians crossing antimeridian
      return [l, lat];
    });
    rings.push(fixed);
    for (const [lon, lat] of fixed) {
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    }
  });
  const midLat = (latMin + latMax) / 2;
  const cosLat = Math.cos(deg2rad(midLat));
  const w = (lonMax - lonMin) * cosLat;
  const h = latMax - latMin;
  const s = Math.min(targetW / w, targetH / h);
  const drawW = w * s;
  const drawH = h * s;
  const padX = (targetW - drawW) / 2;
  const padY = (targetH - drawH) / 2;

  function project([lon, lat]) {
    const x = (lon - lonMin) * cosLat * s + offsetX + padX;
    const y = (latMax - lat) * s + offsetY + padY;
    return [x, y];
  }

  const canvasRings = rings.map((ring) => ring.map(project));
  // Projection constants exposed alongside the piece — js/geoCoords.js's
  // browser-side inverse (right-click "coordinates" context menu) needs
  // these to convert a click back to lon/lat for anything landing inside
  // this inset's own bbox, which uses this simple formula, not the main
  // Albers one below.
  const projection = { lonMin, cosLat, s, offsetX: offsetX + padX, offsetY: offsetY + padY, latMax };
  return { ...buildPieceFromRings(canvasRings), projection };
}

const INSET_Y = TARGET_H + 40;
const akPiece = buildInset(insets['Alaska'], 230, 150, 10, INSET_Y);
const hiPiece = buildInset(insets['Hawaii'], 150, 90, 270, INSET_Y + 60);

// AK/HI sit in their own independent inset projections (see buildInset)
// with no consistent km-per-canvas-unit scale of their own, so kmPerUnit
// (calibrated for the main Albers projection) can't convert their
// areaNative — using the standard US Census total-area figures instead.
const INSET_AREA_KM2 = { AK: 1723337, HI: 28313 };

pieces.push({ id: 'AK', name: 'Alaska', ru: 'Аляска', inset: true, ...akPiece, area: INSET_AREA_KM2.AK });
pieces.push({ id: 'HI', name: 'Hawaii', ru: 'Гавайи', inset: true, ...hiPiece, area: INSET_AREA_KM2.HI });

const CANVAS_W = 960 + MARGIN * 2;
const CANVAS_H = INSET_Y + 160;

// ---- adjacency (for the connect-spark effect): decimated min-distance test ----
function decimate(ring, maxPoints) {
  if (ring.length <= maxPoints) return ring;
  const stride = ring.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(ring[Math.floor(i * stride)]);
  return out;
}

const sampled = pieces
  .filter((p) => !p.inset)
  .map((p) => {
    const canvasRings = projectedRings.get(p.name).map((ring) => ring.map(toCanvas));
    const pts = [];
    for (const ring of canvasRings) for (const pt of decimate(ring, 50)) pts.push(pt);
    return { id: p.id, pts };
  });

const NEIGHBOR_DIST = 6; // canvas px; shared-border points are ~identical
const neighbors = {};
for (let i = 0; i < sampled.length; i++) {
  for (let j = i + 1; j < sampled.length; j++) {
    let minD = Infinity;
    for (const [ax, ay] of sampled[i].pts) {
      for (const [bx, by] of sampled[j].pts) {
        const d = Math.hypot(ax - bx, ay - by);
        if (d < minD) minD = d;
        if (minD < NEIGHBOR_DIST) break;
      }
      if (minD < NEIGHBOR_DIST) break;
    }
    if (minD < NEIGHBOR_DIST) {
      (neighbors[sampled[i].id] ??= []).push(sampled[j].id);
      (neighbors[sampled[j].id] ??= []).push(sampled[i].id);
    }
  }
}
for (const p of pieces) p.neighbors = neighbors[p.id] || [];

console.error('canvas', CANVAS_W, CANVAS_H);
console.error('pieces', pieces.length);
console.error(
  'sample bboxes',
  pieces.filter((p) => ['WA', 'FL', 'ME', 'CA', 'TX'].includes(p.id)).map((p) => [p.id, p.bbox.map((v) => +v.toFixed(0))])
);
console.error('WA neighbors', neighbors['WA']);
console.error('TX neighbors', neighbors['TX']);

// ---- emit levels/usa.js ----
function esc(s) {
  return s.replace(/'/g, "\\'");
}

let out = `// Auto-generated by scripts/build_usa_level.js from a public-domain\n`;
out += `// US states GeoJSON (PublicaMundi/MappingAPI), projected with a standard\n`;
out += `// Albers equal-area conic (the same family real US wall maps use) for\n`;
out += `// the 48 contiguous states, plus independent small insets for Alaska and\n`;
out += `// Hawaii (never shown at true relative scale/position on any US map).\n`;
out += `// Regenerate: node scripts/build_usa_level.js\n`;
out += `export default {\n`;
out += `  id: 'usa',\n`;
out += `  title: 'США: штаты',\n`;
out += `  subtitle: 'Собери и соедини все 50 штатов',\n`;
out += `  canvas: { width: ${Math.round(CANVAS_W)}, height: ${Math.round(CANVAS_H)} },\n`;
out += `  kmPerUnit: ${kmPerUnit.toFixed(6)}, // canvas units -> real-world km, for the on-map scale bar\n`;
// Lets js/geoCoords.js's browser-side inverse (right-click "coordinates"
// context menu) convert a canvas click back to lon/lat — the main Albers
// conic covers the 48 contiguous states + DC; `insets` (below, attached
// per-piece since AK/HI each carry their own independent projection —
// see buildInset) covers Alaska/Hawaii's corner boxes separately, since
// neither uses the main projection at all.
out += `  projection: {\n`;
out += `    type: 'albers',\n`;
out += `    minX: ${minX}, minY: ${minY}, scale: ${scale}, marginPx: ${MARGIN},\n`;
out += `    phi1Deg: 29.5, phi2Deg: 45.5, phi0Deg: 23, lambda0Deg: -96,\n`;
out += `  },\n`;
out += `  pieces: [\n`;
for (const p of pieces) {
  const projStr = p.projection
    ? `, projection: { lonMin: ${p.projection.lonMin}, latMax: ${p.projection.latMax}, cosLat: ${p.projection.cosLat}, s: ${p.projection.s}, offsetX: ${p.projection.offsetX}, offsetY: ${p.projection.offsetY} }`
    : '';
  out += `    { id: '${p.id}', name: '${esc(p.name)}', ru: '${esc(p.ru)}', cx: ${p.cx.toFixed(1)}, cy: ${p.cy.toFixed(1)}, bbox: [${p.bbox.map((v) => v.toFixed(1)).join(', ')}]${p.inset ? ', inset: true' : ''}, area: ${p.area}, neighbors: [${(p.neighbors || []).map((n2) => `'${n2}'`).join(', ')}]${projStr},\n      d: '${p.d}' },\n`;
}
out += `  ],\n`;
out += `};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usa.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
