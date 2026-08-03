// Реестр уровней. Чтобы добавить новую карту (например Европу),
// достаточно создать levels/europe.js с таким же форматом данных
// и зарегистрировать его здесь.
import usa from './usa.js';
import usaCities from './usaCities.js';
import usaPlaces from './usaPlaces.js';

// usaCities.js/usaPlaces.js are generated independently (scripts/
// build_usa_cities.js, scripts/build_usa_places.js) so each can be
// regenerated without touching the state polygon data — attach them here
// rather than baking them into the generated usa.js file.
export const levels = {
  usa: { ...usa, cities: usaCities, places: usaPlaces },
};

export default levels;
