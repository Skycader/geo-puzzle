// Builds the "Шоссе" overlay layer's Hawaii routes — a separate dataset
// from scripts/build_usa_highways.js's mainland Interstates, because
// Hawaii's real road system isn't part of that numbering scheme at all:
// its highways are the real named state routes (Kuhio Highway,
// Kamehameha Highway, Hawaii Belt Road, ...), not "I-NN". js/overviewBoard.js
// renders these with a plain text label along the line instead of the
// mainland's numbered shield (see js/overviewBoard.js's own comment on
// this dataset's shape — no `number` field is what tells it which
// rendering to use).
//
// Source: US Census Bureau TIGER/Line 2023 "Primary and Secondary Roads"
// for Hawaii (state FIPS 15) — public domain, same government source as
// the mainland Interstates, just a different TIGER product: the national
// PRIMARYROADS file only carries Interstates + a handful of freeways, not
// ordinary state highways (confirmed by inspection — Kuhio Highway simply
// isn't in it), so this uses PRISECROADS instead, which does.
//
// Pipeline (already run once, see scripts/data/ for the result — redo only
// if re-downloaded):
//   1. Download https://www2.census.gov/geo/tiger/TIGER2023/PRISECROADS/tl_2023_15_prisecroads.zip
//      and unzip into scripts/data/tmp_hi/prisec/
//   2. npx mapshaper scripts/data/tmp_hi/prisec/tl_2023_15_prisecroads.shp -proj wgs84 -simplify 5% -o format=geojson precision=0.0001 scripts/data/tl_hawaii_prisecroads.geojson force
//      (5% simplify — Hawaii's own islands are tiny on this map, TIGER's
//      raw vertex density is far beyond what a few dozen canvas-pixels of
//      island needs)
//
// Only scripts/data/tl_hawaii_prisecroads.geojson (the small, ~350KB
// result) is checked into the repo — the 1.5MB raw zip and unzipped
// shapefile are not, same "keep only the pre-filtered result" convention
// as every other big source dataset this project uses.
//
// Regenerate: node scripts/build_hawaii_highways.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'tl_hawaii_prisecroads.geojson');
const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// ---- re-derive the exact same Hawaii inset projection as
// build_usa_cities.js/build_usa_places.js/build_usa_level.js — must match
// exactly or these lines land offset from the inset's own state outline
// and city dots.
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
function insetProjector(featureName, targetW, targetH, offsetX, offsetY) {
  const feature = statesGeo.features.find((f) => f.properties.name === featureName);
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
const toCanvasHI = insetProjector('Hawaii', 150, 90, 270, INSET_Y + 60);

// ---- name normalization ----
// TIGER records the same physical highway under several FULLNAME variants
// across different segments: directional prefixes ("N Kamehameha Hwy" vs
// "S Kamehameha Hwy"), historical-vs-current alignment ("Old Haleakala
// Hwy"), abbreviations ("Kam Hwy"), and plain misspellings across
// differently-surveyed segments ("Mamahaloa"/"Mamalaloa"/"Mamlahoa" Hwy —
// all the same Māmalahoa Highway). Normalizing to one canonical key per
// real highway is what lets same-highway segments merge into a single
// drawn+labeled line instead of several overlapping, inconsistently-named
// ones.
function canonicalize(raw) {
  let s = raw.trim();
  const m = s.match(/^I-?\s*H-?\s*(\d+)$/);
  if (m) return `H-${m[1]}`;
  s = s.replace(/^(N|S|E|W)\s+/, '').replace(/^(Old|New)\s+/, '');
  const TYPOS = {
    'Mamahaloa Hwy': 'Mamalahoa Hwy',
    'Mamalaloa Hwy': 'Mamalahoa Hwy',
    'Mamlahoa Hwy': 'Mamalahoa Hwy',
    'Hawaii Belt Rd': 'Mamalahoa Hwy',
    'Kam Hwy': 'Kamehameha Hwy',
  };
  return TYPOS[s] || s;
}

// Only real, recognizable named highways/freeways make it onto the map —
// same "major routes only, not every local street" curation the mainland
// Interstate-only filter already applies. Verified real names (not
// invented): Hawaii DOT route names + Wikipedia. `ru` is a plain
// transliteration, same style as levels/usaCities.js's `ru` fields.
const HIGHWAY_NAMES = {
  'H-1': { en: 'Interstate H-1', ru: 'шоссе H-1' },
  'H-2': { en: 'Interstate H-2', ru: 'шоссе H-2' },
  'H-3': { en: 'Interstate H-3', ru: 'шоссе H-3' },
  'H-201': { en: 'Moanalua Freeway (H-201)', ru: 'фривей Моаналуа (H-201)' },
  'Kamehameha Hwy': { en: 'Kamehameha Highway', ru: 'шоссе Камеамеа' },
  'Kamehameha V Hwy': { en: 'Kamehameha V Highway', ru: 'шоссе Камеамеа V' },
  'Kalanianaole Hwy': { en: 'Kalanianaʻole Highway', ru: 'шоссе Каланианаоле' },
  'Pali Hwy': { en: 'Pali Highway', ru: 'шоссе Пали' },
  'Likelike Hwy': { en: 'Likelike Highway', ru: 'шоссе Ликелике' },
  'Farrington Hwy': { en: 'Farrington Highway', ru: 'шоссе Фаррингтон' },
  'Nimitz Hwy': { en: 'Nimitz Highway', ru: 'шоссе Нимиц' },
  'Mamalahoa Hwy': { en: 'Māmalahoa Highway (Hawaii Belt Road)', ru: 'шоссе Мамалахоа (Гавайская окружная дорога)' },
  'Queen Kaahumanu Hwy': { en: 'Queen Kaʻahumanu Highway', ru: 'шоссе королевы Каахуману' },
  'Kuakini Hwy': { en: 'Kuakini Highway', ru: 'шоссе Куакини' },
  'Daniel K Inouye Hwy': { en: 'Daniel K. Inouye Highway', ru: 'шоссе Дэниела Иноуэ' },
  'Volcano Hwy': { en: 'Volcano Highway', ru: 'Вулканическое шоссе' },
  'Akoni Pule Hwy': { en: 'Akoni Pule Highway', ru: 'шоссе Акони Пуле' },
  'Hana Hwy': { en: 'Hana Highway', ru: 'шоссе Хана' },
  'Honoapiilani Hwy': { en: 'Honoapiʻilani Highway', ru: 'шоссе Хоноапиилани' },
  'Piilani Hwy': { en: 'Piʻilani Highway', ru: 'шоссе Пиилани' },
  'Haleakala Hwy': { en: 'Haleakalā Highway', ru: 'шоссе Халеакала' },
  'Kuihelani Hwy': { en: 'Kuihelani Highway', ru: 'шоссе Куихелани' },
  'Mokulele Hwy': { en: 'Mokulele Highway', ru: 'шоссе Мокулеле' },
  'Kahekili Hwy': { en: 'Kahekili Highway', ru: 'шоссе Кахекили' },
  'Kuhio Hwy': { en: 'Kūhiō Highway', ru: 'шоссе Кухио' },
  'Kaumualii Hwy': { en: 'Kaumualiʻi Highway', ru: 'шоссе Каумуалии' },
  'Kapule Hwy': { en: 'Kapule Highway', ru: 'шоссе Капуле' },
  'Kaumalapau Hwy': { en: 'Kaumalapau Highway', ru: 'шоссе Каумалапау' },
};

// ---- collect + merge segments by canonical highway ----
const byName = new Map(); // canonical -> subpath d-strings + raw points
function addLine(coords, canonical) {
  const pts = coords.map(toCanvasHI);
  if (pts.length < 2) return;
  const d = 'M ' + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ');
  if (!byName.has(canonical)) byName.set(canonical, { subpaths: [], rawPoints: [], bbox: [Infinity, Infinity, -Infinity, -Infinity] });
  const entry = byName.get(canonical);
  entry.subpaths.push(d);
  entry.rawPoints.push(...pts);
  for (const [x, y] of pts) {
    entry.bbox[0] = Math.min(entry.bbox[0], x);
    entry.bbox[1] = Math.min(entry.bbox[1], y);
    entry.bbox[2] = Math.max(entry.bbox[2], x);
    entry.bbox[3] = Math.max(entry.bbox[3], y);
  }
}

const MAX_LABEL_CANDIDATES = 20;
function decimate(pts, maxPoints) {
  if (pts.length <= maxPoints) return pts;
  const stride = pts.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(pts[Math.floor(i * stride)]);
  return out;
}

let skipped = 0;
for (const f of geo.features) {
  if (!f.geometry) continue;
  const canonical = canonicalize(f.properties.FULLNAME || '');
  if (!HIGHWAY_NAMES[canonical]) { skipped++; continue; }
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
  for (const line of lines) addLine(line, canonical);
}

const routes = [...byName.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([canonical, e]) => ({
    id: 'hi-' + canonical.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    name: HIGHWAY_NAMES[canonical].en,
    ru: HIGHWAY_NAMES[canonical].ru,
    d: e.subpaths.join(' '),
    bbox: e.bbox.map((v) => +v.toFixed(1)),
    points: decimate(e.rawPoints, MAX_LABEL_CANDIDATES).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]),
  }));

console.error('Hawaii features skipped (not a recognized named highway):', skipped);
console.error('Hawaii routes:', routes.length);
console.error(routes.map((r) => r.name).join(', '));

let out = `// Auto-generated by scripts/build_hawaii_highways.js from the US Census\n`;
out += `// Bureau's public-domain TIGER/Line Hawaii primary+secondary roads\n`;
out += `// shapefile, filtered to real named state/interstate highways. See the\n`;
out += `// build script's own comments for why this is separate from\n`;
out += `// levels/usaHighways.js (Hawaii's roads aren't part of that numbering\n`;
out += `// scheme at all) and merged with it in levels/index.js.\n`;
out += `// Regenerate: node scripts/build_hawaii_highways.js\n`;
out += `export default ${JSON.stringify(routes, null, 2)};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaHawaiiHighways.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
