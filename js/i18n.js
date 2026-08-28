// Language system — v1, deliberately scoped to the main menu screen only
// (level cards, mode cards, the two "Уровень"/"Режим" headings, the page
// subtitle) per the user's own explicit instruction: "переводится пока
// что только меню" (translates only the menu for now). Everything past
// the menu — in-game HUD, quiz prompts, toggles, mode-specific settings —
// stays Russian-only until this is deliberately expanded (see
// game-plans.md's item 12 for the full remaining scope: ~250 more
// strings across 21 files, plus the separate wiki-content question).
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
};

export function t(key) {
  return STRINGS[key]?.[getLang()] ?? STRINGS[key]?.ru ?? key;
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

// Any state/country/city/place/sea piece already carries BOTH a Russian
// `.ru` and an English `.name` (100% coverage, verified across every
// levels/*.js file) — no translation dict needed here at all, just pick
// the field that matches the current language. Used by
// js/eligibilityList.js for the checklist rows it renders.
export function itemName(it) {
  return getLang() === 'en' ? it.name : it.ru;
}
