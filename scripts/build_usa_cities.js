// Companion to build_usa_level.js: projects a curated list of US cities
// (every state capital + the biggest non-capital metros) onto the exact
// same canvas coordinate system as levels/usa.js, by re-deriving the same
// Albers projection + normalization (and the same AK/HI inset formulas)
// from the same source GeoJSON, so city dots and state borders line up.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'data', 'us-states.geojson');
const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// id -> { d, bbox } for the handful of cities with a real projected
// municipal-boundary shape instead of a plain radius dot — produced by
// scripts/build_city_silhouettes.js (run that first if this is missing).
const SILHOUETTES_PATH = path.join(__dirname, 'data', 'city-silhouettes.generated.json');
const SILHOUETTES = fs.existsSync(SILHOUETTES_PATH) ? JSON.parse(fs.readFileSync(SILHOUETTES_PATH, 'utf8')) : {};

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
// Shifts the WHOLE canvas (mainland included) so Alaska/Canada (which
// land north/negative-y) and Hawaii (far west/negative-x) don't go
// negative — see build_usa_level.js's own comment. Exact value from that
// script's console.error output; must match exactly or city dots drift
// off their state's own outline.
const GLOBAL_SHIFT_X = 839.9193530147361;
const GLOBAL_SHIFT_Y = 715.4619231706608;
function toCanvasMain([lon, lat]) {
  const [x, y] = albers([lon, lat]);
  return [(x - minX) * scale + MARGIN + GLOBAL_SHIFT_X, (y - minY) * scale + MARGIN + GLOBAL_SHIFT_Y];
}

// ---- Alaska/Hawaii: true relative position + true scale — must exactly
// match build_usa_level.js's buildTruePosition (same anchor lon/lat, same
// TRUE_SCALE, same GLOBAL_SHIFT via toCanvasMain above) or city dots land
// off the state's own outline. See that script's own comment for why the
// shape uses this local projection instead of the main Albers formula.
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
// Exact anchors from build_usa_level.js's own console.error output.
const toCanvasAK = trueScaleProjector(-159.4456165, 61.482186500000005);
const toCanvasHI = trueScaleProjector(-157.2861325, 20.588611);

function project(region, lon, lat) {
  if (region === 'AK') return toCanvasAK([lon, lat]);
  if (region === 'HI') return toCanvasHI([lon, lat]);
  return toCanvasMain([lon, lat]);
}

