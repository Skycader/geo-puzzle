// Language system. Started as a v1 scoped to just the main menu screen;
// expanded to cover the rest of the UI (in-game HUD, toggles, mode
// settings, quiz prompts/feedback across every board file) per the user's
// own explicit follow-up request. Wiki info-card CONTENT (the prose
// `extract` text, `image`, `wikiUrl` in levels/usa/cities-info.json and
// places-info.json) is deliberately NOT translated — only the city/place's
// own NAME, which every piece already carries in both languages (see
// itemName below) — per the user's own explicit instruction not to touch
// the actual article content or links.
//
// Design choice: Russian text stays the SOURCE OF TRUTH exactly where it
// already lives (level.title/level.subtitle in levels/*.js, mode.title/
// mode.desc in js/modes.js) — this file holds ONLY the English delta,
// keyed by the same `id` those objects already carry. Duplicating the
// Russian strings here too would just create a second copy that could
// drift out of sync with the real data the first time someone edits a
// level/mode's Russian text without remembering to touch this file too.

const LANG_STORAGE_KEY = 'geoPuzzleLang';
export const LANGS = ['ru', 'en'];
export const DEFAULT_LANG = 'ru';

export function getLang() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch (e) {}
  return DEFAULT_LANG;
}

export function setLang(lang) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch (e) {}
}

