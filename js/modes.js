// Top-level game modes, shown as cards in the menu above the mode-specific
// settings (puzzle difficulty presets vs quiz round length). Every mode
// except "Обзор" is scoped to specific level(s) via `levels` — everything
// below assumes US-state-shaped data (neighbors, cities, places, etc)
// that only levels.usa has, so they're US-only; the two "Моря и океаны"
// modes only make sense for levels.world. "Обзор" has no `levels` at all
// (works generically off level.pieces/cities/places for any level) — see
// game.js's _renderModeList, which filters this list by the currently
// selected level.
// Menu display order — deliberately separate from MODES' own declaration
// order below (which just groups related modes together, not "what order
// should a new player see these in"). Overview first (no task, no
// pressure, just look around), then roughly increasing
// difficulty/complexity: casual drag-and-drop, then recognition (find by
// name), then recall (name what's highlighted), then relational recall
// (name a NEIGHBOR), then context-free recognition (shape alone, no
// location), then the two "different skill entirely" modes (terrain,
// cities), then the world-level sea modes (same find→identify escalation
// as the state ones), then Journey last — the only genuinely compound
// task (has to know a whole region's connectivity, not just one state at
// a time). See js/game.js's _modesForCurrentLevel, which sorts by this
// before filtering to whichever modes the current level supports.
export const MENU_ORDER = [
  'overview',
  'puzzle',
  'quiz',
  'name-state',
  'neighbor',
  'identify',
  'colorfill',
  'city-place',
  'sea-quiz',
  'sea-identify',
  'journey',
];

export const MODES = [
  {
    id: 'puzzle',
    title: 'Собери карту',
    desc: 'Штаты из кусочков, как пазл',
    levels: ['usa'],
  },
  {
    id: 'quiz',
    title: 'Найди штат',
    desc: 'Кликни штат по названию',
    levels: ['usa', 'countries'],
  },
  {
    id: 'name-state',
    title: 'Назови штат',
    desc: 'Назови подсвеченный штат',
    levels: ['usa', 'countries'],
  },
  {
    id: 'neighbor',
    title: 'Назови соседа',
    desc: 'Назови соседний штат',
    levels: ['usa', 'countries'],
  },
  {
    id: 'identify',
    title: 'Определи штат',
    desc: 'Угадай штат по форме',
    levels: ['usa', 'countries'],
  },
  {
    id: 'city-place',
    title: 'Города и места',
    desc: 'Переключи объект и способ игры',
    levels: ['usa'],
  },
  {
    id: 'colorfill',
    title: 'Раскраска',
    desc: 'Закрась штат по типу рельефа',
    levels: ['usa'],
  },
  {
    id: 'sea-identify',
    title: 'Определи море или океан',
    desc: 'Угадай море по форме',
    levels: ['world'],
  },
  {
    id: 'sea-quiz',
    title: 'Найди море или океан',
    desc: 'Кликни море по названию',
    levels: ['world'],
  },
  {
    id: 'overview',
    title: 'Обзор',
    desc: 'Разглядывай карту без заданий',
  },
  {
    id: 'journey',
    title: 'Путешествие',
    desc: 'Проследи автостраду между двумя штатами',
    levels: ['usa'],
  },
];

// "Путешествие" — how the player answers: type the in-between states in
// order, drag their (unlabeled) shapes onto the real map with a dashed
// outline showing exactly where each one goes, or the same drag-assembly
// with that outline turned off (js/puzzleBoard.js's hintsVisible:false —
// same mechanism as plain "Собери карту"'s own hardest presets, just
// applied to Journey's already-smaller piece subset). Shown only for that
// mode, alongside JOURNEY_DIFFICULTIES below.
export const JOURNEY_ANSWER_MODES = [
  { id: 'name', title: 'Назови штаты', desc: 'Впиши штаты между по порядку' },
  { id: 'puzzle', title: 'Собери пазл', desc: 'Перетащи штаты на карту' },
  { id: 'puzzle-blind', title: 'Пазл вслепую', desc: 'Без контуров на карте' },
];

// Chain length (states strictly between the 2 endpoints) — min/max are a
// real-data-calibrated split of scripts/build_usa_route_graph.js's own
// printed "states between" histogram over every reachable state pair, not
// guessed numbers.
export const JOURNEY_DIFFICULTIES = [
  { id: 'easy', title: 'Лёгкий', desc: '1–2 штата между', min: 1, max: 2 },
  { id: 'medium', title: 'Средний', desc: '3–5 штатов между', min: 3, max: 5 },
  { id: 'hard', title: 'Сложный', desc: '6+ штатов между', min: 6, max: 12 },
];

// "Отображение" choice shown only for the Обзор (overview) mode.
export const OVERVIEW_MODES = [
  { id: 'full', title: 'Полная информация', desc: 'Все штаты и города подписаны' },
  { id: 'hidden', title: 'Скрытая информация', desc: 'Наведи курсор — узнаешь название' },
];

// Answer method for "Назови штат" — shown only for that mode.
export const NAME_STATE_DIFFICULTIES = [
  { id: 'easy', title: 'Лёгкий', desc: '4 варианта на выбор' },
  { id: 'hard', title: 'Сложный', desc: 'Впиши название сам' },
];

// Answer method for "Назови соседа" — a third "ultra" tier on top of the
// same easy/hard split, since the shape is already isolated/unlabeled in
// hard mode: rotating it a random angle removes orientation as a
// recognition shortcut, so knowing the shape ISN'T enough on its own.
export const NEIGHBOR_DIFFICULTIES = [
  { id: 'easy', title: 'Лёгкий', desc: '4 варианта на выбор' },
  { id: 'hard', title: 'Сложный', desc: 'Впиши название сам' },
  { id: 'ultra', title: 'Хардкор', desc: 'Штат повёрнут на случайный угол' },
];

// Answer method for "Определи штат" — same three-tier shape (choice/typed/
// rotated) as "Назови соседа"'s, but this mode never labels the state in
// any tier (unlike "Назови соседа"'s easy mode) since the shown state IS
// the answer here, not just context for naming its neighbor.
export const IDENTIFY_DIFFICULTIES = [
  { id: 'easy', title: 'Лёгкий', desc: '4 варианта на выбор' },
  { id: 'medium', title: 'Средний', desc: 'Впиши название сам' },
  { id: 'hard', title: 'Сложный', desc: 'Штат повёрнут на случайный угол' },
];

// Answer method for "Определи море или океан" — no rotated/hardcore tier
// (unlike "Определи штат"/"Назови соседа"'s 3-tier versions), just the
// plain easy/hard split, per what was actually asked for.
export const SEA_IDENTIFY_DIFFICULTIES = [
  { id: 'easy', title: 'Лёгкий', desc: '4 варианта на выбор' },
  { id: 'hard', title: 'Сложный', desc: 'Впиши название сам' },
];
