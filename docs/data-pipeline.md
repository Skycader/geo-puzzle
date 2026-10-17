# Конвейер данных

Данные игры не пишутся руками: `scripts/build_*.js` читают небольшие
«предобработанные» файлы из `scripts/data/` (~11 МБ всего) и пишут
`levels/*.js`. Исходные большие датасеты (сотни МБ) в репозитории **не хранятся** —
в шапке каждого скрипта описано, откуда их скачать и какими командами
(`curl`, `npx mapshaper …`) получен файл в `scripts/data/`. Скрипты — CommonJS,
запускаются из корня: `node scripts/build_<имя>.js`; всё, кроме помеченных
«сеть», работает офлайн.

## Скрипты → результаты

| Скрипт | Вход (`scripts/data/…`) | Выход | Примечания |
|---|---|---|---|
| `build_usa_level.js` | `us-states.geojson`, `world-countries-simplified.geojson` (для Канады) | `levels/usa.js` | штаты, `contextLand`, проекция; **печатает в stderr сдвиги, которые зашиты константами в остальных USA-скриптах (см. «Подводные камни»)** |
| `build_usa_outline.js` | `us-mainland-outline.geojson`, `us-states.geojson` | `levels/usaOutline.js` | общий контур материка |
| `build_city_silhouettes.js` | `us-states.geojson`, `us-city-boundaries.geojson` | `scripts/data/city-silhouettes.generated.json` | потом **запустить `build_usa_cities.js`** (он вшивает силуэты) |
| `build_usa_cities.js` | `us-states.geojson`, `city-silhouettes.generated.json` | `levels/usaCities.js` | список `CITIES` и таблица `RADIUS_KM` — прямо в скрипте |
| `build_usa_places.js` | `us-states.geojson` | `levels/usaPlaces.js` | список `PLACES` в скрипте |
| `build_usa_lakes.js` | `us-major-lakes.geojson`, `us-states.geojson` | `levels/usaLakes.js` | Natural Earth, отфильтровано до 8 озёр |
| `build_usa_highways.js` | `tl_interstates_filtered.geojson`, `us-states.geojson` | `levels/usaHighways.js` | Interstate с номером из 1–2 цифр, TIGER/Line 2023 |
| `build_hawaii_highways.js` | `tl_hawaii_prisecroads.geojson`, `us-states.geojson` | `levels/usaHawaiiHighways.js` | TIGER Primary & Secondary Roads для Гавайев |
| `build_usa_route_graph.js` | импортирует `levels/usa.js` и `levels/usaHighways.js` | `levels/usaRouteGraph.js` | граф для «Путешествия»; запускать **после** штатов и шоссе |
| `build_usa_terrain.js` | `us-states.geojson`, `na-ecoregions-mainland.geojson`, `na-ecoregions-alaska.geojson` | `levels/usaTerrain.js` | экорегионы CEC в 9 категорий |
| `build_world_seas.js` | `world-marine-polys.geojson`, `world-marine-extra.geojson`, `world-countries-simplified.geojson` | `levels/world.js` | моря/океаны + страны-фон; при смене числа акваторий **вручную править** `LEVEL_EN.world.subtitle` в `js/i18n.js` |
| `build_countries_level.js` | `world-countries-simplified/-extra`, `world-w-sahara-morocco`, `sahara-morocco-clip`, `world-admin1-lookup` | `levels/countries.js` | страны мира |
| `extract_airport_runways.js` | `_airports.csv`, `_runways.csv` (качать вручную, **затем удалить**, ~16 МБ) | `scripts/data/airport-runways.generated.json` | список IATA — константа `IATA` в скрипте; ВПП без обоих концов отбрасываются |
| `build_usa_airports.js` | `airport-runways.generated.json` | `levels/usaAirports.js` | таблица `NAMES` (RU/EN), множество `MINOR` (регион./вертолёт) — в скрипте |
| `build_airports_info.js` | сеть (Википедия) | `levels/usa/airports-info.json` | через langlink на русскую статью, иначе английская (`lang`); **возобновляемый**; `node scripts/build_airports_info.js ATL JFK` — только перечисленные коды; Википедия лимитирует частоту → при `FAILED` перезапустить |
| `extract_world_cities.js` | `_ne_populated_places.geojson` (Natural Earth 10m, ~19 МБ: качать вручную, **затем удалить**) | `scripts/data/world-cities-source.json` | все столицы (`Admin-0 capital`) + города от `MIN_BIG_POP` (4 млн); ручные поправки в начале скрипта (не-столицы, пригороды, переименования) |
| `build_world_cities.js` | `world-cities-source.json`, `levels/countries.js` (русские названия стран) | `levels/worldCities.js`, `levels/worldPlaces.js` | список мест `PLACES` — в скрипте |
| `build_zones_info.js` | сеть (Википедия) | `levels/world/zones-info.json` | карточки зон (`land` уровня countries); id → заголовок статьи в `ZONES` |
| `build_world_cities_info.js` | сеть (Wikidata + Википедия) | `levels/world/cities-info.json` | возобновляемый; `node scripts/build_world_cities_info.js moscow paris` — только перечисленные id |
| `build_world_currents.js` | сеть (NOAA ERDDAP, OSCAR) | `levels/worldCurrents.js` | массив `CURRENTS` (id, имя, `temp`, `box`, `seed`, `cutAtEastmost`); усредняет срезы, ведёт линию тока, сглаживает |