// Static menu chrome (page subtitle + panel headings) — not tied to any
// data object, so these get plain translation-key lookup instead of the
// level/mode helpers below. Also covers js/eligibilityList.js's own
// static chrome (search box, column headers, bulk buttons, counts) — that
// component is reused inside the same menu-settings screen this v1 covers.
// Both languages live here (unlike LEVEL_EN/MODE_EN's English-only delta
// above) — these strings have no other home the way level/mode titles do,
// so there's no risk of drifting out of sync with a second source of
// truth, and it means t() alone is correct regardless of caller instead
// of every call site having to remember its own `lang==='en' ? t(k) :
// 'русский'` fallback.
const STRINGS = {
  menuSubtitle: { ru: 'Настрой под настроение — и вперёд.', en: 'Set the mood, then go.' },
  levelHeading: { ru: 'Уровень', en: 'Level' },
  modeHeading: { ru: 'Режим', en: 'Mode' },
  eligAll: { ru: 'Все', en: 'All' },
  eligNone: { ru: 'Никого', en: 'None' },
  eligSearch: { ru: 'Поиск...', en: 'Search...' },
  eligColName: { ru: 'Название', en: 'Name' },
  eligColArea: { ru: 'Площадь', en: 'Area' },
  eligNothingFound: { ru: 'Ничего не найдено', en: 'Nothing found' },
  eligFamiliarity: { ru: 'Знакомство с картой', en: 'Map familiarity' },
  eligSuccesses: { ru: 'Успехов', en: 'Successes' },
  areaUnit: { ru: 'км²', en: 'km²' },
  kmUnit: { ru: 'км', en: 'km' },
  // HUD group-counter labels (js/game.js's this.el.hudGroups) — each
  // board reporting progress builds `${t(key)}: ${n}` itself, since the
  // number always varies but the label doesn't.
  mistakes: { ru: 'Ошибки', en: 'Mistakes' },
  pieces: { ru: 'Частей', en: 'Pieces' },
  avgError: { ru: 'Ср. ошибка', en: 'Avg. error' },
  // Top toggle row (index.html's #hud, js/game.js's per-mode _start*).
  hints: { ru: 'Подсказки', en: 'Hints' },
  letters: { ru: 'Буквы', en: 'Letters' },
  labels: { ru: 'Подписи', en: 'Labels' },
  citiesToggle: { ru: 'Города', en: 'Cities' },
  placesToggle: { ru: 'Места', en: 'Places' },
  citiesToggleTitle: { ru: 'Показать/скрыть города на карте', en: 'Show/hide cities on the map' },
  terrainOff: { ru: 'Рельеф', en: 'Terrain' },
  terrainColor: { ru: 'Рельеф: цвет', en: 'Terrain: color' },
  terrainPattern: { ru: 'Рельеф: иконки', en: 'Terrain: icons' },
  // "Города и места" mode's own two sub-toggles (js/game.js's
  // cityPlaceEntityText/cityPlaceModeText — separate from the shared
  // citiesToggle/placesToggle above, which is Overview's layer toggle).
  cityPlaceEntityCities: { ru: 'Города', en: 'Cities' },
  cityPlaceEntityPlaces: { ru: 'Места', en: 'Places' },
  cityPlaceModeFind: { ru: 'Найди на карте', en: 'Find on the map' },
  cityPlaceModePin: { ru: 'Расставь метку', en: 'Place a pin' },
  // ROUNDS_PANEL_TEXT / _cityPlaceRoundsText's heading + click-to-find
  // prompt bar.
  roundHeading: { ru: 'Раунд', en: 'Round' },
  findOnMapPrompt: { ru: 'Найди на карте:', en: 'Find on the map:' },
  markOnMapPrompt: { ru: 'Отметь на карте:', en: 'Mark on the map:' },
  howManyStatesAsk: { ru: 'Сколько штатов спросить', en: 'How many states to ask' },
  howManyStatesColor: { ru: 'Сколько штатов закрасить', en: 'How many states to color' },
  howManySeasAsk: { ru: 'Сколько морей/океанов спросить', en: 'How many seas/oceans to ask' },
  howManyCountriesAsk: { ru: 'Сколько стран спросить', en: 'How many countries to ask' },
  // Progress export/import (js/game.js's _bindProgressIo).
  exportSaved: { ru: 'Файл сохранён.', en: 'File saved.' },
  importConfirm: {
    ru: 'Импорт заменит текущий прогресс (монеты, адаптивную статистику, сохранённые настройки) данными из файла. Продолжить?',
    en: 'Importing will replace your current progress (coins, adaptive-mode stats, saved settings) with the file’s data. Continue?',
  },
  importFailed: { ru: 'Не удалось импортировать файл.', en: 'Failed to import file.' },
  // Overview mode's HUD piece-count summary (js/game.js's _startOverview).
  pieceUnitWorld: { ru: 'акваторий', en: 'water bodies' },
  pieceUnitCountries: { ru: 'стран', en: 'countries' },
  pieceUnitStates: { ru: 'шт.', en: 'states' },
  citiesUnit: { ru: 'гор.', en: 'cities' },
  placesUnit: { ru: 'мест', en: 'places' },
  // Journey mode (js/game.js's _startJourney).
  journeyNoRoute: { ru: 'не удалось подобрать маршрут, попробуй ещё раз', en: "couldn't find a route, try again" },
  // Static index.html chrome outside the menu screen — the persistent
  // topbar/HUD and the puzzle/quiz/overview/journey settings panels.
  placesToggleText: { ru: 'Места', en: 'Places' },
  highwaysToggleText: { ru: 'Шоссе', en: 'Highways' },
  progressToggleText: { ru: 'Прогресс', en: 'Progress' },
  puzzleDifficultyHeading: { ru: 'Сложность', en: 'Difficulty' },
  customCountLabel: { ru: 'Штатов, которые нужно вставить', en: 'States to place' },
  adaptiveModeText: {
    ru: 'Адаптивный режим — чаще спрашивать штаты, которые даются сложнее',
    en: 'Adaptive mode — ask more often about states you find harder',
  },
  quickSelectText: {
    ru: 'Быстрый выбор (ПКМ) — правый клик сразу подтверждает ответ',
    en: 'Quick select (right-click) — right-click confirms the answer instantly',
  },
  overviewHeading: { ru: 'Отображение', en: 'Display' },
  journeyAnswerHeading: { ru: 'Как отвечать', en: 'How to answer' },
  journeyDifficultyHeading: { ru: 'Сложность', en: 'Difficulty' },
  journeyLabelStatesText: { ru: 'Подписывать штаты', en: 'Label states' },
  journeyShowDestinationText: { ru: 'Показывать штат назначения', en: 'Show destination state' },
  journeyDestinationHidden: { ru: '???', en: '???' },
  playButton: { ru: 'Играть ▶', en: 'Play ▶' },
  backToMenuButton: { ru: 'Вернуться в меню', en: 'Back to menu' },
  // Tooltips (title=/aria-label=) — lower visual priority than the text
  // above (only shown on hover), but still real UI a player can see.
  brandTitle: { ru: 'В главное меню', en: 'Back to main menu' },
  hintsTitle: { ru: 'Показать/скрыть фоновый контур карты-подсказки', en: 'Show/hide the background hint outline' },
  lettersTitle: { ru: 'Показать/скрыть буквы-подписи на кусочках', en: 'Show/hide letter labels on pieces' },
  placesTitle: { ru: 'Показать/скрыть места на карте', en: 'Show/hide places on the map' },
  highwaysTitle: { ru: 'Показать/скрыть шоссе на карте', en: 'Show/hide highways on the map' },
  progressTitle: { ru: 'Раскрасить штаты по прогрессу (адаптивная статистика)', en: 'Color states by progress (adaptive-mode stats)' },
  terrainTitle: { ru: 'Рельеф: выкл / только цвет / иконки', en: 'Terrain: off / color only / icons' },
  terrainOffLabel: { ru: 'Рельеф: выключено', en: 'Terrain: off' },
  terrainColorLabel: { ru: 'Рельеф: только цвет', en: 'Terrain: color only' },
  terrainPatternLabel: { ru: 'Рельеф: иконки', en: 'Terrain: icons' },
  progressScopeTitle: { ru: 'По какому режиму показывать прогресс', en: 'Which mode’s progress to show' },
  coinBalanceTitle: { ru: 'Монеты за верные ответы — нажми, чтобы списать баланс', en: 'Coins earned for correct answers — click to spend your balance' },
  landSchemeTitle: { ru: 'Цветовая схема — карта, меню и кнопки', en: 'Color scheme — map, menu, and buttons' },
  progressIoTitle: { ru: 'Прогресс: экспорт/импорт', en: 'Progress: export/import' },
  exportProgressBtn: { ru: 'Экспорт прогресса', en: 'Export progress' },
  importProgressBtn: { ru: 'Импорт прогресса', en: 'Import progress' },
  // js/overviewBoard.js's info-popup / progress-edit-popup / ruler /
  // context menu / side panel / layer switcher.
  closeBtn: { ru: 'Закрыть', en: 'Close' },
  readOnWikipedia: { ru: 'Читать в Википедии →', en: 'Read on Wikipedia →' },
  successStreakLabel: { ru: 'Успехов подряд', en: 'Success streak' },
  saveBtn: { ru: 'Сохранить', en: 'Save' },
  rulerClear: { ru: 'Очистить', en: 'Clear' },
  rulerPerimeter: { ru: 'Периметр', en: 'Perimeter' },
  rulerDistance: { ru: 'Расстояние', en: 'Distance' },
  rulerArea: { ru: 'Площадь', en: 'Area' },
  coordsUnavailable: { ru: 'Координаты недоступны', en: 'Coordinates unavailable' },
  addPointMenuItem: { ru: 'Добавить точку', en: 'Add a point' },
  openInGoogleMaps: { ru: 'Открыть в Google Maps', en: 'Open in Google Maps' },
  copyCoords: { ru: 'Скопировать координаты', en: 'Copy coordinates' },
  overviewTabOceans: { ru: 'Океаны', en: 'Oceans' },
  overviewTabSeas: { ru: 'Моря', en: 'Seas' },
  overviewTabOther: { ru: 'Остальное', en: 'Other' },
  overviewTabCountries: { ru: 'Страны', en: 'Countries' },
  overviewTabStates: { ru: 'Штаты', en: 'States' },
  overviewTabCities: { ru: 'Города', en: 'Cities' },
  overviewTabPlaces: { ru: 'Места', en: 'Places' },
  collapseExpandList: { ru: 'Свернуть/развернуть список', en: 'Collapse/expand list' },
  layerSwitcherTitle: { ru: 'Слой карты', en: 'Map layer' },
  layerSvgOffline: { ru: 'оффлайн', en: 'offline' },
  layerTopo: { ru: 'Топографическая', en: 'Topographic' },
  // Shared quiz-answer-bar chrome — nameStateBoard/identifyStateBoard/
  // neighborBoard/seaIdentifyBoard/journeyNameBoard all build the same
  // hint-button+text-input+confirm-button row.
  hintBtnTitle: { ru: 'Не могу вспомнить — показать название', en: "Can't remember — show the name" },
  confirmBtnTitle: { ru: 'Подтвердить', en: 'Confirm' },
  inputPlaceholderState: { ru: 'Впиши название штата...', en: "Type the state's name..." },
  inputPlaceholderNeighbor: { ru: 'Впиши название соседа...', en: "Type the neighbor's name..." },
  inputPlaceholderSea: { ru: 'Впиши название моря/океана...', en: "Type the sea's/ocean's name..." },
  correctFeedback: { ru: 'Верно!', en: 'Correct!' },
  wrongStateFeedback: { ru: 'Не тот штат — попробуй ещё', en: 'Not that state — try again' },
  wrongNeighborFeedback: { ru: 'Не тот сосед — попробуй ещё', en: 'Not that neighbor — try again' },
  wrongSeaFeedback: { ru: 'Не то море/океан — попробуй ещё', en: 'Not that sea/ocean — try again' },
  nextBtn: { ru: 'Далее ▶', en: 'Next ▶' },
  trayHandleTitle: { ru: 'Потяните вверх или прокрутите, чтобы открыть лоток', en: 'Drag up or scroll to open the tray' },
  distanceFromTarget: { ru: 'км от цели', en: 'km from target' },
  journeyAlreadyMarked: { ru: 'Уже отмечено на карте', en: 'Already marked on the map' },
  journeyOffRoute: { ru: 'Штат на карте, но не в маршруте — без монет', en: 'On the map, but not on the route — no coins' },
  // js/zoomPan.js's zoom control cluster.
  zoomIn: { ru: 'Приблизить', en: 'Zoom in' },
  currentZoom: { ru: 'Текущий масштаб', en: 'Current zoom' },
  resetZoom: { ru: 'Сбросить масштаб', en: 'Reset zoom' },
  zoomOut: { ru: 'Отдалить', en: 'Zoom out' },
  // js/dataPortability.js's import error messages.
  importErrCorrupt: { ru: 'Файл повреждён или это не JSON.', en: 'The file is corrupted or not JSON.' },
  importErrNotExport: { ru: 'Это не похоже на файл экспорта GEO PUZZLE.', en: "This doesn't look like a GEO PUZZLE export file." },
  importErrEmpty: { ru: 'В файле не нашлось данных для восстановления.', en: 'No data to restore was found in the file.' },
};

