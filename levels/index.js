// Реестр уровней. Чтобы добавить новую карту (например Европу),
// достаточно создать levels/europe.js с таким же форматом данных
// и зарегистрировать его здесь.
import usa from './usa.js';
import usaCities from './usaCities.js';
import usaPlaces from './usaPlaces.js';
import usaHighways from './usaHighways.js';
import usaHawaiiHighways from './usaHawaiiHighways.js';
import usaRouteGraph from './usaRouteGraph.js';
import usaLakes from './usaLakes.js';
import usaAirports from './usaAirports.js';
import world from './world.js';
import worldCurrents from './worldCurrents.js';
import worldCities from './worldCities.js';
import worldPlaces from './worldPlaces.js';
import countries from './countries.js';
import worldTimezones from './worldTimezones.js';

// usaCities.js/usaPlaces.js/usaHighways.js/usaHawaiiHighways.js/
// usaRouteGraph.js/usaLakes.js are generated independently
// (scripts/build_usa_cities.js, scripts/build_usa_places.js,
// scripts/build_usa_highways.js, scripts/build_hawaii_highways.js,
// scripts/build_usa_route_graph.js, scripts/build_usa_lakes.js) so each
// can be regenerated without touching the state polygon data — attach
// them here rather than baking them into the generated usa.js file.
// Hawaii's routes are concatenated onto the same `highways` array (not a
// separate field) — js/overviewBoard.js's single render loop tells them
// apart by shape: a mainland entry has `number` (numbered shield), a
// Hawaii entry has `name`/`ru` instead (text label along the line, real
// road names not being part of the Interstate numbering scheme at all).
// The world level's background countries (`land`) carry no label points of their own;
// borrow them from the matching entry of the countries level (same projection), by id
// or, where Natural Earth's ids differ (Israel, France…), by Russian name. Only these
// matches get a name label in Overview — the rest (disputed zones, military bases, ice
// fields, tiny territories) stay tooltip-only so the map isn't buried. Antarctica and
// Israel (absent from the countries level) are labelled at their own centers.
const countryMatch = new Map();
for (const p of [...countries.pieces, ...countries.land]) {
  countryMatch.set(p.id, p);
  countryMatch.set('ru:' + p.ru, p);
}
const worldLand = world.land.map((l) => {
  const m = countryMatch.get(l.id) || countryMatch.get('ru:' + l.ru);
  if (m?.labelPoints) return { ...l, labelPoints: m.labelPoints };
  if (l.id === 'ata' || l.id === 'isr') return { ...l, labelPoints: [[l.cx, l.cy]] }; // no match in countries.js
  return l;
});

export const levels = {
  usa: { ...usa, cities: usaCities, places: usaPlaces, highways: [...usaHighways, ...usaHawaiiHighways], routeGraph: usaRouteGraph, lakes: usaLakes, airports: usaAirports },
  world: { ...world, land: worldLand, currents: worldCurrents },
  countries: { ...countries, cities: worldCities, places: worldPlaces, timezones: worldTimezones },
};

export default levels;
