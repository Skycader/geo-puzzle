// Difficulty presets. `pieceCount: null` means the player picks the count
// themselves (custom preset) instead of a fixed value.
export const PRESETS = [
  {
    id: 'easy',
    title: 'Лёгкий',
    desc: '5 штатов, с подсказками',
    pieceCount: 5,
    hints: true,
    labels: true,
    showToggles: true,
  },
  {
    id: 'medium',
    title: 'Средний',
    desc: '10 штатов, без подсказок',
    pieceCount: 10,
    hints: false,
    labels: true,
    showToggles: true,
  },
  {
    id: 'hard',
    title: 'Сложный',
    desc: '15 штатов, вслепую',
    pieceCount: 15,
    hints: false,
    labels: false,
    showToggles: true,
  },
  {
    id: 'hardcore',
    title: 'Хардкор',
    desc: 'Все 50 штатов, вслепую',
    pieceCount: 50,
    hints: false,
    labels: false,
    showToggles: false,
  },
  {
    id: 'custom',
    title: 'Кастом',
    desc: 'Сам выбери сколько штатов',
    pieceCount: null,
    hints: true,
    labels: true,
    showToggles: true,
  },
];

export const DEFAULT_CUSTOM_COUNT = 25;
