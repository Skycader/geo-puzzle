// Top-level game modes, shown as cards in the menu above the mode-specific
// settings (puzzle difficulty presets vs quiz round length). Every mode
// except "Обзор" is scoped to specific level(s) via `levels` — everything
// below assumes US-state-shaped data (neighbors, cities, places, etc)
// that only levels.usa has, so they're US-only; the two "Моря и океаны"
// modes only make sense for levels.world. "Обзор" has no `levels` at all
// (works generically off level.pieces/cities/places for any level) — see
// game.js's _renderModeList, which filters this list by the currently
// selected level.
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
