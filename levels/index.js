// Реестр уровней. Чтобы добавить новую карту (например Европу),
// достаточно создать levels/europe.js с таким же форматом данных
// и зарегистрировать его здесь.
import usa from './usa.js';
import usaCities from './usaCities.js';
import usaPlaces from './usaPlaces.js';
import usaHighways from './usaHighways.js';
import usaHawaiiHighways from './usaHawaiiHighways.js';
import usaRouteGraph from './usaRouteGraph.js';
import world from './world.js';
import countries from './countries.js';

// usaCities.js/usaPlaces.js/usaHighways.js/usaHawaiiHighways.js/
// usaRouteGraph.js are generated independently (scripts/build_usa_cities.js,
// scripts/build_usa_places.js, scripts/build_usa_highways.js,
// scripts/build_hawaii_highways.js, scripts/build_usa_route_graph.js) so
// each can be regenerated without touching the state polygon data —
// attach them here rather than baking them into the generated usa.js
// file. Hawaii's routes are concatenated onto the same `highways` array
// (not a separate field) — js/overviewBoard.js's single render loop tells
// them apart by shape: a mainland entry has `number` (numbered shield), a
// Hawaii entry has `name`/`ru` instead (text label along the line, real
// road names not being part of the Interstate numbering scheme at all).
export const levels = {
  usa: { ...usa, cities: usaCities, places: usaPlaces, highways: [...usaHighways, ...usaHawaiiHighways], routeGraph: usaRouteGraph },
  world,
  countries,
};

export default levels;
