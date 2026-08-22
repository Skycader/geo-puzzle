// Companion to build_usa_cities.js: projects a curated list of famous US
// landmarks/points of interest onto the exact same canvas coordinate system
// as levels/usa.js, by re-deriving the same Albers projection + normalization
// (and the same AK/HI inset formulas) from the same source GeoJSON, so place
// dots line up with state borders and city dots.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'us-states.geojson');
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

// ---- re-derive the exact same contiguous-US bbox/scale/margin ----
const SKIP = new Set(['Puerto Rico', 'District of Columbia', 'Alaska', 'Hawaii']);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of geo.features) {
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
function toCanvasMain([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN, (y - minY) * scale + MARGIN];
}

// ---- re-derive the exact same AK / HI inset projections ----
function insetProjector(featureName, targetW, targetH, offsetX, offsetY) {
  const feature = geo.features.find((f) => f.properties.name === featureName);
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
// must match build_usa_level.js / build_usa_cities.js exactly
const bboxH = maxY - minY;
const TARGET_H = bboxH * scale;
const INSET_Y = TARGET_H + 40;
const toCanvasAK = insetProjector('Alaska', 230, 150, 10, INSET_Y);
const toCanvasHI = insetProjector('Hawaii', 150, 90, 270, INSET_Y + 60);

function project(region, lon, lat) {
  if (region === 'AK') return toCanvasAK([lon, lat]);
  if (region === 'HI') return toCanvasHI([lon, lat]);
  return toCanvasMain([lon, lat]);
}

// [id, name, ru, lat, lon, region?] — a mix of real sites and famous
// fictional/semi-fictional ones pinned at their real-world or commonly-
// attributed location. Notes on the judgment calls:
//   - The Overlook Hotel (fictional, "The Shining") -> the Stanley Hotel,
//     Estes Park, CO, its well-known real-world inspiration.
//   - Camp Walden (fictional) -> a plausible Maine lake setting (the
//     archetypal movie-summer-camp state); no canonical real coordinates.
//   - Forks is a real WA town (setting of "Twilight").
//   - Bermuda Triangle has no single point by definition — plotted at its
//     commonly-cited centroid, which sits in open ocean well outside the
//     contiguous-US bbox the map's scale is derived from, so it may render
//     out in the pannable empty margin rather than "on" the landmass.
const PLACES = [
  ['golden_gate_bridge', 'Golden Gate Bridge', 'Мост Золотые Ворота', 37.8199, -122.4783],
  ['statue_of_liberty', 'Statue of Liberty', 'Статуя Свободы', 40.6892, -74.0445],
  ['mount_rushmore', 'Mount Rushmore', 'Гора Рашмор', 43.8791, -103.4591],
  ['white_house', 'The White House', 'Белый дом', 38.8977, -77.0365],
  ['area_51', 'Area 51', 'Зона 51', 37.2431, -115.7930],
  // Wikipedia: 38°44'33"N 104°50'54"W — hardened command center built
  // INSIDE Cheyenne Mountain, not just near it.
  ['norad_cheyenne_mountain', 'NORAD Cheyenne Mountain Complex', 'НОРАД (комплекс в горе Шайенн)', 38.7425, -104.8483],
  ['hollywood_sign', 'Hollywood Sign', 'Знак Голливуд', 34.1341, -118.3215],
  ['kennedy_space_center', 'Kennedy Space Center', 'Космический центр Кеннеди', 28.5729, -80.6490],
  ['harvard_university', 'Harvard University', 'Гарвардский университет', 42.3770, -71.1167],
  ['grand_canyon', 'Grand Canyon', 'Гранд-Каньон', 36.1069, -112.1129],
  ['yellowstone', 'Yellowstone National Park', 'Йеллоустоунский парк', 44.4280, -110.5885],
  ['death_valley', 'Death Valley', 'Долина Смерти', 36.5323, -116.9325],
  ['niagara_falls', 'Niagara Falls', 'Ниагарский водопад', 43.0962, -79.0377],
  ['everglades', 'Everglades', 'Эверглейдс', 25.2866, -80.8987],
  ['mauna_kea', 'Mauna Kea', 'Мауна-Кеа', 19.8207, -155.4681, 'HI'],
  ['camp_walden', 'Camp Walden', 'Лагерь Уолден', 44.5, -70.5],
  ['forks', 'Forks', 'Форкс', 47.9506, -124.3856],
  ['alcatraz', 'Alcatraz', 'Алькатрас', 37.8267, -122.4230],
  ['overlook_hotel', 'The Overlook Hotel', 'Отель «Оверлук»', 40.3775, -105.5217],
  ['bermuda_triangle', 'Bermuda Triangle', 'Бермудский треугольник', 25.0, -71.0],
  ['las_vegas_strip', 'The Las Vegas Strip', 'Лас-Вегас-Стрип', 36.1147, -115.1728],
];

// No Census land-area data applies to a bridge or a hotel — a small
// nominal radius is enough for these to reuse the same Overview-dot /
// EligibilityList code paths as cities (both keyed on radiusKm) without
// any changes to that shared code.
const NOMINAL_RADIUS_KM = 2;

const places = PLACES.map(([id, name, ru, lat, lon, region]) => {
  const [cx, cy] = project(region, lon, lat);
  return { id, name, ru, cx: +cx.toFixed(1), cy: +cy.toFixed(1), radiusKm: NOMINAL_RADIUS_KM };
});

console.error('places', places.length);
console.error(places.map((p) => ({ id: p.id, cx: p.cx, cy: p.cy })));

let out = `// Auto-generated by scripts/build_usa_places.js — projects a curated list\n`;
out += `// of famous US landmarks with the exact same Albers projection +\n`;
out += `// normalization (and AK/HI insets) as scripts/build_usa_level.js /\n`;
out += `// build_usa_cities.js, so these line up with levels/usa.js.\n`;
out += `// Regenerate: node scripts/build_usa_places.js\n`;
out += `export default [\n`;
for (const p of places) {
  out += `  { id: '${p.id}', name: '${p.name.replace(/'/g, "\\'")}', ru: '${p.ru.replace(/'/g, "\\'")}', cx: ${p.cx}, cy: ${p.cy}, radiusKm: ${p.radiusKm} },\n`;
}
out += `];\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaPlaces.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
