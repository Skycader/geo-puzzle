// Top-level game modes, shown as cards in the menu above the mode-specific
// settings (puzzle difficulty presets vs quiz round length).
export const MODES = [
  {
    id: 'puzzle',
    title: 'Собери карту',
    desc: 'Собирай штаты из кусочков как пазл',
  },
  {
    id: 'quiz',
    title: 'Найди штат',
    desc: 'Кликни правильный штат на пустой карте по названию',
  },
  {
    id: 'city-quiz',
    title: 'Найди город',
    desc: 'На карте видны точки городов — кликни нужную по названию',
  },
  {
    id: 'city-pins',
    title: 'Расставь метки',
    desc: 'Поставь булавку туда, где по-твоему находится город — цвет подскажет, насколько точно',
  },
];
