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
// Shifts the WHOLE canvas (mainland included) so Alaska/Canada (north/
// negative-y) and Hawaii (far west/negative-x) don't go negative — exact
// value from build_usa_level.js's own console.error output; must match
// exactly or place dots drift off their state's own outline.
const GLOBAL_SHIFT_X = 856.7122654651434;
const GLOBAL_SHIFT_Y = 636.0468616448984;
function toCanvasMain([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN + GLOBAL_SHIFT_X, (y - minY) * scale + MARGIN + GLOBAL_SHIFT_Y];
}

// ---- Hawaii: true relative position + true scale — must exactly match
// build_usa_level.js's buildTruePosition (same anchor lon/lat, same
// TRUE_SCALE, same GLOBAL_SHIFT via toCanvasMain above).
const TRUE_SCALE = deg2rad(1) * scale;
function trueScaleProjector(anchorLon, anchorLat) {
  const cosLat = Math.cos(deg2rad(anchorLat));
  const [anchorX, anchorY] = toCanvasMain([anchorLon, anchorLat]);
  return ([lon, lat]) => {
    const l = lon > 0 ? lon - 360 : lon;
    const x = (l - anchorLon) * cosLat * TRUE_SCALE + anchorX;
    const y = (anchorLat - lat) * TRUE_SCALE + anchorY;
    return [x, y];
  };
}
// Exact anchor from build_usa_level.js's own console.error output.
const toCanvasHI = trueScaleProjector(-157.6783335, 20.5779665);

// Alaska now goes through toCanvasMain directly (raw Albers) — see
// build_usa_level.js's own comment on why Alaska switched off the
// true-position hybrid.
function project(region, lon, lat) {
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
  // Wikipedia (verified via the MediaWiki API, not just the article prose):
  // 38.525°N 111.75°W, Fishlake National Forest, Sevier County, UT.
  ['pando', 'Pando', 'Пандо', 38.525, -111.75],
  // 10 more Hawaii landmarks (all real, coordinates verified via the
  // MediaWiki API's own `coordinates` field, not guessed from prose) — see
  // levels/usa/places-info.json for the matching info-popup entries. Three
  // of these (Nā Pali, Hawaiʻi Volcanoes NP, Kalaupapa) have no Russian
  // Wikipedia article at all (checked via langlinks, not just a failed
  // search) — same "real English source, honestly linked" call as
  // usaHawaiiHighways.js's Kaneohe/Kailua city-info entries.
  ['na_pali_coast', 'Nā Pali Coast', 'На-Пали', 22.17552, -159.64362, 'HI'],
  ['pearl_harbor', 'USS Arizona Memorial', 'Мемориал USS Arizona (Пёрл-Харбор)', 21.365, -157.95, 'HI'],
  ['diamond_head', 'Diamond Head', 'Даймонд-Хед', 21.25972, -157.81175, 'HI'],
  ['haleakala', 'Haleakalā', 'Халеакала', 20.71333, -156.2575, 'HI'],
  ['hawaii_volcanoes_np', 'Hawaiʻi Volcanoes National Park', 'Нацпарк «Вулканы Гавайев»', 19.38333, -155.2, 'HI'],
  ['waimea_canyon', 'Waimea Canyon', 'Каньон Ваймеа', 22.05611, -159.66528, 'HI'],
  ['kalaupapa', 'Kalaupapa', 'Калаупапа', 21.18944, -156.98167, 'HI'],
  // Anchored at the town of Hāna itself (the highway's real coordinates
  // API summary has no single `coordinates` point — it's a 103km road) —
  // the actual destination everyone means by "the road to Hana".
  ['hana_highway', 'Road to Hāna', 'Дорога в Хану', 20.77, -155.99417, 'HI'],
  ['iolani_palace', 'ʻIolani Palace', 'Дворец Иолани', 21.306622, -157.858958, 'HI'],
  ['puuhonua_o_honaunau', 'Puʻuhonua o Hōnaunau', 'Пуухонуа-о-Хонаунау', 19.4219, -155.91, 'HI'],
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
