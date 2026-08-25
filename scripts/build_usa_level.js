// One-off build script: turns the public-domain PublicaMundi us-states
// GeoJSON into real state-shaped SVG paths for the puzzle, using a proper
// Albers equal-area conic projection for the 48 contiguous states + DC
// (same projection family real US wall maps use). Alaska and Hawaii use
// their own accurate local equirectangular projections (small-area, so no
// meaningful distortion) but are positioned at their TRUE relative
// position and scale versus the mainland (not the arbitrary corner-inset
// convention most printed maps use) — see buildTruePosition's own comment
// below for why the shape itself can't just go through the main Albers
// formula. A non-interactive Canada silhouette (`contextLand`) is added
// for geographic context, at the same true position/scale.
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
// Blank border baked directly into the canvas/viewBox itself (every
// projected coordinate gets +MARGIN) — the map is meant to be monolithic,
// filling its container edge-to-edge with no border of its own (see
// style.css's .zoom-viewport), so this only needs to be just wide enough
// that a border state's own stroke doesn't get clipped by the viewBox
// edge, not a decorative gutter. Was 18 (a ~2% gap on every side, clearly
// visible now that the surrounding CSS layer's own padding/border are 0).
const MARGIN = 3;

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

// ---- Alaska / Hawaii: true relative position + true scale ----
// Each keeps its own accurate LOCAL projection (equirectangular + cosLat
// correction — fine for an area this size) instead of running its real
// outline through the main Albers formula above, which is only accurate
// near ITS OWN standard parallels (29.5-45.5°N) / central meridian (-96°)
// — numerically verified before writing this: Alaska's real corners come
// out as a wildly stretched ~650x550-unit diagonal blob under the raw
// Albers formula, nothing like Alaska's actual shape (it's both 15-45°
// further north than the standard parallels AND crosses the antimeridian).
// Only ONE reference point per region — its own real lon/lat bbox-center —
// goes through the main Albers formula; a single point can't be
// "distorted", so this gives a real, direction-correct anchor position
// without the outline-distortion problem. The local shape is then drawn
// around that anchor at TRUE scale (same km-per-canvas-unit as the main
// map, derived self-consistently from `scale` above) instead of being
// letterbox-fit to an arbitrary box like the old inset mechanism was.
// North stays up (no rotation) — same convention every printed US map
// uses for its Alaska/Hawaii insets; a real rotation (Alaska's would be
// ~38°) would need reworking js/geoCoords.js's unrotated inverse-lookup
// math for no visible benefit (players have no lon/lat grid to notice
// against).
const TRUE_SCALE = deg2rad(1) * scale; // canvas units per degree, at true relative scale

function regionBBoxCenter(feature) {
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  forEachRing(feature.geometry, (ring) => {
    for (let [lon, lat] of ring) {
      if (lon > 0) lon -= 360; // unwrap Aleutians crossing the antimeridian
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    }
  });
  return { lon: (lonMin + lonMax) / 2, lat: (latMin + latMax) / 2 };
}

function buildTruePosition(feature, anchorLon, anchorLat) {
  const rings = [];
  forEachRing(feature.geometry, (ring) => {
    rings.push(ring.map(([lon, lat]) => [lon > 0 ? lon - 360 : lon, lat]));
  });
  const cosLat = Math.cos(deg2rad(anchorLat));
  const [anchorX, anchorY] = toCanvas(albers([anchorLon, anchorLat]));
  function project([lon, lat]) {
    const x = (lon - anchorLon) * cosLat * TRUE_SCALE + anchorX;
    const y = (anchorLat - lat) * TRUE_SCALE + anchorY;
    return [x, y];
  }
  const canvasRings = rings.map((ring) => ring.map(project));
  // Same field names/formula shape js/geoCoords.js's insetInverse already
  // expects (x=(lon-lonMin)*cosLat*s+offsetX, y=(latMax-lat)*s+offsetY) —
  // just fed the anchor point instead of a box corner, so no runtime code
  // needs to change, only these values.
  const projection = { lonMin: anchorLon, latMax: anchorLat, cosLat, s: TRUE_SCALE, offsetX: anchorX, offsetY: anchorY };
  return { ...buildPieceFromRings(canvasRings), projection };
}

const akAnchor = regionBBoxCenter(insets['Alaska']);
const hiAnchor = regionBBoxCenter(insets['Hawaii']);
const akPiece = buildTruePosition(insets['Alaska'], akAnchor.lon, akAnchor.lat);
const hiPiece = buildTruePosition(insets['Hawaii'], hiAnchor.lon, hiAnchor.lat);

// AK/HI's own local projection has no consistent km-per-canvas-unit scale
// of its own beyond TRUE_SCALE (which IS real, unlike the old letterboxed
// inset's `s`) — areaNative is still native-projection area, not real
// km², so this keeps using the standard US Census total-area figures
// directly rather than converting it.
const INSET_AREA_KM2 = { AK: 1723337, HI: 28313 };

pieces.push({ id: 'AK', name: 'Alaska', ru: 'Аляска', inset: true, ...akPiece, area: INSET_AREA_KM2.AK });
pieces.push({ id: 'HI', name: 'Hawaii', ru: 'Гавайи', inset: true, ...hiPiece, area: INSET_AREA_KM2.HI });