export function t(key) {
  return STRINGS[key]?.[getLang()] ?? STRINGS[key]?.ru ?? key;
}

// "Восстановлено записей: {n}. Перезагружаю…" — the only STRINGS entry
// that needed a number spliced into the middle rather than appended, so
// it gets its own tiny function instead of a {ru,en} pair.
export function importRestoredText(count) {
  return getLang() === 'en' ? `Restored ${count} records. Reloading…` : `Восстановлено записей: ${count}. Перезагружаю…`;
}

// "Города и места" mode's round-count slider label — "Сколько городов
// спросить"/"Сколько мест отметить" etc. — 2x2 combination of which
// entity (cities/places) and which interaction (find/pin), so a lookup
// dict would need 4 near-identical entries; a small function reads clearer.
export function cityPlaceRoundsLabel(isPlaces, isPin) {
  if (getLang() === 'en') {
    const entity = isPlaces ? 'places' : 'cities';
    return `How many ${entity} to ${isPin ? 'mark' : 'find'}`;
  }
  const entityWord = isPlaces ? 'мест' : 'городов';
  return `Сколько ${entityWord} ${isPin ? 'отметить' : 'спросить'}`;
}

// levels/usa.js, levels/world.js, levels/countries.js — id -> {title, subtitle}.
const LEVEL_EN = {
  usa: { title: 'USA: States', subtitle: 'Assemble and connect all 50 states' },
  world: { title: 'Seas & Oceans', subtitle: '28 seas and oceans' },
  countries: { title: 'World Countries', subtitle: '211 countries' },
};

