import { getLang, t } from './i18n.js';

// Where each toggleable map layer's data comes from — shown as a small note
// under the layer's row in the "Слои" flyout (see game.js's
// _bindSourceButtons). Keyed by the `data-source` of each row's source
// button in index.html. `links` are official pages, opened in a new tab.
const L = (ru, en) => ({ ru, en });

export const SOURCES = {
  cities: {
    name: L('US Census Bureau', 'US Census Bureau'),
    desc: L(
      'Площадь городов (радиус кружка) — Gazetteer Files 2024; контуры 20 крупных городов — Cartographic Boundary Files. Список городов и координаты составлены вручную, описания — из Википедии.',
      'City areas (circle radius) — Gazetteer Files 2024; outlines of 20 large cities — Cartographic Boundary Files. The city list and coordinates were compiled by hand; descriptions come from Wikipedia.'
    ),
    license: L('Данные Census — общественное достояние; тексты Википедии — CC BY-SA 4.0', 'Census data is public domain; Wikipedia text is CC BY-SA 4.0'),
    links: [
      { label: L('Gazetteer Files', 'Gazetteer Files'), url: 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html' },
      { label: L('Cartographic Boundary Files', 'Cartographic Boundary Files'), url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html' },
    ],
  },
  worldCities: {
    name: L('Natural Earth', 'Natural Earth'),
    desc: L(
      'Столицы всех государств и крупнейшие города мира (от ~4 млн жителей) — слой Natural Earth «Populated places» (10m). Население — оценка Natural Earth (максимальная из оценок, примерно). Русские названия — оттуда же, часть исправлена вручную; описания — из Википедии.',
      'Capitals of all states and the world\'s biggest cities (about 4 million people and up) — the Natural Earth "Populated places" layer (10m). Population is Natural Earth\'s estimate (the largest of its figures, approximate). Names come from it too, some fixed by hand; descriptions from Wikipedia.'
    ),
    license: L('Natural Earth — общественное достояние; тексты Википедии — CC BY-SA 4.0', 'Natural Earth is public domain; Wikipedia text is CC BY-SA 4.0'),
    links: [{ label: L('Natural Earth — Populated Places', 'Natural Earth — Populated Places'), url: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/' }],
  },
  timezones: {
    name: L('Natural Earth', 'Natural Earth'),
    desc: L(
      'Часовые пояса — слой Natural Earth «Time zones» (10m): реальные политические границы поясов (а не полосы по 15° меридианам), упрощённые для карты. Объединены по смещению от UTC; подпись — у крупнейшего куска каждого смещения. Летнее время не учитывается.',
      'Time zones — the Natural Earth "Time zones" layer (10m): real political zone borders (not 15° meridian strips), simplified for the map. Merged per UTC offset; the label sits on the biggest piece of each offset. Daylight saving time is not shown.'
    ),
    license: L('Natural Earth — общественное достояние', 'Natural Earth is public domain'),
    links: [{ label: L('Natural Earth — Time Zones', 'Natural Earth — Time Zones'), url: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/timezones/' }],
  },
  worldPlaces: {
    name: L('Википедия', 'Wikipedia'),
    desc: L('Координаты и описание — из статьи Википедии.', 'Coordinates and description come from the Wikipedia article.'),
    license: L('Тексты — CC BY-SA 4.0, изображения — лицензии Wikimedia Commons', 'Text is CC BY-SA 4.0; images carry their Wikimedia Commons licenses'),
    links: [{ label: L('Википедия', 'Wikipedia'), url: 'https://ru.wikipedia.org/' }],
  },
  places: {
    name: L('Википедия', 'Wikipedia'),
    desc: L(
      'Координаты — из MediaWiki API, тексты и фото — из статей Википедии (русской, а при её отсутствии — английской).',
      'Coordinates come from the MediaWiki API; texts and photos from Wikipedia articles (Russian, or English where there is no Russian one).'
    ),
    license: L('Тексты — CC BY-SA 4.0, изображения — лицензии Wikimedia Commons', 'Text is CC BY-SA 4.0; images carry their Wikimedia Commons licenses'),
    links: [{ label: L('Википедия', 'Wikipedia'), url: 'https://ru.wikipedia.org/' }],
  },
  lakes: {
    name: L('Natural Earth', 'Natural Earth'),
    desc: L(
      'Слой озёр ne_10m_lakes (масштаб 1:10 млн), отобраны 8 крупнейших озёр США.',
      'The ne_10m_lakes layer (1:10m scale), filtered to the 8 largest US lakes.'
    ),
    license: L('Общественное достояние (public domain)', 'Public domain'),
    links: [{ label: L('Natural Earth — Lakes', 'Natural Earth — Lakes'), url: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/' }],
  },
  highways: {
    name: L('US Census Bureau — TIGER/Line 2023', 'US Census Bureau — TIGER/Line 2023'),
    desc: L(
      'Магистрали Interstate (номера из 1–2 цифр) — набор Primary Roads; шоссе Гавайев — Primary and Secondary Roads. Линии упрощены для карты.',
      'Interstate routes (1–2 digit numbers) come from the Primary Roads set; Hawaii\'s roads from Primary and Secondary Roads. Lines are simplified for the map.'
    ),
    license: L('Общественное достояние (public domain)', 'Public domain'),
    links: [{ label: L('TIGER/Line', 'TIGER/Line'), url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html' }],
  },
  airports: {
    name: L('OurAirports', 'OurAirports'),
    desc: L(
      'Аэропорты и взлётно-посадочные полосы (координаты концов, длина) — OurAirports; описания и фото — из Википедии.',
      'Airports and runways (endpoint coordinates, length) come from OurAirports; descriptions and photos from Wikipedia.'
    ),
    license: L('OurAirports — общественное достояние; тексты Википедии — CC BY-SA 4.0', 'OurAirports is public domain; Wikipedia text is CC BY-SA 4.0'),
    links: [
      { label: L('OurAirports', 'OurAirports'), url: 'https://ourairports.com/data/' },
      { label: L('Википедия', 'Wikipedia'), url: 'https://ru.wikipedia.org/' },
    ],
  },
  currents: {
    name: L('NOAA / ERD — OSCAR', 'NOAA / ERD — OSCAR'),
    desc: L(
      'Пути течений проведены по реальному полю скорости течений на поверхности океана (OSCAR, сетка 1/3°, средние за 2012–2013 годы): линия тока от выбранной начальной точки. Названия и тёплые/холодные — по справочникам.',
      'Current paths follow the real ocean surface current field (OSCAR, 1/3° grid, 2012–2013 mean): a streamline from a chosen start point. Names and warm/cold labels come from reference works.'
    ),
    license: L('Данные можно свободно использовать и распространять (NOAA CoastWatch)', 'Free to use and redistribute (NOAA CoastWatch)'),
    links: [
      { label: L('OSCAR на NOAA CoastWatch', 'OSCAR at NOAA CoastWatch'), url: 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar.html' },
      { label: L('OSCAR на NASA PO.DAAC', 'OSCAR at NASA PO.DAAC'), url: 'https://podaac.jpl.nasa.gov/dataset/OSCAR_L4_OC_third-deg' },
    ],
  },
  terrain: {
    name: L('EPA / CEC — Level I Ecoregions', 'EPA / CEC — Level I Ecoregions'),
    desc: L(
      'Экорегионы I уровня Северной Америки, сгруппированы в 9 категорий: горы, леса, равнины, пустыни и др.',
      'Level I Ecoregions of North America, grouped into 9 categories: mountains, forests, plains, deserts, etc.'
    ),
    license: L('Открытые данные EPA и Комиссии по сотрудничеству в области охраны окружающей среды (CEC)', 'Open data from the EPA and the Commission for Environmental Cooperation (CEC)'),
    links: [{ label: L('Ecoregions of North America (EPA)', 'Ecoregions of North America (EPA)'), url: 'https://www.epa.gov/eco-research/ecoregions-north-america' }],
  },
};

// Static, trusted strings only (no user input) — safe to build as HTML.
export function sourceNoteHtml(key) {
  const s = SOURCES[key];
  if (!s) return '';
  const lang = getLang() === 'en' ? 'en' : 'ru';
  const links = s.links
    .map((l) => `<a class="source-note-link" href="${l.url}" target="_blank" rel="noopener">${t('sourceVisit')}: ${l.label[lang]} ↗</a>`)
    .join('');
  return `<div class="source-note-title">${t('sourceLabel')}: ${s.name[lang]}</div>
    <div class="source-note-text">${s.desc[lang]}</div>
    <div class="source-note-license">${s.license[lang]}</div>
    ${links}`;
}
