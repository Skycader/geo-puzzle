import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { mark } from './perfDebug.js';
import { polygonArea, clamp } from './utils.js';
import { buildStateBackground } from './mapBackground.js';
import { nativeToLonLat, formatLonLat, findInset } from './geoCoords.js';
import { loadSuccessStats, setSuccessCount } from './successStats.js';

// Hawaii's own piece is one <path> with 8 real, physically separate
// island rings (see scripts/build_usa_level.js's Hawaii-splice comment) —
// a single static tooltip text can't say which one the cursor is actually
// over. Real center lon/lat per island (verified against the actual
// TIGER-derived geometry, not guessed) mapped to whichever label reads
// best there: the island's biggest known town where this game has one
// (matches levels/usaCities.js), else the island's own name for the four
// that have no town in our city list (Niʻihau is private/no public roads,
// Kaʻula is an uninhabited islet, Molokaʻi/Lānaʻi's own towns — Kaunakakai/
// Lānaʻi City — just aren't in our curated city list).
const HI_ISLAND_HOVER_LABELS = [
  { lon: -160.541, lat: 21.654, label: 'Каула' },
  { lon: -160.152, lat: 21.904, label: 'Ниихау' },
  { lon: -159.547, lat: 22.053, label: 'Капаа' },
  { lon: -157.973, lat: 21.479, label: 'Гонолулу' },
  { lon: -157.008, lat: 21.135, label: 'Молокаи' },
  { lon: -156.935, lat: 20.833, label: 'Ланаи' },
  { lon: -156.343, lat: 20.771, label: 'Кахулуи' },
  { lon: -155.439, lat: 19.592, label: 'Хило' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATE_LABEL_PX = 12;
const STATE_LABEL_STROKE_PX = 3;
const CITY_LABEL_PX = 10;
const CITY_LABEL_STROKE_PX = 2.5;
const CITY_DOT_STROKE_PX = 1;

// City name labels hang off a leader line from the dot's exact center
// (point-mark -> diagonal -> horizontal, text above the horizontal run) —
// all sizes below are constant *screen* px, like the other label styling.
const LEADER_POINT_R_PX = 2.2;
const LEADER_POINT_STROKE_PX = 0.8;
const LEADER_DIAG_PX = 14; // 45°-down-left diagonal segment length
const LEADER_STROKE_PX = 1.2;
const LEADER_PAD_PX = 3; // horizontal run's overshoot past the text on the far end
const LEADER_TEXT_GAP_PX = 3; // gap between the horizontal run and the text sitting above it

const STATE_FOCUS_FILL = 0.6; // fraction of the viewport a focused state's bbox should fill
const CITY_POINT_FOCUS_FILL = 0.08; // fraction of the viewport a focused point-city's dot should fill
const FOCUS_DURATION_MS = 3000; // how long a click's highlight stays lit before auto-clearing
const VIRTUALIZE_MARGIN = 0.4; // extra fraction of the visible rect's size kept rendered just outside it

// Places (landmarks) carry only a nominal radiusKm (see
// scripts/build_usa_places.js — it's there just so they can share
// EligibilityList's area math, not because it means anything physically),
// so their on-map dot is a small constant-screen-px marker instead of a
// true-to-scale circle like a city's, and focusing one zooms to a fixed
// "close-up" radius instead of deriving one from that nominal value.
const PLACE_DOT_R_PX = 4;
const PLACE_DOT_STROKE_PX = 1;
const PLACE_FOCUS_RADIUS_KM = 30;

// OSM layer toggle: converts the currently-visible native rect into a
// lon/lat bounding box for OpenStreetMap's own embeddable viewer
// (openstreetmap.org/export/embed.html?bbox=...) — an officially
// supported widget, not a workaround, so it takes a bbox directly rather
// than needing zoom-level math the way some other embeddable maps do.
//
// Deliberately does NOT try to sync position the other way (OSM -> SVG)
// — switching back to SVG just un-hides it exactly as it was left, since
// its own pan/zoom state was never touched while OSM was showing. That
// asymmetry is what actually satisfies "a focused city must not fly
// away on repeated toggles": every SVG->OSM conversion starts from the
// same untouched SVG state, so it's idempotent by construction rather
// than needing to stay in sync across N round trips.
//
// Returns null (caller should refuse to switch) rather than ever handing
// back a bogus bbox: a null/NaN corner (should be unreachable for
// usa/world/countries, but nativeToLonLat fails closed for anything
// else), or — usa only — a rect whose four corners don't all belong to
// the SAME region (mainland vs one specific Alaska/Hawaii inset). Mixing
// corners from disconnected regions would average together two places
// that were never actually adjacent in the real world, producing a bbox
// that doesn't correspond to what's really on screen — exactly the kind
// of "camera flies somewhere nonsensical" the whole feature has to avoid.
// This only matters at zoomed-OUT views showing multiple regions at
// once, which is outside the "focused on a city" scenario the
// requirement actually cares about — so refusing there (rather than
// guessing) is the right tradeoff, not a compromise.
function computeVisibleLonLatBBox(level, rect) {
  const corners = [
    [rect.x0, rect.y0],
    [rect.x1, rect.y0],
    [rect.x0, rect.y1],
    [rect.x1, rect.y1],
  ];
  if (level.id === 'usa') {
    const regions = corners.map(([x, y]) => findInset(level, x, y) ?? null);
    if (regions.some((r) => r !== regions[0])) return null;
  }
  const pts = corners.map(([x, y]) => nativeToLonLat(level, x, y));
  if (pts.some((p) => !p || !Number.isFinite(p.lon) || !Number.isFinite(p.lat))) return null;
  // Clamped, not rejected: panning is allowed to drift slightly past the
  // map's own edge (see zoomPan.js's clampOrigin/minMapOverlap), which
  // can push a corner's native coordinate just outside the canvas the
  // projection was built from — the resulting lon/lat is still directly
  // usable once folded back into a valid range, no need to refuse over it.
  const lons = pts.map((p) => clamp(p.lon, -180, 180));
  const lats = pts.map((p) => clamp(p.lat, -85, 85));
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  if (!(maxLon > minLon) || !(maxLat > minLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

// "Рельеф" terrain layer's 8 categories (see setTerrainMode below) —
// short explanations of what each one actually IS, not just its name.
// levels/usaTerrain.js's own `label` field is just the category name (it's
// generated data, editorial text doesn't belong there) — this is the
// human-written companion, shown as a hover tooltip on both the legend
// button and the terrain shape itself on the map. Keyed by the same
// `category` string scripts/build_usa_terrain.js's CATEGORY_MAP produces.
const TERRAIN_DESCRIPTIONS = {
  mountain: 'Горные хребты и плато — Скалистые горы, Сьерра-Невада, Каскадные горы. Резкий перепад высот; склоны часто покрыты хвойным лесом до определённой высоты, выше — голый камень и снег.',
  'forest-boreal': 'Северный хвойный лес (тайга) — ель, сосна, лиственница. Холодный климат, короткое лето. В отличие от гор — это равнинная или холмистая местность, просто сплошь заросшая лесом.',
  'forest-broadleaf': 'Листопадный лес востока США — дуб, клён, каштан. Умеренный влажный климат с ярко выраженной сменой сезонов (та самая "золотая осень").',
  'forest-coastal': 'Влажный хвойный лес тихоокеанского побережья — ели, секвойи. Мягкий, очень дождливый климат из-за близости океана.',
  plains: '"Великие" — по масштабу: огромная почти плоская степь в центре страны, тянется на тысячи километров без единого холма. Историческая родина бизонов и прерий, сегодня — главная житница страны (пшеница, кукуруза).',
  desert: 'Засушливые области юго-запада — Мохаве, Сонора, Большой Бассейн. Мало осадков, жаркий день/холодная ночь, кактусы и редкая растительность вместо леса.',
  mediterranean: 'Климат побережья и долин Калифорнии, редкий для США — тёплое сухое лето и мягкая дождливая зима, как в Средиземноморье. Виноградники, оливки, жестколистный кустарник (чапараль).',
  tundra: 'Крайний север Аляски — вечная мерзлота, деревьев почти нет: слишком холодно и лето слишком короткое. Только мхи, лишайники и низкий кустарник — этим и отличается от тайги, где деревья есть.',
  // Unlike the other 8 (a continuous real ecoregion), this one shows just
  // 8 specific, individually-famous named swamps as approximate blobs
  // (real location + real area, hand-drawn shape) — see
  // scripts/build_usa_terrain.js's own comment on why no comprehensive
  // wetlands dataset was usable here.
  swamp: 'Заболоченные низменности — Эверглейдс, Окефеноки, бассейн Атчафалайя и другие крупные болота юго-востока США. Постоянно стоит вода, кипарисы и мангры вместо обычного леса; на карте показаны только несколько самых известных, а не все болота страны.',
};

// "Рельеф" fill, per category — a small hand-drawn icon (pine tree,
// broadleaf tree, dune, tuft of grass...) tiled via a native SVG <pattern>
// rather than a flat color, so a glance at the map actually shows WHAT
// kind of terrain it is, not just "some color = some category" (a flat
// fill alone was the original version of this feature — see the plan/
// commits this shipped from). <pattern> tiles automatically fill however
// much of the shape is on screen with no per-frame JS, unlike the highway
// shields' dynamic repositioning (which exists only because a highway
// LINE is too thin/long for a single fixed icon to ever reliably stay on
// screen — a 2D area has no such problem, a repeating pattern already
// covers all of it). Each tile is a faint full-tile wash of the category's
// own color (so gaps between icons still read as "this category", not as
// a hole) plus the icon itself on top, both referencing var(--terrain-*)
// so they stay scheme-reactive as an inline <pattern> is still part of the
// same document's CSS cascade.
const TERRAIN_PATTERN_TILE_PX = 10; // native canvas units per repeat — ~47km at this map's scale
const TERRAIN_PATTERNS = {
  mountain: `
    <rect width="10" height="10" fill="var(--terrain-mountain)" fill-opacity="0.16"/>
    <path d="M0,9 L2.4,3.4 L4,6.2 L6,2 L9.2,9 Z" fill="var(--terrain-mountain)" fill-opacity="0.85"/>
  `,
  'forest-boreal': `
    <rect width="10" height="10" fill="var(--terrain-forest-boreal)" fill-opacity="0.16"/>
    <path d="M5,1 L7.4,5 L6.2,5 L8.4,8.2 L1.6,8.2 L3.8,5 L2.6,5 Z" fill="var(--terrain-forest-boreal)" fill-opacity="0.9"/>
    <rect x="4.4" y="8.2" width="1.2" height="1.3" fill="var(--terrain-forest-boreal)" fill-opacity="0.9"/>
  `,
  'forest-broadleaf': `
    <rect width="10" height="10" fill="var(--terrain-forest-broadleaf)" fill-opacity="0.16"/>
    <circle cx="5" cy="4.2" r="2.7" fill="var(--terrain-forest-broadleaf)" fill-opacity="0.9"/>
    <rect x="4.4" y="6.7" width="1.2" height="2.2" fill="var(--terrain-forest-broadleaf)" fill-opacity="0.9"/>
  `,
  // Same "tree" language as the other two forest categories, kept taller
  // and narrower — the tall coastal conifers (redwoods etc) this category
  // is actually named for.
  'forest-coastal': `
    <rect width="10" height="10" fill="var(--terrain-forest-coastal)" fill-opacity="0.16"/>
    <path d="M5,0.4 L6.4,3.2 L5.7,3.2 L7.1,5.8 L6.2,5.8 L7.9,9 L2.1,9 L3.8,5.8 L2.9,5.8 L4.3,3.2 L3.6,3.2 Z" fill="var(--terrain-forest-coastal)" fill-opacity="0.9"/>
  `,
  plains: `
    <rect width="10" height="10" fill="var(--terrain-plains)" fill-opacity="0.18"/>
    <path d="M2,9 L2.3,5.2 M4.6,9 L5.1,4.4 M7.2,9 L7.4,5.7" stroke="var(--terrain-plains)" stroke-width="0.7" fill="none" stroke-linecap="round" opacity="0.9"/>
  `,
  // Simple filled semicircles ("bumps" resting on the tile's bottom edge)
  // — the classic dune symbol, not thin wavy strokes (those read as water
  // ripples, not sand — see the earlier version's own note before this).
  desert: `
    <rect width="10" height="10" fill="var(--terrain-desert)" fill-opacity="0.18"/>
    <path d="M1.5,9.5 A3.5,3.5 0 0 1 8.5,9.5 Z" fill="var(--terrain-desert)" fill-opacity="0.85"/>
  `,
  // Small rounded shrub/olive-bush cluster — chaparral, not a full tree.
  mediterranean: `
    <rect width="10" height="10" fill="var(--terrain-mediterranean)" fill-opacity="0.16"/>
    <circle cx="4" cy="5.6" r="1.8" fill="var(--terrain-mediterranean)" fill-opacity="0.9"/>
    <circle cx="6.3" cy="5.1" r="1.4" fill="var(--terrain-mediterranean)" fill-opacity="0.9"/>
    <rect x="4.6" y="7.1" width="0.9" height="1.3" fill="var(--terrain-mediterranean)" fill-opacity="0.9"/>
  `,
  // Sparse lichen/tussock flecks, deliberately the thinnest icon of the 8 —
  // tundra's whole identity (see TERRAIN_DESCRIPTIONS) is "barely anything
  // grows here", so a dense icon would misrepresent it.
  tundra: `
    <rect width="10" height="10" fill="var(--terrain-tundra)" fill-opacity="0.2"/>
    <circle cx="2.4" cy="7" r="0.55" fill="var(--terrain-tundra)" fill-opacity="0.9"/>
    <circle cx="7" cy="4.4" r="0.5" fill="var(--terrain-tundra)" fill-opacity="0.9"/>
    <circle cx="5" cy="8.4" r="0.42" fill="var(--terrain-tundra)" fill-opacity="0.9"/>
    <circle cx="8.3" cy="7.9" r="0.4" fill="var(--terrain-tundra)" fill-opacity="0.9"/>
  `,
  // Dark, still puddles/pools between (implied, unshown) reeds — irregular
  // ellipses rather than perfect circles, so they read as standing water,
  // not as balls/dots the way tundra's lichen flecks do.
  swamp: `
    <rect width="10" height="10" fill="var(--terrain-swamp)" fill-opacity="0.3"/>
    <ellipse cx="3" cy="3.2" rx="1.7" ry="1.05" fill="var(--terrain-swamp)" fill-opacity="0.95" transform="rotate(-12 3 3.2)"/>
    <ellipse cx="7.4" cy="2.6" rx="1.2" ry="0.75" fill="var(--terrain-swamp)" fill-opacity="0.95" transform="rotate(18 7.4 2.6)"/>
    <ellipse cx="5.6" cy="6.4" rx="2" ry="1.2" fill="var(--terrain-swamp)" fill-opacity="0.95" transform="rotate(-6 5.6 6.4)"/>
    <ellipse cx="1.6" cy="8.2" rx="1.1" ry="0.7" fill="var(--terrain-swamp)" fill-opacity="0.95" transform="rotate(10 1.6 8.2)"/>
  `,
};

// Overview mode's 3rd map layer (see setTopoVisible below) — TraceTrack's
// topo__ XYZ tile set, standard Web Mercator/EPSG:3857 slippy-map tiles
// (256px), unlike OSM's option above which is an embeddable bbox *page*
// (openstreetmap.org/export/embed.html) needing no tile math at all. No
// tile-serving proxy exists for this app (it's static files, no backend),
// so the key is necessarily visible in this source — same tradeoff the
// user accepted when supplying it.
const TOPO_TILE_SIZE = 512; // TraceTrack's topo__ tiles are 512px, not the usual 256px
const TOPO_API_KEY = '4fd767ace0ab10303dd0080c295c9c97';
// Caps how far we zoom in past what the bbox math would otherwise pick,
// so a degenerate bbox (near-zero span) can't ask the browser to lay out
// hundreds of <img> tags at once.
const MAX_TOPO_TILES_PER_AXIS = 10;

// Continuous (non-floored) world-pixel coordinates at zoom z — same
// formulas any slippy-map tile scheme uses, kept as plain functions
// rather than folded into setTopoVisible so the tile-index math and the
// sub-tile pixel-offset math below can both call them.
function topoWorldX(lon, z) {
  return ((lon + 180) / 360) * TOPO_TILE_SIZE * 2 ** z;
}
function topoWorldY(lat, z) {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * TOPO_TILE_SIZE * 2 ** z;
}

// this.svg is an SVGElement, not an HTMLElement — the `.hidden` IDL
// property (element.hidden = true/false) only exists on HTMLElement, so
// setting it on an <svg> silently creates a meaningless plain JS
// property with zero effect on rendering (reads back whatever you just
// set, but getComputedStyle's `display` never changes). The underlying
// `hidden` CONTENT ATTRIBUTE + its `[hidden] { display: none }` UA-
// stylesheet rule work on any element type regardless — going through
// setAttribute/removeAttribute directly sidesteps the IDL-property gap
// entirely, so this works uniformly for the SVG, the OSM iframe, and the
// plain <div> zoom-controls/scale-bar alike.
function setElementHidden(el, hide) {
  if (hide) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

// Info-popup: hand-editable Wikipedia-sourced blurbs (see
// levels/usa/cities-info.json / places-info.json — plain JSON, not baked
// into a JS module, specifically so they're easy to hand-edit/extend
// without touching any code). Fetched once and cached at module scope so
// re-entering Overview mode doesn't refetch. Only cities/places with an
// entry here get click-to-info behavior — everything else stays inert.
let _infoLoadPromise = null;
function loadInfo() {
  if (!_infoLoadPromise) {
    // no-store: these files are hand-edited fairly often (see todo.md-style
    // requests to add more entries) — a cached GET response would keep
    // serving a stale version indefinitely across reloads, exactly like it
    // just did (an old cached copy silently keeping edits from showing up).
    const fetchJson = (url) =>
      fetch(url, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    _infoLoadPromise = Promise.all([fetchJson('./levels/usa/cities-info.json'), fetchJson('./levels/usa/places-info.json')]).then(
      ([cities, places]) => ({ cities, places })
    );
  }
  return _infoLoadPromise;
}
const POPUP_W_PX = 480;
const POPUP_MARGIN_PX = 20;
const POPUP_EDGE_PAD_PX = 12;

// "Progress heatmap" — see setProgressVisible. A streak of PROGRESS_MAX or
// more reads as "fully mastered" (the scheme's accent color at 100%); the
// small edit popup this opens is its own, much narrower, card.
const PROGRESS_MAX = 10;
const PROGRESS_EDIT_POPUP_W_PX = 220;

// Ruler tool: right-click places/removes a point, drag moves one, live
// distance/perimeter/area readout. Always live in Overview mode — no
// separate "mode" toggle, since it only ever responds to right-click and
// dragging an existing point, neither of which the rest of the board uses
// for anything (left-click keeps panning / opening city-info popups
// exactly as before — see _onMapTap).
const RULER_POINT_R_PX = 5;
const RULER_POINT_STROKE_PX = 1.5;
const RULER_HIT_R_PX = 12; // how close a right-click has to land on an existing point to delete it instead of adding a new one
const RULER_LABEL_PX = 11;
const RULER_LABEL_STROKE_PX = 2.5;

// Free-look mode: every state sits filled at its true spot (like an
// already-solved puzzle) and every city is a dot, all at once — nothing
// to click, answer or assemble. "Full info" keeps every name permanently
// on screen; "hidden info" hides them and relies on each shape's native
// <title> element, which the browser shows as a hover tooltip.
export class OverviewBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.scale = opts.scale || 1;
    this.labelsVisible = opts.labelsVisible !== false;
    this.citiesVisible = opts.citiesVisible !== false;
    this.allLabelEls = [];
    this.stateLabels = []; // { el }
    // Cities are virtualized — only ones within the visible map area (plus
    // a margin) are actually in the DOM at any given time (see
    // _updateVisibleCities). Each entry tracks its own `appended` state.
    this.cityDotEntries = []; // { id, cx, cy, dot, pointMark, leaderPath, leaderLabel, appended }
    this.cityShapeEntries = []; // { id, cx, cy, bbox, path, label, appended }
    // Places aren't virtualized (only 20 of them, same reasoning as
    // states) — always rendered, no `appended` bookkeeping needed.
    this.placeEntries = []; // { id, cx, cy, dot, pointMark, leaderPath, leaderLabel }
    this.placesVisible = opts.placesVisible !== false;
    // USA-only, only ~59 of them (see levels/usaHighways.js) — same
    // "few enough to just always be in the DOM" reasoning as places.
    // { id, number, pathEl, shieldEl, points, lastPos } — pathEl is the
    // permanent line; shieldEl is the shield-shaped number badge, shown at
    // whichever of `points` is currently closest to the view's center (see
    // _updateHighwayShields) so there's always one somewhere on screen
    // regardless of pan/zoom, never zero and never a cluttered pile of them.
    this.highwayEntries = [];
    this.highwaysVisible = opts.highwaysVisible !== false;
    // "Progress heatmap" — opt-IN (default off), unlike the *Visible flags
    // above, since this replaces the map's normal coloring rather than
    // adding to it. progressScope picks which adaptive-mode success stat
    // (js/successStats.js, keyed by ADAPTIVE_SUCCESS_SCOPE_BY_MODE in
    // game.js) to visualize — see setProgressVisible/setProgressScope.
    this.progressVisible = opts.progressVisible === true;
    this.progressScope = opts.progressScope || 'name-state-states';
    // "Рельеф" — real terrain-classification sub-regions (mountains,
    // forests, plains, desert...) painted underneath the state pieces —
    // opt-in like progress, USA-only (levels/usaTerrain.js has no data for
    // world/countries). 3-step: 'off' | 'color' (flat category color) |
    // 'pattern' (icon-textured, TERRAIN_PATTERNS) — not a plain boolean,
    // since both non-off looks are useful on their own. The ~480KB terrain
    // module is dynamic-imported on first use rather than statically
    // imported at the top of this file, so loading World/Countries
    // Overview never pays for it — see setTerrainMode.
    this.terrainMode = opts.terrainMode === 'color' || opts.terrainMode === 'pattern' ? opts.terrainMode : 'off';
    this.terrainLayer = null; // built lazily on first setTerrainMode() call with a non-'off' mode
    this.terrainLegendEl = null;
    this.terrainRegionsByCategory = null; // category -> <path>, set once terrainLayer is built
    this.terrainLabelsByCategory = null; // category -> Russian label, set alongside terrainRegionsByCategory
    this.terrainHiddenCategories = new Set(); // categories the player filtered off via the legend
    this.terrainHoverTipEl = null; // built lazily on first hover — see _onMapMouseMove
    this.statesById = new Map(); // id -> { data, pathEl }
    this.citiesById = new Map(); // id -> { data, dotEl } | { data, pathEl }
    this.placesById = new Map(); // id -> { data, dotEl }
    // World's side panel splits level.pieces into three tabs by name
    // instead of USA's states/cities/places (world has no cities/places at
    // all — see _pieceCategory) — 'oceans' first since that's the smallest,
    // most-recognizable group.
    this.activeTab = this.level.id === 'world' ? 'oceans' : 'states';
    this.searchQuery = '';
    this.sortBy = null; // null (alphabetical) | 'area'
    this.sortDir = 'desc';
    this.focusedEl = null;
    this.focusTimeoutHandle = null;
    this._revealQueue = [];
    this._revealScheduled = false;
    this._destroyed = false;
    this.info = { cities: {}, places: {} }; // populated async — see loadInfo()
    this._openPopupId = null;
    this._infoPopupEl = null;
    this._infoConnectorEl = null;
    this.rulerPoints = []; // { x, y } in native units, in placement order — see _renderRuler
    this._contextMenuEl = null;

    // Perf instrumentation — instance-level overrides (shadow the
    // prototype methods) so the onVisibleRectChange/onZoomChange
    // callbacks wired up in _build() pick up the timed versions.
    this._updateVisibleCities = mark('overview._updateVisibleCities', this._updateVisibleCities.bind(this));
    this._processRevealQueue = mark('overview._processRevealQueue', this._processRevealQueue.bind(this));
    this._rescaleForZoom = mark('overview._rescaleForZoom', this._rescaleForZoom.bind(this));

    this._build();
    loadInfo().then((info) => {
      if (this._destroyed) return;
      this.info = info;
      this._applyInfoAvailability();
    });
  }

  _build() {
    const { width, height } = this.level.canvas;
    this.container.innerHTML = '';
    // innerHTML='' clears children but not the container's own classList —
    // without this, a panel left collapsed from a previous Overview
    // session would silently carry over into a fresh one.
    this.container.classList.remove('panel-collapsed');
    // Lets .zoom-controls/.layer-switcher's CSS reposition themselves next
    // to the panel with a plain class check instead of :has(.overview-
    // panel) — see that CSS comment for why :has() specifically was a
    // real, measured FPS regression here (this subtree mutates on
    // essentially every pan/zoom frame via city virtualization).
    this.container.classList.add('has-overview-panel');

    const baseW = Math.round(width * this.scale);
    const baseH = Math.round(height * this.scale);

    this.wrapEl = document.createElement('div');
    this.wrapEl.className = 'overview-wrap';
    // The side panel has no natural height of its own (its list wants to
    // grow with content) — pin the row to the map's fixed height so the
    // panel's flex:1 list-scroll area actually has something to be 1/N of,
    // instead of the whole row growing to fit every list item.
    this.wrapEl.style.height = baseH + 'px';

    const { wrap: zoomWrap, viewport: zoomViewport } = createZoomWrap(baseW, baseH, this.container);
    this.zoomWrap = zoomWrap;
    this.zoomViewport = zoomViewport;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', baseW);
    this.svg.setAttribute('height', baseH);
    this.svg.classList.add('board-svg');

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <linearGradient id="piece-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--piece-a)" />
        <stop offset="1" stop-color="var(--piece-b)" />
      </linearGradient>`;
    this.svg.appendChild(defs);

    // Two persistent layers so paint order (and therefore click hit-testing,
    // which follows the same topmost-wins rule) is decided by KIND, not by
    // whichever element happened to get (re-)appended most recently.
    // Without this, anything sized true-to-real-world-scale — a state, a
    // city's real boundary shape (New York City, ~778 km²), or even a plain
    // dot-city's radius circle (Boston's, big enough at deep zoom to cover
    // Harvard's marker a couple km away) — could end up painted over a
    // smaller, precise marker nearby, since virtualization re-appends
    // whatever just scrolled into view to the END of the SVG's children
    // (see _showDotEntry/_showShapeEntry below); which one ended up on top
    // was essentially random. "Zones" (state/country pieces, shape-cities,
    // and dot-cities' real-scale circle — everything that can grow as big
    // as the map itself at deep zoom) always paint below "points" (places,
    // and every city's own constant-screen-px point-mark/leader-line/label)
    // now, regardless of reveal order — see _showDotEntry/_showShapeEntry,
    // which append into these two groups instead of `this.svg` directly.
    this.zonesLayer = document.createElementNS(SVG_NS, 'g');
    this.zonesLayer.setAttribute('class', 'zones-layer');
    this.svg.appendChild(this.zonesLayer);
    this.pointsLayer = document.createElementNS(SVG_NS, 'g');
    this.pointsLayer.setAttribute('class', 'points-layer');
    this.svg.appendChild(this.pointsLayer);

    // World level's `pieces` are seas/oceans — unlike states, they don't
    // tile the whole map, so without land context Overview mode showed
    // them floating in blank space (same issue seaQuizBoard.js/
    // seaIdentifyBoard.js had before they gained this same background
    // layer). The USA level has no `land` field at all (its `pieces`
    // already cover the whole map), so this is a no-op there.
    if (this.level.land) {
      this.zonesLayer.appendChild(buildStateBackground(this.level.land, { pathClass: 'world-bg-path' }));
    }

    // Canada — non-interactive geographic context only (USA level), real
    // position/scale (see scripts/build_usa_level.js's own comment on why
    // Alaska/Hawaii/Canada use this true-position technique). Painted
    // FIRST, before the state pieces, since it geographically overlaps
    // part of the mainland's own bbox (real geography — southern Canada
    // is genuinely south of a lot of the northern US) — the opaque state
    // fills painted after it simply cover the overlap, which is correct,
    // not a glitch. Not a `pieces` entry (see levels/usa.js's own
    // `contextLand` comment) so no other mode ever sees it.
    if (this.level.contextLand) {
      this.zonesLayer.appendChild(buildStateBackground(this.level.contextLand, { pathClass: 'canada-bg-path' }));
    }

    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', 'piece-shape placed' + (this.level.id === 'world' ? ' sea-piece' : ''));
      path.setAttribute('fill', 'url(#piece-grad)');
      // Lets _onMapTap route a click here to the progress-edit popup when
      // that mode is on — states otherwise have no dataset.kind/id at all
      // (only cities/places do), since nothing else currently reacts to
      // clicking one.
      path.dataset.kind = 'state';
      path.dataset.id = p.id;
      // Detached while "Рельеф" is showing (see
      // _setStateNativeTooltipsEnabled) — the custom terrain-hover-tip
      // already shows this same name (plus the terrain category), and
      // having both the native browser tooltip AND the custom one active
      // at once is confusing/redundant, not additive.
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${p.ru} (${p.name})`;
      path.appendChild(title);
      this.zonesLayer.appendChild(path);

      // Hawaii only: swap the static "Гавайи (Hawaii)" tooltip for
      // "Гавайи — <island's town/name>" based on exactly which of the 8
      // real island rings the cursor is over (see HI_ISLAND_HOVER_LABELS's
      // own comment and _hiIslandLabelAt). Native <title> tooltips don't
      // refresh mid-hover, but updating it on pointermove means it's
      // already right by the time the browser's own hover-delay timer
      // fires. This only covers the native-tooltip path — when "Рельеф" is
      // on, this <title> is detached (see _setStateNativeTooltipsEnabled)
      // and _onMapMouseMove's custom terrain-hover-tip takes over instead,
      // which calls the same _hiIslandLabelAt helper itself.
      if (p.id === 'HI') {
        path.addEventListener('pointermove', (e) => {
          const native = this._clientToNative(e.clientX, e.clientY);
          const label = this._hiIslandLabelAt(native);
          if (label) title.textContent = `${p.ru} — ${label}`;
        });
      }

      // Usually one label at [cx, cy] — world/countries pieces carry a
      // `labelPoints` array instead (see scripts/build_world_seas.js's/
      // build_countries_level.js's computeLabelPoints): pieces that
      // straddle the antimeridian (Pacific, Arctic/Southern Ocean, Ross
      // Sea, Russia) render as two disconnected on-screen chunks, and a
      // single label at the center used to land in the empty gap between
      // them, on neither chunk — so those get one label per visible chunk
      // instead. USA itself is a further one-off special case — see
      // build_countries_level.js's applyUsaLabels — with a parallel
      // `labelSuffixes` array (mainland/Alaska/Hawaii are disconnected,
      // not just antimeridian-split, so those get "США", "США - Аляска",
      // "США - Гавайи" rather than the bare name repeated three times).
      // USA states have no `labelPoints` field, so they always fall back
      // to the single [cx, cy] point, unchanged.
      const labelPoints = p.labelPoints || [[p.cx, p.cy]];
      labelPoints.forEach(([lx, ly], i) => {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', lx);
        label.setAttribute('y', ly);
        label.setAttribute('class', 'piece-label');
        // USA states: a short 2-letter code reads fine directly on the map.
        // World seas and countries have no such reliably-short code — a
        // sea's `.id` is a long slug ("gulf_of_mexico"), and while a
        // country's `.id` IS its ISO_A3 code where one exists, ~20% fall
        // back to slugify(name) ("south_ossetia") where it doesn't — both
        // rendered as literal, cluttered slug text on the map before this.
        const baseName = this.level.id === 'usa' ? p.id : p.ru;
        const suffix = p.labelSuffixes?.[i];
        label.textContent = suffix ? `${baseName} - ${suffix}` : baseName;
        this.zonesLayer.appendChild(label);
        this.allLabelEls.push(label);
        this.stateLabels.push({ el: label });
      });
      this.statesById.set(p.id, { data: p, pathEl: path, titleEl: title });
    }

    // Hawaii's true position (see scripts/build_usa_level.js) puts it far
    // southwest of the mainland, at true scale — genuinely small and easy
    // to lose against a lot of open ocean at the default zoomed-out view.
    // A dashed locator ring (non-interactive, in pointsLayer so it always
    // reads on top) fixes that without needing to actually enlarge Hawaii
    // itself out of true scale.
    if (this.level.id === 'usa') {
      const hi = this.level.pieces.find((p) => p.id === 'HI');
      if (hi) {
        const [bx0, by0, bx1, by1] = hi.bbox;
        const cx = (bx0 + bx1) / 2;
        const cy = (by0 + by1) / 2;
        const r = Math.hypot(bx1 - bx0, by1 - by0) / 2 + 14;
        const locator = document.createElementNS(SVG_NS, 'circle');
        locator.setAttribute('class', 'hawaii-locator');
        locator.setAttribute('cx', cx.toFixed(1));
        locator.setAttribute('cy', cy.toFixed(1));
        locator.setAttribute('r', r.toFixed(1));
        this.pointsLayer.appendChild(locator);
      }
    }

    // Highways (USA only, see levels/usaHighways.js). The line itself is
    // painted after the state fills so it reads on top of them, in
    // zonesLayer (not clickable, not virtualized as a whole: only ~59 of
    // them, always in the DOM). The shield badge is a SEPARATE element in
    // pointsLayer — it needs to render above everything, including the
    // line itself and state fills, to stay legible — and unlike the line,
    // its position is NOT fixed: _updateHighwayShields repositions it
    // (and shows/hides it) on every pan/zoom settle, picking whichever of
    // the highway's own sampled points is currently closest to the middle
    // of the visible area. Not part of the states loop above since it's a
    // wholly separate data source with its own id/number scheme, not a
    // per-state piece.
    if (this.level.highways) {
      for (const hw of this.level.highways) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', hw.d);
        path.setAttribute('class', 'highway-path');
        path.dataset.id = hw.id;
        const title = document.createElementNS(SVG_NS, 'title');
        // Hawaii's routes (levels/usaHawaiiHighways.js) aren't part of the
        // Interstate numbering scheme at all — no `number`, real name in
        // `ru`/`name` instead — see the marker branch right below.
        title.textContent = hw.number ? `I-${hw.number}` : hw.ru || hw.name;
        path.appendChild(title);
        this.zonesLayer.appendChild(path);

        const marker = hw.number ? this._buildHighwayShield(hw.number) : this._buildHighwayLabel(hw.ru || hw.name);
        marker.style.display = 'none';
        this.pointsLayer.appendChild(marker);

        this.highwayEntries.push({ id: hw.id, number: hw.number, pathEl: path, shieldEl: marker, points: hw.points, lastPos: null });
      }
    }

    // City elements are built here but NOT appended yet — _updateVisibleCities
    // (driven by zoomPan's virtualization callback) decides what's actually
    // in the DOM, based on what's currently in view.
    for (const c of this.level.cities) {
      // A handful of large/distinctive cities carry a real projected
      // municipal-boundary shape (see build_city_silhouettes.js) — render
      // those like a mini state piece instead of a radius dot.
      if (c.d) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', c.d);
        path.setAttribute('class', 'overview-city-shape');
        path.dataset.id = c.id;
        path.dataset.kind = 'city';
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = this._cityHoverTitle(c);
        path.appendChild(title);

        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', c.cx);
        label.setAttribute('y', c.cy);
        label.setAttribute('class', 'piece-label');
        label.textContent = c.ru;
        this.allLabelEls.push(label);
        this.stateLabels.push({ el: label });

        const entry = { id: c.id, cx: c.cx, cy: c.cy, bbox: c.bbox, path, label, appended: false };
        this.cityShapeEntries.push(entry);
        this.citiesById.set(c.id, { data: c, pathEl: path });
        continue;
      }

      // A true-to-scale radius (derived at build time from real land area,
      // see scripts/build_usa_cities.js) — fixed in native units so it
      // grows/shrinks with zoom exactly like the state borders do, instead
      // of the artificial constant-screen-px sizing used for labels/etc.
      const radiusNative = c.radiusKm / this.level.kmPerUnit;

      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', c.cx);
      dot.setAttribute('cy', c.cy);
      dot.setAttribute('r', radiusNative.toFixed(3));
      dot.setAttribute('class', 'overview-city-dot');
      dot.dataset.id = c.id;
      dot.dataset.kind = 'city';
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = this._cityHoverTitle(c);
      dot.appendChild(title);

      // Leader-line label: a small point-mark at the exact (cx,cy), a line
      // running diagonally down-left then bending horizontal, with the
      // city name sitting above the horizontal run — see _layoutCityLeader.
      const pointMark = document.createElementNS(SVG_NS, 'circle');
      pointMark.setAttribute('class', 'overview-city-point');
      this.allLabelEls.push(pointMark);

      const leaderPath = document.createElementNS(SVG_NS, 'path');
      leaderPath.setAttribute('class', 'overview-city-leader');
      this.allLabelEls.push(leaderPath);

      const leaderLabel = document.createElementNS(SVG_NS, 'text');
      leaderLabel.setAttribute('class', 'overview-city-leader-label');
      leaderLabel.textContent = c.ru;
      this.allLabelEls.push(leaderLabel);

      const entry = { id: c.id, cx: c.cx, cy: c.cy, dot, pointMark, leaderPath, leaderLabel, appended: false };
      this.cityDotEntries.push(entry);
      this.citiesById.set(c.id, { data: c, dotEl: dot });
    }

    // Places (landmarks) — always rendered (unlike cities, no
    // virtualization needed for just 20 of them), same leader-line label
    // construction as a dot-city, but the "dot" itself is a small constant-
    // screen-px marker (set every _rescaleForZoom) rather than a true-to-
    // scale circle, since a landmark has no real land-area radius.
    for (const p of this.level.places) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', p.cx);
      dot.setAttribute('cy', p.cy);
      dot.setAttribute('class', 'overview-place-dot');
      dot.dataset.id = p.id;
      dot.dataset.kind = 'place';
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = this._placeHoverTitle(p);
      dot.appendChild(title);

      const pointMark = document.createElementNS(SVG_NS, 'circle');
      pointMark.setAttribute('class', 'overview-city-point');
      this.allLabelEls.push(pointMark);

      const leaderPath = document.createElementNS(SVG_NS, 'path');
      leaderPath.setAttribute('class', 'overview-city-leader');
      this.allLabelEls.push(leaderPath);

      const leaderLabel = document.createElementNS(SVG_NS, 'text');
      leaderLabel.setAttribute('class', 'overview-city-leader-label');
      leaderLabel.textContent = p.ru;
      this.allLabelEls.push(leaderLabel);

      const entry = { id: p.id, cx: p.cx, cy: p.cy, dot, pointMark, leaderPath, leaderLabel };
      this.placeEntries.push(entry);
      this.placesById.set(p.id, { data: p, dotEl: dot });

      this.pointsLayer.appendChild(dot);
      this.pointsLayer.appendChild(pointMark);
      this.pointsLayer.appendChild(leaderPath);
      this.pointsLayer.appendChild(leaderLabel);
    }

    // Ruler layer — kept as its own <g> so _renderRuler can cheaply
    // rebuild just its contents (innerHTML='') without touching anything
    // else, and so it can be re-appended (moved) to the end of this.svg's
    // children on every render, keeping it painted on top even as new
    // city dots get revealed into the DOM later by the virtualization
    // queue above.
    this.rulerLayer = document.createElementNS(SVG_NS, 'g');
    this.rulerLayer.setAttribute('class', 'ruler-layer');
    this.svg.appendChild(this.rulerLayer);

    this.zoomViewport.appendChild(this.svg);
    // The wrap must be attached to the live document BEFORE attachZoomPan()
    // runs — it measures viewport.clientWidth/Height immediately (for pan
    // clamping and the initial virtualization pass), which reads 0 on a
    // detached element.
    this.wrapEl.appendChild(this.zoomWrap);
    this._buildSidePanel();
    this.container.appendChild(this.wrapEl);
    this._calibrateCharWidth();

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      baseScale: this.scale,
      panFromAnywhere: true,
      onTap: (ev) => this._onMapTap(ev),
      onZoomChange: (zoom) => this._rescaleForZoom(zoom),
      onVisibleRectChange: (rect) => {
        this._updateVisibleCities(rect);
        this._updateHighwayShields(rect);
      },
    });
    // Appended to this.container (#board-container), not this.zoomWrap —
    // .zoom-wrap is deliberately oversized by "cover" fit and gets
    // clipped, so a position:absolute child anchored to ITS edges can
    // land off-screen at extreme aspect ratios — the exact bug
    // .overview-panel/.overview-panel-toggle below were already fixed
    // for (see their own comment); zoom-controls/scale-bar had the same
    // issue.
    // Saved (not just appended-and-forgotten) so setOsmVisible can hide
    // them while the OSM iframe is showing — they only control this.svg's
    // own zoomCtl, which isn't what's on screen at that point.
    this.zoomControlsEl = createZoomControls(this.zoomCtl);
    this.scaleBarEl = createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit });
    this.container.appendChild(this.zoomControlsEl);
    this.container.appendChild(this.scaleBarEl);
    this.osmVisible = false;
    this.osmIframe = null;
    this.topoVisible = false;
    this.topoFrame = null;
    this._topoBBox = null; // current lon/lat bbox the topo grid is rendered from — see setTopoVisible
    this._buildLayerSwitcher();

    // Right-click only — never conflicts with left-click's existing
    // pan/tap-to-info behavior (contextmenu and pointerdown are entirely
    // separate event types), so the ruler needs no "enter ruler mode"
    // toggle at all.
    this.svg.addEventListener('contextmenu', (ev) => this._onMapContextMenu(ev));
    this._buildRulerReadout();
    // "Рельеф" hover readout — see _onMapMouseMove. Always bound (not only
    // while terrainMode !== 'off') since it's a no-op early return
    // otherwise; that avoids adding/removing the listener every time the
    // toggle flips.
    this.svg.addEventListener('mousemove', (ev) => this._onMapMouseMove(ev));
    this.svg.addEventListener('mouseleave', () => this._hideTerrainHoverTip());

    this._rescaleForZoom(1);
    this.setLabelsVisible(this.labelsVisible);
    this.setPlacesVisible(this.placesVisible);
    this.setHighwaysVisible(this.highwaysVisible);
    this.setProgressVisible(this.progressVisible);
    if (this.terrainMode !== 'off') this.setTerrainMode(this.terrainMode);
  }

  // Adds/removes each city's elements from the SVG based on whether it's
  // within the visible native-space rect (plus a margin) — states and
  // their labels stay permanently rendered (only 50 of them), but cities
  // (91, each with several elements) are cheap to keep out of the DOM
  // until they're actually near the camera. Called (debounced) by
  // zoomPan.js after pan/zoom settles, so there's a brief, deliberate delay
  // before newly-panned-into-view cities appear — trading instant pop-in
  // for not paying render cost for off-screen content.
  //
  // Hiding is cheap (just removing nodes) and happens immediately. Showing
  // is NOT cheap — laying out a dot-city's leader line calls
  // getComputedTextLength(), which forces a synchronous layout; doing that
  // for 70+ cities in one synchronous pass (e.g. zooming back out to see
  // the whole map at once) is exactly the kind of single giant frame that
  // tanks the framerate. So reveals go through a small lazy-loading queue
  // instead, a handful per animation frame — cities pop in over a few
  // frames rather than all at once, but every individual frame stays cheap.
  _updateVisibleCities(rect) {
    // An open info popup is anchored to a specific screen position via its
    // connector line — any further pan/zoom moves the dot out from under
    // it, so simplest correct behavior is to just close it rather than
    // continuously re-tracking the line during every frame of a drag. The
    // progress-edit popup is screen-anchored the same way, for the same
    // reason.
    this._closeInfoPopup();
    this._closeProgressEditPopup();
    this._lastVisibleRect = rect; // replayed by setCitiesVisible(true) — see below
    const mx = (rect.x1 - rect.x0) * VIRTUALIZE_MARGIN;
    const my = (rect.y1 - rect.y0) * VIRTUALIZE_MARGIN;
    this._visBounds = { x0: rect.x0 - mx, x1: rect.x1 + mx, y0: rect.y0 - my, y1: rect.y1 + my };

    const toReveal = [];
    for (const entry of this.cityDotEntries) {
      const visible = this.citiesVisible && this._dotEntryVisible(entry);
      if (visible && !entry.appended) toReveal.push({ kind: 'dot', entry });
      else if (!visible && entry.appended) this._hideDotEntry(entry);
    }
    for (const entry of this.cityShapeEntries) {
      const visible = this.citiesVisible && this._shapeEntryVisible(entry);
      if (visible && !entry.appended) toReveal.push({ kind: 'shape', entry });
      else if (!visible && entry.appended) this._hideShapeEntry(entry);
    }
    this._queueReveals(toReveal);
  }

  _dotEntryVisible(entry) {
    const b = this._visBounds;
    return entry.cx >= b.x0 && entry.cx <= b.x1 && entry.cy >= b.y0 && entry.cy <= b.y1;
  }
  _shapeEntryVisible(entry) {
    const [bx0, by0, bx1, by1] = entry.bbox;
    const b = this._visBounds;
    return !(bx1 < b.x0 || bx0 > b.x1 || by1 < b.y0 || by0 > b.y1);
  }

  _hideDotEntry(entry) {
    entry.dot.remove();
    entry.pointMark.remove();
    entry.leaderPath.remove();
    entry.leaderLabel.remove();
    entry.appended = false;
  }
  _hideShapeEntry(entry) {
    entry.path.remove();
    entry.label.remove();
    entry.appended = false;
  }

  _showDotEntry(entry, effScale) {
    // The dot itself is sized true-to-scale (real land-area radius, grows
    // with zoom — see its creation above) and can end up just as huge as a
    // shape-city's real boundary at deep zoom (Boston's radius circle
    // swallowing Harvard's marker was this exact bug), so it belongs with
    // the other "zones" for paint-order purposes. Its point-mark/leader-
    // line/label are separate elements sized in constant screen px — those
    // stay in `pointsLayer` so a city's own label (and every OTHER city's
    // or place's marker) still reliably renders above any dot, including
    // this one's.
    this.zonesLayer.appendChild(entry.dot);
    this.pointsLayer.appendChild(entry.pointMark);
    this.pointsLayer.appendChild(entry.leaderPath);
    this.pointsLayer.appendChild(entry.leaderLabel);
    entry.appended = true;
    // Re-lay-out immediately at the current zoom — while detached, its
    // stored geometry could be stale (from whenever it was last visible),
    // and getComputedTextLength() only works once attached.
    this._layoutCityLeader(entry, effScale);
    entry.leaderLabel.style.opacity = this.labelsVisible ? '' : '0';
    entry.pointMark.style.opacity = this.labelsVisible ? '' : '0';
    entry.leaderPath.style.opacity = this.labelsVisible ? '' : '0';
  }
  _showShapeEntry(entry) {
    this.zonesLayer.appendChild(entry.path);
    this.zonesLayer.appendChild(entry.label);
    entry.appended = true;
    entry.label.style.opacity = this.labelsVisible ? '' : '0';
  }

  _queueReveals(items) {
    if (!items.length) return;
    this._revealQueue = (this._revealQueue || []).concat(items);
    if (this._revealScheduled) return;
    this._revealScheduled = true;
    requestAnimationFrame(() => this._processRevealQueue());
  }

  _processRevealQueue() {
    if (this._destroyed) return;
    const BATCH = 6; // cities revealed per frame — small enough to stay well under a 16ms frame budget
    const effScale = this.scale * (this.zoomCtl?.getZoom() ?? 1);
    let n = 0;
    while (n < BATCH && this._revealQueue.length) {
      const { kind, entry } = this._revealQueue.shift();
      n++;
      if (entry.appended) continue; // already shown by the time its turn came up
      // Re-check visibility — the camera may have moved on since this was
      // queued, and there's no point revealing something no longer in view.
      const stillVisible = kind === 'dot' ? this._dotEntryVisible(entry) : this._shapeEntryVisible(entry);
      if (!stillVisible) continue;
      if (kind === 'dot') this._showDotEntry(entry, effScale);
      else this._showShapeEntry(entry);
    }
    if (this._revealQueue.length) {
      requestAnimationFrame(() => this._processRevealQueue());
    } else {
      this._revealScheduled = false;
    }
  }

  // ---------------- click-to-info popup (cities/places only, states excluded) ----------------

  // Once levels/usa/{cities,places}-info.json has loaded, mark whichever
  // dots/shapes actually have an entry as visually clickable — applied
  // retroactively since the fetch resolves after _build() already created
  // every element (including ones not currently appended, for virtualized
  // cities — the class just sits on the detached node until it's shown).
  _applyInfoAvailability() {
    for (const entry of this.cityDotEntries) {
      if (this.info.cities[entry.id]) entry.dot.classList.add('overview-has-info');
    }
    for (const entry of this.cityShapeEntries) {
      if (this.info.cities[entry.id]) entry.path.classList.add('overview-has-info');
    }
    for (const entry of this.placeEntries) {
      if (this.info.places[entry.id]) entry.dot.classList.add('overview-has-info');
    }
  }

  _onMapTap(ev) {
    const kind = ev.target?.dataset?.kind;
    const id = ev.target?.dataset?.id;
    // While the progress heatmap is on, a state tap corrects its count
    // instead of the normal city/place info popup (states never have one
    // anyway — see the else branch's own comment).
    if (this.progressVisible && kind === 'state') {
      this._openProgressEditPopup(id, ev.clientX, ev.clientY);
      return;
    }
    const entry = kind === 'city' ? this.info.cities[id] : kind === 'place' ? this.info.places[id] : null;
    if (entry) {
      if (this._openPopupId === id) {
        this._closeInfoPopup(); // tapping the same dot again toggles it closed
      } else {
        this._openInfoPopup(kind, id, entry);
      }
    } else {
      this._closeInfoPopup(); // tapping anything else (state, empty map, a city/place with no info) dismisses it
      this._closeProgressEditPopup();
    }
  }

  _openInfoPopup(kind, id, info) {
    this._closeInfoPopup();
    const source = kind === 'city' ? this.citiesById.get(id) : this.placesById.get(id);
    if (!source) return;
    const dotEl = source.dotEl || source.pathEl;
    const wrapRect = this.zoomWrap.getBoundingClientRect();
    const dotRect = dotEl.getBoundingClientRect();
    const dotX = dotRect.left + dotRect.width / 2 - wrapRect.left;
    const dotY = dotRect.top + dotRect.height / 2 - wrapRect.top;

    const popup = document.createElement('div');
    popup.className = 'info-popup';
    popup.innerHTML = `
      <button type="button" class="info-popup-close" title="Закрыть">×</button>
      ${info.image ? `<img class="info-popup-image" src="${info.image}" alt="" loading="lazy" />` : ''}
      <div class="info-popup-body">
        <h3 class="info-popup-title">${source.data.ru}</h3>
        <p class="info-popup-text">${info.extract}</p>
        <a class="info-popup-link" href="${info.wikiUrl}" target="_blank" rel="noopener">Читать в Википедии →</a>
      </div>
    `;
    popup.querySelector('.info-popup-close').addEventListener('click', () => this._closeInfoPopup());
    this.zoomWrap.appendChild(popup);

    // Prefer the right side of the dot; flip to the left if that would
    // overflow the map frame. Vertically centered on the dot, clamped so it
    // never runs off the top/bottom either.
    const wrapW = wrapRect.width;
    const wrapH = wrapRect.height;
    let popX = dotX + POPUP_MARGIN_PX;
    let connectSide = 'left'; // which edge of the popup the connector line touches
    if (popX + POPUP_W_PX > wrapW - POPUP_EDGE_PAD_PX) {
      popX = dotX - POPUP_MARGIN_PX - POPUP_W_PX;
      connectSide = 'right';
    }
    popX = Math.min(Math.max(popX, POPUP_EDGE_PAD_PX), wrapW - POPUP_W_PX - POPUP_EDGE_PAD_PX);
    popup.style.left = `${popX}px`;
    const popH = popup.offsetHeight; // real height, now that content + width are set
    const popY = Math.min(Math.max(dotY - popH / 2, POPUP_EDGE_PAD_PX), wrapH - popH - POPUP_EDGE_PAD_PX);
    popup.style.top = `${popY}px`;

    const connectX = connectSide === 'left' ? popX : popX + POPUP_W_PX;
    const connectY = popY + popH / 2;
    const connectorSvg = document.createElementNS(SVG_NS, 'svg');
    connectorSvg.setAttribute('class', 'info-popup-connector-svg');
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', dotX.toFixed(1));
    line.setAttribute('y1', dotY.toFixed(1));
    line.setAttribute('x2', connectX.toFixed(1));
    line.setAttribute('y2', connectY.toFixed(1));
    line.setAttribute('class', 'info-popup-connector');
    connectorSvg.appendChild(line);
    this.zoomWrap.insertBefore(connectorSvg, popup);

    this._openPopupId = id;
    this._infoPopupEl = popup;
    this._infoConnectorEl = connectorSvg;
  }

  _closeInfoPopup() {
    if (!this._openPopupId) return;
    this._openPopupId = null;
    this._infoPopupEl?.remove();
    this._infoPopupEl = null;
    this._infoConnectorEl?.remove();
    this._infoConnectorEl = null;
  }

  // ---------------- progress-heatmap edit popup (click a state while it's on) ----------------

  // Small card anchored at the click itself (not a connector line to a
  // fixed dot, like _openInfoPopup — a state is a whole shape, not a
  // point, so "where you clicked" is the only sensible anchor) letting the
  // player type in an exact success count for that state, bypassing
  // actually playing rounds to get there.
  _openProgressEditPopup(id, clientX, clientY) {
    this._closeInfoPopup();
    this._closeProgressEditPopup();
    const entry = this.statesById.get(id);
    if (!entry) return;
    const stats = loadSuccessStats(this.level.id, this.progressScope);
    const current = stats[id] || 0;

    const wrapRect = this.zoomWrap.getBoundingClientRect();
    const x = clamp(clientX - wrapRect.left, POPUP_EDGE_PAD_PX, wrapRect.width - PROGRESS_EDIT_POPUP_W_PX - POPUP_EDGE_PAD_PX);

    const popup = document.createElement('div');
    popup.className = 'progress-edit-popup';
    popup.innerHTML = `
      <button type="button" class="info-popup-close" title="Закрыть">×</button>
      <h3 class="progress-edit-title">${entry.data.ru}</h3>
      <label class="progress-edit-label">
        Успехов подряд
        <input type="number" class="progress-edit-input" min="0" max="99" value="${current}" />
      </label>
      <button type="button" class="btn btn-primary progress-edit-save">Сохранить</button>
    `;
    popup.style.left = `${x}px`;
    this.zoomWrap.appendChild(popup);
    const y = clamp(clientY - wrapRect.top, POPUP_EDGE_PAD_PX, wrapRect.height - popup.offsetHeight - POPUP_EDGE_PAD_PX);
    popup.style.top = `${y}px`;

    popup.querySelector('.info-popup-close').addEventListener('click', () => this._closeProgressEditPopup());
    const input = popup.querySelector('.progress-edit-input');
    const save = () => {
      const value = Math.max(0, Math.round(Number(input.value) || 0));
      setSuccessCount(this.level.id, this.progressScope, id, value);
      this.setProgressVisible(true); // re-colors every state — cheap, only ~50 of them
      this._closeProgressEditPopup();
    };
    popup.querySelector('.progress-edit-save').addEventListener('click', save);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') save();
    });
    input.focus();
    input.select();

    this._progressEditPopupEl = popup;
  }

  _closeProgressEditPopup() {
    this._progressEditPopupEl?.remove();
    this._progressEditPopupEl = null;
  }

  // ---------------- ruler tool (right-click to place/remove a point, drag to move) ----------------

  _buildRulerReadout() {
    const el = document.createElement('div');
    el.className = 'ruler-readout';
    el.hidden = true;
    el.innerHTML = `
      <div class="ruler-readout-body"></div>
      <button type="button" class="ruler-readout-clear">Очистить</button>
    `;
    this.rulerReadoutBody = el.querySelector('.ruler-readout-body');
    el.querySelector('.ruler-readout-clear').addEventListener('click', () => this._clearRuler());
    this.zoomWrap.appendChild(el);
    this.rulerReadoutEl = el;
  }

  // Same math as cityPinBoard.js's _clientToNative — reads the SVG's own
  // live viewBox (rather than assuming zoom=1), so it stays correct at
  // any current pan/zoom.
  _clientToNative(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    return {
      x: ((clientX - rect.left) / rect.width) * vb.width + vb.x,
      y: ((clientY - rect.top) / rect.height) * vb.height + vb.y,
    };
  }

  // Right-click doesn't need any onTap-style tap-vs-drag distinction —
  // 'contextmenu' already only fires for a genuine right-click, and (per
  // zoomPan.js) the pan machinery ignores non-left buttons entirely, so
  // there's no risk of a right-click ever starting a pan underneath this.
  // Right-clicking an EXISTING ruler point still deletes it directly, no
  // menu — that's an unambiguous action that doesn't benefit from one.
  // Right-clicking anywhere else opens the coordinates/actions menu
  // instead of placing a point immediately (previous behavior) — adding a
  // point is now one of that menu's options ("Добавить точку").
  _onMapContextMenu(ev) {
    ev.preventDefault();
    const pt = this._clientToNative(ev.clientX, ev.clientY);
    const hitIndex = this._hitTestRulerPoint(pt);
    if (hitIndex !== -1) {
      this.rulerPoints.splice(hitIndex, 1);
      this._renderRuler();
      return;
    }
    // State/terrain label, same lookup _onMapMouseMove's hover tip uses —
    // ev.target is the state <path> itself (or something else entirely,
    // e.g. ocean/background), never the terrain layer (pointer-events:none).
    const stateId = ev.target?.dataset?.kind === 'state' ? ev.target.dataset.id : null;
    const state = stateId ? this.statesById.get(stateId) : null;
    const category = this._terrainCategoryAt(pt);
    const label = state ? state.data.ru + (category ? ` — ${this.terrainLabelsByCategory.get(category)}` : '') : null;
    this._openContextMenu(ev.clientX, ev.clientY, pt, label);
  }

  // Coordinates come from js/geoCoords.js — a different inverse-projection
  // formula per level (equirectangular for world/countries, Albers +
  // per-inset for USA), so this stays entirely level-agnostic and just
  // asks for whatever nativeToLonLat can figure out; null (a future level
  // with no known projection) degrades to "Добавить точку" still working,
  // with the coordinate-dependent actions disabled rather than crashing.
  _openContextMenu(clientX, clientY, nativePt, label) {
    this._closeContextMenu();
    const coords = nativeToLonLat(this.level, nativePt.x, nativePt.y);

    const menu = document.createElement('div');
    menu.className = 'map-context-menu';
    menu.innerHTML = `
      ${label ? `<div class="map-context-menu-label">${label}</div>` : ''}
      <div class="map-context-menu-coords">${coords ? formatLonLat(coords) : 'Координаты недоступны'}</div>
      <button type="button" class="map-context-menu-item" data-action="add-point">Добавить точку</button>
      <button type="button" class="map-context-menu-item" data-action="open-maps"${coords ? '' : ' disabled'}>Открыть в Google Maps</button>
      <button type="button" class="map-context-menu-item" data-action="copy"${coords ? '' : ' disabled'}>Скопировать координаты</button>
    `;
    // Attached before positioning so offsetWidth/Height below reflect the
    // menu's real rendered size, not 0 — then clamped to the map frame so
    // a right-click near an edge doesn't spawn a menu that runs off it.
    this.zoomWrap.appendChild(menu);
    const wrapRect = this.zoomWrap.getBoundingClientRect();
    const maxLeft = Math.max(8, wrapRect.width - menu.offsetWidth - 8);
    const maxTop = Math.max(8, wrapRect.height - menu.offsetHeight - 8);
    menu.style.left = `${Math.min(Math.max(clientX - wrapRect.left, 8), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(clientY - wrapRect.top, 8), maxTop)}px`;

    menu.querySelector('[data-action="add-point"]').addEventListener('click', () => {
      this.rulerPoints.push(nativePt);
      this._renderRuler();
      this._closeContextMenu();
    });
    if (coords) {
      menu.querySelector('[data-action="open-maps"]').addEventListener('click', () => {
        window.open(`https://www.google.com/maps?q=${coords.lat},${coords.lon}`, '_blank', 'noopener');
        this._closeContextMenu();
      });
      menu.querySelector('[data-action="copy"]').addEventListener('click', () => {
        navigator.clipboard?.writeText(`${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`).catch(() => {});
        this._closeContextMenu();
      });
    }

    this._contextMenuEl = menu;
    // Capture phase so this always sees the click before any target's own
    // stopPropagation (same reasoning cityPinBoard.js's pin drag relies
    // on elsewhere) — otherwise clicking a ruler point to start dragging
    // it (which stopPropagation()s) would leave this menu stuck open.
    this._contextMenuOutsideHandler = (e) => {
      if (!menu.contains(e.target)) this._closeContextMenu();
    };
    this._contextMenuKeyHandler = (e) => {
      if (e.key === 'Escape') this._closeContextMenu();
    };
    window.addEventListener('pointerdown', this._contextMenuOutsideHandler, true);
    window.addEventListener('keydown', this._contextMenuKeyHandler);
  }

  _closeContextMenu() {
    if (!this._contextMenuEl) return;
    this._contextMenuEl.remove();
    this._contextMenuEl = null;
    window.removeEventListener('pointerdown', this._contextMenuOutsideHandler, true);
    window.removeEventListener('keydown', this._contextMenuKeyHandler);
    this._contextMenuOutsideHandler = null;
    this._contextMenuKeyHandler = null;
  }

  // Constant on-screen hit radius (like the point markers' own screen
  // size) rather than a fixed native-unit one, so it's equally easy to
  // land a right-click on a point whether zoomed in or out.
  _hitTestRulerPoint(pt) {
    const effScale = this.scale * (this.zoomCtl?.getZoom() ?? 1);
    const hitRadiusNative = RULER_HIT_R_PX / effScale;
    for (let i = 0; i < this.rulerPoints.length; i++) {
      const p = this.rulerPoints[i];
      if (Math.hypot(p.x - pt.x, p.y - pt.y) <= hitRadiusNative) return i;
    }
    return -1;
  }

  // Left-button drag only — a right-click's own pointerdown (button 2)
  // passes straight through here so it isn't stopPropagation'd away from
  // reaching the 'contextmenu' listener that actually handles deleting a
  // point. stopPropagation on the LEFT-button case is what keeps the map
  // from panning underneath the drag (same trick cityPinBoard.js's own
  // pin dragging already relies on — see _onPinPointerDown).
  _onRulerPointerDown(ev, index) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const move = (mv) => {
      this.rulerPoints[index] = this._clientToNative(mv.clientX, mv.clientY);
      this._renderRuler();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _fmtKm(km) {
    if (km < 10) return `${km.toFixed(2)} км`;
    if (km < 100) return `${km.toFixed(1)} км`;
    return `${Math.round(km).toLocaleString('ru-RU')} км`;
  }

  _fmtArea(km2) {
    if (km2 < 100) return `${km2.toFixed(1)} км²`;
    return `${Math.round(km2).toLocaleString('ru-RU')} км²`;
  }

  _clearRuler() {
    this.rulerPoints = [];
    this._renderRuler();
  }

  // Full rebuild on every add/remove/move/zoom — point counts here are
  // always small (a handful), so this is far cheaper than the incremental
  // appended/hidden bookkeeping cities need at 91-wide scale.
  _renderRuler() {
    // Re-append (moves, doesn't clone) so the ruler layer is always the
    // LAST child of this.svg, painting on top even of city dots the
    // virtualization queue appends later.
    this.svg.appendChild(this.rulerLayer);
    this.rulerLayer.innerHTML = '';

    const pts = this.rulerPoints;
    const effScale = this.scale * (this.zoomCtl?.getZoom() ?? 1);
    const kmPerUnit = this.level.kmPerUnit;

    const addLabel = (x, y, text) => {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', y);
      label.setAttribute('class', 'ruler-label');
      label.style.fontSize = `${(RULER_LABEL_PX / effScale).toFixed(2)}px`;
      label.style.strokeWidth = `${(RULER_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
      label.textContent = text;
      this.rulerLayer.appendChild(label);
    };

    // Sequential segments, PLUS an implicit closing edge (last -> first)
    // once there are 3+ points — that's what turns the sequence of
    // segments into a closed polygon with a perimeter/area, with no
    // separate "close the loop" action needed.
    const segCount = pts.length >= 3 ? pts.length : pts.length - 1;
    let totalKm = 0;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const segKm = Math.hypot(b.x - a.x, b.y - a.y) * kmPerUnit;
      totalKm += segKm;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('class', 'ruler-segment');
      this.rulerLayer.appendChild(line);
      addLabel((a.x + b.x) / 2, (a.y + b.y) / 2, this._fmtKm(segKm));
    }

    // Points drawn after (on top of) segments.
    pts.forEach((pt, i) => {
      const marker = document.createElementNS(SVG_NS, 'circle');
      marker.setAttribute('cx', pt.x);
      marker.setAttribute('cy', pt.y);
      marker.setAttribute('r', (RULER_POINT_R_PX / effScale).toFixed(2));
      marker.style.strokeWidth = `${(RULER_POINT_STROKE_PX / effScale).toFixed(2)}px`;
      marker.setAttribute('class', 'ruler-point');
      marker.addEventListener('pointerdown', (ev) => this._onRulerPointerDown(ev, i));
      this.rulerLayer.appendChild(marker);
    });

    // Readout panel — hidden below 2 points (a lone point has nothing to
    // measure yet); "Расстояние" for exactly 2 (a single segment, not a
    // polygon); "Периметр" + "Площадь" once closed (3+).
    if (pts.length < 2) {
      this.rulerReadoutEl.hidden = true;
    } else {
      this.rulerReadoutEl.hidden = false;
      const closed = pts.length >= 3;
      let html = `<div class="ruler-readout-row">${closed ? 'Периметр' : 'Расстояние'}: <strong>${this._fmtKm(totalKm)}</strong></div>`;
      if (closed) {
        const areaKm2 = polygonArea(pts) * kmPerUnit * kmPerUnit;
        html += `<div class="ruler-readout-row">Площадь: <strong>${this._fmtArea(areaKm2)}</strong></div>`;
      }
      this.rulerReadoutBody.innerHTML = html;
    }
  }

  // ---------------- side panel: search + tabbed state/city list ----------------

  _buildSidePanel() {
    const panel = document.createElement('div');
    panel.className = 'overview-panel';
    const tabsHtml =
      this.level.id === 'world'
        ? `<button type="button" class="overview-tab active" data-tab="oceans">Океаны</button>
           <button type="button" class="overview-tab" data-tab="seas">Моря</button>
           <button type="button" class="overview-tab" data-tab="other">Остальное</button>`
        : this.level.id === 'countries'
          ? // Countries has no cities/places (levels/countries.js: cities: [],
            // places: []) — a single tab, same reasoning as world's
            // Океаны/Моря/Остальное replacing Штаты/Города/Места instead of
            // showing two permanently-empty tabs.
            `<button type="button" class="overview-tab active" data-tab="states">Страны</button>`
          : `<button type="button" class="overview-tab active" data-tab="states">Штаты</button>
           <button type="button" class="overview-tab" data-tab="cities">Города</button>
           <button type="button" class="overview-tab" data-tab="places">Места</button>`;
    panel.innerHTML = `
      <div class="overview-tabs">
        ${tabsHtml}
      </div>
      <input type="text" class="overview-search" placeholder="Поиск..." autocomplete="off" />
      <div class="overview-list-header">
        <span class="overview-col-name">Название</span>
        <button type="button" class="overview-col-sort" data-sort="area">Площадь<span class="overview-sort-arrow"></span></button>
      </div>
      <div class="overview-list-scroll"><div class="overview-item-list"></div></div>
    `;

    this.searchInput = panel.querySelector('.overview-search');
    this.itemListEl = panel.querySelector('.overview-item-list');
    this.sortArrowEl = panel.querySelector('.overview-sort-arrow');
    this.sortBtnEl = panel.querySelector('.overview-col-sort');

    for (const btn of panel.querySelectorAll('.overview-tab')) {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === this.activeTab) return;
        this.activeTab = btn.dataset.tab;
        for (const b of panel.querySelectorAll('.overview-tab')) b.classList.toggle('active', b === btn);
        this.searchInput.value = '';
        this.searchQuery = '';
        this._renderList();
      });
    }
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value.trim().toLowerCase();
      this._renderList();
    });
    panel.querySelector('.overview-col-sort').addEventListener('click', () => {
      this.sortDir = this.sortBy === 'area' && this.sortDir === 'desc' ? 'asc' : 'desc';
      this.sortBy = 'area';
      this._renderList();
    });

    this._renderList();
    // Appended to this.container (#board-container), NOT this.wrapEl
    // (.overview-wrap) — the wrap's own box can be taller/wider than the
    // actual screen now that the map uses "cover" fit (see
    // game.js's _computeScale), which is fine for the map itself but was
    // pushing the panel's top (search, column headers) off-screen along
    // with it. #board-container's box stays tied to the real available
    // space (min-height:0 in its own CSS) regardless of the map
    // overflowing it, so anchoring here instead keeps the panel fully
    // on-screen. See style.css's #board-container comment.
    this.container.appendChild(panel);

    // Collapse/expand tab — the list floats over the map now (no reserved
    // width for it), so being able to tuck it away to see the map
    // underneath matters more than it did when it just sat in its own
    // column. State lives on this.container (a class, not a field on
    // `this`) since that's what both .overview-panel's and this button's
    // CSS key off of — see style.css's .panel-collapsed rules.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'overview-panel-toggle';
    toggle.textContent = '▸';
    toggle.title = 'Свернуть/развернуть список';
    toggle.addEventListener('click', () => {
      const collapsed = this.container.classList.toggle('panel-collapsed');
      toggle.textContent = collapsed ? '◂' : '▸';
    });
    this.container.appendChild(toggle);
  }

  // World's three tabs ('oceans'/'seas'/'other') aren't a real field on the
  // piece data — they're derived from the Russian name itself, checked in
  // this order so "океан" is claimed before the "мор" stem gets a chance
  // (an ocean's name never also contains "море", so order only matters for
  // readability, not correctness). Everything left over (gulfs/bays —
  // "залив" — plus Hudson Bay/Baffin Bay's "залив" naming) falls to
  // 'other'. Lowercased first — several names START with "Море ..."
  // (capital М), which a plain .includes('мор') silently never matched,
  // dumping every one of those into 'other' instead of 'seas'.
  _pieceCategory(piece) {
    const ru = piece.ru.toLowerCase();
    if (ru.includes('океан')) return 'oceans';
    if (ru.includes('мор')) return 'seas';
    return 'other';
  }

  _isPieceTab() {
    return this.activeTab === 'states' || this.activeTab === 'oceans' || this.activeTab === 'seas' || this.activeTab === 'other';
  }

  // Effective area (km²) of an item — states and (world level) seas both
  // carry a real `area` field (see build_usa_level.js / build_world_seas.js);
  // cities only store a radius, so their area is derived (they're rendered
  // as a circle of that radius to begin with).
  _areaOf(it) {
    return this._isPieceTab() ? it.area : Math.PI * it.radiusKm * it.radiusKm;
  }

  // 'states': short `.id` codes (AL, CA…) fit a dedicated abbreviation
  // column — scoped to level.id === 'usa' specifically, not just
  // activeTab === 'states', since the countries level's "Страны" tab ALSO
  // uses activeTab 'states' (see _buildSidePanel) but a country's `.id` is
  // its ISO_A3 code where one exists and a full slugify(name) like
  // "south_ossetia" where it doesn't — not reliably short either way
  // (world's 'oceans'/'seas'/'other' tabs sidestep this by never using
  // activeTab 'states' at all). 'cities': capital/silhouette markers + a
  // state sub-label. Everything else (world's seas, countries, USA's
  // places) just gets a plain name — this used to fall into the 'cities'
  // template by default for anything not 'states'/'places', which
  // rendered a literal "undefined" sub-label for seas (no `.state` field)
  // — same bug already fixed in js/eligibilityList.js's equivalent method.
  _mainColumnHtml(it) {
    if (this.activeTab === 'states' && this.level.id === 'usa') {
      return `<span class="overview-item-main"><span class="overview-item-abbr">${it.id}</span><span class="overview-item-name">${it.ru}</span></span>`;
    }
    if (this.activeTab === 'cities') {
      return `<span class="overview-item-main"><span class="overview-item-name">${it.ru}${it.capital ? ' ★' : ''}${it.d ? ' ◆' : ''}</span><span class="overview-item-sub">${it.state || ''}</span></span>`;
    }
    return `<span class="overview-item-main"><span class="overview-item-name">${it.ru}</span></span>`;
  }

  // Hover tooltip for a city marker (dot or real-boundary shape alike) —
  // area here is always the derived circle-of-that-radius figure, computed
  // directly rather than via _areaOf (which reads the side panel's current
  // tab to decide states-vs-cities and would misfire if a city is hovered
  // on the map while that panel happens to be showing the states tab).
  _cityHoverTitle(c) {
    const areaKm2 = Math.PI * c.radiusKm * c.radiusKm;
    const areaStr = Math.round(areaKm2).toLocaleString('ru-RU');
    return `${c.ru} (${c.name}) — R ${c.radiusKm.toFixed(1)} км (${areaStr} км²)`;
  }

  // Places have no meaningful radius/area (see scripts/build_usa_places.js)
  // — just the name, unlike _cityHoverTitle.
  _placeHoverTitle(p) {
    return `${p.ru} (${p.name})`;
  }

  _renderList() {
    const items =
      this.activeTab === 'states'
        ? this.level.pieces
        : this.activeTab === 'oceans' || this.activeTab === 'seas' || this.activeTab === 'other'
          ? this.level.pieces.filter((p) => this._pieceCategory(p) === this.activeTab)
          : this.activeTab === 'places'
            ? this.level.places
            : this.level.cities;
    const q = this.searchQuery;
    const filtered = q
      ? items.filter((it) => it.ru.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q))
      : items;

    // Places carry only a nominal radiusKm (identical for every place), so
    // sorting/showing "Площадь" for them would be a meaningless tie —
    // hide that column entirely on this tab instead of displaying it.
    const showArea = this.activeTab !== 'places';
    this.sortBtnEl.hidden = !showArea;

    let sorted;
    if (this.sortBy === 'area' && showArea) {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      sorted = [...filtered].sort((a, b) => (this._areaOf(a) - this._areaOf(b)) * dir);
    } else {
      sorted = [...filtered].sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));
    }
    this.sortArrowEl.textContent = this.sortBy === 'area' && showArea ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    this.itemListEl.innerHTML = '';
    if (!sorted.length) {
      this.itemListEl.innerHTML = '<p class="overview-empty">Ничего не найдено</p>';
      return;
    }

    for (const it of sorted) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'overview-item';
      const areaStr = showArea ? Math.round(this._areaOf(it)).toLocaleString('ru-RU') + ' км²' : '';
      row.innerHTML = this._mainColumnHtml(it) + `<span class="overview-item-area">${areaStr}</span>`;
      row.addEventListener('click', () => {
        if (this._isPieceTab()) this._focusState(it.id);
        else if (this.activeTab === 'places') this._focusPlace(it.id);
        else this._focusCity(it.id);
      });
      this.itemListEl.appendChild(row);
    }
  }

  // ---------------- focus / highlight ----------------

  _focusState(id) {
    const entry = this.statesById.get(id);
    if (!entry) return;
    this._focusShape(entry.data);
  }

  _focusCity(id) {
    const entry = this.citiesById.get(id);
    if (!entry) return;
    const { data } = entry;
    if (data.bbox) {
      this._focusShape(data);
      return;
    }
    // Point features (plain dots) don't have a bbox to fit like states/shape
    // cities do, but the dot's true-to-scale radius (native units, same as
    // everything else — see where it's built) works the same way: zoom so
    // it fills a small, comfortable fraction of the viewport. This used to
    // just pass Infinity and rely on focusOn() clamping it to the shared
    // max zoom — now that zoom has no ceiling at all (by design), Infinity
    // stays Infinity and breaks the view entirely, so this needs its own
    // finite target instead of leaning on a cap that no longer exists.
    const radiusNative = data.radiusKm / this.level.kmPerUnit;
    const diameterNative = Math.max(radiusNative * 2, 1);
    const vw = this.zoomViewport.clientWidth;
    const vh = this.zoomViewport.clientHeight;
    const targetZoom = Math.max(
      1,
      Math.min((vw * CITY_POINT_FOCUS_FILL) / (diameterNative * this.scale), (vh * CITY_POINT_FOCUS_FILL) / (diameterNative * this.scale))
    );
    this.zoomCtl.focusOn(data.cx, data.cy, targetZoom);
    this._clearFocus();
    entry.dotEl.classList.add('overview-focused');
    this.focusedEl = entry.dotEl;
    this._scheduleAutoClear();
  }

  // A place has no bbox and no real physical radius (unlike a city's
  // true-to-scale one) — same point-feature zoom math as _focusCity's
  // point branch, just against a fixed "close-up" radius instead of a
  // meaningful one.
  _focusPlace(id) {
    const entry = this.placesById.get(id);
    if (!entry) return;
    const { data } = entry;
    const radiusNative = PLACE_FOCUS_RADIUS_KM / this.level.kmPerUnit;
    const diameterNative = Math.max(radiusNative * 2, 1);
    const vw = this.zoomViewport.clientWidth;
    const vh = this.zoomViewport.clientHeight;
    const targetZoom = Math.max(
      1,
      Math.min((vw * CITY_POINT_FOCUS_FILL) / (diameterNative * this.scale), (vh * CITY_POINT_FOCUS_FILL) / (diameterNative * this.scale))
    );
    this.zoomCtl.focusOn(data.cx, data.cy, targetZoom);
    this._clearFocus();
    entry.dotEl.classList.add('overview-focused');
    this.focusedEl = entry.dotEl;
    this._scheduleAutoClear();
  }

  // Shared by states and by the handful of cities with a real boundary
  // shape: zoom to fit the shape's bbox, then drop a glowing copy of it on
  // top of everything else in paint order (see the comment below).
  _focusShape(data) {
    const [bx0, by0, bx1, by1] = data.bbox;
    const bboxW = Math.max(bx1 - bx0, 1);
    const bboxH = Math.max(by1 - by0, 1);
    const vw = this.zoomViewport.clientWidth;
    const vh = this.zoomViewport.clientHeight;
    const targetZoom = Math.max(1, Math.min((vw * STATE_FOCUS_FILL) / (bboxW * this.scale), (vh * STATE_FOCUS_FILL) / (bboxH * this.scale)));
    this.zoomCtl.focusOn(data.cx, data.cy, targetZoom);

    this._clearFocus();
    // Neighboring shapes painted after this one in document order would
    // otherwise cover parts of its glow along shared borders — a fresh
    // copy appended last (topmost in SVG paint order) always renders fully
    // on top, whichever shape it is.
    const glow = document.createElementNS(SVG_NS, 'path');
    glow.setAttribute('d', data.d);
    glow.setAttribute('class', 'overview-focus-glow');
    this.svg.appendChild(glow);
    this.focusGlowEl = glow;
    this._scheduleAutoClear();
  }

  _scheduleAutoClear() {
    clearTimeout(this.focusTimeoutHandle);
    this.focusTimeoutHandle = setTimeout(() => this._clearFocus(), FOCUS_DURATION_MS);
  }

  _clearFocus() {
    clearTimeout(this.focusTimeoutHandle);
    this.focusTimeoutHandle = null;
    this.focusedEl?.classList.remove('overview-focused');
    this.focusedEl = null;
    this.focusGlowEl?.remove();
    this.focusGlowEl = null;
  }

  // Keeps text (and stroke widths) a constant number of *screen* pixels
  // regardless of zoom level. The board's width/height attributes scale
  // relative to a fixed viewBox (see zoomPan.js), so every native SVG unit
  // maps to more screen pixels as you zoom in — sizes expressed in native
  // units would otherwise balloon and overlap. City dot radii are the one
  // exception: those are meant to grow/shrink with zoom, so they're set
  // once at creation and never touched here. Only *currently-appended*
  // (i.e. visible — see _updateVisibleCities) city entries are touched —
  // there's no point paying to lay out elements nobody can see.
  _rescaleForZoom(zoom) {
    const effScale = this.scale * zoom;
    for (const { el } of this.stateLabels) {
      el.style.fontSize = `${(STATE_LABEL_PX / effScale).toFixed(2)}px`;
      el.style.strokeWidth = `${(STATE_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
    }
    for (const entry of this.cityDotEntries) {
      if (!entry.appended) continue;
      this._layoutCityLeader(entry, effScale);
      // dot radius is NOT rescaled here — it's fixed in native units (true
      // geographic size), only the outline stroke stays a constant screen px.
      entry.dot.style.strokeWidth = `${(CITY_DOT_STROKE_PX / effScale).toFixed(2)}px`;
    }
    for (const entry of this.placeEntries) {
      this._layoutCityLeader(entry, effScale);
      // Unlike a city dot, a place's dot IS rescaled here — it has no real
      // physical radius to stay true-to-scale to, so it's just a constant-
      // screen-px marker like the label text/leader-line around it.
      entry.dot.setAttribute('r', (PLACE_DOT_R_PX / effScale).toFixed(2));
      entry.dot.style.strokeWidth = `${(PLACE_DOT_STROKE_PX / effScale).toFixed(2)}px`;
    }
    // Keeps whichever shields are already showing at a constant screen
    // size DURING a zoom gesture — _updateHighwayShields itself only runs
    // after pan/zoom settles (debounced), so without this they'd stay the
    // old size until the gesture finished instead of scaling smoothly
    // alongside everything else on the map.
    for (const entry of this.highwayEntries) {
      if (entry.lastPos) this._positionHighwayShield(entry, effScale);
    }
    // _renderRuler already recomputes its own effScale internally and is a
    // full (cheap, small-N) rebuild each time, so just re-running it here
    // keeps ruler point/label sizes constant-screen-px too, same as
    // everything else in this method.
    if (this.rulerLayer) this._renderRuler();
  }

  // getComputedTextLength() forces a synchronous layout of the *whole*
  // page, not just the one element — calling it per-city (up to 91 times
  // on first load, and again for every visible city on every zoom step)
  // was the actual cause of the framerate collapsing to single digits,
  // independent of how small the reveal batches were. JetBrains Mono is
  // monospace, so every character has the same advance width — measuring
  // it ONCE here and reusing that ratio arithmetically from then on gets
  // the same result without ever forcing layout again.
  _calibrateCharWidth() {
    const probe = document.createElementNS(SVG_NS, 'text');
    probe.setAttribute('class', 'overview-city-leader-label');
    probe.style.fontSize = '100px';
    probe.style.opacity = '0';
    probe.textContent = 'MW0123456789АБВГДЕЖ';
    this.svg.appendChild(probe);
    const len = probe.getComputedTextLength();
    this.svg.removeChild(probe);
    this._charWidthRatio = len / (probe.textContent.length * 100); // px of width per px of font-size, per character
  }

  // Point-mark -> diagonal -> horizontal run -> text, all sized/positioned
  // in constant screen px regardless of zoom (see the comment above). The
  // horizontal run's length comes from the calibrated char-width ratio
  // (see _calibrateCharWidth) rather than measuring the live element, so
  // laying out a city never forces a page-wide synchronous layout.
  _layoutCityLeader(entry, effScale) {
    const { cx, cy, pointMark, leaderPath, leaderLabel } = entry;
    pointMark.setAttribute('cx', cx);
    pointMark.setAttribute('cy', cy);
    pointMark.setAttribute('r', (LEADER_POINT_R_PX / effScale).toFixed(2));
    pointMark.style.strokeWidth = `${(LEADER_POINT_STROKE_PX / effScale).toFixed(2)}px`;

    const d45 = LEADER_DIAG_PX / effScale / Math.SQRT2;
    const bendX = cx - d45;
    const bendY = cy + d45;

    const fontSizeNative = CITY_LABEL_PX / effScale;
    leaderLabel.style.fontSize = `${fontSizeNative.toFixed(2)}px`;
    leaderLabel.style.strokeWidth = `${(CITY_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
    const textLen = leaderLabel.textContent.length * this._charWidthRatio * fontSizeNative;
    const pad = LEADER_PAD_PX / effScale;
    const lineEndX = bendX - textLen - pad * 2;

    leaderPath.setAttribute('d', `M ${cx.toFixed(1)},${cy.toFixed(1)} L ${bendX.toFixed(1)},${bendY.toFixed(1)} L ${lineEndX.toFixed(1)},${bendY.toFixed(1)}`);
    leaderPath.style.strokeWidth = `${(LEADER_STROKE_PX / effScale).toFixed(2)}px`;

    leaderLabel.setAttribute('x', bendX - pad);
    leaderLabel.setAttribute('y', bendY - LEADER_TEXT_GAP_PX / effScale);
  }

  setLabelsVisible(visible) {
    this.labelsVisible = visible;
    for (const label of this.allLabelEls) label.style.opacity = visible ? '' : '0';
  }

  // Turning cities off hides every currently-shown dot/shape immediately
  // (via the next _updateVisibleCities pass); turning them back on replays
  // the last known visible rect so whatever should be on screen reappears
  // right away instead of waiting for the next pan/zoom to trigger it.
  setCitiesVisible(visible) {
    this.citiesVisible = visible;
    if (this._lastVisibleRect) this._updateVisibleCities(this._lastVisibleRect);
  }

  // The line itself is a direct display toggle (same reasoning as
  // setPlacesVisible — only ~59 of them, always in the DOM). The shield
  // badges need more than that: turning highways back on should show
  // whichever shields belong in the CURRENT view immediately, not wait
  // for the next pan/zoom to trigger _updateHighwayShields — replaying
  // the last known visible rect (same trick setCitiesVisible uses) does
  // that instead of everyone popping in only after the player next moves
  // the map.
  setHighwaysVisible(visible) {
    this.highwaysVisible = visible;
    for (const entry of this.highwayEntries) {
      entry.pathEl.style.display = visible ? '' : 'none';
      if (!visible) entry.shieldEl.style.display = 'none';
    }
    if (visible && this._lastVisibleRect) this._updateHighwayShields(this._lastVisibleRect);
  }

  // "Progress heatmap": colors every state from black (0 successes) to the
  // CURRENT color scheme's accent at PROGRESS_MAX+ — using CSS color-mix()
  // directly in the fill value (var(--neon-cyan) resolves live against
  // whatever :root[data-land-scheme] is active) rather than computing a
  // static rgb blend in JS, so toggling the color scheme while this is on
  // updates every state's fill for free, with no re-render needed here.
  setProgressVisible(visible) {
    this.progressVisible = visible;
    if (!visible) {
      this._closeProgressEditPopup();
      for (const { pathEl } of this.statesById.values()) pathEl.style.fill = '';
      return;
    }
    const stats = loadSuccessStats(this.level.id, this.progressScope);
    for (const { data, pathEl } of this.statesById.values()) {
      const t = clamp((stats[data.id] || 0) / PROGRESS_MAX, 0, 1);
      pathEl.style.fill = `color-mix(in srgb, black ${(100 - t * 100).toFixed(1)}%, var(--neon-cyan) ${(t * 100).toFixed(1)}%)`;
    }
  }

  // Switches which adaptive-mode success stat is being visualized —
  // re-applies immediately if the heatmap is currently showing, otherwise
  // just remembered for whenever it's next turned on.
  setProgressScope(scope) {
    this.progressScope = scope;
    if (this.progressVisible) this.setProgressVisible(true);
  }

  // Builds the 8 <pattern> elements TERRAIN_PATTERNS describes — called
  // once, the first time the terrain layer is built (see setTerrainMode).
  // style.css's `.terrain-region[data-terrain='X'] { fill: url(#terrain-
  // pattern-X); }` rules are what actually point each region at its
  // pattern; this method only needs to make sure those ids exist in the
  // document. Fixed (non-randomized) ids are safe here — unlike
  // setTerrainMode's own clip-path id, exactly one OverviewBoard is
  // ever mounted at a time (game.js destroys the previous one before
  // building a new one), so there's no risk of two boards' defs colliding.
  _buildTerrainPatternDefs() {
    const defs = document.createElementNS(SVG_NS, 'defs');
    // category -> its <pattern> — _updateTerrainPatternScale below reads
    // this to know which patterns exist (only 'mountain' is EXCLUDED from
    // the zoom-compensation loop there).
    this.terrainPatternsByCategory = new Map();
    for (const [category, iconSvg] of Object.entries(TERRAIN_PATTERNS)) {
      const pattern = document.createElementNS(SVG_NS, 'pattern');
      pattern.id = `terrain-pattern-${category}`;
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      pattern.setAttribute('width', TERRAIN_PATTERN_TILE_PX);
      pattern.setAttribute('height', TERRAIN_PATTERN_TILE_PX);
      pattern.innerHTML = iconSvg;
      defs.appendChild(pattern);
      this.terrainPatternsByCategory.set(category, pattern);
    }
    return defs;
  }

  // Real mountain RANGES are genuinely hundreds of km across, so letting
  // that pattern grow with the map at deep zoom (its default, untouched
  // behavior) still looks right — you're just seeing more detail of the
  // same real feature, the way zooming into a real photo of a mountain
  // range would. A single pine tree or dune is nowhere near that scale
  // though: without this, zooming in made every OTHER icon blow up into
  // an absurd, map-sized giant tree/dune/puddle. patternTransform's
  // scale(f) shrinks a pattern's own tile (repeat spacing included, not
  // just its content) around its origin — applying 1/zoom here cancels
  // the map's own zoom back out for these categories, so their on-screen
  // icon size stays roughly constant (more, smaller icons become visible
  // as you zoom in, instead of the same few icons just getting huge) —
  // clamped at 1 so zooming OUT past the default fit doesn't inflate them
  // instead, and floored so an extreme zoom-in can't ask for a
  // vanishingly, uselessly tiny tile.
  _updateTerrainPatternScale(zoom) {
    if (!this.terrainPatternsByCategory) return;
    const MIN_FACTOR = 0.12;
    const factor = zoom > 1 ? Math.max(MIN_FACTOR, 1 / zoom) : 1;
    for (const [category, pattern] of this.terrainPatternsByCategory) {
      if (category === 'mountain') continue;
      pattern.setAttribute('patternTransform', `scale(${factor})`);
    }
  }

  // Detaches (or re-attaches) every state piece's native <title> — see the
  // comment where it's created in _build(). SVG <title> tooltips can only
  // be suppressed by actually removing the node (no CSS controls native
  // tooltip visibility), so this is real DOM surgery, not a class toggle;
  // cheap enough at 50 states, and only runs once per terrain toggle flip.
  _setStateNativeTooltipsEnabled(enabled) {
    for (const { pathEl, titleEl } of this.statesById.values()) {
      if (!titleEl) continue;
      if (enabled && !titleEl.isConnected) pathEl.appendChild(titleEl);
      else if (!enabled && titleEl.isConnected) titleEl.remove();
    }
  }

  // "Рельеф" — lazily builds levels/usaTerrain.js's 8 terrain-category
  // sub-regions into a <g class="terrain-layer">, inserted as the FIRST
  // child of zonesLayer (the same position buildStateBackground's land
  // layer occupies for world/countries — see _build), so it paints
  // underneath every state piece automatically via existing paint order,
  // no z-index bookkeeping needed. pointer-events:none (style.css) keeps
  // it out of hit-testing entirely — no click-handling code anywhere needs
  // to know it exists. Clipped to the union of every state's own `d` so
  // terrain color never bleeds into the ocean/gaps beyond the US outline —
  // cheaper than intersecting each terrain polygon against state borders
  // individually, which this project has no library for anyway (see the
  // plan this shipped from).
  //
  // The ~480KB terrain module is dynamic-imported here on first use
  // instead of statically imported at the top of this file, so loading
  // World/Countries Overview never pays for it.
  //
  // mode is 'off' | 'color' | 'pattern' — the layer itself only ever needs
  // building once (the <path>s are identical either way); 'color' vs.
  // 'pattern' is just a CSS class flip (.terrain-mode-color, see
  // style.css) that swaps each region's fill between its flat
  // var(--terrain-X) and its url(#terrain-pattern-X).
  async setTerrainMode(mode) {
    if (this.level.id !== 'usa') return;
    this.terrainMode = mode;
    const visible = mode !== 'off';
    this._setStateNativeTooltipsEnabled(!visible);
    if (!visible) {
      if (this.terrainLayer) setElementHidden(this.terrainLayer, true);
      if (this.terrainLegendEl) setElementHidden(this.terrainLegendEl, true);
      this.zonesLayer.classList.remove('terrain-active');
      return;
    }
    if (!this.terrainLayer) {
      const { default: usaTerrain } = await import('../levels/usaTerrain.js');
      if (this._destroyed) return; // board torn down while the import was in flight
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'terrain-layer');
      const clipId = 'terrain-clip-' + Math.random().toString(36).slice(2);
      const clipPath = document.createElementNS(SVG_NS, 'clipPath');
      clipPath.id = clipId;
      const clipShape = document.createElementNS(SVG_NS, 'path');
      clipShape.setAttribute('d', this.level.pieces.map((p) => p.d).join(' '));
      clipPath.appendChild(clipShape);
      g.appendChild(clipPath);
      g.setAttribute('clip-path', `url(#${clipId})`);
      g.appendChild(this._buildTerrainPatternDefs());
      // category -> its <path> — _toggleTerrainCategory below looks this up
      // instead of re-querying the DOM on every click. terrainLabelsByCategory
      // is the same keys -> Russian label, for the hover tip/context menu.
      this.terrainRegionsByCategory = new Map();
      this.terrainLabelsByCategory = new Map();
      for (const region of usaTerrain.regions) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', region.d);
        path.setAttribute('class', 'terrain-region');
        path.dataset.terrain = region.category;
        // No <title> here on purpose — pointer-events:none (style.css)
        // means this path can never actually receive the hover that would
        // show it; _onMapMouseMove's custom terrain-hover-tip is what
        // actually reports the category, via _terrainCategoryAt.
        g.appendChild(path);
        this.terrainRegionsByCategory.set(region.category, path);
        this.terrainLabelsByCategory.set(region.category, region.label);
      }
      this.zonesLayer.insertBefore(g, this.zonesLayer.firstChild);
      this.terrainLayer = g;
      // Live-updates as the player zooms — see _updateTerrainPatternScale's
      // own comment for why mountains are excluded. subscribe() only fires
      // on FUTURE changes, so this also needs one immediate call for
      // whatever zoom level is already active right now.
      this.zoomCtl.subscribe((zoom) => this._updateTerrainPatternScale(zoom));
      this._updateTerrainPatternScale(this.zoomCtl.getZoom());

      // Anchored to this.container (#board-container), not zoomWrap — see
      // the CSS comment on .terrain-legend for why. Every swatch doubles as
      // a per-category filter button — not persisted across reloads, same
      // as terrainMode itself (see game.js's terrainMode comment).
      const legend = document.createElement('div');
      legend.className = 'terrain-legend';
      for (const region of usaTerrain.regions) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'terrain-legend-item';
        item.dataset.terrain = region.category;
        const description = TERRAIN_DESCRIPTIONS[region.category];
        item.title = description ? `${region.label}\n\n${description}` : region.label;
        item.innerHTML = `<span class="terrain-legend-swatch" style="background: var(--terrain-${region.category})"></span><span>${region.label}</span>`;
        item.addEventListener('click', () => this._toggleTerrainCategory(region.category));
        legend.appendChild(item);
      }
      this.container.appendChild(legend);
      this.terrainLegendEl = legend;
    }
    // Re-check — the toggle could have been switched off again while the
    // dynamic import above was still in flight.
    if (this.terrainMode === 'off') return;
    setElementHidden(this.terrainLayer, false);
    setElementHidden(this.terrainLegendEl, false);
    this.zonesLayer.classList.add('terrain-active');
    this.terrainLayer.classList.toggle('terrain-mode-color', this.terrainMode === 'color');
  }

  // Per-category filter — clicking a legend swatch hides/shows just that
  // one terrain category's <path> without touching the other 7 or the
  // "Рельеф" toggle itself. Not persisted across reloads, same as
  // terrainMode (see game.js's terrainMode comment) — this is a
  // view filter for the current look at the map, not a settings-panel
  // choice like level/mode/difficulty.
  _toggleTerrainCategory(category) {
    const path = this.terrainRegionsByCategory?.get(category);
    const item = this.terrainLegendEl?.querySelector(`.terrain-legend-item[data-terrain="${category}"]`);
    if (!path || !item) return;
    const nowHidden = !this.terrainHiddenCategories.has(category);
    if (nowHidden) this.terrainHiddenCategories.add(category);
    else this.terrainHiddenCategories.delete(category);
    setElementHidden(path, nowHidden);
    item.classList.toggle('terrain-legend-item-off', nowHidden);
  }

  // Which terrain category (if any) contains a native-space point — a
  // real point-in-polygon test against each category's actual <path>
  // geometry via SVGGeometryElement.isPointInFill, since the terrain
  // layer's own paths are pointer-events:none (see the class comment on
  // setTerrainMode) and so can never be ev.target themselves. Filtered-
  // off categories (see _toggleTerrainCategory) are skipped, same as they
  // are visually — hovering there should behave like the layer just isn't
  // there, not silently report a hidden category. Null when terrain isn't
  // built/visible yet, or the point isn't inside any category (Hawaii, or
  // any other gap in the source dataset).
  // Nearest of HI_ISLAND_HOVER_LABELS's 8 real island centers to a given
  // native-coordinate point, or null off the projection's known area
  // entirely. Shared by the HI piece's native <title> (pointermove, above)
  // and _onMapMouseMove's custom terrain-hover-tip — Hawaii has no terrain
  // category data at all (see _terrainCategoryAt's own comment on gaps in
  // the source dataset), so without this its terrain tooltip falls back to
  // the bare state name same as before this existed.
  _hiIslandLabelAt(nativePt) {
    const coords = nativeToLonLat(this.level, nativePt.x, nativePt.y);
    if (!coords) return null;
    let best = null;
    let bestD = Infinity;
    for (const isl of HI_ISLAND_HOVER_LABELS) {
      const d = (coords.lon - isl.lon) ** 2 + (coords.lat - isl.lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = isl;
      }
    }
    return best?.label ?? null;
  }

  _terrainCategoryAt(nativePt) {
    if (this.terrainMode === 'off' || !this.terrainRegionsByCategory) return null;
    const svgPt = this.svg.createSVGPoint();
    svgPt.x = nativePt.x;
    svgPt.y = nativePt.y;
    for (const [category, path] of this.terrainRegionsByCategory) {
      if (this.terrainHiddenCategories.has(category)) continue;
      if (path.isPointInFill(svgPt)) return category;
    }
    return null;
  }

  // Live "Вайоминг — Пустыня" readout while the mouse moves over a state
  // with "Рельеф" on — a plain state <title> can't do this since its text
  // is fixed per-element, not per-cursor-position, and a state can straddle
  // several terrain categories (see _terrainCategoryAt). Cheap early-outs
  // (terrainMode 'off', not hovering a state) keep this from doing any
  // point-in-fill work on every ordinary mousemove.
  _onMapMouseMove(ev) {
    if (this.terrainMode === 'off') return this._hideTerrainHoverTip();
    const kind = ev.target?.dataset?.kind;
    const id = ev.target?.dataset?.id;
    if (kind !== 'state' || !id) return this._hideTerrainHoverTip();
    const state = this.statesById.get(id);
    const nativePt = this._clientToNative(ev.clientX, ev.clientY);
    const category = this._terrainCategoryAt(nativePt);
    const stateName = state?.data.ru || id;
    const hiIsland = category ? null : id === 'HI' ? this._hiIslandLabelAt(nativePt) : null;
    const text = category
      ? `${stateName} — ${this.terrainLabelsByCategory.get(category)}`
      : hiIsland
        ? `${stateName} — ${hiIsland}`
        : stateName;
    this._showTerrainHoverTip(ev.clientX, ev.clientY, text);
  }

  _showTerrainHoverTip(clientX, clientY, text) {
    if (!this.terrainHoverTipEl) {
      const el = document.createElement('div');
      el.className = 'terrain-hover-tip';
      // Sibling of zoomWrap inside this.container, not a zoomWrap child —
      // same "oversized zoom-wrap is a trap for absolutely-positioned
      // overlays" reasoning as .zoom-controls/.terrain-legend, and this one
      // in particular needs to track the raw client cursor position, which
      // only lines up correctly against a container that isn't oversized.
      this.container.appendChild(el);
      this.terrainHoverTipEl = el;
    }
    const wrapRect = this.container.getBoundingClientRect();
    this.terrainHoverTipEl.textContent = text;
    this.terrainHoverTipEl.style.left = `${clientX - wrapRect.left + 14}px`;
    this.terrainHoverTipEl.style.top = `${clientY - wrapRect.top + 18}px`;
    setElementHidden(this.terrainHoverTipEl, false);
  }

  _hideTerrainHoverTip() {
    if (this.terrainHoverTipEl) setElementHidden(this.terrainHoverTipEl, true);
  }

  // Picks, for each highway, whichever of its sampled points (see
  // levels/usaHighways.js) is currently on screen AND closest to the
  // middle of the view, and puts the shield badge there — so there's
  // always exactly one shield per highway visible somewhere in the
  // viewport (never zero, never a cluttered pile of them), the same way a
  // real interactive map re-labels a road as you pan across it rather
  // than fixing labels to specific points on the ground.
  _updateHighwayShields(rect) {
    if (!this.highwaysVisible) return;
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;
    const effScale = this.scale * (this.zoomCtl?.getZoom() ?? 1);
    for (const entry of this.highwayEntries) {
      let best = null;
      let bestDist = Infinity;
      for (const p of entry.points) {
        const [x, y] = p;
        if (x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      if (!best) {
        entry.shieldEl.style.display = 'none';
        entry.lastPos = null;
        continue;
      }
      entry.lastPos = best;
      entry.shieldEl.style.display = '';
      this._positionHighwayShield(entry, effScale);
    }
  }

  // Constant-screen-px size regardless of zoom — same `1/effScale` idea as
  // every other overlay marker here (state label font-size, city dot
  // radius, etc.), just done via an SVG transform instead since a shield
  // is a whole little shape (path + text), not a single scalar property.
  _positionHighwayShield(entry, effScale) {
    if (!entry.lastPos) return;
    const [x, y] = entry.lastPos;
    const k = 1 / effScale;
    entry.shieldEl.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(4)})`);
  }

  // Local coordinate box, centered on (0,0), roughly 20x22 native units —
  // scaled down to a constant on-screen size by _positionHighwayShield's
  // transform, not by these numbers themselves.
  _buildHighwayShield(number) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'highway-shield');
    const bg = document.createElementNS(SVG_NS, 'path');
    bg.setAttribute('class', 'highway-shield-bg');
    bg.setAttribute('d', 'M -10,-11 L 10,-11 L 10,3 Q 10,9 0,11 Q -10,9 -10,3 Z');
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'highway-shield-text');
    text.setAttribute('x', '0');
    text.setAttribute('y', '2');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = number;
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `I-${number}`;
    g.appendChild(bg);
    g.appendChild(text);
    g.appendChild(title);
    return g;
  }

  // Hawaii's real named highways (levels/usaHawaiiHighways.js) — a plain
  // text label along the line instead of a numbered shield, since a real
  // name like "Kūhiō Highway" has no short number to put in a badge and
  // the shield iconography specifically evokes the Interstate system,
  // which these routes aren't part of. Positioned/repositioned by the
  // exact same _updateHighwayShields/_positionHighwayShield pan-follow
  // logic as a shield — only the marker's own shape differs.
  _buildHighwayLabel(text) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'highway-label');
    const textEl = document.createElementNS(SVG_NS, 'text');
    textEl.setAttribute('class', 'highway-label-text');
    textEl.setAttribute('text-anchor', 'middle');
    textEl.textContent = text;
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = text;
    g.appendChild(textEl);
    g.appendChild(title);
    return g;
  }

  // Places aren't virtualized (always in the DOM — see the constructor
  // comment), so unlike setCitiesVisible this just toggles display directly
  // rather than replaying a visible-rect pass.
  setPlacesVisible(visible) {
    this.placesVisible = visible;
    for (const entry of this.placeEntries) {
      entry.dot.style.display = visible ? '' : 'none';
      entry.pointMark.style.display = visible ? '' : 'none';
      entry.leaderPath.style.display = visible ? '' : 'none';
      entry.leaderLabel.style.display = visible ? '' : 'none';
    }
  }

  // Small floating "layers" button in the map's bottom-right corner
  // (stacked above .zoom-controls, same corner-cluster language) that
  // opens an upward dropdown with the two available layers. Lives here
  // rather than as a topbar checkbox (an earlier version of this
  // feature) since it's Overview-only and purely about THIS map, not a
  // global setting game.js needs to know about.
  _buildLayerSwitcher() {
    const wrap = document.createElement('div');
    wrap.className = 'layer-switcher';
    wrap.innerHTML = `
      <button type="button" class="layer-switcher-btn" title="Слой карты" aria-haspopup="true" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 L21 8 L12 13 L3 8 Z" />
          <path d="M3 12 L12 17 L21 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M3 16 L12 21 L21 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="layer-switcher-menu" hidden>
        <button type="button" class="layer-switcher-option" data-layer="svg">SVG <span class="layer-switcher-hint">оффлайн</span></button>
        <button type="button" class="layer-switcher-option" data-layer="osm">OpenStreetMap</button>
        <button type="button" class="layer-switcher-option" data-layer="topo">Топографическая</button>
      </div>
    `;
    this.container.appendChild(wrap);
    this.layerSwitcherEl = wrap;
    this.layerSwitcherBtn = wrap.querySelector('.layer-switcher-btn');
    this.layerSwitcherMenu = wrap.querySelector('.layer-switcher-menu');

    this.layerSwitcherBtn.addEventListener('click', () => {
      if (this.layerSwitcherMenu.hidden) this._openLayerSwitcher();
      else this._closeLayerSwitcher();
    });
    this.layerSwitcherMenu.querySelector('[data-layer="svg"]').addEventListener('click', () => {
      if (!this.osmVisible && !this.topoVisible) return this._closeLayerSwitcher(); // already active
      if (this.osmVisible) this.setOsmVisible(false);
      if (this.topoVisible) this.setTopoVisible(false);
      this._closeLayerSwitcher();
    });
    this.layerSwitcherMenu.querySelector('[data-layer="osm"]').addEventListener('click', () => {
      if (this.osmVisible) return this._closeLayerSwitcher(); // already active
      if (this.topoVisible) this.setTopoVisible(false);
      // Left open on failure (see setOsmVisible's own comment on when
      // that happens) rather than closing as if it had worked — the
      // player can zoom/pan to a single-region view and try again
      // without having to reopen the menu.
      if (this.setOsmVisible(true)) this._closeLayerSwitcher();
    });
    this.layerSwitcherMenu.querySelector('[data-layer="topo"]').addEventListener('click', () => {
      if (this.topoVisible) return this._closeLayerSwitcher(); // already active
      if (this.osmVisible) this.setOsmVisible(false);
      // Same "left open on failure" reasoning as the OSM option above.
      if (this.setTopoVisible(true)) this._closeLayerSwitcher();
    });
    this._updateLayerSwitcherActive();
  }

  _openLayerSwitcher() {
    this.layerSwitcherMenu.hidden = false;
    this.layerSwitcherBtn.setAttribute('aria-expanded', 'true');
    // Capture phase + a fresh task (not this same click) — same reasoning
    // as _openContextMenu's outside-click handler: attaching synchronously
    // within the very click that opened it would let that click's own
    // bubble-up close it again immediately.
    setTimeout(() => {
      this._layerSwitcherOutsideHandler = (e) => {
        if (!this.layerSwitcherEl.contains(e.target)) this._closeLayerSwitcher();
      };
      this._layerSwitcherKeyHandler = (e) => {
        if (e.key === 'Escape') this._closeLayerSwitcher();
      };
      window.addEventListener('pointerdown', this._layerSwitcherOutsideHandler, true);
      window.addEventListener('keydown', this._layerSwitcherKeyHandler);
    }, 0);
  }

  _closeLayerSwitcher() {
    if (this.layerSwitcherMenu.hidden) return;
    this.layerSwitcherMenu.hidden = true;
    this.layerSwitcherBtn.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', this._layerSwitcherOutsideHandler, true);
    window.removeEventListener('keydown', this._layerSwitcherKeyHandler);
    this._layerSwitcherOutsideHandler = null;
    this._layerSwitcherKeyHandler = null;
  }

  _updateLayerSwitcherActive() {
    const svgBtn = this.layerSwitcherMenu.querySelector('[data-layer="svg"]');
    const osmBtn = this.layerSwitcherMenu.querySelector('[data-layer="osm"]');
    const topoBtn = this.layerSwitcherMenu.querySelector('[data-layer="topo"]');
    svgBtn.classList.toggle('active', !this.osmVisible && !this.topoVisible);
    osmBtn.classList.toggle('active', this.osmVisible);
    topoBtn.classList.toggle('active', this.topoVisible);
  }

  // Switches between the offline SVG map and a live OpenStreetMap iframe
  // framing (as closely as computeVisibleLonLatBBox can manage) the same
  // area the SVG was just showing. Returns false (and leaves everything
  // as it was) when that's not currently possible — see
  // computeVisibleLonLatBBox's own comment for exactly when/why.
  //
  // Switching back to SVG never touches this.zoomCtl's pan/zoom state at
  // all — it was frozen the moment OSM appeared (the iframe, not the
  // hidden SVG, is what actually receives pointer/wheel input while
  // visible), so un-hiding it always shows exactly the same view it had
  // right before switching. That's deliberate, not a shortcut: it's what
  // makes toggling back and forth any number of times land on the same
  // framing every time instead of drifting further off with each round
  // trip.
  setOsmVisible(visible) {
    if (!visible) {
      this.osmVisible = false;
      if (this.osmIframe) setElementHidden(this.osmIframe, true);
      setElementHidden(this.svg, false);
      setElementHidden(this.zoomControlsEl, false);
      setElementHidden(this.scaleBarEl, false);
      this._updateLayerSwitcherActive();
      return true;
    }
    if (!this._lastVisibleRect) return false;
    const bbox = computeVisibleLonLatBBox(this.level, this._lastVisibleRect);
    if (!bbox) return false;
    if (!this.osmIframe) {
      const iframe = document.createElement('iframe');
      iframe.className = 'osm-frame';
      iframe.title = 'OpenStreetMap';
      iframe.loading = 'lazy';
      this.zoomViewport.appendChild(iframe);
      this.osmIframe = iframe;
    }
    const { minLon, minLat, maxLon, maxLat } = bbox;
    this.osmIframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${minLon.toFixed(5)}%2C${minLat.toFixed(5)}%2C${maxLon.toFixed(5)}%2C${maxLat.toFixed(5)}&layer=mapnik`;
    setElementHidden(this.osmIframe, false);
    setElementHidden(this.svg, true);
    setElementHidden(this.zoomControlsEl, true);
    setElementHidden(this.scaleBarEl, true);
    this.osmVisible = true;
    this._updateLayerSwitcherActive();
    return true;
  }

  // Switches to a grid of TraceTrack topo tiles framing the same area
  // setOsmVisible would, using the same computeVisibleLonLatBBox call (and
  // the same failure/"left open" contract — see setOsmVisible's own
  // comment) since there's no bbox-embed page for this tile set, only raw
  // {z}/{x}/{y} images.
  //
  // Unlike the OSM iframe (an actual openstreetmap.org page with its own
  // built-in pan/zoom), there's no ready-made interactivity here — drag and
  // wheel handling are hand-rolled in _bindTopoPan below, driving
  // this._topoBBox directly rather than going through this.zoomCtl (which
  // only ever transforms the now-hidden SVG's viewBox — see the class
  // comment on _renderTopoTiles). Every time this layer is (re)opened,
  // this._topoBBox is recomputed fresh from the SVG's current camera,
  // discarding wherever the topo view had been panned to last time it was
  // shown — the same "resync from the frozen SVG snapshot" behavior
  // setOsmVisible already has, just made explicit here since there's no
  // iframe hiding it.
  setTopoVisible(visible) {
    if (!visible) {
      this.topoVisible = false;
      if (this.topoFrame) setElementHidden(this.topoFrame, true);
      setElementHidden(this.svg, false);
      setElementHidden(this.zoomControlsEl, false);
      setElementHidden(this.scaleBarEl, false);
      this._updateLayerSwitcherActive();
      return true;
    }
    if (!this._lastVisibleRect) return false;
    const bbox = computeVisibleLonLatBBox(this.level, this._lastVisibleRect);
    if (!bbox) return false;
    if (!this.topoFrame) {
      const frame = document.createElement('div');
      frame.className = 'osm-frame topo-frame';
      this.zoomViewport.appendChild(frame);
      this.topoFrame = frame;
      this._bindTopoPan(frame);
    }
    this._topoBBox = bbox;
    this._renderTopoTiles(this._topoBBox);
    setElementHidden(this.topoFrame, false);
    setElementHidden(this.svg, true);
    setElementHidden(this.zoomControlsEl, true);
    setElementHidden(this.scaleBarEl, true);
    this.topoVisible = true;
    this._updateLayerSwitcherActive();
    return true;
  }

  // Drag-to-pan + wheel-to-zoom for the topo grid, bound once when
  // this.topoFrame is first created (not re-bound on every show/hide).
  // Dragging moves the whole already-rendered grid via a cheap CSS
  // transform for instant feedback, then re-renders the real tile grid
  // (fetching whatever's newly needed) only once the drag/wheel settles —
  // the same "cheap transform while interacting, rebake once it settles"
  // shape zoomPan.js's own history comment describes, just applied to a
  // raster tile grid instead of an SVG viewBox.
  _bindTopoPan(frame) {
    let drag = null;
    frame.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || !this._topoBBox) return;
      drag = { startX: ev.clientX, startY: ev.clientY, bbox: this._topoBBox };
      frame.setPointerCapture(ev.pointerId);
      frame.classList.add('panning');
    });
    frame.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      frame.style.transform = `translate(${ev.clientX - drag.startX}px, ${ev.clientY - drag.startY}px)`;
    });
    const endDrag = (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      frame.style.transform = '';
      frame.classList.remove('panning');
      this._panTopoBBoxBy(drag.bbox, dx, dy);
      drag = null;
    };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);
    frame.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this._zoomTopoBBox(ev.deltaY < 0 ? 1 / 1.35 : 1.35, ev.clientX, ev.clientY);
      },
      { passive: false }
    );
  }

  // Shifts bbox by a drag of (dxPx, dyPx) screen pixels and re-renders.
  // Uses a flat degrees-per-pixel approximation (bbox span / container
  // size) rather than inverting the Mercator projection properly — over
  // one viewport-sized drag that's indistinguishable from exact, and it's
  // the same order of approximation computeVisibleLonLatBBox's own comment
  // already accepts elsewhere in this file.
  _panTopoBBoxBy(bbox, dxPx, dyPx) {
    const containerW = this.zoomViewport.clientWidth || 1;
    const containerH = this.zoomViewport.clientHeight || 1;
    const lonPerPx = (bbox.maxLon - bbox.minLon) / containerW;
    const latPerPx = (bbox.maxLat - bbox.minLat) / containerH;
    // Content follows the cursor (standard "grab the map" panning): dragging
    // right/down should reveal what was off-screen left/below, i.e. the
    // camera itself moves left/up — west (lower lon) and, since north is
    // the HIGH-latitude direction (unlike native canvas Y), up means higher
    // lat, so dLat carries the same sign as dyPx while dLon carries the
    // opposite sign of dxPx.
    const dLon = -dxPx * lonPerPx;
    const dLat = dyPx * latPerPx;
    const minLon = clamp(bbox.minLon + dLon, -180, 180);
    const maxLon = clamp(bbox.maxLon + dLon, -180, 180);
    const minLat = clamp(bbox.minLat + dLat, -85, 85);
    const maxLat = clamp(bbox.maxLat + dLat, -85, 85);
    if (!(maxLon > minLon) || !(maxLat > minLat)) return; // clamped into degeneracy at a pole/antimeridian
    this._topoBBox = { minLon, minLat, maxLon, maxLat };
    this._renderTopoTiles(this._topoBBox);
  }

  // Scales bbox by `factor` (<1 zooms in, >1 zooms out) anchored on
  // (clientX, clientY) so the map point under the cursor stays put, same
  // anchor-preserving intent as zoomPan.js's own wheel handler.
  _zoomTopoBBox(factor, clientX, clientY) {
    const bbox = this._topoBBox;
    if (!bbox) return;
    const rect = this.zoomViewport.getBoundingClientRect();
    const fx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const fy = clamp((clientY - rect.top) / rect.height, 0, 1);
    const anchorLon = bbox.minLon + fx * (bbox.maxLon - bbox.minLon);
    const anchorLat = bbox.maxLat - fy * (bbox.maxLat - bbox.minLat); // fy=0 at the top = maxLat
    const minSpan = 0.005; // degrees — keeps wheel-zoom from collapsing to a degenerate bbox
    const lonSpan = clamp((bbox.maxLon - bbox.minLon) * factor, minSpan, 360);
    const latSpan = clamp((bbox.maxLat - bbox.minLat) * factor, minSpan, 170);
    const minLon = clamp(anchorLon - fx * lonSpan, -180, 180);
    const maxLon = clamp(minLon + lonSpan, -180, 180);
    const maxLat = clamp(anchorLat + fy * latSpan, -85, 85);
    const minLat = clamp(maxLat - latSpan, -85, 85);
    if (!(maxLon > minLon) || !(maxLat > minLat)) return;
    this._topoBBox = { minLon, minLat, maxLon, maxLat };
    this._renderTopoTiles(this._topoBBox);
  }

  // Lays out one absolutely-positioned <img> per tile inside this.topoFrame,
  // sized/positioned so the grid exactly fills the viewport regardless of
  // how the chosen zoom level's tile boundaries happen to align with the
  // bbox — see the scaleX/scaleY comment below for why that's needed.
  // Called both from setTopoVisible (first show) and from _bindTopoPan's
  // drag/wheel handlers (every time the topo view itself pans/zooms).
  _renderTopoTiles(bbox) {
    const { minLon, minLat, maxLon, maxLat } = bbox;
    const containerW = this.zoomViewport.clientWidth || 1;
    const containerH = this.zoomViewport.clientHeight || 1;

    // Pick the zoom level whose world-pixel width, spread across the
    // bbox's longitude span, roughly matches the viewport's actual pixel
    // width — i.e. "1 world pixel ≈ 1 screen pixel" at this zoom.
    let z = Math.floor(Math.log2((containerW * 360) / ((maxLon - minLon) * TOPO_TILE_SIZE)));
    z = clamp(z, 0, 18);
    // Degenerate bboxes (near-zero span) can otherwise demand a huge tile
    // grid — back off the zoom level until it fits the cap.
    while (z > 0 && (topoWorldX(maxLon, z) - topoWorldX(minLon, z)) / TOPO_TILE_SIZE > MAX_TOPO_TILES_PER_AXIS) {
      z--;
    }

    const left = topoWorldX(minLon, z);
    const right = topoWorldX(maxLon, z);
    const top = topoWorldY(maxLat, z);
    const bottom = topoWorldY(minLat, z);
    // Rarely exactly containerW/containerH (the bbox's aspect ratio at
    // this discrete zoom level won't perfectly match the viewport's), so
    // each axis gets its own scale rather than assuming a single uniform
    // one — same mild stretch tradeoff the OSM bbox embed already accepts
    // implicitly by not preserving aspect ratio either.
    const scaleX = containerW / (right - left);
    const scaleY = containerH / (bottom - top);

    const maxTileIndex = 2 ** z - 1;
    const xMin = Math.max(0, Math.floor(left / TOPO_TILE_SIZE));
    const xMax = Math.min(maxTileIndex, Math.floor((right - 1) / TOPO_TILE_SIZE));
    const yMin = Math.max(0, Math.floor(top / TOPO_TILE_SIZE));
    const yMax = Math.min(maxTileIndex, Math.floor((bottom - 1) / TOPO_TILE_SIZE));

    this.topoFrame.innerHTML = '';
    for (let ty = yMin; ty <= yMax; ty++) {
      for (let tx = xMin; tx <= xMax; tx++) {
        const img = document.createElement('img');
        img.className = 'topo-tile';
        img.alt = '';
        img.src = `https://tile.tracestrack.com/topo__/${z}/${tx}/${ty}.webp?key=${TOPO_API_KEY}`;
        img.style.left = `${(tx * TOPO_TILE_SIZE - left) * scaleX}px`;
        img.style.top = `${(ty * TOPO_TILE_SIZE - top) * scaleY}px`;
        img.style.width = `${TOPO_TILE_SIZE * scaleX}px`;
        img.style.height = `${TOPO_TILE_SIZE * scaleY}px`;
        this.topoFrame.appendChild(img);
      }
    }
  }

  destroy() {
    this._destroyed = true;
    this._revealQueue = [];
    clearTimeout(this.focusTimeoutHandle);
    this._closeContextMenu(); // removes its window-level listeners too, not just the DOM node
    this._closeLayerSwitcher(); // same reasoning — its outside-click/Escape listeners are window-level too
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
    // Otherwise leaving Overview for any other mode would leave
    // #board-container's .zoom-controls permanently shifted to the
    // panel-open 320px offset there too — the class survives innerHTML
    // clearing just like panel-collapsed does (see _build's comment).
    this.container.classList.remove('has-overview-panel');
  }
}
