import { PuzzleBoard } from './puzzleBoard.js';
import { QuizBoard } from './quizBoard.js';
import { NameStateBoard } from './nameStateBoard.js';
import { NeighborBoard } from './neighborBoard.js';
import { IdentifyStateBoard } from './identifyStateBoard.js';
import { CityQuizBoard } from './cityQuizBoard.js';
import { CityPinBoard } from './cityPinBoard.js';
import { OverviewBoard, OVERVIEW_PANEL_W } from './overviewBoard.js';
import { EligibilityList } from './eligibilityList.js';
import { clamp } from './utils.js';
import { PRESETS, DEFAULT_CUSTOM_COUNT } from './presets.js';
import { MODES, OVERVIEW_MODES, NAME_STATE_DIFFICULTIES, NEIGHBOR_DIFFICULTIES, IDENTIFY_DIFFICULTIES } from './modes.js';
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
// of a static per-mode lookup.
const ROUNDS_PANEL_TEXT = {
  quiz: { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: 'Найди на карте:' },
  'name-state': { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: '' },
  neighbor: { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: '' },
  identify: { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: '' },
};

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
    this._renderLevelList();
    this._renderModeList();
    this._renderPresetList();
    this._renderOverviewList();
    this._bindEvents();
    this._applyModeVisibility();
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
      btnMenu: document.getElementById('btn-menu'),
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
      winStats: document.getElementById('win-stats'),
      btnBackMenu: document.getElementById('btn-back-menu'),
      toggleHintsWrap: document.getElementById('toggle-hints-wrap'),
      toggleLabelsWrap: document.getElementById('toggle-labels-wrap'),
      toggleHints: document.getElementById('toggle-hints'),
      toggleHintsText: document.getElementById('toggle-hints-text'),
      toggleLabels: document.getElementById('toggle-labels'),
      toggleLabelsText: document.getElementById('toggle-labels-text'),
      togglePlacesWrap: document.getElementById('toggle-places-wrap'),
      togglePlaces: document.getElementById('toggle-places'),
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
        // Eligibility lists (and the round-count max they drive) are
        // per-level data — only one level exists today, but this keeps
        // switching levels from leaving a stale states/cities list behind.
        this._applyModeVisibility();
      });
      this.el.levelList.appendChild(card);
    }
  }

  _renderModeList() {
    this.el.modeList.innerHTML = '';
    for (const mode of MODES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (mode.id === this.modeId ? ' selected' : '');
      card.innerHTML = `<strong>${mode.title}</strong><p>${mode.desc}</p>`;
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
    // "Города и места" only gets an eligibility checklist in "найти" mode —
    // "расставь метку" always draws from the full pool, same as the old
    // separate city-pins mode used to.
    const hasEligibility = isQuiz || isNameState || isNeighbor || isIdentify || (isCityPlace && this.cityPlaceMode === 'find');
    this.el.panelPuzzleSettings.hidden = !isPuzzle;
    this.el.panelQuizSettings.hidden = !isRounds;
    this.el.panelOverviewSettings.hidden = !isOverview;
    this.el.quizEligibleWrap.hidden = !hasEligibility;
    this.el.nameStateDifficultyEl.hidden = !(isNameState || isNeighbor || isIdentify);
    // Each of these three modes has its own differently-sized difficulty
    // list (2/3/3 tiers — NAME_STATE_DIFFICULTIES / NEIGHBOR_DIFFICULTIES /
    // IDENTIFY_DIFFICULTIES) sharing the same panel element — re-render it
    // for whichever mode is now active so the right cards (and the right
    // one marked "selected") show up.
    if (isNameState) this._renderNameStateDifficulty();
    else if (isNeighbor) this._renderNeighborDifficulty();
    else if (isIdentify) this._renderIdentifyDifficulty();
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

    const text = isCityPlace ? this._cityPlaceRoundsText() : ROUNDS_PANEL_TEXT[this.modeId];
    this.el.quizPanelHeading.textContent = text.heading;
    this.el.quizCountLabel.textContent = text.label;
    this.el.quizPromptLabel.textContent = text.prompt;

    const level = this.levels[this.levelId];
    this.eligibilityList?.destroy();
    this.eligibilityList = null;

    if (hasEligibility) {
      const kind = isQuiz || isNameState || isNeighbor || isIdentify ? 'states' : this.cityPlaceEntity;
      const items = kind === 'states' ? level.pieces : kind === 'places' ? level.places : level.cities;
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

  _renderDifficultyList(diffs, currentId, onSelect) {
    this.el.nameStateDifficultyEl.innerHTML = '';
    for (const diff of diffs) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (diff.id === currentId ? ' selected' : '');
      card.innerHTML = `<strong>${diff.title}</strong><p>${diff.desc}</p>`;
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
    this.el.btnBrand.addEventListener('click', () => this._goMenu());
    this.el.btnMenu.addEventListener('click', () => this._goMenu());
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
  }

  _availableHeight(extraReserve = 0) {
    const headerH = document.querySelector('.topbar').offsetHeight || 64;
    const screenPadV = 32; // .screen-game padding-top + padding-bottom
    return window.innerHeight - headerH - screenPadV - extraReserve;
  }

  _computeScale(canvas, availH, availWOverride) {
    const availW = availWOverride ?? window.innerWidth - 48;
    // No reason to cap this at native (1x) resolution — it's all vector
    // SVG, so it stays crisp at any size. Filling the available screen
    // space is what makes the map (and its text/pieces) actually
    // comfortable to read instead of floating small in the middle of a
    // big monitor.
    return clamp(Math.min(availW / canvas.width, availH / canvas.height), 0.2, 3);
  }

  startGame() {
    const level = this.levels[this.levelId];
    this.el.screenMenu.hidden = true;
    this.el.screenGame.hidden = false;
    this.el.hud.hidden = false;

    if (this.board) this.board.destroy();

    if (this.modeId === 'quiz') this._startQuiz(level);
    else if (this.modeId === 'name-state') this._startNameState(level);
    else if (this.modeId === 'neighbor') this._startNeighbor(level);
    else if (this.modeId === 'identify') this._startIdentify(level);
    else if (this.modeId === 'city-place') this._startCityPlace(level);
    else if (this.modeId === 'overview') this._startOverview(level);
    else this._startPuzzle(level);

    this.seconds = 0;
    this.el.hudTimer.textContent = formatTime(0);
    clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      this.seconds++;
      this.el.hudTimer.textContent = formatTime(this.seconds);
    }, 1000);
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
    this.el.toggleHintsText.textContent = 'Подсказки';
    this.el.toggleLabelsText.textContent = 'Буквы';
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · ${preset.title} (${toPlaceCount})`;
    this.el.hudProgress.textContent = `0/${toPlaceCount}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Частей: 0';

    // split the available vertical space between the board and the tray,
    // then size tray pieces so all of them fit the tray band without it
    // needing to scroll (small piece counts get full-size icons, large
    // ones shrink to fit).
    const availH = this._availableHeight();
    const availW = window.innerWidth - 48;
    const trayBandH = clamp(availH * 0.28, 110, 280);
    const boardBandH = availH - trayBandH - 14;
    const scale = this._computeScale(level.canvas, boardBandH);
    const traySize = clamp(Math.sqrt((availW * trayBandH) / toPlaceCount) * 0.78, 38, 110);

    this.board = new PuzzleBoard(this.el.boardContainer, level, {
      toPlaceCount,
      scale,
      traySize,
      hintsVisible: this.hintsVisible,
      labelsVisible: this.labelsVisible,
      onProgress: (p) => this._onPuzzleProgress(p),
      onWin: () => this._onFinish('КАРТА СОБРАНА', `Время: ${formatTime(this.seconds)}`),
    });
  }

  _startQuiz(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Найди штат (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const promptH = this.el.quizPrompt.offsetHeight + 14; // + gap to the map
    const scale = this._computeScale(level.canvas, this._availableHeight(promptH));
    this.board = new QuizBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      scale,
      onProgress: (p) => this._onQuizProgress(p),
      onFinish: (stats) =>
        this._onFinish(
          'РАУНД ЗАВЕРШЁН',
          `Время: ${formatTime(this.seconds)} · Ошибок: ${stats.mistakes} из ${stats.total} штатов`
        ),
    });
  }

  _startNameState(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    // No text prompt here — the "question" is the pulsing highlight on the
    // map itself (see nameStateBoard.js), showing the name would give away
    // the answer.
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · Назови штат (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const answerBarH = 110; // the board builds its own options/input bar below the map
    const scale = this._computeScale(level.canvas, this._availableHeight(answerBarH));
    this.board = new NameStateBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      difficulty: this.nameStateDifficulty,
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      scale,
      onProgress: (p) => this._onNameStateProgress(p),
      onFinish: (stats) =>
        this._onFinish(
          'РАУНД ЗАВЕРШЁН',
          `Время: ${formatTime(this.seconds)} · Ошибок: ${stats.mistakes} из ${stats.total} штатов`
        ),
    });
  }

  _startNeighbor(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    // No text prompt — the "question" is entirely on the map (highlighted
    // state + glowing border), same reasoning as _startNameState.
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · Назови соседа (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    // Unlike every other board, this one crops/zooms to a DIFFERENT
    // native-unit bounding box every round (just the current state's own
    // shape, not the fixed full canvas) — so it needs the raw available
    // pixel space to fit against each round, not a single pre-computed
    // scale for the whole (unused, here) canvas.
    const answerBarH = 110; // the board builds its own options/input bar below the map
    this.board = new NeighborBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      difficulty: this.neighborDifficulty,
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      availW: window.innerWidth - 48,
      availH: this._availableHeight(answerBarH),
      onProgress: (p) => this._onNameStateProgress(p),
      onFinish: (stats) =>
        this._onFinish(
          'РАУНД ЗАВЕРШЁН',
          `Время: ${formatTime(this.seconds)} · Ошибок: ${stats.mistakes} из ${stats.total} штатов`
        ),
    });
  }

  _startIdentify(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · Определи штат (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    // Same per-round isolated-shape cropping as _startNeighbor — see its
    // comment for why raw available pixel space is passed instead of a
    // single pre-computed scale.
    const answerBarH = 110;
    this.board = new IdentifyStateBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      eligibleIds: this.eligibilityList?.getSelectedIds(),
      difficulty: this.identifyDifficulty,
      levelId: this.levelId,
      adaptive: this.adaptiveMode,
      availW: window.innerWidth - 48,
      availH: this._availableHeight(answerBarH),
      onProgress: (p) => this._onNameStateProgress(p),
      onFinish: (stats) =>
        this._onFinish(
          'РАУНД ЗАВЕРШЁН',
          `Время: ${formatTime(this.seconds)} · Ошибок: ${stats.mistakes} из ${stats.total} штатов`
        ),
    });
  }

  // Replaces the old separate _startCityQuiz/_startCityPins — one method
  // dispatching to whichever of the two (still-unchanged-in-core-logic)
  // board classes the interaction toggle picked, over whichever item pool
  // (cities or places) the entity toggle picked.
  _startCityPlace(level) {
    const isPin = this.cityPlaceMode === 'pin';
    const items = this.cityPlaceEntity === 'places' ? level.places : level.cities;
    const entityWord = this.cityPlaceEntity === 'places' ? 'мест' : 'городов';

    this.el.toggleHintsWrap.hidden = true;
    this.el.togglePlacesWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Города и места (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.hidden = false;

    if (isPin) {
      this.el.hudGroups.textContent = 'Ср. ошибка: —';
      const promptH = this.el.quizPrompt.offsetHeight + 14;
      const actionBarH = 60; // the board builds its own confirm/next bar below the map
      const scale = this._computeScale(level.canvas, this._availableHeight(promptH + actionBarH));
      this.board = new CityPinBoard(this.el.boardContainer, level, {
        rounds: this.quizRounds,
        items,
        scale,
        onProgress: (p) => this._onPinProgress(p),
        onFinish: (stats) =>
          this._onFinish('РАУНД ЗАВЕРШЁН', `${entityWord[0].toUpperCase()}${entityWord.slice(1)}: ${stats.rounds} · Средняя ошибка: ${stats.avgDistanceKm} км`),
      });
    } else {
      this.el.hudGroups.textContent = 'Ошибки: 0';
      const promptH = this.el.quizPrompt.offsetHeight + 14;
      const scale = this._computeScale(level.canvas, this._availableHeight(promptH));
      this.board = new CityQuizBoard(this.el.boardContainer, level, {
        rounds: this.quizRounds,
        items,
        eligibleIds: this.eligibilityList?.getSelectedIds(),
        scale,
        onProgress: (p) => this._onQuizProgress(p),
        onFinish: (stats) =>
          this._onFinish(
            'РАУНД ЗАВЕРШЁН',
            `Время: ${formatTime(this.seconds)} · Ошибок: ${stats.mistakes} из ${stats.total} ${entityWord}`
          ),
      });
    }
  }

  _startOverview(level) {
    const overviewMode = OVERVIEW_MODES.find((m) => m.id === this.overviewModeId) || OVERVIEW_MODES[0];
    this.labelsVisible = overviewMode.id === 'full';
    this.citiesVisible = true;
    this.placesVisible = true;

    this.el.toggleHintsWrap.hidden = false;
    this.el.toggleHintsWrap.title = 'Показать/скрыть города на карте';
    this.el.toggleHintsText.textContent = 'Города';
    this.el.toggleHints.checked = this.citiesVisible;
    this.el.toggleLabelsWrap.hidden = false;
    this.el.toggleLabelsText.textContent = 'Подписи';
    this.el.toggleLabels.checked = this.labelsVisible;
    this.el.togglePlacesWrap.hidden = false;
    this.el.togglePlaces.checked = this.placesVisible;
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · Обзор`;
    this.el.hudProgress.textContent = `${level.pieces.length} шт. · ${level.cities.length} гор. · ${level.places.length} мест`;
    this.el.hudGroups.hidden = true;

    // the side list panel eats into the map's available width — the
    // default _computeScale width doesn't know about it, so pass an
    // override (kept in sync with .overview-panel's CSS width).
    const availW = window.innerWidth - 48 - OVERVIEW_PANEL_W - 14;
    const scale = this._computeScale(level.canvas, this._availableHeight(), availW);
    this.board = new OverviewBoard(this.el.boardContainer, level, {
      scale,
      labelsVisible: this.labelsVisible,
      citiesVisible: this.citiesVisible,
      placesVisible: this.placesVisible,
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

  _onFinish(title, statsText) {
    clearInterval(this.timerHandle);
    // A small bottom bar rather than a modal — a full-screen overlay blocked
    // the finished map right when the player most wants to look at it (e.g.
    // the assembled puzzle).
    this.el.winStats.textContent = `${title} — ${statsText}`;
    this.el.winBar.hidden = false;
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
