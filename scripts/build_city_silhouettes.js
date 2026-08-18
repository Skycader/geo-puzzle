// Companion to build_usa_cities.js: for a handful of large/distinctively-
// shaped cities, projects their real municipal boundary (US Census
// cartographic boundary file, scripts/data/us-city-boundaries.geojson —
// see that file's extraction notes) onto the exact same canvas coordinate
// system as levels/usa.js, using the exact same Albers projection +
// normalization (and AK/HI insets) as build_usa_level.js / build_usa_cities.js.
//
// Writes scripts/data/city-silhouettes.generated.json (an id -> {d, bbox}
// map) rather than touching levels/usaCities.js directly — build_usa_cities.js
// reads that file and bakes the fields in as part of its own output, so
// re-running either script in either order stays safe (levels/usaCities.js
// only ever has one writer).
// Regenerate: node scripts/build_city_silhouettes.js && node scripts/build_usa_cities.js
const fs = require('fs');
const path = require('path');

const STATES_SRC = path.join(__dirname, 'data', 'us-states.geojson');
const CITIES_SRC = path.join(__dirname, 'data', 'us-city-boundaries.geojson');
const states = JSON.parse(fs.readFileSync(STATES_SRC, 'utf8'));
const cityBoundaries = JSON.parse(fs.readFileSync(CITIES_SRC, 'utf8'));

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

// ---- re-derive the exact same contiguous-US bbox/scale/margin ----
const SKIP = new Set(['Puerto Rico', 'District of Columbia', 'Alaska', 'Hawaii']);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of states.features) {
  if (SKIP.has(f.properties.name)) continue;
  forEachRing(f.geometry, (ring) => {
    for (const [x, y] of ring.map(albers)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
}
const TARGET_W = 960;
const scale = TARGET_W / (maxX - minX);
// Must match build_usa_level.js's own MARGIN exactly (same reasoning as
// build_usa_cities.js's copy of this constant) — this one had drifted out
// of sync at 18 (build_usa_level.js's old value, before it dropped to 3),
// silently offsetting every silhouette's d/bbox by 15 canvas units from
// its own city's correct cx/cy, enough to push coastal cities (New York,
// Jacksonville, ...) into the ocean.
const MARGIN = 3;
function toCanvasMain([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN, (y - minY) * scale + MARGIN];
}

// ---- re-derive the exact same AK inset projection (only AK city here) ----
function insetProjector(featureName, targetW, targetH, offsetX, offsetY) {
  const feature = states.features.find((f) => f.properties.name === featureName);
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  forEachRing(feature.geometry, (ring) => {
    for (let [lon, lat] of ring) {
      if (lon > 0) lon -= 360;
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
  const padX = (targetW - w * s) / 2;
  const padY = (targetH - h * s) / 2;
  return ([lon, lat]) => {
    let l = lon;
    if (l > 0) l -= 360;
    return [(l - lonMin) * cosLat * s + offsetX + padX, (latMax - lat) * s + offsetY + padY];
  };
}
const bboxH = maxY - minY;
const TARGET_H = bboxH * scale;
const INSET_Y = TARGET_H + 40;
const toCanvasAK = insetProjector('Alaska', 230, 150, 10, INSET_Y);

function project(state, lon, lat) {
  if (state === 'AK') return toCanvasAK([lon, lat]);
  return toCanvasMain([lon, lat]);
}

function decimate(ring, maxPoints) {
  if (ring.length <= maxPoints) return ring;
  const stride = ring.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(ring[Math.floor(i * stride)]);
  return out;
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
    const n2 = ring.length;
    const sx = ring.reduce((s, p) => s + p[0], 0) / n2;
    const sy = ring.reduce((s, p) => s + p[1], 0) / n2;
    return [sx, sy, 0];
  }
  return [cx / (6 * a), cy / (6 * a), Math.abs(a)];
}

const MAX_PTS_PER_RING = 120;
const silhouettes = {};
for (const f of cityBoundaries.features) {
  const { id, state } = f.properties;
  const canvasRings = f.geometry.coordinates.map((ring) =>
    decimate(ring.map(([lon, lat]) => project(state, lon, lat)), MAX_PTS_PER_RING)
  );

  const d = canvasRings.map((ring) => 'M ' + ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ') + ' Z').join(' ');

  let totalArea = 0, cx = 0, cy = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const ring of canvasRings) {
    const [rcx, rcy, area] = ringCentroid(ring);
    totalArea += area;
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

  silhouettes[id] = { d, bbox: [bx0, by0, bx1, by1].map((v) => +v.toFixed(1)) };
}

console.error('silhouettes', Object.keys(silhouettes).length);

const outPath = path.join(__dirname, 'data', 'city-silhouettes.generated.json');
fs.writeFileSync(outPath, JSON.stringify(silhouettes), 'utf8');
console.error('wrote', outPath);
