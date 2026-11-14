// One-off / refresh helper: pulls curated mountain-range + national-park
// polygons out of Natural Earth's public-domain layers into a small
// FeatureCollection that scripts/build_usa_place_polys.js projects.
//
// Prerequisites (download once; not committed — too big):
//   curl.exe -sL -o scripts/data/ne_10m_geography_regions_polys.geojson ^
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_polys.geojson
//   curl.exe -sL -o scripts/data/ne_10m_parks_area.geojson ^
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_parks_and_protected_lands_area.geojson
//
// Then: node scripts/filter_usa_place_polys.js
//       node scripts/build_usa_place_polys.js
//
// NE's APPALACHIAN MTS. / ROCKY MOUNTAINS / CASCADE RANGE blobs extend well
// into Canada (Gaspé at −64° reads as "ocean" on the USA Albers map). After
// picking, features are clipped to US state land (scripts/data/us-states.geojson)
// via mapshaper so only the domestic footprint remains.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REGIONS_SRC = path.join(__dirname, 'data', 'ne_10m_geography_regions_polys.geojson');
const PARKS_SRC = path.join(__dirname, 'data', 'ne_10m_parks_area.geojson');
const STATES_SRC = path.join(__dirname, 'data', 'us-states.geojson');
const OUT = path.join(__dirname, 'data', 'us-place-polys.geojson');
const MASK = path.join(__dirname, 'data', 'us-land-mask.geojson');
const RAW = path.join(__dirname, 'data', 'us-place-polys-raw.geojson');

// Ranges / plateaus / gorges from geography_regions_polys (match on NAME).
const REGION_PICKS = [
  { neName: 'APPALACHIAN MTS.', id: 'appalachians', name: 'Appalachian Mountains', ru: 'Аппалачи', kind: 'range' },
  { neName: 'SIERRA NEVADA', id: 'sierra_nevada', name: 'Sierra Nevada', ru: 'Сьерра-Невада', kind: 'range' },
  { neName: 'ROCKY MOUNTAINS', id: 'rocky_mountains', name: 'Rocky Mountains', ru: 'Скалистые горы', kind: 'range' },
  { neName: 'CASCADE RANGE', id: 'cascade_range', name: 'Cascade Range', ru: 'Каскадные горы', kind: 'range' },
  { neName: 'COAST RANGES', id: 'coast_ranges', name: 'Pacific Coast Ranges', ru: 'Береговые хребты', kind: 'range' },
  { neName: 'ALASKA RANGE', id: 'alaska_range', name: 'Alaska Range', ru: 'Аляскинский хребет', kind: 'range' },
  { neName: 'BROOKS RANGE', id: 'brooks_range', name: 'Brooks Range', ru: 'Хребет Брукса', kind: 'range' },
  { neName: 'Wasatch Range', id: 'wasatch_range', name: 'Wasatch Range', ru: 'Хребет Уосатч', kind: 'range' },
  { neName: 'Black Hills', id: 'black_hills', name: 'Black Hills', ru: 'Блэк-Хиллс', kind: 'range' },
  { neName: 'Adirondack Mts.', id: 'adirondacks', name: 'Adirondack Mountains', ru: 'Адирондак', kind: 'range' },
];

// NPS area units (match on short `name` field — "Yellowstone", not the full unit_name).
const PARK_PICKS = [
  { neName: 'Yellowstone', id: 'yellowstone', name: 'Yellowstone National Park', ru: 'Йеллоустоунский парк', kind: 'park' },
  { neName: 'Death Valley', id: 'death_valley', name: 'Death Valley', ru: 'Долина Смерти', kind: 'park' },
  { neName: 'Everglades', id: 'everglades', name: 'Everglades', ru: 'Эверглейдс', kind: 'park' },
  { neName: 'Grand Canyon', id: 'grand_canyon', name: 'Grand Canyon', ru: 'Гранд-Каньон', kind: 'park' },
  { neName: 'Yosemite', id: 'yosemite', name: 'Yosemite National Park', ru: 'Йосемити', kind: 'park' },
  { neName: 'Denali', id: 'denali', name: 'Denali National Park', ru: 'Денали', kind: 'park' },
];

function pick(features, picks, nameOf) {
  const byName = new Map();
  for (const f of features) {
    const n = nameOf(f);
    if (n) byName.set(n, f);
  }
  const out = [];
  for (const pick of picks) {
    const f = byName.get(pick.neName);
    if (!f) throw new Error(`Missing Natural Earth feature: ${pick.neName}`);
    out.push({
      type: 'Feature',
      properties: { id: pick.id, name: pick.name, ru: pick.ru, kind: pick.kind, neName: pick.neName },
      geometry: f.geometry,
    });
  }
  return out;
}

function mapshaper(args) {
  execFileSync('npx', ['--yes', 'mapshaper', ...args], { stdio: 'inherit', shell: true });
}

const regions = JSON.parse(fs.readFileSync(REGIONS_SRC, 'utf8'));
const parks = JSON.parse(fs.readFileSync(PARKS_SRC, 'utf8'));

const features = [
  ...pick(regions.features, REGION_PICKS, (f) => f.properties.NAME),
  ...pick(parks.features, PARK_PICKS, (f) => f.properties.name),
];

fs.writeFileSync(RAW, JSON.stringify({ type: 'FeatureCollection', features }));

// Dissolve US states (drop PR) → clip NE ranges/parks to domestic land only.
mapshaper([
  '-i', STATES_SRC,
  '-filter', `name != 'Puerto Rico'`,
  '-dissolve',
  '-o', 'format=geojson', 'precision=0.0001', MASK, 'force',
]);
mapshaper([
  '-i', RAW,
  '-clip', MASK,
  '-o', 'format=geojson', 'precision=0.0001', OUT, 'force',
]);

fs.unlinkSync(RAW);
fs.unlinkSync(MASK);

const clipped = JSON.parse(fs.readFileSync(OUT, 'utf8'));
console.error(
  'wrote',
  OUT,
  clipped.features.length,
  'features:',
  clipped.features.map((f) => f.properties.id).join(', '),
);
console.error('bytes', fs.statSync(OUT).size);
