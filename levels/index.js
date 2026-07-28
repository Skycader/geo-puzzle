// Реестр уровней. Чтобы добавить новую карту (например Европу),
// достаточно создать levels/europe.js с таким же форматом данных
// и зарегистрировать его здесь.
import usa from './usa.js';
import usaCities from './usaCities.js';

// usaCities.js is generated independently (scripts/build_usa_cities.js) so
// it can be regenerated without touching the state polygon data — attach
// it here rather than baking it into the generated usa.js file.
export const levels = {
  usa: { ...usa, cities: usaCities },
};

export default levels;