// js/modes.js's MODES array — id -> {title, desc}.
const MODE_EN = {
  puzzle: { title: 'Assemble the Map', desc: 'States as jigsaw pieces' },
  quiz: { title: 'Find the State', desc: 'Click the named state' },
  'name-state': { title: 'Name the State', desc: 'Name the highlighted state' },
  neighbor: { title: 'Name the Neighbor', desc: 'Name the neighboring state' },
  identify: { title: 'Identify the State', desc: 'Guess the state by its shape' },
  'city-place': { title: 'Cities & Places', desc: 'Switch what and how you play' },
  colorfill: { title: 'Color Fill', desc: 'Color the state by terrain type' },
  'sea-identify': { title: 'Identify the Sea', desc: 'Guess the sea by its shape' },
  'sea-quiz': { title: 'Find the Sea', desc: 'Click the named sea' },
  overview: { title: 'Overview', desc: 'Explore the map, no tasks' },
  journey: { title: 'Journey', desc: 'Trace a highway between two states' },
};

// English mirror of js/game.js's own MODE_CARD_TEXT_COUNTRIES — "state"
// reads wrong on the Countries level in English same as "штат" does in
// Russian there (js/game.js's own comment explains the Russian case;
// English has no grammatical-gender wrinkle, but "State" vs "Country" is
// still a real wrong word, not just a style nit).
const MODE_EN_COUNTRIES = {
  quiz: { title: 'Find the Country', desc: 'Click the named country' },
  'name-state': { title: 'Name the Country', desc: 'Name the highlighted country' },
  neighbor: { title: 'Name the Neighbor', desc: 'Name the neighboring country' },
  identify: { title: 'Identify the Country', desc: 'Guess the country by its shape' },
};