// [id, name, ru, state, lat, lon, isCapital, region?]
const CITIES = [
  ['montgomery', 'Montgomery', 'Монтгомери', 'AL', 32.38, -86.30, true],
  ['birmingham', 'Birmingham', 'Бирмингем', 'AL', 33.52, -86.81, false],
  ['juneau', 'Juneau', 'Джуно', 'AK', 58.30, -134.42, true, 'AK'],
  ['anchorage', 'Anchorage', 'Анкоридж', 'AK', 61.22, -149.90, false, 'AK'],
  ['phoenix', 'Phoenix', 'Финикс', 'AZ', 33.45, -112.07, true],
  ['tucson', 'Tucson', 'Тусон', 'AZ', 32.22, -110.97, false],
  ['little_rock', 'Little Rock', 'Литл-Рок', 'AR', 34.75, -92.29, true],
  ['sacramento', 'Sacramento', 'Сакраменто', 'CA', 38.58, -121.49, true],
  ['los_angeles', 'Los Angeles', 'Лос-Анджелес', 'CA', 34.05, -118.24, false],
  ['san_francisco', 'San Francisco', 'Сан-Франциско', 'CA', 37.77, -122.42, false],
  ['san_diego', 'San Diego', 'Сан-Диего', 'CA', 32.72, -117.16, false],
  ['san_jose', 'San Jose', 'Сан-Хосе', 'CA', 37.34, -121.89, false],
  ['denver', 'Denver', 'Денвер', 'CO', 39.74, -104.99, true],
  ['hartford', 'Hartford', 'Хартфорд', 'CT', 41.76, -72.69, true],
  ['dover', 'Dover', 'Довер', 'DE', 39.16, -75.52, true],
  ['washington_dc', 'Washington, D.C.', 'Вашингтон', 'DC', 38.90, -77.04, false],
  ['tallahassee', 'Tallahassee', 'Таллахасси', 'FL', 30.44, -84.28, true],
  ['miami', 'Miami', 'Майами', 'FL', 25.76, -80.19, false],
  ['jacksonville', 'Jacksonville', 'Джэксонвилл', 'FL', 30.33, -81.66, false],
  ['orlando', 'Orlando', 'Орландо', 'FL', 28.54, -81.38, false],
  ['atlanta', 'Atlanta', 'Атланта', 'GA', 33.75, -84.39, true],
  ['honolulu', 'Honolulu', 'Гонолулу', 'HI', 21.31, -157.86, true, 'HI'],
  ['boise', 'Boise', 'Бойсе', 'ID', 43.62, -116.20, true],
  ['springfield_il', 'Springfield', 'Спрингфилд', 'IL', 39.80, -89.64, true],
  ['chicago', 'Chicago', 'Чикаго', 'IL', 41.88, -87.63, false],
  ['indianapolis', 'Indianapolis', 'Индианаполис', 'IN', 39.77, -86.16, true],
  ['des_moines', 'Des Moines', 'Де-Мойн', 'IA', 41.59, -93.62, true],
  ['topeka', 'Topeka', 'Топика', 'KS', 39.06, -95.68, true],
  ['wichita', 'Wichita', 'Уичито', 'KS', 37.69, -97.34, false],
  ['frankfort', 'Frankfort', 'Франкфорт', 'KY', 38.20, -84.87, true],
  ['louisville', 'Louisville', 'Луисвилл', 'KY', 38.25, -85.76, false],
  ['baton_rouge', 'Baton Rouge', 'Батон-Руж', 'LA', 30.45, -91.19, true],
  ['new_orleans', 'New Orleans', 'Новый Орлеан', 'LA', 29.95, -90.07, false],
  ['augusta', 'Augusta', 'Огаста', 'ME', 44.31, -69.78, true],
  ['annapolis', 'Annapolis', 'Аннаполис', 'MD', 38.98, -76.49, true],
  ['baltimore', 'Baltimore', 'Балтимор', 'MD', 39.29, -76.61, false],
  ['boston', 'Boston', 'Бостон', 'MA', 42.36, -71.06, true],
  ['lansing', 'Lansing', 'Лансинг', 'MI', 42.73, -84.56, true],
  ['detroit', 'Detroit', 'Детройт', 'MI', 42.33, -83.05, false],
  ['saint_paul', 'Saint Paul', 'Сент-Пол', 'MN', 44.95, -93.09, true],
  ['minneapolis', 'Minneapolis', 'Миннеаполис', 'MN', 44.98, -93.27, false],
  ['jackson', 'Jackson', 'Джексон', 'MS', 32.30, -90.18, true],
  ['jefferson_city', 'Jefferson City', 'Джефферсон-Сити', 'MO', 38.58, -92.17, true],
  ['st_louis', 'St. Louis', 'Сент-Луис', 'MO', 38.63, -90.20, false],
  ['kansas_city', 'Kansas City', 'Канзас-Сити', 'MO', 39.10, -94.58, false],
  ['helena', 'Helena', 'Хелена', 'MT', 46.59, -112.04, true],
  ['lincoln', 'Lincoln', 'Линкольн', 'NE', 40.81, -96.68, true],
  ['omaha', 'Omaha', 'Омаха', 'NE', 41.26, -95.93, false],
  ['carson_city', 'Carson City', 'Карсон-Сити', 'NV', 39.16, -119.77, true],
  ['las_vegas', 'Las Vegas', 'Лас-Вегас', 'NV', 36.17, -115.14, false],
  ['concord', 'Concord', 'Конкорд', 'NH', 43.21, -71.54, true],
  ['trenton', 'Trenton', 'Трентон', 'NJ', 40.22, -74.76, true],
  ['newark', 'Newark', 'Ньюарк', 'NJ', 40.74, -74.17, false],
  ['santa_fe', 'Santa Fe', 'Санта-Фе', 'NM', 35.69, -105.94, true],
  ['albuquerque', 'Albuquerque', 'Альбукерке', 'NM', 35.08, -106.65, false],
  ['albany', 'Albany', 'Олбани', 'NY', 42.65, -73.75, true],
  ['new_york', 'New York', 'Нью-Йорк', 'NY', 40.71, -74.01, false],
  ['raleigh', 'Raleigh', 'Роли', 'NC', 35.78, -78.64, true],
  ['charlotte', 'Charlotte', 'Шарлотт', 'NC', 35.23, -80.84, false],
  ['bismarck', 'Bismarck', 'Бисмарк', 'ND', 46.81, -100.78, true],
  ['columbus', 'Columbus', 'Колумбус', 'OH', 39.96, -83.00, true],
  ['cleveland', 'Cleveland', 'Кливленд', 'OH', 41.50, -81.69, false],
  ['oklahoma_city', 'Oklahoma City', 'Оклахома-Сити', 'OK', 35.47, -97.52, true],
  ['tulsa', 'Tulsa', 'Талса', 'OK', 36.15, -95.99, false],
  ['salem', 'Salem', 'Сейлем', 'OR', 44.94, -123.04, true],
  ['portland_or', 'Portland', 'Портленд', 'OR', 45.52, -122.68, false],
  ['harrisburg', 'Harrisburg', 'Гаррисберг', 'PA', 40.27, -76.88, true],
  ['philadelphia', 'Philadelphia', 'Филадельфия', 'PA', 39.95, -75.17, false],
  ['pittsburgh', 'Pittsburgh', 'Питтсбург', 'PA', 40.44, -79.99, false],
  ['providence', 'Providence', 'Провиденс', 'RI', 41.82, -71.41, true],
  ['columbia', 'Columbia', 'Колумбия', 'SC', 34.00, -81.03, true],
  ['pierre', 'Pierre', 'Пирр', 'SD', 44.37, -100.35, true],
  ['nashville', 'Nashville', 'Нэшвилл', 'TN', 36.16, -86.78, true],
  ['memphis', 'Memphis', 'Мемфис', 'TN', 35.15, -90.05, false],
  ['austin', 'Austin', 'Остин', 'TX', 30.27, -97.74, true],
  ['houston', 'Houston', 'Хьюстон', 'TX', 29.76, -95.37, false],
  ['san_antonio', 'San Antonio', 'Сан-Антонио', 'TX', 29.42, -98.49, false],
  ['dallas', 'Dallas', 'Даллас', 'TX', 32.78, -96.80, false],
  ['fort_worth', 'Fort Worth', 'Форт-Уэрт', 'TX', 32.75, -97.33, false],
  ['el_paso', 'El Paso', 'Эль-Пасо', 'TX', 31.76, -106.49, false],
  // Both real termini of I-27 (see scripts/build_usa_highways.js) — without
  // these, that highway's line just stopped in empty space on the map with
  // nothing marking where it actually ends, even though the underlying
  // data was correct all along.
  ['amarillo', 'Amarillo', 'Амарилло', 'TX', 35.22, -101.83, false],
  ['lubbock', 'Lubbock', 'Лаббок', 'TX', 33.58, -101.86, false],
  ['salt_lake_city', 'Salt Lake City', 'Солт-Лейк-Сити', 'UT', 40.76, -111.89, true],
  ['montpelier', 'Montpelier', 'Монтпилиер', 'VT', 44.26, -72.58, true],
  ['richmond', 'Richmond', 'Ричмонд', 'VA', 37.54, -77.44, true],
  ['virginia_beach', 'Virginia Beach', 'Виргиния-Бич', 'VA', 36.85, -75.98, false],
  ['langley', 'Langley (CIA HQ)', 'Лэнгли (штаб-квартира ЦРУ)', 'VA', 38.95, -77.15, false],
  ['olympia', 'Olympia', 'Олимпия', 'WA', 47.04, -122.90, true],
  ['seattle', 'Seattle', 'Сиэтл', 'WA', 47.61, -122.33, false],
  ['charleston_wv', 'Charleston', 'Чарлстон', 'WV', 38.35, -81.63, true],
  ['madison', 'Madison', 'Мадисон', 'WI', 43.07, -89.40, true],
  ['milwaukee', 'Milwaukee', 'Милуоки', 'WI', 43.04, -87.91, false],
  ['cheyenne', 'Cheyenne', 'Шайенн', 'WY', 41.14, -104.82, true],
  // Hawaii — beyond the capital (Honolulu, already above), one real town
  // per major island for actual coverage: Hilo/Kailua-Kona (Hawaii
  // island), Kahului (Maui), Kapaa/Lihue (Kauai — Kapaa sits right on
  // Kuhio Highway, see scripts/build_hawaii_highways.js), Kailua/Kaneohe/
  // Pearl City (windward/central Oahu). Coordinates + land area (for
  // RADIUS_KM below) verified against Census Bureau CDP profiles, same
  // sourcing standard as RADIUS_KM's own comment.
  ['hilo', 'Hilo', 'Хило', 'HI', 19.7297, -155.0900, false, 'HI'],
  ['kailua_kona', 'Kailua-Kona', 'Кайлуа-Кона', 'HI', 19.6400, -155.9969, false, 'HI'],
  ['kahului', 'Kahului', 'Кахулуи', 'HI', 20.8893, -156.4729, false, 'HI'],
  ['kapaa', 'Kapaa', 'Капаа', 'HI', 22.0752, -159.3190, false, 'HI'],
  ['lihue', 'Lihue', 'Лихуэ', 'HI', 21.9811, -159.3711, false, 'HI'],
  ['kailua_oahu', 'Kailua', 'Кайлуа', 'HI', 21.4022, -157.7394, false, 'HI'],
  ['kaneohe', 'Kaneohe', 'Канеохе', 'HI', 21.4180, -157.8036, false, 'HI'],
  ['pearl_city', 'Pearl City', 'Перл-Сити', 'HI', 21.3972, -157.9752, false, 'HI'],
];

