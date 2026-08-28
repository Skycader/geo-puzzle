import { PuzzleBoard } from './puzzleBoard.js';
import { QuizBoard } from './quizBoard.js';
import { NameStateBoard } from './nameStateBoard.js';
import { NeighborBoard } from './neighborBoard.js';
import { IdentifyStateBoard } from './identifyStateBoard.js';
import { CityQuizBoard } from './cityQuizBoard.js';
import { CityPinBoard } from './cityPinBoard.js';
import { ColorFillBoard } from './colorFillBoard.js';
import { SeaIdentifyBoard } from './seaIdentifyBoard.js';
import { SeaQuizBoard } from './seaQuizBoard.js';
import { OverviewBoard } from './overviewBoard.js';
import { JourneyNameBoard } from './journeyNameBoard.js';
import { pickJourneyPair } from './journeyRoute.js';
import { EligibilityList } from './eligibilityList.js';
import { getCoins, spendAllCoins, onCoinsChanged } from './coins.js';
import { SCREEN_EDGE_MARGIN_PX } from './constants.js';
import { clamp, unionBBox } from './utils.js';
import { PRESETS, DEFAULT_CUSTOM_COUNT } from './presets.js';
import {
  MODES,
  OVERVIEW_MODES,
  NAME_STATE_DIFFICULTIES,
  NEIGHBOR_DIFFICULTIES,
  IDENTIFY_DIFFICULTIES,
  SEA_IDENTIFY_DIFFICULTIES,
  JOURNEY_ANSWER_MODES,
  JOURNEY_DIFFICULTIES,
} from './modes.js';
import { playClick } from './audio.js';
import { loadSuccessStats } from './successStats.js';
import { downloadProgressExport, importProgressFile } from './dataPortability.js';
import {
  getLang,
  setLang,
  t,
  levelText,
  modeText,
  presetText,
  PRESETS_EN,
  NAME_STATE_DIFFICULTIES_EN,
  NEIGHBOR_DIFFICULTIES_EN,
  IDENTIFY_DIFFICULTIES_EN,
  SEA_IDENTIFY_DIFFICULTIES_EN,
  JOURNEY_ANSWER_MODES_EN,
  JOURNEY_DIFFICULTIES_EN,
  OVERVIEW_MODES_EN,
} from './i18n.js';

// Distinct scopes per mode — clicking a state on the map (quiz), recalling
// its name from a highlight (name-state), naming its neighbor (neighbor),
// and identifying it from a bare isolated shape (identify) are different
// skills, so their adaptive streaks are tracked separately (see the
// matching SUCCESS_SCOPE constants in quizBoard.js / nameStateBoard.js /
// neighborBoard.js / identifyStateBoard.js).
const ADAPTIVE_SUCCESS_SCOPE_BY_MODE = {
  quiz: 'quiz-states',
  'name-state': 'name-state-states',
  neighbor: 'neighbor-states',
  identify: 'identify-states',
  colorfill: 'colorfill-states',
  journey: 'journey-states',
};

// 'city-place' isn't here — its heading/label/prompt depend on its own two
// toggles (entity, interaction), computed by _cityPlaceRoundsText() instead
// of a static per-mode lookup. quiz/name-state/neighbor/identify are
// shared between levels.usa and levels.countries (see js/modes.js's
// `levels` arrays) — the "штатов" wording is wrong on the countries level,
// so this is looked up per (mode, level) pair via _roundsPanelText() below
// rather than by mode id alone.
const ROUNDS_PANEL_TEXT = {
  quiz: { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: 'Найди на карте:' },
  'name-state': { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: '' },
  neighbor: { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: '' },
  identify: { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: '' },
  colorfill: { heading: 'Раунд', label: 'Сколько штатов закрасить', prompt: '' },
  'sea-identify': { heading: 'Раунд', label: 'Сколько морей/океанов спросить', prompt: '' },
  'sea-quiz': { heading: 'Раунд', label: 'Сколько морей/океанов спросить', prompt: 'Найди на карте:' },
};
const ROUNDS_PANEL_TEXT_COUNTRIES = {
  quiz: { heading: 'Раунд', label: 'Сколько стран спросить', prompt: 'Найди на карте:' },
  'name-state': { heading: 'Раунд', label: 'Сколько стран спросить', prompt: '' },
  neighbor: { heading: 'Раунд', label: 'Сколько стран спросить', prompt: '' },
  identify: { heading: 'Раунд', label: 'Сколько стран спросить', prompt: '' },
};

// Mode-card title/desc for the same 4 shared modes, on the countries
// level — MODES' own title/desc say "штат" (grammatically masculine),
// which doesn't just read oddly on the countries level, it's flat wrong
// ("страну" is feminine accusative, not a drop-in swap of one word).
const MODE_CARD_TEXT_COUNTRIES = {
  quiz: { title: 'Найди страну', desc: 'Кликни страну по названию' },
  'name-state': { title: 'Назови страну', desc: 'Назови подсвеченную страну' },
  neighbor: { title: 'Назови соседа', desc: 'Назови соседнюю страну' },
  identify: { title: 'Определи страну', desc: 'Угадай страну по форме' },
};

// Language switcher's flag icons — real SVG, not emoji: Windows doesn't
// reliably render Unicode regional-indicator flag emoji (🇷🇺/🇺🇸 show as
// plain letters or tofu for a lot of users), so a vector icon is the only
// rendering-guaranteed option. Markup mirrors index.html's own dropdown-
// option flags exactly (kept in sync by hand, not shared/templated — this
// project has no build step to generate one from the other) since
// _bindLangSwitcher below also needs to set this SAME icon on the button
// itself, whose content changes at runtime based on the selected language.
const LANG_FLAG_SVG = {
  ru: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/><rect y="4.67" width="20" height="4.67" fill="#0039a6"/><rect y="9.33" width="20" height="4.67" fill="#d52b1e"/></svg>',
  en: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/><rect y="0" width="20" height="1.08" fill="#b22234"/><rect y="2.15" width="20" height="1.08" fill="#b22234"/><rect y="4.31" width="20" height="1.08" fill="#b22234"/><rect y="6.46" width="20" height="1.08" fill="#b22234"/><rect y="8.62" width="20" height="1.08" fill="#b22234"/><rect y="10.77" width="20" height="1.08" fill="#b22234"/><rect y="12.92" width="20" height="1.08" fill="#b22234"/><rect width="8" height="7.54" fill="#3c3b6e"/></svg>',
};

