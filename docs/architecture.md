# Архитектура

Ванильный JS (ES-модули), без сборки и фреймворков. Карта — SVG. Данные —
статические JS/JSON-файлы, сгенерированные скриптами (см. [data-pipeline.md](data-pipeline.md)).

## Как стартует приложение

1. `index.html` — вся разметка: шапка (`.topbar`), экран меню `#screen-menu`,
   экран игры `#screen-game`. Перед загрузкой CSS инлайн-скрипт читает
   `localStorage['geoPuzzleLandScheme']` и ставит `data-land-scheme="gray"` на
   `<html>`, чтобы не мигала тема (ключ нужно держать в синхроне с `js/game.js`).
2. `<script type="module" src="js/main.js">` → по `DOMContentLoaded`:
   `new Game({ levels })`, затем `startFpsMeter()`, `startLongTaskObserver()`,
   `initDebugConsole()`. Уровни приходят из `levels/index.js`.
3. `Game` (`js/game.js`, класс-«контроллер») в конструкторе: собирает ссылки на DOM
   в `this.el`, восстанавливает последние настройки (`geoPuzzleLastSettings`),
   рисует меню (`_renderLevelList`, `_renderModeList`, списки сложности),
   навешивает обработчики (`_bindEvents`), применяет цветовую схему и язык.
4. Кнопка «Играть» → `startGame()`: прячет меню, уничтожает прошлую доску
   (`board.destroy()`), по `this.modeId` вызывает `_start<Режим>(level)`, который
   настраивает шапку/тумблеры и создаёт доску `new <X>Board(#board-container, level, opts)`.
   Таймер идёт везде, кроме «Обзора». Назад — `_goMenu()` (логотип или «Меню»).

## Контракт «доски»

Каждый режим = один файл `js/*Board.js` с классом, у которого:

- конструктор `(container, level, opts)`; `container` — `#board-container`;
  `opts.scale` (масштаб, считает `Game._computeScale`), настройки режима,
  колбэки (`onProgress`, `onFinish`…);
- метод `destroy()` (есть у всех 13 досок) — обязан убрать свои DOM-узлы, таймеры
  и слушатели; `container.innerHTML=''` не сбрасывает классы самого контейнера —
  чистить их вручную (так сделано для `panel-collapsed`, `has-overview-panel`).

Соответствие режим → доска: `puzzle` → `PuzzleBoard`; `quiz` → `QuizBoard`;
`name-state` → `NameStateBoard`; `neighbor` → `NeighborBoard`; `identify` →
`IdentifyStateBoard`; `place-state` → `StatePlacementBoard`; `colorfill` →
`ColorFillBoard`; `sea-quiz` → `SeaQuizBoard`; `sea-identify` → `SeaIdentifyBoard`;
`city-place` → `CityQuizBoard` / `CityPinBoard`; `overview` → `OverviewBoard`;
`journey` → `JourneyNameBoard` или `PuzzleBoard` с синтетическим уровнем.

## Карта модулей `js/`

| Файл | Роль |
|---|---|
| `main.js` | точка входа |
| `game.js` | контроллер: меню, настройки, запуск режимов, шапка/HUD, слои-флайаут, схема, язык, источники слоёв |
| `modes.js`, `presets.js`, `constants.js` | реестр режимов и сложностей, пресеты пазла, награды |
| `i18n.js` | RU/EN: `STRINGS` + `t()`, `LEVEL_EN`/`MODE_EN`…, `itemName()`/`bilingualLabel()` |
| `*Board.js` (13 шт.) | по одному на режим (см. выше); `overviewBoard.js` — самый большой, см. [overview-mode.md](overview-mode.md) |
| `viewUrl.js` | камера Overview ↔ хэш URL (`#overview?level=…&z=…&x=…&y=…`): чтение, запись, очистка; см. [overview-mode.md](overview-mode.md) |
| `zoomPan.js` | зум/панорама: двигает `viewBox` SVG (без CSS-масштабирования), `createZoomWrap`, кнопки зума, масштабная линейка |
| `mapBackground.js`, `pieceShape.js`, `utils.js`, `geoCoords.js` | фоновый контур, сдвиг путей, общие функции, координаты холста → широта/долгота |
| `eligibilityList.js`, `listWidgets.js` | чек-лист допустимых объектов; общие виджеты списков (маркеры ★/◆, поиск с крестиком) |
| `dataSources.js` | тексты и ссылки «источник данных» для слоёв |
| `coins.js`, `successStats.js`, `dataPortability.js` | монеты, серии верных ответов, экспорт/импорт прогресса |
| `journeyRoute.js` | выбор пары штатов и цепочки для «Путешествия» (по графу из `levels/usaRouteGraph.js`) |
| `audio.js`, `fpsMeter.js`, `perfDebug.js` | синтез звуков (WebAudio), счётчик FPS, замеры (`mark()`, `startDebug()/endDebug()`) |

