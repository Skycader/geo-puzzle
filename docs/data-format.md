# Формат данных

Все файлы в `levels/` сгенерированы скриптами (см. [data-pipeline.md](data-pipeline.md)) —
руками не правятся (кроме info-JSON, они ручные/полуавтоматические). Все пути
`d` — SVG-строки вида `M x,y L x,y …` в «родных» единицах холста уровня.
Реестр уровней и склейка полей — `levels/index.js` (дополнительные массивы
подключаются там, а не вшиваются в `usa.js`/`world.js`).

## Уровень (объект)

| Поле | Где | Описание |
|---|---|---|
| `id`, `title`, `subtitle` | все | `usa` / `world` / `countries`; русские заголовки (английские — в `LEVEL_EN` в `js/i18n.js`, **подзаголовок мира с числом акваторий там задан вручную** и после смены данных правится руками) |
| `canvas` | все | `{width, height}`: США 2017×1237, мир и страны 1152×576 |
| `kmPerUnit` | все | км на единицу холста (США ~4,79; мир/страны ~34,8 у экватора) |
| `projection` | usa | Альберс (`phi1Deg 29.5`, `phi2Deg 45.5`, `phi0Deg 23`, `lambda0Deg -96`, `scale`, `minX/minY`, `marginPx`) — по нему `geoCoords.js` возвращает широту/долготу; Аляска считается тем же Альберсом, Гавайи — локальной проекцией в истинном положении и масштабе |
| `contextLand` | usa | массив из одной фигуры Канады (только контекст, не `piece`) |
| `pieces` | все | основные объекты уровня: штаты / акватории / страны |
| `land` | world, countries | world: страны как фон (~258); countries: «зоны» — территории, которые рисуются и подписываются, но не страны (Западная Сахара, Свободная зона; список `ZONE_IDS` в `build_countries_level.js`), в играх, списках и счётчиках не участвуют |
| `cities`, `places`, `lakes`, `highways`, `airports`, `routeGraph` | usa | см. ниже |
| `currents` | world | см. ниже |
| `cities`, `places` | countries | города мира (~247) и места (~1) — только на «Страны мира»; подключаются в `levels/index.js` из `worldCities.js` / `worldPlaces.js`; см. «Города мира» ниже |

### `pieces[]`

`id`, `name` (en), `ru`, `cx, cy` (центр), `bbox [x0,y0,x1,y1]`, `area` (км²),
`d`. Дополнительно: `neighbors` (массив `id`; usa и countries), `labelPoints`
(массив `[x,y]`, по одной подписи на видимый кусок — world и countries; у usa
своих `labelPoints` нет). `id`: у штатов двухбуквенный код (`AL`), у стран ISO-A3
в нижнем регистре (`idn`) или транслит (`south_ossetia`), у акваторий —
транслит названия (`arctic_ocean`). Мир: контур, пересекающий линию перемены дат, может быть продублирован
со сдвигом на ширину холста (см. комментарии в `scripts/build_world_seas.js`).

### `cities[]` (usa)

`id`, `name`, `ru`, `state` (код штата), `capital` (bool), `cx, cy`,
`radiusKm` (эффективный радиус по площади города). У ~20 городов есть реальный
контур: `bbox` + `d` (признак — ◆ в списке). Радиусы — Census Gazetteer.

### `places[]` (usa)

`id`, `name`, `ru`, `cx, cy`, `radiusKm` (условное `2`, физического смысла нет).
Карточка для места и города — в info-JSON по тому же `id`.

### `lakes[]` (usa)

`id`, `name`, `ru`, `cx, cy`, `bbox`, `area`, `d` — реальные полигоны (8 крупнейших).

### `highways[]` (usa)

Материк: `id` (`i2`), `number` (строка), `d`, `lengthKm`, `bbox`, `points`
(выборка точек для постановки щита). Гавайи — `id` вида `hi-…`, `name`, `ru` (без
`number`), `d`, `bbox`, `points`. Оба набора лежат в одном массиве; отличают по
наличию `number`.

### `routeGraph` (usa, для «Путешествия»)

`{ routeStates: {routeId: [штаты…]}, adjacency: {штат: [{to, routeId, routeNumber, baseRouteId}…]} }`.
Шоссе из двух физически несвязных кусков с одним номером разнесены на
отдельные компоненты — ложных рёбер нет.

### `airports[]` (usa)

