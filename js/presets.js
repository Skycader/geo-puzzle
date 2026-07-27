// Difficulty presets. `pieceCount: null` means the player picks the count
// themselves (custom preset) instead of a fixed value.
export const PRESETS = [
  {
    id: 'easy',
    title: 'Лёгкий',
    desc: 'Вставь 5 штатов — подсказки и названия включены',
    pieceCount: 5,
    hints: true,
    labels: true,
    showToggles: true,
  },
  {
    id: 'medium',
    title: 'Средний',
    desc: 'Вставь 10 штатов — названия есть, подсказок нет',
    pieceCount: 10,
    hints: false,
    labels: true,
    showToggles: true,
  },
  {
    id: 'hard',
    title: 'Сложный',
    desc: 'Вставь 15 штатов — без подсказок и названий',
    pieceCount: 15,
    hints: false,
    labels: false,
    showToggles: true,
  },
  {
    id: 'hardcore',
    title: 'Хардкор',
    desc: 'Собери все 50 штатов с нуля — без подсказок, без названий, без тумблеров',
    pieceCount: 50,
    hints: false,
    labels: false,
    showToggles: false,
  },
  {
    id: 'custom',
    title: 'Кастом',
    desc: 'Сам выбери, сколько штатов нужно вставить',
    pieceCount: null,
    hints: true,
    labels: true,
    showToggles: true,
  },
];

export const DEFAULT_CUSTOM_COUNT = 25;
