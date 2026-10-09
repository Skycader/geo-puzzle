// Companion to build_usa_places.js: projects the major US airports AND their
// real runways (OurAirports data, filtered to the airports below by
// scripts/extract_airport_runways.js into
// scripts/data/airport-runways.generated.json) onto the same canvas
// coordinate system as levels/usa.js — same Albers projection + AK/HI inset
// formulas — so airports line up with state borders, cities and highways.
// Each runway keeps its real endpoints, so length and bearing are true to
// scale (the map is ~4.7 km per canvas unit, so a runway is sub-pixel until
// you zoom in a long way).
// Regenerate: node scripts/build_usa_airports.js
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


const RUNWAYS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'airport-runways.generated.json'), 'utf8'));

// iata -> [Russian short name, English short name].
const NAMES = {
  ATL: ['Хартсфилд — Джексон (Атланта)', 'Hartsfield–Jackson (Atlanta)'],
  LAX: ['Лос-Анджелес', 'Los Angeles'],
  ORD: ["О'Хара (Чикаго)", "O'Hare (Chicago)"],
  DFW: ['Даллас/Форт-Уэрт', 'Dallas/Fort Worth'],
  DEN: ['Денвер', 'Denver'],
  JFK: ['Кеннеди (Нью-Йорк)', 'John F. Kennedy (New York)'],
  SFO: ['Сан-Франциско', 'San Francisco'],
  SEA: ['Сиэтл — Такома', 'Seattle–Tacoma'],
  LAS: ['Гарри Рид (Лас-Вегас)', 'Harry Reid (Las Vegas)'],
  MCO: ['Орландо', 'Orlando'],
  EWR: ['Ньюарк Либерти', 'Newark Liberty'],
  CLT: ['Шарлотт — Дуглас', 'Charlotte Douglas'],
  PHX: ['Финикс Скай-Харбор', 'Phoenix Sky Harbor'],
  MIA: ['Майами', 'Miami'],
  IAH: ['Джордж Буш (Хьюстон)', 'George Bush (Houston)'],
  BOS: ['Логан (Бостон)', 'Logan (Boston)'],
  MSP: ['Миннеаполис — Сент-Пол', 'Minneapolis–Saint Paul'],
  FLL: ['Форт-Лодердейл — Голливуд', 'Fort Lauderdale–Hollywood'],
  DTW: ['Детройт Метрополитан', 'Detroit Metropolitan'],
  PHL: ['Филадельфия', 'Philadelphia'],
  LGA: ['Ла-Гуардия (Нью-Йорк)', 'LaGuardia (New York)'],
  BWI: ['Балтимор / Вашингтон', 'Baltimore/Washington'],
  SLC: ['Солт-Лейк-Сити', 'Salt Lake City'],
  SAN: ['Сан-Диего', 'San Diego'],
  DCA: ['Рейган (Вашингтон)', 'Reagan National (Washington)'],
  IAD: ['Даллес (Вашингтон)', 'Dulles (Washington)'],
  TPA: ['Тампа', 'Tampa'],
  BNA: ['Нашвилл', 'Nashville'],
  AUS: ['Остин — Бергстром', 'Austin–Bergstrom'],
  MDW: ['Мидуэй (Чикаго)', 'Midway (Chicago)'],
  HNL: ['Дэниел Иноуэ (Гонолулу)', 'Daniel K. Inouye (Honolulu)'],
  DAL: ['Лав-Филд (Даллас)', 'Love Field (Dallas)'],
  PDX: ['Портленд', 'Portland'],
  STL: ['Сент-Луис Ламберт', 'St. Louis Lambert'],
  RDU: ['Роли — Дарем', 'Raleigh–Durham'],
  MCI: ['Канзас-Сити', 'Kansas City'],
  SMF: ['Сакраменто', 'Sacramento'],
  SJC: ['Сан-Хосе', 'San Jose'],
  OAK: ['Окленд', 'Oakland'],
  MSY: ['Луис Армстронг (Новый Орлеан)', 'Louis Armstrong (New Orleans)'],
  SAT: ['Сан-Антонио', 'San Antonio'],
  CLE: ['Кливленд Хопкинс', 'Cleveland Hopkins'],
  PIT: ['Питтсбург', 'Pittsburgh'],
  CVG: ['Цинциннати — Северный Кентукки', 'Cincinnati/Northern Kentucky'],
  CMH: ['Джон Гленн (Колумбус)', 'John Glenn (Columbus)'],
  IND: ['Индианаполис', 'Indianapolis'],
  MKE: ['Милуоки Митчелл', 'Milwaukee Mitchell'],
  ANC: ['Анкоридж (Тед Стивенс)', 'Anchorage (Ted Stevens)'],
  OGG: ['Кахулуи (Мауи)', 'Kahului (Maui)'],
  ABQ: ['Альбукерке Санпорт', 'Albuquerque Sunport'],
  KOA: ['Кона (Кайлуа-Кона)', 'Kona (Kailua-Kona)'],
  ITO: ['Хило', 'Hilo'],
  LIH: ['Лихуэ (Кауаи)', 'Lihue (Kauai)'],
  MKK: ['Молокаи', 'Molokai'],
  LNY: ['Ланаи', 'Lanai'],
  JHM: ['Капалуа (Мауи)', 'Kapalua (Maui)'],
  HNM: ['Хана (Мауи)', 'Hana (Maui)'],
  LUP: ['Калаупапа (Молокаи)', 'Kalaupapa (Molokai)'],
  BHM: ['Бирмингем — Шаттлсуорт', 'Birmingham–Shuttlesworth'],
  HSV: ['Хантсвилл', 'Huntsville'],
  FAI: ['Фэрбанкс', 'Fairbanks'],
  JNU: ['Джуно', 'Juneau'],
  KTN: ['Кетчикан', 'Ketchikan'],
  BET: ['Бетел', 'Bethel'],
  OME: ['Ном', 'Nome'],
  ADQ: ['Кадьяк', 'Kodiak'],
  TUS: ['Тусон', 'Tucson'],
  LIT: ['Литл-Рок', 'Little Rock'],
  XNA: ['Северо-Западный Арканзас', 'Northwest Arkansas'],
  ONT: ['Онтарио', 'Ontario'],
  SNA: ['Санта-Ана (Джон Уэйн)', 'Santa Ana (John Wayne)'],
  BUR: ['Бербанк', 'Burbank'],
  FAT: ['Фресно', 'Fresno'],
  PSP: ['Палм-Спрингс', 'Palm Springs'],
  COS: ['Колорадо-Спрингс', 'Colorado Springs'],
  ASE: ['Аспен', 'Aspen'],
  BDL: ['Брэдли (Хартфорд)', 'Bradley (Hartford)'],
  ILG: ['Уилмингтон', 'Wilmington'],
  JAX: ['Джэксонвилл', 'Jacksonville'],
  RSW: ['Форт-Майерс', 'Fort Myers'],
  DJT: ['Палм-Бич', 'Palm Beach'],
  SRQ: ['Сарасота — Брадентон', 'Sarasota–Bradenton'],
  PNS: ['Пенсакола', 'Pensacola'],
  EYW: ['Ки-Уэст', 'Key West'],
  TLH: ['Таллахасси', 'Tallahassee'],
  SAV: ['Саванна', 'Savannah'],
  BOI: ['Бойсе', 'Boise'],
  DSM: ['Де-Мойн', 'Des Moines'],
  CID: ['Сидар-Рапидс', 'Cedar Rapids'],
  ICT: ['Уичито', 'Wichita'],
  SDF: ['Луисвилл', 'Louisville'],
  LEX: ['Лексингтон', 'Lexington'],
  BTR: ['Батон-Руж', 'Baton Rouge'],
  SHV: ['Шривпорт', 'Shreveport'],
  PWM: ['Портленд (Мэн)', 'Portland (Maine)'],
  BGR: ['Бангор', 'Bangor'],
  GRR: ['Гранд-Рапидс', 'Grand Rapids'],
  JAN: ['Джэксон — Эверс', 'Jackson–Evers'],
  SGF: ['Спрингфилд (Миссури)', 'Springfield (Missouri)'],
  BIL: ['Биллингс', 'Billings'],
  BZN: ['Боузмен', 'Bozeman'],
  MSO: ['Миссула', 'Missoula'],
  GTF: ['Грейт-Фолс', 'Great Falls'],
  HLN: ['Хелена', 'Helena'],
  OMA: ['Омаха', 'Omaha'],
  RNO: ['Рино', 'Reno'],
  MHT: ['Манчестер (Нью-Гэмпшир)', 'Manchester (New Hampshire)'],
  BUF: ['Буффало', 'Buffalo'],
  ROC: ['Рочестер', 'Rochester'],
  SYR: ['Сиракьюс', 'Syracuse'],
  ALB: ['Олбани', 'Albany'],
  AVL: ['Эшвилл', 'Asheville'],
  FAR: ['Фарго', 'Fargo'],
  BIS: ['Бисмарк', 'Bismarck'],
  GFK: ['Гранд-Форкс', 'Grand Forks'],
  MOT: ['Майнот', 'Minot'],
  DAY: ['Дейтон', 'Dayton'],
  OKC: ['Оклахома-Сити', 'Oklahoma City'],
  TUL: ['Талса', 'Tulsa'],
  EUG: ['Юджин', 'Eugene'],
  MDT: ['Гаррисберг (Мидлтаун)', 'Harrisburg (Middletown)'],
  PVD: ['Провиденс', 'Providence'],
  CHS: ['Чарлстон', 'Charleston'],
  GSP: ['Гринвилл — Спартанберг', 'Greenville–Spartanburg'],
  MYR: ['Миртл-Бич', 'Myrtle Beach'],
  FSD: ['Су-Фолс', 'Sioux Falls'],
  RAP: ['Рапид-Сити', 'Rapid City'],
  MEM: ['Мемфис', 'Memphis'],
  TYS: ['Ноксвилл', 'Knoxville'],
  HOU: ['Хьюстон Хобби', 'Houston Hobby'],
  ELP: ['Эль-Пасо', 'El Paso'],
  LBB: ['Лаббок', 'Lubbock'],
  AMA: ['Амарилло', 'Amarillo'],
  CRP: ['Корпус-Кристи', 'Corpus Christi'],
  MAF: ['Мидленд', 'Midland'],
  BTV: ['Берлингтон', 'Burlington'],
  RIC: ['Ричмонд', 'Richmond'],
  ORF: ['Норфолк', 'Norfolk'],
  GEG: ['Спокан', 'Spokane'],
  CRW: ['Чарлстон (Западная Виргиния)', 'Charleston (West Virginia)'],
  MSN: ['Мадисон', 'Madison'],
  GRB: ['Грин-Бэй', 'Green Bay'],
  JAC: ['Джэксон-Хоул', 'Jackson Hole'],
  CPR: ['Каспер', 'Casper'],
};