`id` (код IATA в нижнем регистре), `iata`, `name`, `ru`, `state`, `cx, cy`, `bbox`,
`runwayCount`, `longestM`, `d` (по подпути `M … L …` на каждую ВПП, настоящие
концы), `minor: true` — «региональный» (значок-вертолёт); флаг есть только у
`minor`. Всего ~144 (58 основных + 86 `minor`).

### Города мира (`worldCities.js`, только уровень countries)

`id` (транслит имени, при совпадении — с суффиксом ISO), `name`, `ru`, `state` (страна по-русски),
`stateEn`, `capital` (bool; столица по Natural Earth, не все «alt»-столицы), `cx, cy`, **`pop`**
(Natural Earth `POP_MAX`, примерно). Поля `radiusKm` **нет**: по нему `overviewBoard.js` отличает
такой город от американского — рисует постоянный по размеру кружок, в списке показывает
население вместо площади, подпись появляется с зума, зависящего от `pop` (≥5 млн — всегда,
иначе позже; столицы не позже зума 2,5). Места мира (`worldPlaces.js`) — как `places` США.

### `currents[]` (world)

`id`, `name`, `ru`, `temp` (`warm`/`cold`), `lengthKm`, `cx, cy`, `bbox`, `d`
(для подсветки и зоны клика), `pts` (та же линия как массив `[x,y]` — из неё на
лету строится стрелка), `mid` (`{x,y}` — якорь подписи на линии).

### Отдельные файлы

- `levels/usaOutline.js` — `{bbox, d}`: общий контур материка (для режима «Расположи штат»).
- `levels/usaTerrain.js` — `{regions: [{category, label, d}], stateCategories: {штат: [категории]}}`;
  9 категорий: `mountain`, `forest-boreal`, `forest-broadleaf`, `forest-coastal`,
  `plains`, `desert`, `mediterranean`, `swamp`, `tundra`. Грузится динамически.

## Info-карточки (JSON)

Формат одинаков: `{ "<id>": { "extract": "...", "image": "https://upload.wikimedia.org/...", "wikiUrl": "https://ru.wikipedia.org/wiki/..." } }`.
`id` = `id` объекта в данных.

| Файл | Ключи | Заметки |
|---|---|---|
| `levels/usa/cities-info.json` | города (~115, по числу городов) | русские |
| `levels/usa/places-info.json` | места | русские; часть мест без русской статьи — ссылка на английскую |
| `levels/usa/places-info.en.json` | места | английские; **в коде не подключён** |
| `levels/usa/lakes-info.json` | озёра | русские |
| `levels/usa/contextland-info.json` | `canada` | открывается из контекстного меню по правому клику |
| `levels/world/zones-info.json` | зоны уровня countries (`esh`, `esh_east`) | правый клик → «Что здесь?»; собирается `scripts/build_zones_info.js` (заголовки статей — в нём) |
| `levels/usa/airports-info.json` | аэропорты (~144) | + поле `lang` (`ru`/`en`); больше половины только на английском — русской статьи нет |
| `levels/world/currents-info.json` | течения | русские |
| `levels/world/cities-info.json` | города мира | поле `lang`; русская статья, иначе английская; грузится для всех уровней, кроме США (США берёт `usa/cities-info.json`); используется на уровне countries |
| `levels/world/places-info.json` | места мира | русские |

Шероховатости: `extract` у части карточек содержит знаки ударения (Википедия);
в `image` — прямая ссылка на миниатюру (`/330px-`), не локальная копия; ссылки
`wikiUrl` часто закодированы процентно.

## localStorage

| Ключ | Что хранит |
|---|---|
| `geoPuzzleLang` | `ru` / `en` |
| `geoPuzzleLandScheme` | `blue` (цветная) / `gray` (серая) |
| `geoPuzzleLastSettings` | JSON: последние уровень, режим, сложности, число раундов, адаптивный режим и т. д. (поля — в `Game._saveLastSettings`) |
| `geoPuzzleCoins` | число монет |
| `geo-puzzle:success:<levelId>:<scope>` | JSON `{id объекта: серия}` (адаптивный режим / «Прогресс»); `scope` — `quiz-states`, `name-state-states`, `neighbor-states`, `identify-states`, `colorfill-states`, `journey-states` |
| `geo-puzzle:eligible:<levelId>:<kind>` | JSON-массив `id` разрешённых объектов |

Экспорт/импорт (`dataPortability.js`) собирает все ключи с префиксами
`geoPuzzle` и `geo-puzzle:`; формат файла — `FORMAT_VERSION = 1`.