// ---- Canada: non-interactive context silhouette, real position/scale ----
// Explains at a glance why Alaska sits disconnected up in the corner (it's
// not disconnected — Canada is just in between). Real geometry from the
// world-level land dataset (already in the repo, no new download), same
// true-position technique as AK/HI above. Deliberately NOT added to
// `pieces` — it would otherwise surface as a guessable/clickable "state"
// in every quiz/name-state/neighbor/identify/colorfill mode, none of which
// should know it exists — a separate `contextLand` field (mirroring
// levels/world.js's own `land` background field) keeps it invisible to
// all of those while still renderable by js/overviewBoard.js.
const WORLD_COUNTRIES_SRC = path.join(__dirname, 'data', 'world-countries-simplified.geojson');
const worldCountries = JSON.parse(fs.readFileSync(WORLD_COUNTRIES_SRC, 'utf8'));
const canadaFeature = worldCountries.features.find((f) => f.properties.NAME === 'Canada');
const canadaAnchor = regionBBoxCenter(canadaFeature);
const canadaPiece = buildTruePosition(canadaFeature, canadaAnchor.lon, canadaAnchor.lat);

// ---- shift the whole canvas so nothing is negative ----
// Alaska/Hawaii/Canada's true positions land well outside the mainland's
// own (0,0)-anchored box (Canada and Alaska both go north/negative-y,
// Hawaii goes far west/negative-x) — everything (mainland included) gets
// translated by one shared constant so the final canvas starts at (0,0).
// A pure translation, not a rescale, so it's low-risk to apply uniformly.
// The other 6 build scripts that re-derive this same projection hardcode
// this exact constant too (same "duplicate literal constants across
// scripts" convention this file's old inset-box numbers already used) —
// see this script's own console.error output when regenerating.
function translateD(d, dx, dy) {
  return d.replace(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g, (_, x, y) => `${(parseFloat(x) + dx).toFixed(1)},${(parseFloat(y) + dy).toFixed(1)}`);
}
function translatePiece(p, dx, dy) {
  p.d = translateD(p.d, dx, dy);
  p.cx += dx;
  p.cy += dy;
  p.bbox = [p.bbox[0] + dx, p.bbox[1] + dy, p.bbox[2] + dx, p.bbox[3] + dy];
  if (p.projection) {
    p.projection.offsetX += dx;
    p.projection.offsetY += dy;
  }
  return p;
}

let shiftMinX = Infinity, shiftMinY = Infinity, shiftMaxX = -Infinity, shiftMaxY = -Infinity;
for (const p of [...pieces, canadaPiece]) {
  if (p.bbox[0] < shiftMinX) shiftMinX = p.bbox[0];
  if (p.bbox[1] < shiftMinY) shiftMinY = p.bbox[1];
  if (p.bbox[2] > shiftMaxX) shiftMaxX = p.bbox[2];
  if (p.bbox[3] > shiftMaxY) shiftMaxY = p.bbox[3];
}
const GLOBAL_SHIFT_X = -shiftMinX + MARGIN;
const GLOBAL_SHIFT_Y = -shiftMinY + MARGIN;
for (const p of pieces) translatePiece(p, GLOBAL_SHIFT_X, GLOBAL_SHIFT_Y);
translatePiece(canadaPiece, GLOBAL_SHIFT_X, GLOBAL_SHIFT_Y);

const CANVAS_W = shiftMaxX + GLOBAL_SHIFT_X + MARGIN;
const CANVAS_H = shiftMaxY + GLOBAL_SHIFT_Y + MARGIN;

console.error('TRUE_SCALE', TRUE_SCALE);
console.error('GLOBAL_SHIFT_X', GLOBAL_SHIFT_X, 'GLOBAL_SHIFT_Y', GLOBAL_SHIFT_Y);
console.error('AK anchor', akAnchor, 'HI anchor', hiAnchor, 'Canada anchor', canadaAnchor);

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
out += `// the 48 contiguous states, plus Alaska/Hawaii at their TRUE relative\n`;
out += `// position and scale (own accurate local projection, anchored via the\n`;
out += `// main Albers formula — see buildTruePosition's comment). contextLand\n`;
out += `// (Canada) is background context only, not a piece.\n`;
out += `// Regenerate: node scripts/build_usa_level.js\n`;
out += `export default {\n`;
out += `  id: 'usa',\n`;
out += `  title: 'США: штаты',\n`;
out += `  subtitle: 'Собери и соедини все 50 штатов',\n`;
out += `  canvas: { width: ${Math.round(CANVAS_W)}, height: ${Math.round(CANVAS_H)} },\n`;
out += `  kmPerUnit: ${kmPerUnit.toFixed(6)}, // canvas units -> real-world km, for the on-map scale bar\n`;
// Lets js/geoCoords.js's browser-side inverse (right-click "coordinates"
// context menu) convert a canvas click back to lon/lat — the main Albers
// conic covers the 48 contiguous states + DC. minX/minY here are adjusted
// by -GLOBAL_SHIFT/scale so albersInverse's `(x-marginPx)/scale+minX`
// correctly un-does the global canvas shift applied below; marginPx stays
// the plain MARGIN since that part of the shift is unrelated. Alaska/
// Hawaii use their own per-piece `projection` (attached below, already
// shifted) since neither is on the main Albers formula at all.
out += `  projection: {\n`;
out += `    type: 'albers',\n`;
out += `    minX: ${minX - GLOBAL_SHIFT_X / scale}, minY: ${minY - GLOBAL_SHIFT_Y / scale}, scale: ${scale}, marginPx: ${MARGIN},\n`;
out += `    phi1Deg: 29.5, phi2Deg: 45.5, phi0Deg: 23, lambda0Deg: -96,\n`;
out += `  },\n`;
out += `  contextLand: [{ d: '${canadaPiece.d}' }],\n`;
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