const MINOR = new Set(['BHM', 'HSV', 'FAI', 'JNU', 'KTN', 'BET', 'OME', 'ADQ', 'TUS', 'LIT', 'XNA', 'ONT', 'SNA', 'BUR', 'FAT', 'PSP', 'COS', 'ASE', 'BDL', 'ILG', 'JAX', 'RSW', 'DJT', 'SRQ', 'PNS', 'EYW', 'TLH', 'SAV', 'BOI', 'DSM', 'CID', 'ICT', 'SDF', 'LEX', 'BTR', 'SHV', 'PWM', 'BGR', 'GRR', 'JAN', 'SGF', 'BIL', 'BZN', 'MSO', 'GTF', 'HLN', 'OMA', 'RNO', 'MHT', 'BUF', 'ROC', 'SYR', 'ALB', 'AVL', 'FAR', 'BIS', 'GFK', 'MOT', 'DAY', 'OKC', 'TUL', 'EUG', 'MDT', 'PVD', 'CHS', 'GSP', 'MYR', 'FSD', 'RAP', 'MEM', 'TYS', 'HOU', 'ELP', 'LBB', 'AMA', 'CRP', 'MAF', 'BTV', 'RIC', 'ORF', 'GEG', 'CRW', 'MSN', 'GRB', 'JAC', 'CPR']); // second batch: regional/state airports (labels appear only when zoomed in)
const FT_TO_M = 0.3048;
const airports = Object.entries(RUNWAYS).map(([iata, a]) => {
  if (!NAMES[iata]) throw new Error('no names for ' + iata);
  const state = a.region.replace('US-', '');
  const region = state === 'HI' ? 'HI' : undefined; // only Hawaii has its own inset projection
  const [cx, cy] = project(region, a.lon, a.lat);
  const segs = [];
  const xs = [cx], ys = [cy];
  let longest = 0;
  for (const r of a.runways) {
    const [x1, y1] = project(region, r.le[1], r.le[0]);
    const [x2, y2] = project(region, r.he[1], r.he[0]);
    segs.push(`M ${x1.toFixed(3)},${y1.toFixed(3)} L ${x2.toFixed(3)},${y2.toFixed(3)}`);
    xs.push(x1, x2);
    ys.push(y1, y2);
    longest = Math.max(longest, r.len);
  }
  return {
    id: iata.toLowerCase(), iata, name: NAMES[iata][1], ru: NAMES[iata][0], state,
    cx: +cx.toFixed(2), cy: +cy.toFixed(2),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(2)),
    d: segs.join(' '), runwayCount: a.runways.length, longestM: Math.round(longest * FT_TO_M),
    minor: MINOR.has(iata),
  };
});

console.error('airports', airports.length, 'runways', airports.reduce((s, a) => s + a.runwayCount, 0));

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
let out = '// Auto-generated by scripts/build_usa_airports.js — major US airports with\n';
out += '// their real runways (`d`: one subpath per runway, true endpoints), projected\n';
out += '// like levels/usa.js. Regenerate: node scripts/build_usa_airports.js\n';
out += 'export default [\n';
for (const a of airports) {
  out += `  { id: '${a.id}', iata: '${a.iata}', name: '${q(a.name)}', ru: '${q(a.ru)}', state: '${a.state}', cx: ${a.cx}, cy: ${a.cy}, bbox: [${a.bbox.join(', ')}], runwayCount: ${a.runwayCount}, longestM: ${a.longestM}, ${a.minor ? 'minor: true, ' : ''}d: '${a.d}' },\n`;
}
out += '];\n';
const outPath = path.join(__dirname, '..', 'levels', 'usaAirports.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