// Global "land color scheme" toggle (topbar, always visible, independent
// of level/mode) — one persisted choice for every level's land layer, see
// style.css's --land-fill/--land-stroke variables and _initLandScheme.
const LAND_SCHEME_STORAGE_KEY = 'geoPuzzleLandScheme';
// Whatever level/mode/difficulty/rounds/adaptive-toggle combo was in
// effect the last time a round was actually started — see
// _saveLastSettings (called from startGame()) and _loadLastSettings
// (called from the constructor, before the menu is first rendered).
const LAST_SETTINGS_STORAGE_KEY = 'geoPuzzleLastSettings';
// "Рельеф" toggle's 3 steps — see _setTerrainMode.
const TERRAIN_MODE_LABELS = { off: 'Рельеф', color: 'Рельеф: цвет', pattern: 'Рельеф: иконки' };
// How far above the map's own rendered bottom edge the finish button sits
// (see _positionWinBar) — comfortably more than half the button's own
// height so it never straddles that edge.
const WIN_BAR_INSET_PX = 32;

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export class Game {
  constructor({ levels }) {
    this.levels = levels;
    this.levelId = Object.keys(levels)[0];
    this.modeId = MODES[0].id;
    this.presetId = PRESETS[0].id;
    this.overviewModeId = OVERVIEW_MODES[0].id;
    this.customCount = DEFAULT_CUSTOM_COUNT;
    this.quizRounds = 15;
    this.nameStateDifficulty = NAME_STATE_DIFFICULTIES[0].id;
    this.neighborDifficulty = NEIGHBOR_DIFFICULTIES[0].id;
    this.identifyDifficulty = IDENTIFY_DIFFICULTIES[0].id;
    this.seaIdentifyDifficulty = SEA_IDENTIFY_DIFFICULTIES[0].id;
    this.journeyAnswerMode = JOURNEY_ANSWER_MODES[0].id;
    this.journeyDifficulty = JOURNEY_DIFFICULTIES[0].id;
    // "Города и места" — two independent toggles instead of separate mode
    // cards: WHAT to ask about (cities vs places) and HOW to answer
    // (click-to-find vs place-a-pin). See _startCityPlace.
    this.cityPlaceEntity = 'cities';
    this.cityPlaceMode = 'find';
    this.adaptiveMode = false;
    // "Быстрый выбор (ПКМ)" — quiz/sea-quiz only, see quizBoard.js's
    // _build/_confirmAnswer.
    this.quickSelect = false;
    this.hintsVisible = true;
    this.labelsVisible = true;
    this.citiesVisible = true;
    this.placesVisible = true;
    // Overview's "progress heatmap" — off by default (opt-in, unlike the
    // *Visible flags above), scoped to whichever adaptive-mode success
    // stat (see ADAPTIVE_SUCCESS_SCOPE_BY_MODE) the player wants to see
    // colored onto the map. See _startOverview/OverviewBoard's
    // setProgressVisible/setProgressScope.
    this.progressVisible = false;
    this.progressScope = 'name-state-states';
    // "Рельеф" — real terrain sub-regions painted under the state pieces,
    // same opt-in/USA-only shape as progressVisible above, but 3-step
    // ('off' | 'color' | 'pattern') instead of a plain boolean — see
    // _setTerrainMode and OverviewBoard's setTerrainMode.
    this.terrainMode = 'off';
    this.eligibilityList = null; // current EligibilityList instance for quiz/city-place — see _applyModeVisibility
    this.board = null;
    this.seconds = 0;
    this.timerHandle = null;
    // Overrides whichever of the defaults above have a validated,
    // previously-saved counterpart — must run after all of them are set
    // (it only patches fields, doesn't establish them) and before the
    // render calls below (so the menu reflects the restored choice on
    // first paint, not just after the player touches something).
    this._loadLastSettings();

    this._cacheDom();
    this._initLandScheme();
    this._initCoins();
    // Renders level/mode/preset/overview cards AND applies mode
    // visibility (difficulty lists, eligibility checklist) — same reason
    // _loadLastSettings() runs before this: reflects a saved language
    // choice on first paint, not just RU.
    this._applyMenuTranslations();
    this._bindEvents();
  }

  // Reads the persisted global color-scheme choice ('blue' default — the
  // original look everything always had | 'gray'), applies it as a
  // data-attribute on <html>, and wires the topbar toggle to change +
  // persist it. Independent of level/mode — see the toggle's markup in
  // index.html, deliberately a sibling of .hud, not inside it.
  // style.css keys a lot off this attribute: --piece-a/--piece-b and
  // --land-fill/--land-stroke (state/sea pieces + their background-context
  // layers) AND --neon-cyan/--neon-pink/--neon-violet (the app's general
  // accent colors — buttons, borders, highlights throughout the menu and
  // HUD), so picking "gray" reskins the whole app, not just the map.
  _initLandScheme() {
    let scheme = 'blue';
    try {
      const saved = localStorage.getItem(LAND_SCHEME_STORAGE_KEY);
      if (saved === 'blue' || saved === 'gray') scheme = saved;
    } catch {
      // Storage can fail (private browsing, quota, disabled) — falls back
      // to the default for this session, same as EligibilityList's own
      // localStorage guard.
    }
    this._applyLandScheme(scheme);
    this.el.toggleLandScheme.addEventListener('change', (ev) => {
      this._applyLandScheme(ev.target.checked ? 'blue' : 'gray');
      try {
        localStorage.setItem(LAND_SCHEME_STORAGE_KEY, this.landScheme);
      } catch {
        // Non-fatal — the choice still applies for the current session.
      }
    });
  }

  _applyLandScheme(scheme) {
    this.landScheme = scheme;
    document.documentElement.dataset.landScheme = scheme;
    this.el.toggleLandScheme.checked = scheme === 'blue';
    this._updateFavicon();
  }

  // The browser tab's favicon (index.html's <link id="favicon-link">) is a
  // separate static resource in its own isolated document context — unlike
  // the in-page brand icon (also inline SVG, right next to this button),
  // it has no access to this page's CSS custom properties, so var(--neon-cyan)
  // inside favicon.svg itself would just resolve to nothing. Rebuilding it
  // as a data: URI with the CURRENT resolved colors baked in, every time
  // the scheme changes, is what keeps it in sync — same shape as
  // favicon.svg, just regenerated rather than swapped between two static
  // files, so it stays correct for whatever scheme exists later too.
  _updateFavicon() {
    const cs = getComputedStyle(document.documentElement);
    const cyan = cs.getPropertyValue('--neon-cyan').trim();
    const violet = cs.getPropertyValue('--neon-violet').trim();
    const bgGlow = cs.getPropertyValue('--bg-glow').trim();
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${cyan}"/><stop offset="1" stop-color="${violet}"/>` +
      `</linearGradient></defs>` +
      `<rect x="2" y="2" width="60" height="60" rx="14" fill="#04222b" stroke="${cyan}" stroke-opacity="0.4" stroke-width="1.5"/>` +
      `<path d="M 17,17 L 47,17 L 47,25 A 6.5,6.5 0 0 1 47,38 L 47,47 L 38,47 A 6.5,6.5 0 0 1 25,47 L 17,47 Z" fill="url(#g)" stroke="${bgGlow}" stroke-width="1.2"/>` +
      `</svg>`;
    this.el.faviconLink.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  // First-pass rewards system (see js/coins.js) — a single shared balance,
  // shown in the topbar (a sibling of .hud, same reasoning as the
  // land-scheme toggle: it's global/persisted, not tied to whatever's
  // currently on screen, so it stays visible on the menu too). The board
  // that actually earns coins (identifyStateBoard.js, for now) calls
  // addCoins() directly rather than routing through game.js — this just
  // displays whatever balance results. No separate "Списать" button —
  // the balance display itself IS the button; clicking it writes the
  // whole thing off.
  _initCoins() {
    this._renderCoinBalance(getCoins());
    onCoinsChanged((balance) => this._renderCoinBalance(balance));
    this.el.coinBalance.addEventListener('click', () => {
      spendAllCoins();
    });
  }

  _renderCoinBalance(balance) {
    this.el.coinBalanceValue.textContent = balance;
    this.el.coinBalance.disabled = balance === 0;
  }

  _cacheDom() {
    this.el = {
      screenMenu: document.getElementById('screen-menu'),
      screenGame: document.getElementById('screen-game'),
      hud: document.getElementById('hud'),
      hudLevel: document.getElementById('hud-level'),
      hudProgress: document.getElementById('hud-progress'),
      hudGroups: document.getElementById('hud-groups'),
      hudTimer: document.getElementById('hud-timer'),
      btnBrand: document.getElementById('btn-brand'),
      levelList: document.getElementById('level-list'),
      modeList: document.getElementById('mode-list'),
      presetList: document.getElementById('preset-list'),
      panelPuzzleSettings: document.getElementById('panel-puzzle-settings'),
      panelQuizSettings: document.getElementById('panel-quiz-settings'),
      panelOverviewSettings: document.getElementById('panel-overview-settings'),
      overviewList: document.getElementById('overview-list'),
      panelJourneySettings: document.getElementById('panel-journey-settings'),
      journeyAnswerModeEl: document.getElementById('journey-answer-mode'),
      journeyDifficultyEl: document.getElementById('journey-difficulty'),
      quizPanelHeading: document.getElementById('quiz-panel-heading'),
      quizCountLabel: document.getElementById('quiz-count-label'),
      customCountRow: document.getElementById('custom-count-row'),
      customCountInput: document.getElementById('custom-count'),
      customCountValue: document.getElementById('custom-count-value'),
      quizCountInput: document.getElementById('quiz-count'),
      quizCountValue: document.getElementById('quiz-count-value'),
      quizEligibleWrap: document.getElementById('quiz-eligible-wrap'),
      nameStateDifficultyEl: document.getElementById('name-state-difficulty'),
      cityPlaceEntityRow: document.getElementById('city-place-entity-row'),
      cityPlaceEntityCheckbox: document.getElementById('city-place-entity-checkbox'),
      cityPlaceEntityText: document.getElementById('city-place-entity-text'),
      cityPlaceModeRow: document.getElementById('city-place-mode-row'),
      cityPlaceModeCheckbox: document.getElementById('city-place-mode-checkbox'),
      cityPlaceModeText: document.getElementById('city-place-mode-text'),
      adaptiveModeRow: document.getElementById('adaptive-mode-row'),
      adaptiveModeCheckbox: document.getElementById('adaptive-mode-checkbox'),
      quickSelectRow: document.getElementById('quick-select-row'),
      quickSelectCheckbox: document.getElementById('quick-select-checkbox'),
      btnStart: document.getElementById('btn-start'),
      langSwitcherWrap: document.getElementById('lang-switcher-wrap'),
      langSwitcherBtn: document.getElementById('lang-switcher-btn'),
      langSwitcherMenu: document.getElementById('lang-switcher-menu'),
      langSwitcherFlag: document.getElementById('lang-switcher-flag'),
      menuSubtitle: document.getElementById('menu-subtitle'),
      menuLevelHeading: document.getElementById('menu-level-heading'),
      menuModeHeading: document.getElementById('menu-mode-heading'),
      progressIoWrap: document.getElementById('progress-io-wrap'),
      progressIoBtn: document.getElementById('progress-io-btn'),
      progressIoMenu: document.getElementById('progress-io-menu'),
      btnExportProgress: document.getElementById('btn-export-progress'),
      btnImportProgress: document.getElementById('btn-import-progress'),
      importProgressInput: document.getElementById('import-progress-input'),
      progressIoStatus: document.getElementById('progress-io-status'),
      boardContainer: document.getElementById('board-container'),
      quizPrompt: document.getElementById('quiz-prompt'),
      quizPromptLabel: document.getElementById('quiz-prompt-label'),
      quizPromptName: document.getElementById('quiz-prompt-name'),
      winBar: document.getElementById('win-bar'),
      replayHint: document.getElementById('replay-hint'),
      btnBackMenu: document.getElementById('btn-back-menu'),
      toggleHintsWrap: document.getElementById('toggle-hints-wrap'),
      toggleLabelsWrap: document.getElementById('toggle-labels-wrap'),
      toggleHints: document.getElementById('toggle-hints'),
      toggleHintsText: document.getElementById('toggle-hints-text'),
      toggleLabels: document.getElementById('toggle-labels'),
      toggleLabelsText: document.getElementById('toggle-labels-text'),
      togglePlacesWrap: document.getElementById('toggle-places-wrap'),
      togglePlaces: document.getElementById('toggle-places'),
      toggleHighwaysWrap: document.getElementById('toggle-highways-wrap'),
      toggleHighways: document.getElementById('toggle-highways'),
      toggleProgressWrap: document.getElementById('toggle-progress-wrap'),
      toggleProgress: document.getElementById('toggle-progress'),
      toggleTerrainWrap: document.getElementById('toggle-terrain-wrap'),
      toggleTerrainText: document.getElementById('toggle-terrain-text'),
      progressScopeWrap: document.getElementById('progress-scope-wrap'),
      progressScopeBtn: document.getElementById('progress-scope-btn'),
      progressScopeLabel: document.getElementById('progress-scope-label'),
      progressScopeMenu: document.getElementById('progress-scope-menu'),
      toggleLandScheme: document.getElementById('toggle-land-scheme'),
      faviconLink: document.getElementById('favicon-link'),
      coinBalance: document.getElementById('coin-balance'),
      coinBalanceValue: document.getElementById('coin-balance-value'),
    };
  }

  // Overrides the hardcoded defaults set earlier in the constructor with
  // whatever was saved from the last actually-started round (see
  // _saveLastSettings) — each field is validated against its own current
  // valid-options list before being trusted, since level data or the
  // mode/difficulty/preset lists can change between versions and a stale
  // id would otherwise silently break whatever UI it drives (selecting a
  // preset/difficulty card that no longer exists, an out-of-range slider
  // value, etc). Doesn't touch the DOM — this runs before _cacheDom(), the
  // patched fields just get picked up naturally by the render calls that
  // already run at the end of the constructor.
  _loadLastSettings() {
    let saved;
    try {
      const raw = localStorage.getItem(LAST_SETTINGS_STORAGE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return;

    if (saved.levelId in this.levels) this.levelId = saved.levelId;
    // Must come after levelId above — _modesForCurrentLevel() reads it.
    if (this._modesForCurrentLevel().some((m) => m.id === saved.modeId)) this.modeId = saved.modeId;
    if (PRESETS.some((p) => p.id === saved.presetId)) this.presetId = saved.presetId;
    if (OVERVIEW_MODES.some((m) => m.id === saved.overviewModeId)) this.overviewModeId = saved.overviewModeId;
    if (Number.isFinite(saved.customCount)) this.customCount = clamp(saved.customCount, 1, 50);
    if (Number.isFinite(saved.quizRounds)) this.quizRounds = clamp(saved.quizRounds, 1, 50);
    if (NAME_STATE_DIFFICULTIES.some((d) => d.id === saved.nameStateDifficulty)) this.nameStateDifficulty = saved.nameStateDifficulty;
    if (NEIGHBOR_DIFFICULTIES.some((d) => d.id === saved.neighborDifficulty)) this.neighborDifficulty = saved.neighborDifficulty;
    if (IDENTIFY_DIFFICULTIES.some((d) => d.id === saved.identifyDifficulty)) this.identifyDifficulty = saved.identifyDifficulty;
    if (SEA_IDENTIFY_DIFFICULTIES.some((d) => d.id === saved.seaIdentifyDifficulty)) this.seaIdentifyDifficulty = saved.seaIdentifyDifficulty;
    if (JOURNEY_ANSWER_MODES.some((m) => m.id === saved.journeyAnswerMode)) this.journeyAnswerMode = saved.journeyAnswerMode;
    if (JOURNEY_DIFFICULTIES.some((d) => d.id === saved.journeyDifficulty)) this.journeyDifficulty = saved.journeyDifficulty;
    if (saved.cityPlaceEntity === 'cities' || saved.cityPlaceEntity === 'places') this.cityPlaceEntity = saved.cityPlaceEntity;
    if (saved.cityPlaceMode === 'find' || saved.cityPlaceMode === 'pin') this.cityPlaceMode = saved.cityPlaceMode;
    if (typeof saved.adaptiveMode === 'boolean') this.adaptiveMode = saved.adaptiveMode;
    if (typeof saved.quickSelect === 'boolean') this.quickSelect = saved.quickSelect;
  }

  // Snapshots the current settings so _loadLastSettings() can restore this
  // same combination next time the app opens — called after every single
  // change to any of the fields below (level/mode/preset/difficulty/round-
  // count/adaptive/city-place toggles — see each one's own event handler),
  // not just when a round is actually started. The player should see
  // whatever they last had selected even if they never pressed "Играть".
  _saveLastSettings() {
    const settings = {
      levelId: this.levelId,
      modeId: this.modeId,
      presetId: this.presetId,
      overviewModeId: this.overviewModeId,
      customCount: this.customCount,
      quizRounds: this.quizRounds,
      nameStateDifficulty: this.nameStateDifficulty,
      neighborDifficulty: this.neighborDifficulty,
      identifyDifficulty: this.identifyDifficulty,
      seaIdentifyDifficulty: this.seaIdentifyDifficulty,
      journeyAnswerMode: this.journeyAnswerMode,
      journeyDifficulty: this.journeyDifficulty,
      cityPlaceEntity: this.cityPlaceEntity,
      cityPlaceMode: this.cityPlaceMode,
      adaptiveMode: this.adaptiveMode,
      quickSelect: this.quickSelect,
    };
    try {
      localStorage.setItem(LAST_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage can fail (private browsing, quota, disabled) — the round
      // still plays fine, the settings just won't persist for next time.
    }
  }

  // Export/import of everything the game persists to localStorage — see
  // js/dataPortability.js. A topbar icon + dropdown, same open/close
  // pattern (outside-click + Escape) as overviewBoard.js's layer switcher.
  // Import overwrites the current browser's progress, so it's gated behind
  // a confirm() (native, not custom UI — this is exactly the kind of
  // one-off "are you sure" a blocking dialog suits, and reloading right
  // after makes a custom in-page confirmation no more reversible anyway).
  _bindProgressIo() {
    this.el.progressIoBtn.addEventListener('click', () => {
      if (this.el.progressIoMenu.hidden) this._openProgressIoMenu();
      else this._closeProgressIoMenu();
    });
    this.el.btnExportProgress.addEventListener('click', () => {
      playClick();
      downloadProgressExport();
      this._setProgressIoStatus('Файл сохранён.', 'success');
    });
    this.el.btnImportProgress.addEventListener('click', () => {
      playClick();
      this.el.importProgressInput.click();
    });
    this.el.importProgressInput.addEventListener('change', async () => {
      const file = this.el.importProgressInput.files?.[0];
      this.el.importProgressInput.value = ''; // lets the same file be re-selected later
      if (!file) return;
      if (!confirm('Импорт заменит текущий прогресс (монеты, адаптивную статистику, сохранённые настройки) данными из файла. Продолжить?')) return;
      try {
        const count = await importProgressFile(file);
        this._setProgressIoStatus(`Восстановлено записей: ${count}. Перезагружаю…`, 'success');
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        this._setProgressIoStatus(err.message || 'Не удалось импортировать файл.', 'error');
      }
    });
  }

  _openProgressIoMenu() {
    this.el.progressIoMenu.hidden = false;
    this.el.progressIoBtn.setAttribute('aria-expanded', 'true');
    // Capture phase + a fresh task (not this same click) — same reasoning
    // as overviewBoard.js's _openLayerSwitcher: attaching synchronously
    // within the very click that opened it would let that click's own
    // bubble-up close it again immediately.
    setTimeout(() => {
      this._progressIoOutsideHandler = (e) => {
        if (!this.el.progressIoWrap.contains(e.target)) this._closeProgressIoMenu();
      };
      this._progressIoKeyHandler = (e) => {
        if (e.key === 'Escape') this._closeProgressIoMenu();
      };
      window.addEventListener('pointerdown', this._progressIoOutsideHandler, true);
      window.addEventListener('keydown', this._progressIoKeyHandler);
    }, 0);
  }

  _closeProgressIoMenu() {
    if (this.el.progressIoMenu.hidden) return;
    this.el.progressIoMenu.hidden = true;
    this.el.progressIoBtn.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', this._progressIoOutsideHandler, true);
    window.removeEventListener('keydown', this._progressIoKeyHandler);
    this._progressIoOutsideHandler = null;
    this._progressIoKeyHandler = null;
  }

  // Language switcher — v1, menu-only (see js/i18n.js's own comment for
  // exact scope). Same topbar icon+dropdown open/close pattern (outside-
  // click + Escape) as _bindProgressIo right above.
  _bindLangSwitcher() {
    this.el.langSwitcherFlag.innerHTML = LANG_FLAG_SVG[getLang()];
    this.el.langSwitcherBtn.addEventListener('click', () => {
      if (this.el.langSwitcherMenu.hidden) this._openLangSwitcherMenu();
      else this._closeLangSwitcherMenu();
    });
    for (const btn of this.el.langSwitcherMenu.querySelectorAll('.lang-switcher-option')) {
      btn.addEventListener('click', () => {
        playClick();
        setLang(btn.dataset.lang);
        this.el.langSwitcherFlag.innerHTML = LANG_FLAG_SVG[btn.dataset.lang];
        this._applyMenuTranslations();
        this._closeLangSwitcherMenu();
      });
    }
  }

  // Re-renders exactly the menu-screen text this v1 covers — see
  // js/i18n.js's own comment on why the rest of the app isn't touched yet.
  _applyMenuTranslations() {
    this.el.menuSubtitle.textContent = t('menuSubtitle');
    this.el.menuLevelHeading.textContent = t('levelHeading');
    this.el.menuModeHeading.textContent = t('modeHeading');
    this._renderLevelList();
    this._renderModeList();
    // Puzzle-mode's piece-count presets and Overview's info-display modes
    // are each only ever rendered here + once more at construction — unlike
    // the other difficulty lists below, nothing else re-triggers them on a
    // level/mode change, so without this they'd stay stuck in whichever
    // language was active when the page first loaded.
    this._renderPresetList();
    this._renderOverviewList();
    // Difficulty-preset cards and the states/countries eligibility
    // checklist both live behind this — without it, switching language
    // mid-session would leave them showing the old language until the
    // player happened to touch a level/mode card and re-trigger it
    // indirectly.
    this._applyModeVisibility();
  }

  _openLangSwitcherMenu() {
    this.el.langSwitcherMenu.hidden = false;
    this.el.langSwitcherBtn.setAttribute('aria-expanded', 'true');
    setTimeout(() => {
      this._langSwitcherOutsideHandler = (e) => {
        if (!this.el.langSwitcherWrap.contains(e.target)) this._closeLangSwitcherMenu();
      };
      this._langSwitcherKeyHandler = (e) => {
        if (e.key === 'Escape') this._closeLangSwitcherMenu();
      };
      window.addEventListener('pointerdown', this._langSwitcherOutsideHandler, true);
      window.addEventListener('keydown', this._langSwitcherKeyHandler);
    }, 0);
  }

  _closeLangSwitcherMenu() {
    if (this.el.langSwitcherMenu.hidden) return;
    this.el.langSwitcherMenu.hidden = true;
    this.el.langSwitcherBtn.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', this._langSwitcherOutsideHandler, true);
    window.removeEventListener('keydown', this._langSwitcherKeyHandler);
    this._langSwitcherOutsideHandler = null;
    this._langSwitcherKeyHandler = null;
  }

  // Which adaptive-mode scope the Overview progress heatmap visualizes —
  // a custom dropdown, not a native <select> (see index.html's comment:
  // native option lists ignore this app's dark theme entirely). Same
  // open/close pattern as _bindProgressIo/overviewBoard.js's layer switcher.
  _bindProgressScopeMenu() {
    this.el.progressScopeBtn.addEventListener('click', () => {
      if (this.el.progressScopeMenu.hidden) this._openProgressScopeMenu();
      else this._closeProgressScopeMenu();
    });
    this.el.progressScopeMenu.querySelectorAll('.progress-scope-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.progressScope = btn.dataset.scope;
        this._setProgressScopeUI();
        if (this.board?.setProgressScope) this.board.setProgressScope(this.progressScope);
        this._closeProgressScopeMenu();
      });
    });
  }

  // Syncs the button's label and the menu's ✓ mark to this.progressScope —
  // called both after picking an option and whenever the panel is
  // (re)shown (e.g. _startOverview), so a restored/programmatic scope
  // change is reflected even if the player never opened the menu.
  _setProgressScopeUI() {
    const active = this.el.progressScopeMenu.querySelector(`[data-scope="${this.progressScope}"]`);
    this.el.progressScopeLabel.textContent = active ? active.textContent : '';
    this.el.progressScopeMenu.querySelectorAll('.progress-scope-option').forEach((b) => b.classList.toggle('active', b === active));
  }

  // Syncs the "Рельеф" button's data-mode/label to this.terrainMode and
  // (unless silent) pushes it to the live board — called both from the
  // click handler above and from _startOverview's initial sync, same
  // split as _setProgressScopeUI/setProgressScope. silent is used by
  // _startOverview: the board doesn't exist yet at that point (it's built
  // right after with terrainMode passed into its constructor options), so
  // there's nothing to push to yet.
  _setTerrainMode(mode, { silent = false } = {}) {
    this.terrainMode = mode;
    this.el.toggleTerrainWrap.dataset.mode = mode;
    this.el.toggleTerrainText.textContent = TERRAIN_MODE_LABELS[mode];
    if (!silent && this.board?.setTerrainMode) this.board.setTerrainMode(mode);
  }

  _openProgressScopeMenu() {
    this.el.progressScopeMenu.hidden = false;
    this.el.progressScopeBtn.setAttribute('aria-expanded', 'true');
    // Capture phase + a fresh task — same reasoning as _openProgressIoMenu:
    // attaching synchronously within the very click that opened it would
    // let that click's own bubble-up close it again immediately.
    setTimeout(() => {
      this._progressScopeOutsideHandler = (e) => {
        if (!this.el.progressScopeWrap.contains(e.target)) this._closeProgressScopeMenu();
      };
      this._progressScopeKeyHandler = (e) => {
        if (e.key === 'Escape') this._closeProgressScopeMenu();
      };
      window.addEventListener('pointerdown', this._progressScopeOutsideHandler, true);
      window.addEventListener('keydown', this._progressScopeKeyHandler);
    }, 0);
  }

  _closeProgressScopeMenu() {
    if (this.el.progressScopeMenu.hidden) return;
    this.el.progressScopeMenu.hidden = true;
    this.el.progressScopeBtn.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', this._progressScopeOutsideHandler, true);
    window.removeEventListener('keydown', this._progressScopeKeyHandler);
    this._progressScopeOutsideHandler = null;
    this._progressScopeKeyHandler = null;
  }

  _setProgressIoStatus(text, kind) {
    const el = this.el.progressIoStatus;
    el.textContent = text;
    el.classList.toggle('error', kind === 'error');
    el.classList.toggle('success', kind === 'success');
  }

  _renderLevelList() {
    this.el.levelList.innerHTML = '';
    for (const [id, level] of Object.entries(this.levels)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'level-card' + (id === this.levelId ? ' selected' : '');
      const text = levelText(level);
      card.innerHTML = `<strong>${text.title}</strong><p>${text.subtitle || ''}</p>`;
      card.addEventListener('click', () => {
        this.levelId = id;
        this.el.levelList.querySelectorAll('.level-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        // Most modes assume US-state-shaped data (neighbors, cities,
        // places…) that only levels.usa has — see modes.js's `levels`
        // field. If the mode that was selected doesn't apply to the level
        // just switched to, fall back to the first one that does, rather
        // than leaving a now-nonsensical mode selected.
        if (!this._modesForCurrentLevel().some((m) => m.id === this.modeId)) {
          this.modeId = this._modesForCurrentLevel()[0].id;
        }
        this._renderModeList();
        // Eligibility lists (and the round-count max they drive) are
        // per-level data — this keeps switching levels from leaving a
        // stale states/cities list behind.
        this._applyModeVisibility();
        this._saveLastSettings();
      });
      this.el.levelList.appendChild(card);
    }
  }

  // Modes with no `levels` field (currently just "Обзор") work generically
  // for any level; everything else is scoped to specific ones.
  _modesForCurrentLevel() {
    return MODES.filter((m) => !m.levels || m.levels.includes(this.levelId));
  }

  _renderModeList() {
    this.el.modeList.innerHTML = '';
    for (const mode of this._modesForCurrentLevel()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (mode.id === this.modeId ? ' selected' : '');
      const ruText = (this.levelId === 'countries' && MODE_CARD_TEXT_COUNTRIES[mode.id]) || mode;
      const text = getLang() === 'en' ? modeText(mode, this.levelId) : ruText;
      card.innerHTML = `<strong>${text.title}</strong><p>${text.desc}</p>`;
      card.addEventListener('click', () => {
        this.modeId = mode.id;
        this.el.modeList.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this._applyModeVisibility();
        this._saveLastSettings();
      });
      this.el.modeList.appendChild(card);
    }
  }

  _applyModeVisibility() {
    const isPuzzle = this.modeId === 'puzzle';
    const isOverview = this.modeId === 'overview';
    const isJourney = this.modeId === 'journey';
    // Journey has no round-count/eligibility-checklist/adaptive-mode row —
    // it's a third structural category alongside puzzle/overview (one
    // fixed round: a randomly-picked state pair), not a "rounds" mode.
    const isRounds = !isPuzzle && !isOverview && !isJourney;
    const isNameState = this.modeId === 'name-state';
    const isNeighbor = this.modeId === 'neighbor';
    const isIdentify = this.modeId === 'identify';
    const isQuiz = this.modeId === 'quiz';
    const isCityPlace = this.modeId === 'city-place';
    const isColorFill = this.modeId === 'colorfill';
    const isSeaIdentify = this.modeId === 'sea-identify';
    const isSeaQuiz = this.modeId === 'sea-quiz';
    // "Города и места" only gets an eligibility checklist in "найти" mode —
    // "расставь метку" always draws from the full pool, same as the old
    // separate city-pins mode used to.
    const hasEligibility =
      isQuiz || isNameState || isNeighbor || isIdentify || isColorFill || isSeaIdentify || isSeaQuiz || (isCityPlace && this.cityPlaceMode === 'find');
    this.el.panelPuzzleSettings.hidden = !isPuzzle;
    this.el.panelQuizSettings.hidden = !isRounds;
    this.el.panelOverviewSettings.hidden = !isOverview;
    this.el.panelJourneySettings.hidden = !isJourney;
    if (isJourney) {
      this._renderJourneyAnswerMode();
      this._renderJourneyDifficulty();
    }
    this.el.quizEligibleWrap.hidden = !hasEligibility;
    this.el.nameStateDifficultyEl.hidden = !(isNameState || isNeighbor || isIdentify || isSeaIdentify);
    // Each of these has its own differently-sized difficulty list sharing
    // the same panel element — re-render it for whichever mode is now
    // active so the right cards (and the right one marked "selected")
    // show up. "sea-quiz" has no difficulty at all (click-to-find only),
    // so the panel just stays hidden for it.
    if (isNameState) this._renderNameStateDifficulty();
    else if (isNeighbor) this._renderNeighborDifficulty();
    else if (isIdentify) this._renderIdentifyDifficulty();
    else if (isSeaIdentify) this._renderSeaIdentifyDifficulty();
    // No adaptive mode for the two new sea modes (not asked for, keeps
    // this new level's scope tight) — same "no adaptive" default
    // city-place's pin mode already has.
    this.el.adaptiveModeRow.hidden = !(isQuiz || isNameState || isNeighbor || isIdentify || isColorFill);
    this.el.adaptiveModeCheckbox.checked = this.adaptiveMode;
    // Only the "find X on the map by clicking" modes have a select-then-
    // confirm two-click sequence for right-click to shortcut in the first
    // place — name-state/neighbor/identify answer by picking from options
    // or typing, not by clicking the map.
    this.el.quickSelectRow.hidden = !(isQuiz || isSeaQuiz);
    this.el.quickSelectCheckbox.checked = this.quickSelect;
    this.el.cityPlaceEntityRow.hidden = !isCityPlace;
    this.el.cityPlaceModeRow.hidden = !isCityPlace;
    this.el.cityPlaceEntityCheckbox.checked = this.cityPlaceEntity === 'places';
    this.el.cityPlaceEntityText.textContent = this.cityPlaceEntity === 'places' ? 'Места' : 'Города';
    this.el.cityPlaceModeCheckbox.checked = this.cityPlaceMode === 'pin';
    this.el.cityPlaceModeText.textContent = this.cityPlaceMode === 'pin' ? 'Расставь метку' : 'Найди на карте';

    if (!isRounds) {
      this.eligibilityList?.destroy();
      this.eligibilityList = null;
      this.el.btnStart.disabled = false;
      return;
    }

    const text = isCityPlace
      ? this._cityPlaceRoundsText()
      : this.levelId === 'countries' && ROUNDS_PANEL_TEXT_COUNTRIES[this.modeId]
        ? ROUNDS_PANEL_TEXT_COUNTRIES[this.modeId]
        : ROUNDS_PANEL_TEXT[this.modeId];
    this.el.quizPanelHeading.textContent = text.heading;
    this.el.quizCountLabel.textContent = text.label;
    this.el.quizPromptLabel.textContent = text.prompt;

    const level = this.levels[this.levelId];
    this.eligibilityList?.destroy();
    this.eligibilityList = null;

    if (hasEligibility) {
      const isSharedStateMode = isQuiz || isNameState || isNeighbor || isIdentify || isColorFill;
      const kind = isSeaIdentify || isSeaQuiz ? 'seas' : isSharedStateMode ? (this.levelId === 'countries' ? 'countries' : 'states') : this.cityPlaceEntity;
      const items = kind === 'states' || kind === 'seas' || kind === 'countries' ? level.pieces : kind === 'places' ? level.places : level.cities;
      // Adaptive mode's success streak — shown here so the player can see,
      // right where they're picking which states to include, which ones
      // are still giving them trouble in whichever mode they're setting up.
      const adaptiveScope = ADAPTIVE_SUCCESS_SCOPE_BY_MODE[this.modeId];
      const statOpts = adaptiveScope
        ? (() => {
            const stats = loadSuccessStats(this.levelId, adaptiveScope);
            return { getStat: (it) => stats[it.id] || 0, statLabel: t('eligSuccesses') };
          })()
        : {};
      // "Назови соседа" can only ask about states that actually HAVE a
      // land neighbor (e.g. not Hawaii) — the round cap must reflect that
      // narrower pool, not the raw checklist selection, or the slider
      // could ask for more rounds than the mode can actually deliver.
      // "Раскраска" can't ask about Hawaii — no CEC terrain coverage for it
      // (see levels/usaTerrain.js's stateCategories) — same narrowing
      // reasoning as "Назови соседа" excluding neighborless states below.
      const countEligible = (selected) =>
        isNeighbor
          ? items.filter((it) => selected.has(it.id) && it.neighbors && it.neighbors.length > 0).length
          : isColorFill
            ? items.filter((it) => selected.has(it.id) && it.id !== 'HI').length
            : selected.size;
      this.eligibilityList = new EligibilityList(this.el.quizEligibleWrap, items, {
        kind,
        storageKey: `geo-puzzle:eligible:${this.levelId}:${kind}`,
        onChange: (selected) => this._applyRoundCap(countEligible(selected)),
        ...statOpts,
      });
      this._applyRoundCap(countEligible(this.eligibilityList.getSelectedIds()));
    } else {
      this.el.btnStart.disabled = false;
      // "расставь метку" (city-place's pin mode) — full pool, no checklist.
      const fullPoolCount = isCityPlace && this.cityPlaceEntity === 'places' ? level.places.length : level.cities.length;
      this._applyRoundCap(fullPoolCount);
    }
  }

  // "Города и места"'s heading/label/prompt depend on its own two toggles
  // rather than a static per-mode lookup — see ROUNDS_PANEL_TEXT's comment.
  _cityPlaceRoundsText() {
    const entityWord = this.cityPlaceEntity === 'places' ? 'мест' : 'городов';
    const isPin = this.cityPlaceMode === 'pin';
    return {
      heading: 'Раунд',
      label: `Сколько ${entityWord} ${isPin ? 'отметить' : 'спросить'}`,
      prompt: isPin ? 'Отметь на карте:' : 'Найди на карте:',
    };
  }

  // Keeps the round-count range from ever asking for more rounds than
  // there are eligible states/cities to pick from — if the eligible count
  // drops below the current round count, the range's max (and, if needed,
  // its value) drops to match; growing the eligible count back up only
  // raises the max, not the value, so it doesn't silently override a
  // smaller round count the player chose on purpose.
  _applyRoundCap(eligibleCount) {
    const max = Math.max(1, eligibleCount);
    this.quizRounds = Math.min(clamp(this.quizRounds, 1, max), max);
    this.el.quizCountInput.max = String(max);
    this.el.quizCountInput.value = String(this.quizRounds);
    this.el.quizCountValue.textContent = this.quizRounds;
    this.el.btnStart.disabled = eligibleCount === 0;
  }

  // "Найди штат"-style mode heading text — same MODE_CARD_TEXT_COUNTRIES
  // titles already used for the mode-selection cards, reused here for the
  // in-game HUD heading so the two never drift apart.
  _modeHeadingText(modeId, fallback) {
    return (this.levelId === 'countries' && MODE_CARD_TEXT_COUNTRIES[modeId]?.title) || fallback;
  }

  // NEIGHBOR_DIFFICULTIES/IDENTIFY_DIFFICULTIES's rotated-shape tier says
  // "Штат повёрнут…" (masculine, agreeing with штат) — on the countries
  // level this isn't just oddly worded, it's grammatically wrong (страна
  // is feminine: "повёрнут" needs to be "повёрнута"). Everything else in
  // both arrays is already level-agnostic ("Впиши название сам" etc), so
  // this one substitution is the only thing that needs fixing here.
  _countryAwareDesc(desc) {
    if (this.levelId !== 'countries') return desc;
    return desc.replace('Штат повёрнут', 'Страна повёрнута').replace('State rotated', 'Country rotated');
  }

  // containerEl defaults to the single shared element name-state/neighbor/
  // identify/sea-identify all reuse (only one of those panels is ever
  // visible at once). Journey needs 2 simultaneously-visible pickers
  // (answer mode + difficulty), which doesn't fit that assumption — its 2
  // call sites (_renderJourneyAnswerMode/_renderJourneyDifficulty) pass
  // their own containers instead.
  _renderDifficultyList(diffs, currentId, onSelect, containerEl = this.el.nameStateDifficultyEl, enDict = {}) {
    containerEl.innerHTML = '';
    for (const diff of diffs) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (diff.id === currentId ? ' selected' : '');
      const text = presetText(diff, enDict);
      card.innerHTML = `<strong>${text.title}</strong><p>${this._countryAwareDesc(text.desc)}</p>`;
      card.addEventListener('click', () => {
        onSelect(diff.id);
        containerEl.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this._saveLastSettings();
      });
      containerEl.appendChild(card);
    }
  }

  _renderNameStateDifficulty() {
    this._renderDifficultyList(
      NAME_STATE_DIFFICULTIES,
      this.nameStateDifficulty,
      (id) => {
        this.nameStateDifficulty = id;
      },
      this.el.nameStateDifficultyEl,
      NAME_STATE_DIFFICULTIES_EN,
    );
  }

  _renderNeighborDifficulty() {
    this._renderDifficultyList(
      NEIGHBOR_DIFFICULTIES,
      this.neighborDifficulty,
      (id) => {
        this.neighborDifficulty = id;
      },
      this.el.nameStateDifficultyEl,
      NEIGHBOR_DIFFICULTIES_EN,
    );
  }

  _renderIdentifyDifficulty() {
    this._renderDifficultyList(
      IDENTIFY_DIFFICULTIES,
      this.identifyDifficulty,
      (id) => {
        this.identifyDifficulty = id;
      },
      this.el.nameStateDifficultyEl,
      IDENTIFY_DIFFICULTIES_EN,
    );
  }

  _renderSeaIdentifyDifficulty() {
    this._renderDifficultyList(
      SEA_IDENTIFY_DIFFICULTIES,
      this.seaIdentifyDifficulty,
      (id) => {
        this.seaIdentifyDifficulty = id;
      },
      this.el.nameStateDifficultyEl,
      SEA_IDENTIFY_DIFFICULTIES_EN,
    );
  }

  _renderJourneyAnswerMode() {
    this._renderDifficultyList(
      JOURNEY_ANSWER_MODES,
      this.journeyAnswerMode,
      (id) => {
        this.journeyAnswerMode = id;
      },
      this.el.journeyAnswerModeEl,
      JOURNEY_ANSWER_MODES_EN,
    );
  }

  _renderJourneyDifficulty() {
    this._renderDifficultyList(
      JOURNEY_DIFFICULTIES,
      this.journeyDifficulty,
      (id) => {
        this.journeyDifficulty = id;
      },
      this.el.journeyDifficultyEl,
      JOURNEY_DIFFICULTIES_EN,
    );
  }

  _renderOverviewList() {
    this.el.overviewList.innerHTML = '';
    for (const mode of OVERVIEW_MODES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (mode.id === this.overviewModeId ? ' selected' : '');
      const text = presetText(mode, OVERVIEW_MODES_EN);
      card.innerHTML = `<strong>${text.title}</strong><p>${text.desc}</p>`;
      card.addEventListener('click', () => {
        this.overviewModeId = mode.id;
        this.el.overviewList.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this._saveLastSettings();
      });
      this.el.overviewList.appendChild(card);
    }
  }

  _renderPresetList() {
    this.el.presetList.innerHTML = '';
    for (const preset of PRESETS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (preset.id === this.presetId ? ' selected' : '');
      const text = presetText(preset, PRESETS_EN);
      card.innerHTML = `<strong>${text.title}</strong><p>${text.desc}</p>`;
      card.addEventListener('click', () => {
        this.presetId = preset.id;
        this.el.presetList.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.el.customCountRow.hidden = preset.id !== 'custom';
        this._saveLastSettings();
      });
      this.el.presetList.appendChild(card);
    }
    this.el.customCountRow.hidden = this.presetId !== 'custom';
  }

  _bindEvents() {
    this.el.btnStart.addEventListener('click', () => {
      playClick();
      this.startGame();
    });
    this._bindProgressIo();
    this._bindLangSwitcher();
    // "Press R to replay" (see .replay-hint's keycap+reload badge in
    // win-bar) — only live while the win-bar is actually showing, so R
    // doesn't do anything unexpected mid-round or on the menu.
    // startGame() re-reads this.levelId/this.modeId/etc, which are all
    // still exactly what they were for the round that just finished, so
    // this is a genuine "same settings, go again" rather than a trip
    // back through the setup screen.
    const replay = () => {
      playClick();
      this.startGame();
    };
    document.addEventListener('keydown', (ev) => {
      // The winBar.hidden check must come BEFORE preventDefault(), not
      // after — calling it unconditionally on every "r" keypress blocked
      // typing the letter "r" into any text input on the page (e.g. "hard"
      // mode's name-state text answer field), even while the win-bar
      // wasn't showing at all and this shortcut had nothing to catch.
      if (this.el.winBar.hidden) return;
      if (ev.key.toLowerCase() !== 'r') return;
      ev.preventDefault();
      replay();
    });
    // The hint is clickable too, not just a passive "press R" reminder —
    // role="button"/tabindex in index.html make it keyboard-reachable, so
    // Enter/Space (the native activation keys a "button" role implies)
    // need handling alongside plain click.
    this.el.replayHint.addEventListener('click', replay);
    this.el.replayHint.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      replay();
    });
    this.el.btnBrand.addEventListener('click', () => this._goMenu());
    this.el.btnBackMenu.addEventListener('click', () => {
      playClick();
      this._goMenu();
    });
    this.el.customCountInput.addEventListener('input', (ev) => {
      this.customCount = Number(ev.target.value);
      this.el.customCountValue.textContent = this.customCount;
      this._saveLastSettings();
    });
    this.el.adaptiveModeCheckbox.addEventListener('change', (ev) => {
      this.adaptiveMode = ev.target.checked;
      this._saveLastSettings();
    });
    this.el.quickSelectCheckbox.addEventListener('change', (ev) => {
      this.quickSelect = ev.target.checked;
      this._saveLastSettings();
    });
    this.el.cityPlaceEntityCheckbox.addEventListener('change', (ev) => {
      this.cityPlaceEntity = ev.target.checked ? 'places' : 'cities';
      this._applyModeVisibility(); // rebuilds the eligibility list for the newly-chosen entity
      this._saveLastSettings();
    });
    this.el.cityPlaceModeCheckbox.addEventListener('change', (ev) => {
      this.cityPlaceMode = ev.target.checked ? 'pin' : 'find';
      this._applyModeVisibility(); // eligibility only applies to "найти", not "расставь"
      this._saveLastSettings();
    });
    this.el.quizCountInput.addEventListener('input', (ev) => {
      this.quizRounds = Number(ev.target.value);
      this.el.quizCountValue.textContent = this.quizRounds;
      this._saveLastSettings();
    });
    this.el.toggleHints.addEventListener('change', (ev) => {
      // Reused for Overview mode's "hide cities" switch — see _startOverview
      // (mirrors how toggleLabels doubles as "Буквы"/"Подписи").
      if (this.modeId === 'overview') {
        this.citiesVisible = ev.target.checked;
        if (this.board?.setCitiesVisible) this.board.setCitiesVisible(this.citiesVisible);
      } else {
        this.hintsVisible = ev.target.checked;
        if (this.board?.setHintsVisible) this.board.setHintsVisible(this.hintsVisible);
      }
    });
    this.el.toggleLabels.addEventListener('change', (ev) => {
      this.labelsVisible = ev.target.checked;
      if (this.board?.setLabelsVisible) this.board.setLabelsVisible(this.labelsVisible);
    });
    this.el.togglePlaces.addEventListener('change', (ev) => {
      this.placesVisible = ev.target.checked;
      if (this.board?.setPlacesVisible) this.board.setPlacesVisible(this.placesVisible);
    });
    this.el.toggleHighways.addEventListener('change', (ev) => {
      this.highwaysVisible = ev.target.checked;
      if (this.board?.setHighwaysVisible) this.board.setHighwaysVisible(this.highwaysVisible);
    });
    this.el.toggleProgress.addEventListener('change', (ev) => {
      this.progressVisible = ev.target.checked;
      this.el.progressScopeWrap.hidden = !this.progressVisible;
      if (this.board?.setProgressVisible) this.board.setProgressVisible(this.progressVisible);
    });
    // Segmented control (index.html's 3 .toggle-3way-zone buttons) rather
    // than a single toggle target — delegated so any of the 3 zones jumps
    // straight to its own mode, no forced cycling through the middle one.
    this.el.toggleTerrainWrap.addEventListener('click', (ev) => {
      const zone = ev.target.closest('.toggle-3way-zone');
      if (zone) this._setTerrainMode(zone.dataset.mode);
    });
    this._bindProgressScopeMenu();
    // Keeps the finish button anchored to the map's actual edge (see
    // _positionWinBar) if the window resizes while it's showing — a no-op
    // whenever the bar is hidden, so this doesn't need its own
    // add/remove lifecycle around each round.
    window.addEventListener('resize', () => {
      if (!this.el.winBar.hidden) this._positionWinBar();
    });
  }

  _availableHeight(extraReserve = 0) {
    const headerH = document.querySelector('.topbar').offsetHeight || 64;
    const screenPadV = SCREEN_EDGE_MARGIN_PX * 2; // .screen-game padding-top + padding-bottom
    return window.innerHeight - headerH - screenPadV - extraReserve;
  }

  // `cover`: fills the ENTIRE available box with no gap on any side —
  // Math.max means whichever dimension doesn't need cropping still
  // overflows it slightly, same idea as CSS `background-size: cover`.
  // Every free-pan/zoom viewing mode wants this now (the map is meant to
  // be monolithic, edge-to-edge, no letterboxing "padding" from preserving
  // the whole canvas's aspect ratio — see .zoom-viewport/.screen-game).
  // Puzzle mode is the one exception (the default, `cover: false` /
  // Math.min = CSS `contain`): the WHOLE target outline has to stay
  // visible for players to see where every remaining piece goes, so it
  // can never crop any part of it off-screen.
  _computeScale(canvas, availH, availWOverride, cover = false) {
    const availW = availWOverride ?? window.innerWidth - SCREEN_EDGE_MARGIN_PX * 2;
    // No reason to cap this at native (1x) resolution — it's all vector
    // SVG, so it stays crisp at any size. Filling the available screen
    // space is what makes the map (and its text/pieces) actually
    // comfortable to read instead of floating small in the middle of a
    // big monitor.
    const fit = cover ? Math.max(availW / canvas.width, availH / canvas.height) : Math.min(availW / canvas.width, availH / canvas.height);
    return clamp(fit, 0.2, 3);
  }

  startGame() {
    this._saveLastSettings();
    const level = this.levels[this.levelId];
    this.el.screenMenu.hidden = true;
    this.el.screenGame.hidden = false;
    // Otherwise replaying via the "press R" shortcut (see _bindEvents)
    // would leave the just-finished round's win-bar floating on top of
    // the freshly-started one — the setup screen's own "Играть" path
    // never needed this since the win-bar is already hidden by then.
    this.el.winBar.hidden = true;
    this.el.hud.hidden = false;

    if (this.board) this.board.destroy();

    if (this.modeId === 'quiz') this._startQuiz(level);
    else if (this.modeId === 'name-state') this._startNameState(level);
    else if (this.modeId === 'neighbor') this._startNeighbor(level);
    else if (this.modeId === 'identify') this._startIdentify(level);
    else if (this.modeId === 'city-place') this._startCityPlace(level);
    else if (this.modeId === 'colorfill') this._startColorFill(level);
    else if (this.modeId === 'sea-identify') this._startSeaIdentify(level);
    else if (this.modeId === 'sea-quiz') this._startSeaQuiz(level);
    else if (this.modeId === 'overview') this._startOverview(level);
    else if (this.modeId === 'journey') this._startJourney(level);
    else this._startPuzzle(level);

    // Overview is free browsing, not a timed challenge — the win bar it
    // could theoretically show never reads this, so a running stopwatch
    // there is just noise.
    clearInterval(this.timerHandle);
    this.el.hudTimer.hidden = this.modeId === 'overview';
    if (this.modeId !== 'overview') {
      this.seconds = 0;
      this.el.hudTimer.textContent = formatTime(0);
      this.timerHandle = setInterval(() => {
        this.seconds++;
        this.el.hudTimer.textContent = formatTime(this.seconds);
      }, 1000);
    }
  }

  _startPuzzle(level) {
    const preset = PRESETS.find((p) => p.id === this.presetId);
    const toPlaceCount = preset.pieceCount ?? this.customCount;

    this.hintsVisible = preset.hints;
    this.labelsVisible = preset.labels;
    this.el.toggleHints.checked = this.hintsVisible;
    this.el.toggleLabels.checked = this.labelsVisible;
    this.el.toggleHintsWrap.hidden = !preset.showToggles;
    this.el.toggleLabelsWrap.hidden = !preset.showToggles;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    this.el.toggleHintsText.textContent = 'Подсказки';
    this.el.toggleLabelsText.textContent = 'Буквы';
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · ${preset.title} (${toPlaceCount})`;
    this.el.hudProgress.textContent = `0/${toPlaceCount}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Частей: 0';

    // Still "contain" fit (see _computeScale's comment — puzzle mode can
    // never crop the hint outline, unlike every other mode's cover fit),
    // but now against the FULL available height instead of a boardBandH
    // shrunk to leave room for a permanent tray band below it — the tray
    // is a pull-out drawer overlaying the map's bottom edge now (see
    // puzzleBoard.js's _bindTrayDrawer), so the board no longer has to
    // share the screen with it at all. That's what was squeezing the
    // board into a small letterboxed square: the USA canvas is close to
    // square itself, so contain-fitting it into a short, tray-shrunk band
    // produced a small square with big empty margins on either side.
    // Piece icons get one comfortable constant size rather than shrinking
    // to force-fit a budget — the drawer's own internal scroll handles
    // overflow instead.
    const scale = this._computeScale(level.canvas, this._availableHeight());
    const traySize = 78;

    // Hawaii is excluded from this mode specifically (Alaska stays) — at
    // its true real-world position/scale (scripts/build_usa_level.js) it
    // sits far southwest with nothing but ocean around it, which doesn't
    // suit "drag it onto its own true-position outline" the way a normal
    // state piece does; it's still a normal, guessable/clickable piece in
    // every OTHER mode. Same synthetic-level-with-filtered-pieces pattern
    // Journey mode's puzzle sub-mode already uses (js/game.js's
    // _startJourney) — PuzzleBoard's own `level.pieces.length`-based
    // win-check/tray-count automatically scopes correctly, no board
    // changes needed.
    const puzzleLevel = { ...level, pieces: level.pieces.filter((p) => p.id !== 'HI') };

    this.board = new PuzzleBoard(this.el.boardContainer, puzzleLevel, {
      toPlaceCount,
      scale,
      traySize,
      hintsVisible: this.hintsVisible,
      labelsVisible: this.labelsVisible,
      onProgress: (p) => this._onPuzzleProgress(p),
      onWin: () => this._onFinish(),
    });
    // The canvas now also fits true-position Alaska/Canada/Hawaii (see
    // scripts/build_usa_level.js) — without this, the default camera would
    // show the WHOLE extended canvas, most of it empty ocean around
    // Canada/Hawaii, leaving the actual play area tiny. Restrict to just
    // the mainland+Alaska bbox (exactly what's left in puzzleLevel.pieces
    // now that Hawaii's filtered out) — same focusOnBBox pattern Journey
    // mode's puzzle sub-mode already uses.
    this.board.zoomCtl.focusOnBBox(unionBBox(puzzleLevel.pieces.map((p) => p.bbox)), { animate: false, pad: 0.05 });
  }

  _startQuiz(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · ${this._modeHeadingText('quiz', 'Найди штат')} (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
    this.board = new QuizBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      quickSelect: this.quickSelect,
      scale,
      onProgress: (p) => this._onQuizProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  _startNameState(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    // No text prompt here — the "question" is the pulsing highlight on the
    // map itself (see nameStateBoard.js), showing the name would give away
    // the answer.
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · ${this._modeHeadingText('name-state', 'Назови штат')} (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
    this.board = new NameStateBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      difficulty: this.nameStateDifficulty,
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      scale,
      onProgress: (p) => this._onNameStateProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  _startNeighbor(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    // No text prompt — the "question" is entirely on the map (highlighted
    // state + glowing border), same reasoning as _startNameState.
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · Назови соседа (${this.quizRounds})`; // "соседа" itself needs no state/country-specific wording
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    // Unlike every other board, this one crops/zooms to a DIFFERENT
    // native-unit bounding box every round (just the current state's own
    // shape, not the fixed full canvas) — so it needs the raw available
    // pixel space to fit against each round, not a single pre-computed
    // scale for the whole (unused, here) canvas.
    this.board = new NeighborBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      difficulty: this.neighborDifficulty,
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      availW: window.innerWidth - SCREEN_EDGE_MARGIN_PX * 2,
      availH: this._availableHeight(),
      onProgress: (p) => this._onNameStateProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  _startIdentify(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · ${this._modeHeadingText('identify', 'Определи штат')} (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    // Same per-round isolated-shape cropping as _startNeighbor — see its
    // comment for why raw available pixel space is passed instead of a
    // single pre-computed scale.
    this.board = new IdentifyStateBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      difficulty: this.identifyDifficulty,
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      availW: window.innerWidth - SCREEN_EDGE_MARGIN_PX * 2,
      availH: this._availableHeight(),
      onProgress: (p) => this._onNameStateProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  _startSeaIdentify(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · Определи море или океан (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    // Unlike _startIdentify/_startNeighbor's per-round isolated-shape crop,
    // this shows the whole world map with the target sea highlighted —
    // sea shapes read as "the gap between coastlines", so cropping away the
    // land context (as states can afford to, being self-contained shapes)
    // left the target floating in blank space. See seaIdentifyBoard.js.
    const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
    this.board = new SeaIdentifyBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      difficulty: this.seaIdentifyDifficulty,
      scale,
      onProgress: (p) => this._onNameStateProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  _startSeaQuiz(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Найди море или океан (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
    this.board = new SeaQuizBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      quickSelect: this.quickSelect,
      scale,
      onProgress: (p) => this._onQuizProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  // Replaces the old separate _startCityQuiz/_startCityPins — one method
  // dispatching to whichever of the two (still-unchanged-in-core-logic)
  // board classes the interaction toggle picked, over whichever item pool
  // (cities or places) the entity toggle picked.
  _startCityPlace(level) {
    const isPin = this.cityPlaceMode === 'pin';
    const items = this.cityPlaceEntity === 'places' ? level.places : level.cities;

    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Города и места (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;

    if (isPin) {
      this.el.hudGroups.textContent = 'Ср. ошибка: —';
      const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
      this.board = new CityPinBoard(this.el.boardContainer, level, {
        rounds: this.quizRounds,
        items,
        levelId: this.levelId,
        scale,
        onProgress: (p) => this._onPinProgress(p),
        onFinish: () => this._onFinish(),
      });
    } else {
      this.el.hudGroups.textContent = 'Ошибки: 0';
      const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
      this.board = new CityQuizBoard(this.el.boardContainer, level, {
        rounds: this.quizRounds,
        items,
        eligibleIds: this.eligibilityList?.getSelectedIds(),
        levelId: this.levelId,
        scale,
        onProgress: (p) => this._onQuizProgress(p),
        onFinish: () => this._onFinish(),
      });
    }
  }

  // "Раскраска" — the only board that needs levels/usaTerrain.js (the
  // ~480KB terrain dataset), so the dynamic import happens HERE rather
  // than as a static import in colorFillBoard.js itself: every board class
  // is imported up front by this file regardless of which mode the player
  // picks, so a static import inside colorFillBoard.js would mean every
  // single page load pays for this file, not just sessions that actually
  // play this mode.
  async _startColorFill(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;
    // No text prompt — same reasoning as name-state/neighbor/identify: the
    // camera-focused state IS the question, a redundant label would just
    // repeat what's already on screen.
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · ${this._modeHeadingText('colorfill', 'Раскраска')} (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const { default: terrainData } = await import('../levels/usaTerrain.js');
    // The player could have switched levels/modes while that import was in
    // flight — bail rather than mounting a stale board over whatever's
    // now actually selected.
    if (this.modeId !== 'colorfill' || this.levelId !== 'usa') return;

    const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
    this.board = new ColorFillBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      terrainData,
      scale,
      onProgress: (p) => this._onColorFillProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  _startOverview(level) {
    const overviewMode = OVERVIEW_MODES.find((m) => m.id === this.overviewModeId) || OVERVIEW_MODES[0];
    // "Полная информация" turns every layer ON; "Скрытая информация" turns
    // all of them OFF (bare unlabeled map, hover-to-reveal) — even on the
    // world level, where seas cluster tightly enough (Mediterranean/Black/
    // Red/Persian Gulf, Caribbean/Gulf of Mexico…) that "full" used to look
    // messy, this no longer silently overrides labels off regardless of
    // what was picked. Silently overriding an explicit choice is worse
    // than a cluttered map — every layer here already has its own one-
    // click HUD toggle to fix right there. "Прогресс" is deliberately NOT
    // included — it stays off regardless of this choice (an opt-in
    // heatmap, not a base layer).
    const isFull = overviewMode.id === 'full';
    this.labelsVisible = isFull;
    this.citiesVisible = isFull;
    this.placesVisible = isFull;
    this.highwaysVisible = isFull;
    // USA-only, same as the toggle itself being hidden for world/countries
    // below. "Full" defaults to the richest look ('pattern'), same spirit
    // as every other *Visible flag above defaulting fully on.
    const terrainMode = isFull && level.id === 'usa' ? 'pattern' : 'off';

    // World level has no cities/places at all (levels/world.js: cities: [],
    // places: []) — showing "Города"/"Места" toggles for a level with
    // nothing for them to show/hide is just confusing clutter. Highways
    // are USA-only for now (levels/usaHighways.js) — same reasoning.
    this.el.toggleHintsWrap.hidden = level.cities.length === 0;
    this.el.toggleHintsWrap.title = 'Показать/скрыть города на карте';
    this.el.toggleHintsText.textContent = 'Города';
    this.el.toggleHints.checked = this.citiesVisible;
    this.el.toggleLabelsWrap.hidden = false;
    this.el.toggleLabelsText.textContent = 'Подписи';
    this.el.toggleLabels.checked = this.labelsVisible;
    this.el.togglePlacesWrap.hidden = level.places.length === 0;
    this.el.togglePlaces.checked = this.placesVisible;
    this.el.toggleHighwaysWrap.hidden = !level.highways?.length;
    this.el.toggleHighways.checked = this.highwaysVisible;
    // States only for now (per the feature's own scope) — every adaptive-
    // mode success scope this drives (ADAPTIVE_SUCCESS_SCOPE_BY_MODE) is
    // state-keyed, so there's nothing meaningful to show on world/countries.
    this.el.toggleProgressWrap.hidden = level.id !== 'usa';
    this.el.toggleProgress.checked = this.progressVisible;
    this.el.progressScopeWrap.hidden = level.id !== 'usa' || !this.progressVisible;
    this._setProgressScopeUI();
    this.el.toggleTerrainWrap.hidden = level.id !== 'usa';
    this._setTerrainMode(terrainMode, { silent: true });
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · Обзор`;
    // Omit "0 гор. · 0 мест" entirely for levels with none (world) instead
    // of stating a count of zero for something that isn't there at all.
    // World's pieces are oceans/seas/gulfs, not generic "шт." — "акваторий"
    // (water body) covers all three without a per-category breakdown.
    const pieceUnit = level.id === 'world' ? 'акваторий' : level.id === 'countries' ? 'стран' : 'шт.';
    const progressParts = [`${level.pieces.length} ${pieceUnit}`];
    if (level.cities.length) progressParts.push(`${level.cities.length} гор.`);
    if (level.places.length) progressParts.push(`${level.places.length} мест`);
    this.el.hudProgress.textContent = progressParts.join(' · ');
    this.el.hudGroups.hidden = true;

    // The side list panel floats OVER the map now (position:absolute, see
    // .overview-panel) rather than sharing the row's width with it, so the
    // map's own scale no longer needs to account for it — same calculation
    // as every other mode.
    const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
    this.board = new OverviewBoard(this.el.boardContainer, level, {
      scale,
      labelsVisible: this.labelsVisible,
      citiesVisible: this.citiesVisible,
      placesVisible: this.placesVisible,
      highwaysVisible: this.highwaysVisible,
      progressVisible: level.id === 'usa' && this.progressVisible,
      progressScope: this.progressScope,
      terrainMode: level.id === 'usa' ? this.terrainMode : 'off',
    });
  }

  // "Путешествие" — picks 2 random states connected by the real highway
  // graph (js/journeyRoute.js, built from scripts/build_usa_route_graph.js's
  // levels/usaRouteGraph.js) and shows only them + the connecting route(s).
  // Two answer sub-modes: type the in-between states in order
  // (JourneyNameBoard), or drag their unlabeled shapes onto the real map
  // (PuzzleBoard, reusing its toPlaceIds/highways additions).
  _startJourney(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;
    this.el.toggleProgressWrap.hidden = true;
    this.el.toggleTerrainWrap.hidden = true;
    this.el.progressScopeWrap.hidden = true;
    this.el.quizPrompt.hidden = true;

    // Excludes Alaska/Hawaii (no highway data reaches them — separate inset
    // projections, see levels/usa.js's `inset` flag) and any state that
    // ends up with zero route-graph edges, so pickJourneyPair's retry
    // budget is never wasted sampling an unreachable candidate.
    const candidateIds = level.pieces.filter((p) => !p.inset && level.routeGraph.adjacency[p.id]).map((p) => p.id);
    const tier = JOURNEY_DIFFICULTIES.find((d) => d.id === this.journeyDifficulty) || JOURNEY_DIFFICULTIES[0];
    let pick = pickJourneyPair(candidateIds, level.routeGraph, { minBetween: tier.min, maxBetween: tier.max });
    // Retry once with a widened range rather than silently failing — the
    // real states-between histogram (see build_usa_route_graph.js's own
    // diagnostic output) makes every tier's range reachable in practice,
    // but a widened fallback is cheap insurance against an unlucky
    // maxAttempts exhaustion.
    if (!pick) pick = pickJourneyPair(candidateIds, level.routeGraph, { minBetween: 1, maxBetween: 20, maxAttempts: 1000 });
    if (!pick) {
      this.el.hudLevel.textContent = `${level.title} · Путешествие: не удалось подобрать маршрут, попробуй ещё раз`;
      this.el.hudProgress.textContent = '';
      this.el.hudGroups.hidden = true;
      this.board = null;
      return;
    }

    const startPiece = level.pieces.find((p) => p.id === pick.startId);
    const endPiece = level.pieces.find((p) => p.id === pick.endId);
    this.el.hudLevel.textContent = `${level.title} · Путешествие: ${startPiece.ru} → ${endPiece.ru}`;
    this.el.hudGroups.hidden = false;

    if (this.journeyAnswerMode === 'puzzle' || this.journeyAnswerMode === 'puzzle-blind') {
      const betweenIds = pick.chain.slice(1, -1);
      const subsetIds = new Set([pick.startId, pick.endId, ...betweenIds]);
      const syntheticLevel = { ...level, pieces: level.pieces.filter((p) => subsetIds.has(p.id)) };
      // Dot-per-stop + dashed line, not real highway geometry — see
      // puzzleBoard.js's routeDots comment.
      const routeDots = pick.chain.map((id) => level.pieces.find((p) => p.id === id)).filter(Boolean).map((p) => ({ cx: p.cx, cy: p.cy }));

      this.el.hudProgress.textContent = `0/${betweenIds.length}`;
      this.el.hudGroups.textContent = 'Частей: 0';

      const scale = this._computeScale(level.canvas, this._availableHeight());
      this.board = new PuzzleBoard(this.el.boardContainer, syntheticLevel, {
        scale,
        toPlaceIds: new Set(betweenIds),
        labelsVisible: false,
        // "Пазл вслепую" — same drag-assembly, no dashed true-position
        // outline on the map (js/puzzleBoard.js's hintsVisible, same
        // mechanism plain "Собери карту"'s hardest presets already use).
        hintsVisible: this.journeyAnswerMode !== 'puzzle-blind',
        routeDots,
        onProgress: (p) => this._onPuzzleProgress(p),
        onWin: () => this._onFinish(),
      });
      // PuzzleBoard has no automatic camera-focus (unlike JourneyNameBoard)
      // — without this the small subset would render tiny inside an
      // otherwise-blank full-US canvas.
      this.board.zoomCtl.focusOnBBox(unionBBox(syntheticLevel.pieces.map((p) => p.bbox)), { animate: false, pad: 1 });
    } else {
      this.el.hudProgress.textContent = `0/${pick.chain.length - 2}`;
      this.el.hudGroups.textContent = 'Ошибки: 0';

      const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
      this.board = new JourneyNameBoard(this.el.boardContainer, level, {
        scale,
        startId: pick.startId,
        endId: pick.endId,
        chain: pick.chain,
        hops: pick.hops,
        levelId: this.levelId,
        onProgress: (p) => this._onJourneyNameProgress(p),
        onFinish: () => this._onFinish(),
      });
    }
  }

  _onJourneyNameProgress({ chainIndex, total, mistakes }) {
    this.el.hudProgress.textContent = `${chainIndex}/${total}`;
    this.el.hudGroups.textContent = `Ошибки: ${mistakes}`;
  }

  _onPuzzleProgress({ placed, total, groups }) {
    this.el.hudProgress.textContent = `${placed}/${total}`;
    this.el.hudGroups.textContent = `Частей: ${groups}`;
  }

  _onQuizProgress({ index, total, mistakes, promptRu, promptName }) {
    this.el.hudProgress.textContent = `${index}/${total}`;
    this.el.hudGroups.textContent = `Ошибки: ${mistakes}`;
    this.el.quizPromptName.textContent = promptName ? `${promptRu} (${promptName})` : promptRu;
  }

  _onNameStateProgress({ index, total, mistakes }) {
    this.el.hudProgress.textContent = `${index}/${total}`;
    this.el.hudGroups.textContent = `Ошибки: ${mistakes}`;
  }

  _onColorFillProgress({ index, total, mistakes }) {
    this.el.hudProgress.textContent = `${index}/${total}`;
    this.el.hudGroups.textContent = `Ошибки: ${mistakes}`;
  }

  _onPinProgress({ index, total, avgDistanceKm, promptRu, promptName }) {
    this.el.hudProgress.textContent = `${index}/${total}`;
    this.el.hudGroups.textContent = avgDistanceKm == null ? 'Ср. ошибка: —' : `Ср. ошибка: ${avgDistanceKm} км`;
    this.el.quizPromptName.textContent = promptName ? `${promptRu} (${promptName})` : promptRu;
  }

  _onFinish() {
    clearInterval(this.timerHandle);
    // Floats INSIDE the map (see .win-bar's own comment) rather than a
    // modal — a full-screen overlay blocked the finished map right when
    // the player most wants to look at it (e.g. the assembled puzzle). No
    // stats text — nobody reads it once the round is over, and it used to
    // sit next to leftover in-round UI (the 4-option buttons or text input
    // various boards build below the map), which stayed live and
    // clickable after the round had already ended. Both are just noise
    // now: hide whatever answer UI the board built, and leave only the way
    // back to the menu.
    this.el.quizPrompt.hidden = true;
    this.el.boardContainer.querySelectorAll('.name-answer-bar, .city-actions, .colorfill-palette').forEach((el) => { el.hidden = true; });
    this.el.winBar.hidden = false;
    this._positionWinBar();
  }

  // Anchored to the actual rendered map (this.board.zoomWrap — every board
  // class exposes it, exactly sized to its own rendered pixels), not the
  // viewport. A fixed viewport-relative offset could straddle the map's
  // own bottom edge — half on the map, half in the letterboxing gap below
  // it — whenever the map doesn't fill the full available height (see
  // .quiz-prompt's comment on aspect-ratio letterboxing). WIN_BAR_INSET_PX
  // keeps the button clearly inside that edge instead of flush against it.
  //
  // Clamped against #board-container's own rect too, not just the map's:
  // .zoom-wrap is deliberately oversized by "cover" fit (every mode but
  // puzzle) and gets cropped, so its OWN rect can extend well past the
  // real visible area at wide aspect ratios — anchoring straight to its
  // bottom/left/right pushed the button off-screen entirely. Taking the
  // intersection of the two rects keeps the letterboxing-aware behavior
  // above for puzzle mode (map smaller than the container) while clamping
  // to the real visible bounds for every cover-fit mode (map bigger than
  // the container) — see js/nameStateBoard.js's matching comment on the
  // same underlying trap for the answer bar/zoom controls/scale bar.
  _positionWinBar() {
    const mapEl = this.board?.zoomWrap;
    if (!mapEl) return;
    const mapRect = mapEl.getBoundingClientRect();
    const containerRect = this.el.boardContainer.getBoundingClientRect();
    const left = Math.max(mapRect.left, containerRect.left);
    const right = Math.min(mapRect.right, containerRect.right);
    const bottom = Math.min(mapRect.bottom, containerRect.bottom);
    this.el.winBar.style.left = `${(left + right) / 2}px`;
    this.el.winBar.style.top = `${bottom - WIN_BAR_INSET_PX}px`;
  }

  _goMenu() {
    clearInterval(this.timerHandle);
    if (this.board) {
      this.board.destroy();
      this.board = null;
    }
    this.el.screenGame.hidden = true;
    this.el.hud.hidden = true;
    this.el.screenMenu.hidden = false;
    // The finish bar is only ever shown mid-game — hiding it here (rather
    // than just in btn-back-menu's own handler) covers every way back to
    // the menu, including the header logo and the "Меню" button, which
    // used to leave it stuck on screen.
    this.el.winBar.hidden = true;
    // Rebuild the eligibility list so its success stats reflect the round
    // that was just played — otherwise it kept showing whatever stats were
    // loaded when the settings panel was last opened, before the round.
    this._applyModeVisibility();
  }
}