// js/presets.js's PRESETS (puzzle-mode piece count) — id -> {title, desc}.
const PRESETS_EN = {
  easy: { title: 'Easy', desc: '5 states, with hints' },
  medium: { title: 'Medium', desc: '10 states, no hints' },
  hard: { title: 'Hard', desc: '15 states, blind' },
  hardcore: { title: 'Hardcore', desc: 'All 50 states, blind' },
  custom: { title: 'Custom', desc: 'Pick how many states yourself' },
};

// js/modes.js's difficulty/answer-mode arrays — each keyed by its own id,
// which repeats ACROSS arrays with different meanings ('easy' in
// PRESETS_EN above isn't the same card as 'easy' here) — that's exactly
// why these stay as separate named dicts instead of one flat id->text map.
const NAME_STATE_DIFFICULTIES_EN = {
  easy: { title: 'Easy', desc: 'Choose from 4 options' },
  hard: { title: 'Hard', desc: 'Type the name yourself' },
};
const SEA_IDENTIFY_DIFFICULTIES_EN = NAME_STATE_DIFFICULTIES_EN;
const NEIGHBOR_DIFFICULTIES_EN = {
  easy: { title: 'Easy', desc: 'Choose from 4 options' },
  hard: { title: 'Hard', desc: 'Type the name yourself' },
  ultra: { title: 'Hardcore', desc: 'State rotated to a random angle' },
};
const IDENTIFY_DIFFICULTIES_EN = {
  easy: { title: 'Easy', desc: 'Choose from 4 options' },
  medium: { title: 'Medium', desc: 'Type the name yourself' },
  hard: { title: 'Hard', desc: 'State rotated to a random angle' },
};
const JOURNEY_ANSWER_MODES_EN = {
  name: { title: 'Name the States', desc: 'Type the in-between states in order' },
  puzzle: { title: 'Assemble the Puzzle', desc: 'Drag states onto the map' },
  'puzzle-blind': { title: 'Blind Puzzle', desc: 'No outlines on the map' },
};
const JOURNEY_DIFFICULTIES_EN = {
  easy: { title: 'Easy', desc: '1–2 states between' },
  medium: { title: 'Medium', desc: '3–5 states between' },
  hard: { title: 'Hard', desc: '6+ states between' },
};
const OVERVIEW_MODES_EN = {
  full: { title: 'Full Info', desc: 'Every state and city labeled' },
  hidden: { title: 'Hidden Info', desc: 'Hover to reveal the name' },
};
export {
  PRESETS_EN,
  NAME_STATE_DIFFICULTIES_EN,
  SEA_IDENTIFY_DIFFICULTIES_EN,
  NEIGHBOR_DIFFICULTIES_EN,
  IDENTIFY_DIFFICULTIES_EN,
  JOURNEY_ANSWER_MODES_EN,
  JOURNEY_DIFFICULTIES_EN,
  OVERVIEW_MODES_EN,
};

// Generic {id,title,desc} translator for any of the EN dicts above — same
// English-delta-only design as levelText/modeText. `desc` may still need
// js/game.js's own _countryAwareDesc run on top of the result (the
// "State rotated"/"Штат повёрнут" -> country wording swap happens after
// translation, not instead of it).
export function presetText(item, enDict) {
  if (getLang() !== 'en') return { title: item.title, desc: item.desc };
  const en = enDict[item.id];
  return { title: en?.title ?? item.title, desc: en?.desc ?? item.desc };
}

