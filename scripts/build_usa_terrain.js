// One-off build script: turns the free EPA/CEC "Level I Ecoregions of North
// America" dataset into a terrain-color layer for the USA map, bucketed
// into 8 player-facing categories (mountains/forests/plains/desert/etc.)
// and reprojected into the EXACT SAME native canvas space
// scripts/build_usa_level.js already put the state pieces in — the two
// projection passes below (Albers for the mainland, the equirectangular
// inset formula for Alaska) are deliberately byte-for-byte copies of that
// script's own math, re-derived from the same scripts/data/us-states.geojson
// rather than read back out of the generated levels/usa.js (which is an ES
// module — `export default {...}` — and can't be `require()`d from this
// plain CommonJS script). Recomputing from the same source with the same
// code is exactly as accurate as reading it back would have been, since
// both are fully deterministic given the same input.
//
// Source data pipeline (already run once, see scripts/data/ for the
// results — regenerate with the commands below if the raw shapefile ever
// needs to change):
//   1. Download https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/cec_na/na_cec_eco_l1.zip
//      and unzip into scripts/data/na_cec_eco_l1/
//   2. npx mapshaper -i scripts/data/na_cec_eco_l1/NA_CEC_Eco_Level1.shp -proj wgs84 -simplify 2% -filter 'NA_L1NAME != "WATER"' -o format=geojson precision=0.0001 scripts/data/na-ecoregions-level1.geojson
//      (the shapefile's own .prj is a sphere-based Lambert Azimuthal Equal
//      Area, not lon/lat — `-proj wgs84` reprojects it to real lon/lat,
//      which this script's own forward projections require as input; 2%
//      simplification was chosen by hand — coarse enough to keep the final
//      output well under 1MB, fine enough that California still comes out
//      as several distinct Mediterranean-California fragments rather than
//      one blob, see the tuning notes in the commit this script landed in)
//   3. npx mapshaper -i scripts/data/na-ecoregions-level1.geojson -clip bbox=-125,24,-66,50 -o format=geojson precision=0.0001 scripts/data/na-ecoregions-mainland.geojson force
//   4. npx mapshaper -i scripts/data/na-ecoregions-level1.geojson -clip bbox=-180,51,-129,72 -o format=geojson precision=0.0001 scripts/data/na-ecoregions-alaska.geojson force
//
// Only the two regional outputs from steps 3/4 are checked into
// scripts/data/ (na-ecoregions-mainland.geojson, na-ecoregions-alaska.geojson)
// — the raw 28MB shapefile zip and the whole-North-America intermediate
// from step 2 are NOT kept in the repo, same as sahara-morocco-clip.geojson
// only keeps build_world_seas.js's pre-clipped result, not its raw source.
// Regenerate this script's own output: node scripts/build_usa_terrain.js
const fs = require('fs');
const path = require('path');

const deg2rad = (d) => (d * Math.PI) / 180;

function forEachRing(geometry, fn) {
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => fn(ring));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((poly) => poly.forEach((ring) => fn(ring)));
  }
}

// ---- Re-derive the mainland Albers projection + canvas bbox, identical
// to scripts/build_usa_level.js's own pass 1 (same exclusions: Puerto
// Rico/DC dropped entirely, Alaska/Hawaii routed to their own insets) ----
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

// Same id<->name table build_usa_level.js has (just the pairs needed to key
// stateCategories below by the 2-letter id the game already uses everywhere
// — js/game.js/js/colorFillBoard.js key states by `id`, not the geojson's
// full `name`). Duplicated rather than imported — see the file header on
// why this script can't require() anything from levels/.
const NAME_TO_ID = {
  Alabama: 'AL', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE',
  Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN',
  Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', Alaska: 'AK', Hawaii: 'HI',
};

