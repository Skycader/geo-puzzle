// Top-level game modes, shown as cards in the menu above the mode-specific
// settings (puzzle difficulty presets vs quiz round length).
export const MODES = [
  {
    id: 'puzzle',
    title: 'Собери карту',
    desc: 'Штаты из кусочков, как пазл',
  },
  {
    id: 'quiz',
    title: 'Найди штат',
    desc: 'Кликни штат по названию',
  },
  {
    id: 'name-state',
    title: 'Назови штат',
    desc: 'Карта подсвечивает штат — угадай название',
  },
  {
    id: 'city-quiz',
    title: 'Найди город',
    desc: 'Кликни город по названию',
  },
  {
    id: 'city-pins',
    title: 'Расставь метки',
    desc: 'Булавка меняет цвет от точности',
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