Все `levels/*.js`-выходы начинаются с комментария «Auto-generated … Regenerate:».

**Подводные камни**
- Константы `GLOBAL_SHIFT_X/Y` зашиты копиями в скриптах `build_city_silhouettes`,
  `build_usa_cities`, `build_usa_places`, `build_usa_airports`, `build_usa_highways`,
  `build_hawaii_highways`, `build_usa_lakes`, `build_usa_outline`, `build_usa_terrain`; якорь
  Гавайев (`toCanvasHI`) — в `cities`, `places`, `airports`, `hawaii_highways`. Всё это должно
  **точно** совпадать с выводом `build_usa_level.js` — иначе точки «уплывают» от своих
  штатов. Менять `build_usa_level.js` можно только перегенерировав всё зависимое.
- Города/места/аэропорты у Аляски проецируются тем же Альберсом, у Гавайев — своей
  проекцией (`region: 'HI'` в записи).
- `world-marine-extra.geojson` — «заплатка»: отдельные фичи 10m (Natural Earth),
  добавленные в 110m-слой (Саргассово море, проливы и заливы). Добавить ещё одну
  акваторию = положить её фичу туда и перегенерировать (скачивание 10m — в шапке
  `build_world_seas.js`). Из 10m исключены реки, озёра, рифы и фичи без `name_ru`;
  нет в данных Печорского моря, Берингова пролива, пролива Виктория.
- Файлы в `/tmp` из Git Bash не видны `node.exe` (разные пути в Windows) — скачивать
  сразу в `scripts/data/`.

## Источники и лицензии

| Данные | Источник | Лицензия (по описанию источника/комментариям скриптов) |
|---|---|---|
| Штаты США | PublicaMundi `us-states` GeoJSON; Гавайи — US Census TIGER/Line 2023 (State) | общественное достояние |
| Города (площади, силуэты) | US Census Bureau: Gazetteer Files 2024, Cartographic Boundary Files | общественное достояние |
| Шоссе | US Census Bureau TIGER/Line 2023 (Primary Roads; Hawaii — Primary & Secondary Roads) | общественное достояние |
| Озёра, моря, океаны, страны | Natural Earth (`ne_10m_lakes`, marine polys 110m/10m, admin-0 10m, disputed areas) | общественное достояние |
| Города мира | Natural Earth «Populated places» 10m (названия RU/EN, координаты, население `POP_MAX`) | общественное достояние |
| Рельеф | EPA/CEC «Level I Ecoregions of North America» | открытые данные |
| Аэропорты и ВПП | OurAirports (`airports.csv`, `runways.csv`) | общественное достояние |
| Деление аэропортов (для справки; в данные не вшито) | FAA, таблица enplanements CY2025 и NPIAS 2025–2029 | открытые данные FAA |
| Течения | NOAA/ERD «OSCAR» (CoastWatch ERDDAP `jplOscar`, 2011-12 … 2014-09) | «free to use and redistribute» |
| Тексты, фото, координаты мест | Википедия (MediaWiki API, REST summary), изображения — Wikimedia Commons | CC BY-SA 4.0 / лицензии Commons |
| Подложки | OpenStreetMap (iframe), Tracestrack (топо-тайлы) | ODbL (OSM) / условия Tracestrack |

Ссылки на официальные страницы — в `js/dataSources.js` (и в меню «Слои»).
Раньше пробовали слой «Major Ocean Currents» (Esri/Maps.com): сервер требует
токен, лицензии нет — не используется.