// Effective radius (km) of each city's land area — sqrt(land_km2 / pi), so
// a city with an irregular footprint gets the radius of a circle covering
// the same area. Source: US Census Bureau 2024 Gazetteer Files (ALAND_SQMI
// per place, https://www2.census.gov/geo/docs/maps-data/data/gazetteer/),
// matched by name; four consolidated city-county governments (Honolulu,
// Carson City, Nashville, Louisville) needed their official Census place
// name looked up by hand since it doesn't match the plain city name —
// Louisville's naming ("Louisville/Jefferson County metro government
// (balance)") was initially missed by the automated match because of the
// "/" right after the city name, which silently picked the small legacy
// "Louisville city" remnant instead; corrected using the real metro figure
// found while extracting scripts/data/us-city-boundaries.geojson.
const RADIUS_KM = {
  montgomery: 11.48, birmingham: 11.01, juneau: 47.21, anchorage: 37.51,
  phoenix: 20.67, tucson: 14.13, little_rock: 10, sacramento: 9.02,
  los_angeles: 19.7, san_francisco: 6.2, san_diego: 16.4, san_jose: 12.11,
  denver: 11.23, hartford: 3.79, dover: 4.43, washington_dc: 7.1,
  tallahassee: 9.2, miami: 5.45, jacksonville: 24.82, orlando: 9.57,
  atlanta: 10.56, honolulu: 7.07, boise: 8.38, springfield_il: 7.11,
  chicago: 13.7, indianapolis: 17.25, des_moines: 8.53, topeka: 7.14,
  wichita: 11.67, frankfort: 3.49, louisville: 14.73, baton_rouge: 8.47,
  new_orleans: 11.82, augusta: 6.74, annapolis: 2.44, baltimore: 8.17,
  boston: 6.31, lansing: 5.7, detroit: 10.69, saint_paul: 6.55,
  minneapolis: 6.67, jackson: 9.6, jefferson_city: 5.45, st_louis: 7.13,
  kansas_city: 16.1, helena: 6.62, lincoln: 9.13, omaha: 10.85,
  carson_city: 10.92, las_vegas: 10.81, concord: 7.26, trenton: 2.5,
  newark: 4.46, santa_fe: 6.56, albuquerque: 12.43, albany: 4.2,
  new_york: 15.74, raleigh: 11.15, charlotte: 16.03, bismarck: 5.35,
  columbus: 13.51, cleveland: 8.01, oklahoma_city: 22.36, tulsa: 12.77,
  salem: 6.35, portland_or: 10.49, harrisburg: 2.59, philadelphia: 10.52,
  pittsburgh: 6.76, providence: 3.9, columbia: 10.69, pierre: 3.28,
  nashville: 19.8, memphis: 15.46, austin: 16.4, houston: 22.98,
  san_antonio: 20.28, dallas: 16.73, fort_worth: 17.03, el_paso: 14.61,
  amarillo: 9.19, lubbock: 10.09,
  salt_lake_city: 9.56, montpelier: 2.88, richmond: 7.03, virginia_beach: 14.2,
  langley: 4.52, olympia: 3.88, seattle: 8.32, charleston_wv: 5.09,
  madison: 8.3, milwaukee: 8.9, cheyenne: 5.48,
  hilo: 6.64, kailua_kona: 3.37, kahului: 3.44, kapaa: 2.87, lihue: 2.35,
  kailua_oahu: 2.54, kaneohe: 2.31, pearl_city: 2.03,
};