// Falls back to the real Russian data whenever the current language has
// no override (covers both lang === 'ru' and any id EN_MAP hasn't caught
// up to yet) — a level/mode this file doesn't know about degrades to
// Russian instead of showing blank text.
export function levelText(level) {
  const en = getLang() === 'en' ? LEVEL_EN[level.id] : null;
  return { title: en?.title ?? level.title, subtitle: en?.subtitle ?? level.subtitle };
}

// levelId is optional — pass it (js/game.js's this.levelId) to get the
// Countries-level-specific wording ("Country" not "State"), same
// precedence as MODE_CARD_TEXT_COUNTRIES already uses for the Russian text.
export function modeText(mode, levelId) {
  if (getLang() !== 'en') return { title: mode.title, desc: mode.desc };
  const en = (levelId === 'countries' && MODE_EN_COUNTRIES[mode.id]) || MODE_EN[mode.id];
  return { title: en?.title ?? mode.title, desc: en?.desc ?? mode.desc };
}

// js/overviewBoard.js's TERRAIN_DESCRIPTIONS — real hand-written prose
// (not simple UI chrome), same "translate it, just not the wiki article
// content" instruction the user gave applies here too since this was
// never wiki content to begin with, just longer than most other strings
// in this file.
const TERRAIN_DESCRIPTIONS_EN = {
  mountain:
    "Mountain ranges and plateaus — the Rockies, Sierra Nevada, Cascades. Sharp elevation changes; slopes are often covered in conifer forest up to a certain height, above which it's bare rock and snow.",
  'forest-boreal':
    'Northern conifer forest (taiga) — spruce, pine, larch. Cold climate, short summer. Unlike mountains, this is flat or hilly land simply covered wall-to-wall in forest.',
  'forest-broadleaf':
    'Deciduous forest of the eastern US — oak, maple, chestnut. Temperate, humid climate with pronounced seasons (this is the region behind the famous fall foliage).',
  'forest-coastal': "Wet conifer forest of the Pacific coast — spruce, redwoods. Mild, very rainy climate due to the ocean's proximity.",
  plains:
    '"Great" as in scale — a vast, nearly flat steppe across the country\'s center, stretching thousands of kilometers without a single hill. Historically the home of bison and prairie, today the country\'s main breadbasket (wheat, corn).',
  desert: 'Arid regions of the Southwest — the Mojave, Sonoran, and Great Basin deserts. Little rainfall, hot days and cold nights, cacti and sparse vegetation instead of forest.',
  mediterranean:
    "The climate of California's coast and valleys, rare for the US — warm dry summers and mild rainy winters, like the Mediterranean. Vineyards, olives, and hardleaf scrub (chaparral).",
  tundra:
    "The far north of Alaska — permafrost, almost no trees: too cold, and the summer too short. Just mosses, lichens, and low shrubs — that's what sets it apart from taiga, which does have trees.",
  swamp:
    'Low-lying wetlands — the Everglades, Okefenokee, the Atchafalaya Basin, and other major swamps of the southeastern US. Standing water year-round, cypress and mangroves instead of ordinary forest; the map shows only a few of the most famous ones, not every swamp in the country.',
};
export function terrainDescription(category, ruText) {
  return getLang() === 'en' ? TERRAIN_DESCRIPTIONS_EN[category] ?? ruText : ruText;
}

// levels/usaTerrain.js's own `region.label` field (generated data, RU
// only) — same English-delta pattern as levelText/modeText above, keyed
// by the same `category` string TERRAIN_DESCRIPTIONS_EN uses.
const TERRAIN_LABEL_EN = {
  mountain: 'Mountains',
  'forest-boreal': 'Boreal forest',
  'forest-broadleaf': 'Broadleaf forest',
  'forest-coastal': 'Pacific forest',
  plains: 'Great Plains',
  desert: 'Desert',
  mediterranean: 'Mediterranean',
  tundra: 'Tundra',
  swamp: 'Swamp',
};
export function terrainLabel(category, ruLabel) {
  return getLang() === 'en' ? TERRAIN_LABEL_EN[category] ?? ruLabel : ruLabel;
}

// Any state/country/city/place/sea piece already carries BOTH a Russian
// `.ru` and an English `.name` (100% coverage, verified across every
// levels/*.js file) — no translation dict needed here at all, just pick
// the field that matches the current language. Used by
// js/eligibilityList.js for the checklist rows it renders.
export function itemName(it) {
  return getLang() === 'en' ? it.name : it.ru;
}