const statesGeo = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'us-states.geojson'), 'utf8'));
let alaskaFeature = null;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
// id -> array of raw (un-projected) rings — projected into canvas space in
// a second pass below, once minX/minY/scale are known from this loop.
const stateRawRingsById = {};
for (const f of statesGeo.features) {
  const name = f.properties.name;
  if (name === 'Puerto Rico' || name === 'District of Columbia') continue;
  if (name === 'Alaska') { alaskaFeature = f; continue; }
  if (name === 'Hawaii') continue; // no terrain coverage for HI in this dataset anyway
  const rings = [];
  forEachRing(f.geometry, (ring) => {
    rings.push(ring);
    for (const pt of ring) {
      const [x, y] = albers(pt);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  stateRawRingsById[NAME_TO_ID[name]] = rings;
}
const TARGET_W = 960;
const scale = TARGET_W / (maxX - minX);
const TARGET_H = (maxY - minY) * scale;
const MARGIN = 3;
function toCanvas([x, y]) {
  return [(x - minX) * scale + MARGIN, (y - minY) * scale + MARGIN];
}
function projectMainland(ring) {
  return ring.map((pt) => toCanvas(albers(pt)));
}

// ---- Re-derive Alaska's inset projection, identical to
// scripts/build_usa_level.js's buildInset (called there with
// targetW=230, targetH=150, offsetX=10, offsetY=TARGET_H+40) ----
const INSET_Y = TARGET_H + 40;
function deriveAlaskaInset(feature, targetW, targetH, offsetX, offsetY) {
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  forEachRing(feature.geometry, (ring) => {
    for (const [lon, lat] of ring) {
      const l = lon > 0 ? lon - 360 : lon; // unwrap Aleutians crossing the antimeridian
      if (l < lonMin) lonMin = l;
      if (l > lonMax) lonMax = l;
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
  return { lonMin, latMax, cosLat, s, offsetX: offsetX + padX, offsetY: offsetY + padY };
}
const akInset = deriveAlaskaInset(alaskaFeature, 230, 150, 10, INSET_Y);
function projectAlaska(ring) {
  return ring.map(([lon, lat]) => {
    const l = lon > 0 ? lon - 360 : lon;
    const x = (l - akInset.lonMin) * akInset.cosLat * akInset.s + akInset.offsetX;
    const y = (akInset.latMax - lat) * akInset.s + akInset.offsetY;
    return [x, y];
  });
}

// Every state's own rings, in the SAME canvas space as the terrain
// category rings below — needed for _computeStateCategories's overlap
// test (js/colorFillBoard.js's per-round "which categories does this
// state actually contain" question — see stateCategories in the emitted
// output). AK gets its own inset projection, same routing as everywhere
// else in this file.
const stateCanvasRingsById = {};
for (const [id, rawRings] of Object.entries(stateRawRingsById)) {
  stateCanvasRingsById[id] = rawRings.map(projectMainland);
}
if (alaskaFeature) {
  const akRawRings = [];
  forEachRing(alaskaFeature.geometry, (r) => akRawRings.push(r));
  stateCanvasRingsById.AK = akRawRings.map(projectAlaska);
}

function ringBBox(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}
function bboxesOverlap(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

// Standard ray-casting point-in-polygon, against ONE ring (states/terrain
// categories are treated as a flat union of rings, not exterior+hole pairs
// — this project has no real holes at this simplification level, so that
// distinction isn't worth the extra complexity).
function pointInRing(pt, ring) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d === 0) return false; // parallel/collinear — treated as non-crossing, same approximation tolerance as everywhere else in this file
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
// Does ringA overlap ringB at all? Vertex-containment first (cheap, catches
// the vast majority of real cases — one ring's corner sitting inside the
// other), edge-intersection as the fallback for the rarer case where two
// rings cross without either one's own vertices landing inside the other.
function ringsOverlap(ringA, ringB) {
  if (!bboxesOverlap(ringBBox(ringA), ringBBox(ringB))) return false;
  for (const pt of ringA) if (pointInRing(pt, ringB)) return true;
  for (const pt of ringB) if (pointInRing(pt, ringA)) return true;
  for (let i = 0; i < ringA.length; i++) {
    const a1 = ringA[i], a2 = ringA[(i + 1) % ringA.length];
    for (let j = 0; j < ringB.length; j++) {
      const b1 = ringB[j], b2 = ringB[(j + 1) % ringB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// ---- Bucket CEC's 15 Level-I categories into 8 player-facing ones ----
const CATEGORY_MAP = {
  'NORTHWESTERN FORESTED MOUNTAINS': 'mountain',
  'TEMPERATE SIERRAS': 'mountain',
  'SOUTHERN SEMIARID HIGHLANDS': 'mountain',
  'TAIGA': 'forest-boreal',
  'NORTHERN FORESTS': 'forest-boreal',
  'EASTERN TEMPERATE FORESTS': 'forest-broadleaf',
  'TROPICAL WET FORESTS': 'forest-broadleaf',
  'TROPICAL DRY FORESTS': 'forest-broadleaf',
  'MARINE WEST COAST FOREST': 'forest-coastal',
  'GREAT PLAINS': 'plains',
  'NORTH AMERICAN DESERTS': 'desert',
  'MEDITERRANEAN CALIFORNIA': 'mediterranean',
  'TUNDRA': 'tundra',
};
const CATEGORY_LABELS = {
  mountain: 'Горы',
  'forest-boreal': 'Хвойный/таёжный лес',
  'forest-broadleaf': 'Широколиственный лес',
  'forest-coastal': 'Тихоокеанский лес',
  plains: 'Великие равнины',
  desert: 'Пустыня',
  mediterranean: 'Средиземноморье',
  tundra: 'Тундра',
  swamp: 'Болото',
};

// category -> array of raw projected rings (point arrays) — kept alongside
// the stringified version below since js/colorFillBoard.js's per-state
// category list (computed right after) needs real geometry to test
// against, not an SVG path string.
const ringsByCategory = {};
function addRings(geojsonPath, projectRing) {
  const geo = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  let skipped = 0;
  for (const f of geo.features) {
    const category = CATEGORY_MAP[f.properties.NA_L1NAME];
    if (!category) { skipped++; continue; }
    forEachRing(f.geometry, (ring) => {
      (ringsByCategory[category] ??= []).push(projectRing(ring));
    });
  }
  console.error(path.basename(geojsonPath), '-> skipped (unmapped category)', skipped, 'of', geo.features.length);
}
addRings(path.join(__dirname, 'data', 'na-ecoregions-mainland.geojson'), projectMainland);
addRings(path.join(__dirname, 'data', 'na-ecoregions-alaska.geojson'), projectAlaska);

// ---- "Болото" — unlike the other 8 categories (real ecoregion polygons),
// no free, easily-processed vector dataset of US wetlands exists at a
// scale this project's tooling can handle: the USFWS National Wetlands
// Inventory has real boundaries but is per-state, hundreds of MB even for
// one state, and tens of millions of tiny polygons (every farm pond
// included) — nowhere near "a build script mapshaper can chew through".
// FWS/NPS boundary REST APIs that could have given real refuge/park
// shapes for just the famous swamps were unreachable from this project's
// environment (timeouts/500s on several different endpoints).
//
// So this is a deliberate, disclosed exception: real named places with
// real center coordinates and real published areas (Wikipedia, cited
// per-swamp below), each drawn as an approximate hand-generated blob
// (a wobbled circle, not an invented precise outline) sized to match the
// real area — same "real facts, approximate shape" honesty as
// levels/usaPlaces.js's landmark dots, just area-sized instead of a fixed
// small radius. Not exhaustive (there are thousands of named wetlands in
// the US) — just the handful actually famous enough that a player would
// recognize the name.
const SWAMPS = [
  // [id, ru name, lat, lon, areaKm2] — areaKm2 sourced from each place's
  // current official protected-area size where one exists (national
  // park/preserve/refuge), or its commonly-cited swamp extent otherwise.
  ['everglades_swamp', 'Эверглейдс', 25.32, -80.93, 6107],
  ['big_cypress', 'Биг-Сайпрес', 25.90, -81.10, 2916],
  ['atchafalaya_basin', 'Бассейн Атчафалайя', 30.30, -91.60, 5666],
  ['okefenokee_swamp', 'Окефеноки', 30.70, -82.30, 1770],
  ['great_dismal_swamp', 'Грейт-Дизмал-Суомп', 36.60, -76.40, 450],
  ['congaree_swamp', 'Конгари', 33.80, -80.80, 108],
  ['green_swamp_fl', 'Грин-Суомп', 28.30, -81.90, 230],
  ['great_swamp_nj', 'Грейт-Суомп (Нью-Джерси)', 40.70, -74.45, 30],
];
// Wobbled circle, not a perfect ellipse — an exactly-round/oval blob would
// look conspicuously artificial next to the other 8 categories' organic
// ecoregion outlines. Seeded per-swamp (its own lon/lat) so re-running
// this script produces the identical shape every time, not a new random
// one — determinism matters here the same way it does for every other
// generated file in this project.
function wobbledCircleLonLat(lon, lat, areaKm2, seed) {
  const KM_PER_DEG_LAT = 111.32;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(deg2rad(lat));
  const radiusKm = Math.sqrt(areaKm2 / Math.PI);
  const POINTS = 16;
  const ring = [];
  for (let i = 0; i < POINTS; i++) {
    const angle = (i / POINTS) * 2 * Math.PI;
    const wobble = 1 + 0.22 * Math.sin(angle * 2.4 + seed) + 0.12 * Math.sin(angle * 5.1 + seed * 2);
    const r = radiusKm * wobble;
    const dLat = (r * Math.cos(angle)) / KM_PER_DEG_LAT;
    const dLon = (r * Math.sin(angle)) / kmPerDegLon;
    ring.push([lon + dLon, lat + dLat]);
  }
  return ring;
}
for (const [id, , lat, lon, areaKm2] of SWAMPS) {
  // Simple numeric seed from the id's char codes — arbitrary but fixed.
  const seed = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const ring = wobbledCircleLonLat(lon, lat, areaKm2, seed);
  (ringsByCategory.swamp ??= []).push(projectMainland(ring));
}

const regions = Object.keys(CATEGORY_LABELS)
  .filter((cat) => ringsByCategory[cat]?.length)
  .map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    d: ringsByCategory[cat].map((ring) => 'M ' + ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ') + ' Z').join(' '),
  }));

console.error('regions', regions.map((r) => [r.category, ringsByCategory[r.category].length + ' rings', r.d.length + ' chars']));

// ---- Per-state category list (js/colorFillBoard.js's "Раскраска" mode:
// which of the 8 categories does THIS state actually need painted —
// South Dakota has 2, California can have 5) — computed once here via
// real ring-overlap geometry (ringsOverlap above) rather than approximated
// at runtime, so a thin sliver (e.g. Mediterranean California's coastal
// strip) can't silently go undetected the way point-sampling might. ----
const stateCategories = {};
for (const [stateId, stateRings] of Object.entries(stateCanvasRingsById)) {
  const stateBBox = stateRings.reduce(
    (acc, r) => {
      const b = ringBBox(r);
      return [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])];
    },
    [Infinity, Infinity, -Infinity, -Infinity]
  );
  const found = [];
  for (const cat of Object.keys(CATEGORY_LABELS)) {
    const catRings = ringsByCategory[cat];
    if (!catRings) continue;
    const overlaps = catRings.some((catRing) => {
      if (!bboxesOverlap(stateBBox, ringBBox(catRing))) return false;
      return stateRings.some((stateRing) => ringsOverlap(stateRing, catRing));
    });
    if (overlaps) found.push(cat);
  }
  stateCategories[stateId] = found;
}
console.error(
  'stateCategories sample',
  ['SD', 'CA', 'KS', 'AK'].map((id) => [id, stateCategories[id]])
);

let out = `// Auto-generated by scripts/build_usa_terrain.js from the free EPA/CEC\n`;
out += `// "Level I Ecoregions of North America" dataset, bucketed into 8\n`;
out += `// player-facing terrain categories and projected into the exact same\n`;
out += `// native canvas space as levels/usa.js's state pieces.\n`;
out += `// Regenerate: node scripts/build_usa_terrain.js\n`;
out += `export default {\n`;
out += `  regions: [\n`;
for (const r of regions) {
  out += `    { category: '${r.category}', label: '${r.label}', d: '${r.d}' },\n`;
}
out += `  ],\n`;
// Which categories exist inside EACH state — see the comment above this
// loop. js/colorFillBoard.js uses this directly instead of doing its own
// runtime point-sampling.
out += `  stateCategories: {\n`;
for (const [id, cats] of Object.entries(stateCategories)) {
  out += `    ${id}: [${cats.map((c) => `'${c}'`).join(', ')}],\n`;
}
out += `  },\n`;
out += `};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaTerrain.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