const cities = CITIES.map(([id, name, ru, state, lat, lon, capital, region]) => {
  const [cx, cy] = project(region, lon, lat);
  const silhouette = SILHOUETTES[id];
  return {
    id, name, ru, state, capital: !!capital,
    cx: +cx.toFixed(1), cy: +cy.toFixed(1), radiusKm: RADIUS_KM[id],
    d: silhouette?.d, bbox: silhouette?.bbox,
  };
});

// ---- snap onto the coastline any city whose real coordinates land just
// outside its own state's SIMPLIFIED polygon — a normal, small side
// effect of a low-vertex-count coastline (Oahu's Pearl Harbor/Kailua Bay/
// Kaneohe Bay mouths get smoothed straight across), not a projection bug.
// Nudges onto (and 1.5 units past) the nearest boundary point rather than
// leaving the dot floating a few km out at sea. Real city coordinates are
// unchanged for every city that's already inside — this only touches the
// rare edge case.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearestOnRing(x, y, ring) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = [cx, cy]; }
  }
  return { pt: best, dist: bestD };
}
function stateRings(featureName, region) {
  const feature = geo.features.find((f) => f.properties.name === featureName);
  const rings = [];
  forEachRing(feature.geometry, (ring) => rings.push(ring.map(([lon, lat]) => project(region, lon, lat))));
  return rings;
}
const STATE_NAME_BY_ID = { HI: 'Hawaii', AK: 'Alaska' };
const coastlineCache = new Map();
for (const c of cities) {
  const stateName = STATE_NAME_BY_ID[c.state];
  if (!stateName) continue; // only AK/HI's own simplified coastline is a concern here
  if (!coastlineCache.has(c.state)) coastlineCache.set(c.state, stateRings(stateName, c.state));
  const rings = coastlineCache.get(c.state);
  if (rings.some((r) => pointInRing(c.cx, c.cy, r))) continue;
  let best = null;
  for (const r of rings) {
    const { pt, dist } = nearestOnRing(c.cx, c.cy, r);
    if (!best || dist < best.dist) best = { pt, dist };
  }
  const dirX = best.pt[0] - c.cx, dirY = best.pt[1] - c.cy;
  const len = Math.hypot(dirX, dirY) || 1;
  console.error(`snapped ${c.id} onto ${stateName}'s coastline (was ${best.dist.toFixed(2)} canvas units outside — simplified-coastline artifact)`);
  c.cx = +(best.pt[0] + (dirX / len) * 1.5).toFixed(1);
  c.cy = +(best.pt[1] + (dirY / len) * 1.5).toFixed(1);
}

