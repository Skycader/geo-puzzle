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

const statesGeo = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'us-states.geojson'), 'utf8'));
let alaskaFeature = null;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of statesGeo.features) {
  const name = f.properties.name;
  if (name === 'Puerto Rico' || name === 'District of Columbia') continue;
  if (name === 'Alaska') { alaskaFeature = f; continue; }
  if (name === 'Hawaii') continue; // no terrain coverage for HI in this dataset anyway
  forEachRing(f.geometry, (ring) => {
    for (const pt of ring) {
      const [x, y] = albers(pt);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
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
};

// category -> array of ring strings ("x,y L x,y ... ")
const ringsByCategory = {};
function addRings(geojsonPath, projectRing) {
  const geo = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  let skipped = 0;
  for (const f of geo.features) {
    const category = CATEGORY_MAP[f.properties.NA_L1NAME];
    if (!category) { skipped++; continue; }
    forEachRing(f.geometry, (ring) => {
      const projected = projectRing(ring);
      const str = projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ');
      (ringsByCategory[category] ??= []).push(str);
    });
  }
  console.error(path.basename(geojsonPath), '-> skipped (unmapped category)', skipped, 'of', geo.features.length);
}
addRings(path.join(__dirname, 'data', 'na-ecoregions-mainland.geojson'), projectMainland);
addRings(path.join(__dirname, 'data', 'na-ecoregions-alaska.geojson'), projectAlaska);

const regions = Object.keys(CATEGORY_LABELS)
  .filter((cat) => ringsByCategory[cat]?.length)
  .map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    d: ringsByCategory[cat].map((r) => `M ${r} Z`).join(' '),
  }));

console.error('regions', regions.map((r) => [r.category, ringsByCategory[r.category].length + ' rings', r.d.length + ' chars']));

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
out += `};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaTerrain.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