## Данные и масштаб

- Уровень — объект (`levels/index.js`); формат — в [data-format.md](data-format.md).
  Координаты всех геометрий — «родные» единицы холста уровня (`level.canvas`);
  `level.kmPerUnit` переводит единицы в километры (США ~4,79 км/ед. по Альберсу;
  мир равнопрямоугольный, 3,2 ед./градус, ~34,8 км/ед. у экватора).
- Размер на экране: `scale` × зум. Подписи, значки и обводки в «Обзоре» держат
  постоянный размер в пикселях экрана — их пересчёт делает
  `OverviewBoard._rescaleForZoom(zoom)`.
- Режим «cover»: `.zoom-wrap` специально больше видимой области и обрезается
  `#board-container` (карта на весь экран без полей); исключение — пазл.
- Тяжёлые данные подгружаются динамически: `levels/usaTerrain.js` (~480 КБ)
  импортируется только при включении «Рельефа»; info-JSON — через `fetch` один раз
  (кэш на уровне модуля `overviewBoard.js`).

## Сохранение

Всё в `localStorage` (ключи — в [data-format.md](data-format.md)); серверной части нет.
`dataPortability.js` собирает все ключи с префиксами `geoPuzzle` / `geo-puzzle:`
в один JSON (версия формата 1). Новая настройка попадёт в экспорт автоматически,
если её ключ начинается с одного из этих префиксов.

## Известные подводные камни

Каждый подтверждён реальным багом в этом проекте.

| Ловушка | Как правильно |
|---|---|
| Оверлеи (`bottom/right`) внутри `.zoom-wrap` улетают за экран на широких окнах | добавлять в `#board-container` (`this.container`), а не в `zoomWrap`; доски, пересоздающие `zoomWrap` каждый раунд, сами убирают свои кнопки зума/линейку |
| `el.hidden = true` на SVG-элементе ничего не делает | `setAttribute('hidden','')` / `removeAttribute`; проверять скриншотом |
| CSS `:has()` над `#board-container` резко роняет FPS (виртуализация городов меняет поддерево каждый кадр) | ставить обычный класс из JS (`has-overview-panel`) |
| `offset-path` + центрирование отрицательным margin даёт промах при «приземлении» анимации | ручной `requestAnimationFrame` + `transform: translate` |
| Hover-флайаут с зазором закрывается при движении мыши | невидимый `::before` на панели, перекрывающий зазор; проверять настоящим движением мыши |
| Начальная `opacity` подписей применяется после принудительного layout (`getComputedTextLength`) → вспышка из-за `transition: opacity` | ставить начальное состояние до присоединения SVG к документу (`_rescaleForZoom(1)` вызывается раньше `_calibrateCharWidth()`) |
| `getBBox()`/`getComputedTextLength()` на неприсоединённом SVG возвращают нули; и то и другое форсирует layout | измерять один раз (`_charWidthRatio`), не в цикле |
| Подписи «под» соседними фигурами | подписи лежат в отдельном `labelsLayer` выше фигур и течений |
| Однопоточный `http.server` зависал на пустом соединении браузера | `scripts/dev_server.py` уже многопоточный — не возвращать `HTTPServer` |
| Git Bash `/tmp` ≠ `/tmp` у `node.exe` (Windows) | временные файлы класть в проект/`scratchpad`, не полагаться на `/tmp` |
| Browser-панель Claude: rAF/анимации не идут пока нет отрисовки; `resize_window` на загруженной вкладке ломает композитинг; консоль вкладки хранит старые ошибки между навигациями | для скриншотов открывать свежую вкладку; анимации проверять расчётом/побочными эффектами; сверять ошибки по `window.addEventListener('error')` |
| Ключ тайлов Tracestrack (`TOPO_API_KEY`) лежит прямо в `js/overviewBoard.js` | знать об этом: ключ в публичных ремоутах; при желании вынести/перевыпустить |