console.error('cities', cities.length, '(', Object.keys(SILHOUETTES).length, 'with a real silhouette )');
console.error('sample', cities.filter((c) => ['new_york', 'los_angeles', 'seattle', 'miami', 'juneau', 'honolulu'].includes(c.id)).map((c) => ({ ...c, d: c.d && c.d.slice(0, 20) + '…' })));

let out = `// Auto-generated by scripts/build_usa_cities.js — projects a curated list\n`;
out += `// of US cities (every state capital + the biggest non-capital metros) with\n`;
out += `// the exact same Albers projection + normalization (and AK/HI insets) as\n`;
out += `// scripts/build_usa_level.js, so these line up with levels/usa.js. A few\n`;
out += `// large/distinctive cities also carry \`d\`/\`bbox\` — a real projected\n`;
out += `// municipal-boundary shape (see build_city_silhouettes.js) instead of just\n`;
out += `// a point; js/overviewBoard.js renders those as a filled shape like a\n`;
out += `// state piece rather than a radius dot.\n`;
out += `// Regenerate: node scripts/build_usa_cities.js\n`;
out += `export default [\n`;
for (const c of cities) {
  let line = `  { id: '${c.id}', name: '${c.name.replace(/'/g, "\\'")}', ru: '${c.ru.replace(/'/g, "\\'")}', state: '${c.state}', capital: ${c.capital}, cx: ${c.cx}, cy: ${c.cy}, radiusKm: ${c.radiusKm}`;
  if (c.d) line += `, bbox: [${c.bbox.join(', ')}], d: '${c.d}'`;
  line += ' },\n';
  out += line;
}
out += `];\n`;

const outPath = path.join(__dirname, '..', 'levels', 'usaCities.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
