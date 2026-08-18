import { PuzzleBoard } from './puzzleBoard.js';
import { QuizBoard } from './quizBoard.js';
import { NameStateBoard } from './nameStateBoard.js';
import { NeighborBoard } from './neighborBoard.js';
import { IdentifyStateBoard } from './identifyStateBoard.js';
import { CityQuizBoard } from './cityQuizBoard.js';
import { CityPinBoard } from './cityPinBoard.js';
import { SeaIdentifyBoard } from './seaIdentifyBoard.js';
import { SeaQuizBoard } from './seaQuizBoard.js';
import { OverviewBoard } from './overviewBoard.js';
import { EligibilityList } from './eligibilityList.js';
import { getCoins, spendAllCoins, onCoinsChanged } from './coins.js';
import { SCREEN_EDGE_MARGIN_PX } from './constants.js';
import { clamp } from './utils.js';
import { PRESETS, DEFAULT_CUSTOM_COUNT } from './presets.js';
import {
  MODES,
  OVERVIEW_MODES,
  NAME_STATE_DIFFICULTIES,
  NEIGHBOR_DIFFICULTIES,
  IDENTIFY_DIFFICULTIES,
  SEA_IDENTIFY_DIFFICULTIES,
} from './modes.js';
import { playClick } from './audio.js';
import { loadSuccessStats } from './successStats.js';

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

