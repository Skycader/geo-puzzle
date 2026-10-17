// Filters Natural Earth's public-domain "populated places" layer (10m) down to the
// cities shown on the world / countries levels: every sovereign capital plus every
// other city of at least MIN_BIG_POP people. Writes the small, committed
// scripts/data/world-cities-source.json; levels/worldCities.js is built from it by
// scripts/build_world_cities.js.
//
// The raw file is ~19 MB, so it is NOT kept; to regenerate:
//   curl -sL -o scripts/data/_ne_populated_places.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson
//   node scripts/extract_world_cities.js
//   (then delete scripts/data/_ne_populated_places.geojson)
//
// Population is Natural Earth's POP_MAX (the largest of its estimates — a
// metro-ish figure, approximate). Capital = FEATURECLA "Admin-0 capital" (NE's
// own designation; a few countries have several, e.g. South Africa, Bolivia).
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, 'data', '_ne_populated_places.geojson');
const OUT = path.join(__dirname, 'data', 'world-cities-source.json');
const MIN_BIG_POP = 4000000;

// NE quirks, fixed by hand (each checked against the real world):
// - NE flags these as capitals but they are not (Johannesburg, Yangon).
const NOT_CAPITALS = new Set(['Johannesburg', 'Yangon']);
// - Suburbs / sub-units of a larger metro that NE lists with a huge POP_MAX.
const SKIP_BIG = new Set(['Irvine', 'Haora', 'Amaravati']);
// - Outdated or mistyped names in NE: name -> [English, Russian].
const RENAME = {
  'Nur-Sultan': ['Astana', 'Астана'],
  Shenyeng: ['Shenyang', 'Шэньян'],
  Xian: ["Xi'an", 'Сиань'],
};

const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\bSt\. /g, 'Saint ').trim();

const geo = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const out = [];
for (const f of geo.features) {
  const p = f.properties;
  const name = tidy(p.NAME);
  const isCap = p.FEATURECLA === 'Admin-0 capital' && !NOT_CAPITALS.has(p.NAME);
  const big = (p.POP_MAX || 0) >= MIN_BIG_POP && !SKIP_BIG.has(p.NAME);
  if (!isCap && !big) continue;
  const [en, ru] = RENAME[name] || [name, (p.NAME_RU || '').trim()];
  if (!ru) throw new Error('no Russian name for ' + name);
  out.push({
    name: en, ru, country: p.ADM0NAME, a3: p.ADM0_A3, capital: isCap,
    lat: +p.LATITUDE.toFixed(4), lon: +p.LONGITUDE.toFixed(4), pop: p.POP_MAX || 0, wikidata: p.WIKIDATAID || null,
  });
}
out.sort((a, b) => b.pop - a.pop);
fs.writeFileSync(OUT, JSON.stringify(out));
console.error('cities', out.length, '(capitals', out.filter((c) => c.capital).length + ')');