// "Россия (Russia)" / "Russia (Россия)" — primary language first, other
// language as a parenthetical, so a bilingual hover tooltip still teaches
// the OTHER name regardless of which language is active. Used wherever
// js/overviewBoard.js previously always hardcoded `${p.ru} (${p.name})`.
export function bilingualLabel(it) {
  return getLang() === 'en' ? `${it.name} (${it.ru})` : `${it.ru} (${it.name})`;
}

// js/overviewBoard.js's HI_ISLAND_HOVER_LABELS — English is the same
// spelling as the Russian transliteration reads out loud (Oahu, Maui,
// Honolulu…), so this is a straight name list, not prose to translate.
const HI_ISLAND_EN = {
  Каула: 'Kaula',
  Ниихау: 'Niihau',
  Кауаи: 'Kauai',
  Капаа: 'Kapaa',
  Оаху: 'Oahu',
  Гонолулу: 'Honolulu',
  Молокаи: 'Molokai',
  Ланаи: 'Lanai',
  Мауи: 'Maui',
  Кахулуи: 'Kahului',
  'Гавайи (Большой остров)': 'Hawaii (Big Island)',
  Хило: 'Hilo',
};
export function hiIslandName(ru) {
  return getLang() === 'en' ? HI_ISLAND_EN[ru] ?? ru : ru;
}

// "Ответ: Россия (Russia)" — hint reveal, shared shape across
// nameStateBoard/identifyStateBoard/neighborBoard/seaIdentifyBoard/
// journeyNameBoard.
export function answerRevealText(piece) {
  return getLang() === 'en' ? `Answer: ${piece.name} (${piece.ru})` : `Ответ: ${piece.ru} (${piece.name})`;
}

// "«Техас» — не тот штат, попробуй ещё" — wrong-guess feedback naming
// what was actually typed. `nounRu`/`nounEn` is the mismatched noun
// ("штат"/"state", "сосед"/"neighbor", or the seaIdentifyBoard variant's
// plain "не то" with no noun at all).
export function wrongGuessText(matched, nounRu, nounEn) {
  if (getLang() === 'en') return `"${matched.name}" — not the right ${nounEn}, try again`;
  return `«${matched.ru}» — не тот ${nounRu}, попробуй ещё`;
}

// neighborBoard.js's "Верно! Сосед: Россия (Russia)" correct-answer text —
// unlike the other boards' plain "Верно!", this one also names the
// neighbor that was just correctly identified.
export function correctNeighborText(piece) {
  return getLang() === 'en' ? `Correct! Neighbor: ${piece.name} (${piece.ru})` : `Верно! Сосед: ${piece.ru} (${piece.name})`;
}

// seaIdentifyBoard.js's noun-free wrong-guess variant — "«Балтийское
// море» — не то, попробуй ещё" (no "не то МОРЕ" — seas/oceans/gulfs don't
// share one grammatical noun the way "штат"/"сосед" do elsewhere).
export function wrongGuessNoNounText(matched) {
  return getLang() === 'en' ? `"${matched.name}" — not that one, try again` : `«${matched.ru}» — не то, попробуй ещё`;
}

// journeyNameBoard.js's free-order chain-progress bar text. hideEnd (the
// "Показывать штат назначения" checkbox, off and not yet revealed) swaps
// the real destination name for the same "???" placeholder game.js's HUD
// line uses — otherwise this bar would spell it out even though the map
// and HUD both keep it hidden.
export function journeyProgressText(correct, total, startPiece, endPiece, hideEnd = false) {
  const start = itemName(startPiece);
  const end = hideEnd ? t('journeyDestinationHidden') : itemName(endPiece);
  return getLang() === 'en'
    ? `Chain states collected: ${correct}/${total}, between ${start} and ${end}`
    : `Штатов цепочки собрано: ${correct}/${total}, между ${start} и ${end}`;
}
export function journeyNearestChainStateText(target) {
  return getLang() === 'en' ? `Nearest chain state: ${target.name} (${target.ru})` : `Ближайший штат цепочки: ${target.ru} (${target.name})`;
}
export function journeyNotAdjacentText(matched) {
  return getLang() === 'en'
    ? `"${matched.name}" doesn't border anything you've already reached`
    : `«${matched.ru}» не граничит ни с чем из уже пройденного`;
}