// Global "land color scheme" toggle (topbar, always visible, independent
// of level/mode) — one persisted choice for every level's land layer, see
// style.css's --land-fill/--land-stroke variables and _initLandScheme.
const LAND_SCHEME_STORAGE_KEY = 'geoPuzzleLandScheme';
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
    // "Города и места" — two independent toggles instead of separate mode
    // cards: WHAT to ask about (cities vs places) and HOW to answer
    // (click-to-find vs place-a-pin). See _startCityPlace.
    this.cityPlaceEntity = 'cities';
    this.cityPlaceMode = 'find';
    this.adaptiveMode = false;
    this.hintsVisible = true;
    this.labelsVisible = true;
    this.citiesVisible = true;
    this.placesVisible = true;
    this.eligibilityList = null; // current EligibilityList instance for quiz/city-place — see _applyModeVisibility
    this.board = null;
    this.seconds = 0;
    this.timerHandle = null;

    this._cacheDom();
    this._initLandScheme();
    this._initCoins();
    this._renderLevelList();
    this._renderModeList();
    this._renderPresetList();
    this._renderOverviewList();
    this._bindEvents();
    this._applyModeVisibility();
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
      btnStart: document.getElementById('btn-start'),
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
      toggleLandScheme: document.getElementById('toggle-land-scheme'),
      faviconLink: document.getElementById('favicon-link'),
      coinBalance: document.getElementById('coin-balance'),
      coinBalanceValue: document.getElementById('coin-balance-value'),
    };
  }

  _renderLevelList() {
    this.el.levelList.innerHTML = '';
    for (const [id, level] of Object.entries(this.levels)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'level-card' + (id === this.levelId ? ' selected' : '');
      card.innerHTML = `<strong>${level.title}</strong><p>${level.subtitle || ''}</p>`;
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
      const text = (this.levelId === 'countries' && MODE_CARD_TEXT_COUNTRIES[mode.id]) || mode;
      card.innerHTML = `<strong>${text.title}</strong><p>${text.desc}</p>`;
      card.addEventListener('click', () => {
        this.modeId = mode.id;
        this.el.modeList.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this._applyModeVisibility();
      });
      this.el.modeList.appendChild(card);
    }
  }

  _applyModeVisibility() {
    const isPuzzle = this.modeId === 'puzzle';
    const isOverview = this.modeId === 'overview';
    const isRounds = !isPuzzle && !isOverview;
    const isNameState = this.modeId === 'name-state';
    const isNeighbor = this.modeId === 'neighbor';
    const isIdentify = this.modeId === 'identify';
    const isQuiz = this.modeId === 'quiz';
    const isCityPlace = this.modeId === 'city-place';
    const isSeaIdentify = this.modeId === 'sea-identify';
    const isSeaQuiz = this.modeId === 'sea-quiz';
    // "Города и места" only gets an eligibility checklist in "найти" mode —
    // "расставь метку" always draws from the full pool, same as the old
    // separate city-pins mode used to.
    const hasEligibility =
      isQuiz || isNameState || isNeighbor || isIdentify || isSeaIdentify || isSeaQuiz || (isCityPlace && this.cityPlaceMode === 'find');
    this.el.panelPuzzleSettings.hidden = !isPuzzle;
    this.el.panelQuizSettings.hidden = !isRounds;
    this.el.panelOverviewSettings.hidden = !isOverview;
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
    this.el.adaptiveModeRow.hidden = !(isQuiz || isNameState || isNeighbor || isIdentify);
    this.el.adaptiveModeCheckbox.checked = this.adaptiveMode;
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
      const isSharedStateMode = isQuiz || isNameState || isNeighbor || isIdentify;
      const kind = isSeaIdentify || isSeaQuiz ? 'seas' : isSharedStateMode ? (this.levelId === 'countries' ? 'countries' : 'states') : this.cityPlaceEntity;
      const items = kind === 'states' || kind === 'seas' || kind === 'countries' ? level.pieces : kind === 'places' ? level.places : level.cities;
      // Adaptive mode's success streak — shown here so the player can see,
      // right where they're picking which states to include, which ones
      // are still giving them trouble in whichever mode they're setting up.
      const adaptiveScope = ADAPTIVE_SUCCESS_SCOPE_BY_MODE[this.modeId];
      const statOpts = adaptiveScope
        ? (() => {
            const stats = loadSuccessStats(this.levelId, adaptiveScope);
            return { getStat: (it) => stats[it.id] || 0, statLabel: 'Успехов' };
          })()
        : {};
      // "Назови соседа" can only ask about states that actually HAVE a
      // land neighbor (e.g. not Hawaii) — the round cap must reflect that
      // narrower pool, not the raw checklist selection, or the slider
      // could ask for more rounds than the mode can actually deliver.
      const countEligible = (selected) =>
        isNeighbor ? items.filter((it) => selected.has(it.id) && it.neighbors && it.neighbors.length > 0).length : selected.size;
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
    return this.levelId === 'countries' ? desc.replace('Штат повёрнут', 'Страна повёрнута') : desc;
  }

  _renderDifficultyList(diffs, currentId, onSelect) {
    this.el.nameStateDifficultyEl.innerHTML = '';
    for (const diff of diffs) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (diff.id === currentId ? ' selected' : '');
      card.innerHTML = `<strong>${diff.title}</strong><p>${this._countryAwareDesc(diff.desc)}</p>`;
      card.addEventListener('click', () => {
        onSelect(diff.id);
        this.el.nameStateDifficultyEl.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      this.el.nameStateDifficultyEl.appendChild(card);
    }
  }

  _renderNameStateDifficulty() {
    this._renderDifficultyList(NAME_STATE_DIFFICULTIES, this.nameStateDifficulty, (id) => {
      this.nameStateDifficulty = id;
    });
  }

  _renderNeighborDifficulty() {
    this._renderDifficultyList(NEIGHBOR_DIFFICULTIES, this.neighborDifficulty, (id) => {
      this.neighborDifficulty = id;
    });
  }

  _renderIdentifyDifficulty() {
    this._renderDifficultyList(IDENTIFY_DIFFICULTIES, this.identifyDifficulty, (id) => {
      this.identifyDifficulty = id;
    });
  }

  _renderSeaIdentifyDifficulty() {
    this._renderDifficultyList(SEA_IDENTIFY_DIFFICULTIES, this.seaIdentifyDifficulty, (id) => {
      this.seaIdentifyDifficulty = id;
    });
  }

  _renderOverviewList() {
    this.el.overviewList.innerHTML = '';
    for (const mode of OVERVIEW_MODES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (mode.id === this.overviewModeId ? ' selected' : '');
      card.innerHTML = `<strong>${mode.title}</strong><p>${mode.desc}</p>`;
      card.addEventListener('click', () => {
        this.overviewModeId = mode.id;
        this.el.overviewList.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
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
      card.innerHTML = `<strong>${preset.title}</strong><p>${preset.desc}</p>`;
      card.addEventListener('click', () => {
        this.presetId = preset.id;
        this.el.presetList.querySelectorAll('.preset-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.el.customCountRow.hidden = preset.id !== 'custom';
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
    // "Press R to replay" (see .replay-hint's keycap+reload badge in
    // win-bar) — only live while the win-bar is actually showing, so R
    // doesn't do anything unexpected mid-round or on the menu.
    // startGame() re-reads this.levelId/this.modeId/etc, which are all
    // still exactly what they were for the round that just finished, so
    // this is a genuine "same settings, go again" rather than a trip
    // back through the setup screen.
    const replay = () => {
      if (this.el.winBar.hidden) return;
      playClick();
      this.startGame();
    };
    document.addEventListener('keydown', (ev) => {
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
    });
    this.el.adaptiveModeCheckbox.addEventListener('change', (ev) => {
      this.adaptiveMode = ev.target.checked;
    });
    this.el.cityPlaceEntityCheckbox.addEventListener('change', (ev) => {
      this.cityPlaceEntity = ev.target.checked ? 'places' : 'cities';
      this._applyModeVisibility(); // rebuilds the eligibility list for the newly-chosen entity
    });
    this.el.cityPlaceModeCheckbox.addEventListener('change', (ev) => {
      this.cityPlaceMode = ev.target.checked ? 'pin' : 'find';
      this._applyModeVisibility(); // eligibility only applies to "найти", not "расставь"
    });
    this.el.quizCountInput.addEventListener('input', (ev) => {
      this.quizRounds = Number(ev.target.value);
      this.el.quizCountValue.textContent = this.quizRounds;
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
    else if (this.modeId === 'sea-identify') this._startSeaIdentify(level);
    else if (this.modeId === 'sea-quiz') this._startSeaQuiz(level);
    else if (this.modeId === 'overview') this._startOverview(level);
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
    this.el.toggleHighwaysWrap.hidden = true;    this.el.toggleHintsText.textContent = 'Подсказки';
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

    this.board = new PuzzleBoard(this.el.boardContainer, level, {
      toPlaceCount,
      scale,
      traySize,
      hintsVisible: this.hintsVisible,
      labelsVisible: this.labelsVisible,
      onProgress: (p) => this._onPuzzleProgress(p),
      onWin: () => this._onFinish(),
    });
  }

  _startQuiz(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;    this.el.quizPrompt.hidden = false;

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
      scale,
      onProgress: (p) => this._onQuizProgress(p),
      onFinish: () => this._onFinish(),
    });
  }

  _startNameState(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.toggleHighwaysWrap.hidden = true;    // No text prompt here — the "question" is the pulsing highlight on the
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
    this.el.toggleHighwaysWrap.hidden = true;    // No text prompt — the "question" is entirely on the map (highlighted
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
    this.el.toggleHighwaysWrap.hidden = true;    this.el.quizPrompt.hidden = true;

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
    this.el.toggleHighwaysWrap.hidden = true;    this.el.quizPrompt.hidden = true;

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
    this.el.toggleHighwaysWrap.hidden = true;    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Найди море или океан (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const scale = this._computeScale(level.canvas, this._availableHeight(), undefined, true);
    this.board = new SeaQuizBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
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
    this.el.toggleHighwaysWrap.hidden = true;    this.el.quizPrompt.hidden = false;

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

  _startOverview(level) {
    const overviewMode = OVERVIEW_MODES.find((m) => m.id === this.overviewModeId) || OVERVIEW_MODES[0];
    // Explicitly choosing "Полная информация" means labels ON, full stop —
    // even for the world level, where seas cluster tightly enough
    // (Mediterranean/Black/Red/Persian Gulf, Caribbean/Gulf of Mexico…)
    // that it used to look messy, so this silently forced labels off
    // regardless of what the player picked. Silently overriding an
    // explicit choice is worse than a cluttered map — "Подписи" already
    // lets anyone turn labels back off with one click.
    this.labelsVisible = overviewMode.id === 'full';
    this.citiesVisible = true;
    this.placesVisible = true;
    this.highwaysVisible = true;

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
    });
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
    this.el.boardContainer.querySelectorAll('.name-answer-bar, .city-actions').forEach((el) => { el.hidden = true; });
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
