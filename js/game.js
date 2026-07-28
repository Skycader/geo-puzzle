import { PuzzleBoard } from './puzzleBoard.js';
import { QuizBoard } from './quizBoard.js';
import { CityQuizBoard } from './cityQuizBoard.js';
import { CityPinBoard } from './cityPinBoard.js';
import { clamp } from './utils.js';
import { PRESETS, DEFAULT_CUSTOM_COUNT } from './presets.js';
import { MODES } from './modes.js';

const ROUNDS_PANEL_TEXT = {
  quiz: { heading: 'Раунд', label: 'Сколько штатов спросить', prompt: 'Найди на карте:' },
  'city-quiz': { heading: 'Раунд', label: 'Сколько городов спросить', prompt: 'Найди на карте:' },
  'city-pins': { heading: 'Раунд', label: 'Сколько городов отметить', prompt: 'Отметь на карте:' },
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
    this.customCount = DEFAULT_CUSTOM_COUNT;
    this.quizRounds = 15;
    this.hintsVisible = true;
    this.labelsVisible = true;
    this.board = null;
    this.seconds = 0;
    this.timerHandle = null;

    this._cacheDom();
    this._renderLevelList();
    this._renderModeList();
    this._renderPresetList();
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
      quizPanelHeading: document.getElementById('quiz-panel-heading'),
      quizCountLabel: document.getElementById('quiz-count-label'),
      customCountRow: document.getElementById('custom-count-row'),
      customCountInput: document.getElementById('custom-count'),
      customCountValue: document.getElementById('custom-count-value'),
      quizCountInput: document.getElementById('quiz-count'),
      quizCountValue: document.getElementById('quiz-count-value'),
      btnStart: document.getElementById('btn-start'),
      boardContainer: document.getElementById('board-container'),
      quizPrompt: document.getElementById('quiz-prompt'),
      quizPromptLabel: document.getElementById('quiz-prompt-label'),
      quizPromptName: document.getElementById('quiz-prompt-name'),
      winOverlay: document.getElementById('win-overlay'),
      winTitle: document.getElementById('win-title'),
      winStats: document.getElementById('win-stats'),
      btnAgain: document.getElementById('btn-again'),
      btnBackMenu: document.getElementById('btn-back-menu'),
      toggleHintsWrap: document.getElementById('toggle-hints-wrap'),
      toggleLabelsWrap: document.getElementById('toggle-labels-wrap'),
      toggleHints: document.getElementById('toggle-hints'),
      toggleLabels: document.getElementById('toggle-labels'),
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
    this.el.panelPuzzleSettings.hidden = !isPuzzle;
    this.el.panelQuizSettings.hidden = isPuzzle;
    if (isPuzzle) return;

    const text = ROUNDS_PANEL_TEXT[this.modeId];
    this.el.quizPanelHeading.textContent = text.heading;
    this.el.quizCountLabel.textContent = text.label;
    this.el.quizPromptLabel.textContent = text.prompt;

    const level = this.levels[this.levelId];
    const max = this.modeId === 'quiz' ? level.pieces.length : level.cities.length;
    this.quizRounds = clamp(this.quizRounds, 1, max);
    this.el.quizCountInput.max = String(max);
    this.el.quizCountInput.value = String(this.quizRounds);
    this.el.quizCountValue.textContent = this.quizRounds;
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
    this.el.btnStart.addEventListener('click', () => this.startGame());
    this.el.btnBrand.addEventListener('click', () => this._goMenu());
    this.el.btnMenu.addEventListener('click', () => this._goMenu());
    this.el.btnAgain.addEventListener('click', () => {
      this.el.winOverlay.hidden = true;
      this.startGame();
    });
    this.el.btnBackMenu.addEventListener('click', () => {
      this.el.winOverlay.hidden = true;
      this._goMenu();
    });
    this.el.customCountInput.addEventListener('input', (ev) => {
      this.customCount = Number(ev.target.value);
      this.el.customCountValue.textContent = this.customCount;
    });
    this.el.quizCountInput.addEventListener('input', (ev) => {
      this.quizRounds = Number(ev.target.value);
      this.el.quizCountValue.textContent = this.quizRounds;
    });
    this.el.toggleHints.addEventListener('change', (ev) => {
      this.hintsVisible = ev.target.checked;
      if (this.board?.setHintsVisible) this.board.setHintsVisible(this.hintsVisible);
    });
    this.el.toggleLabels.addEventListener('change', (ev) => {
      this.labelsVisible = ev.target.checked;
      if (this.board?.setLabelsVisible) this.board.setLabelsVisible(this.labelsVisible);
    });
  }

  _availableHeight(extraReserve = 0) {
    const headerH = document.querySelector('.topbar').offsetHeight || 56;
    const screenPadV = 24; // .screen-game padding-top + padding-bottom
    return window.innerHeight - headerH - screenPadV - extraReserve;
  }

  _computeScale(canvas, availH) {
    const availW = window.innerWidth - 48;
    return clamp(Math.min(availW / canvas.width, availH / canvas.height), 0.2, 1);
  }

  startGame() {
    const level = this.levels[this.levelId];
    this.el.screenMenu.hidden = true;
    this.el.screenGame.hidden = false;
    this.el.hud.hidden = false;

    if (this.board) this.board.destroy();

    if (this.modeId === 'quiz') this._startQuiz(level);
    else if (this.modeId === 'city-quiz') this._startCityQuiz(level);
    else if (this.modeId === 'city-pins') this._startCityPins(level);
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
    this.el.quizPrompt.hidden = true;

    this.el.hudLevel.textContent = `${level.title} · ${preset.title} (${toPlaceCount})`;
    this.el.hudProgress.textContent = `0/${toPlaceCount}`;
    this.el.hudGroups.textContent = 'Частей: 0';

    // split the available vertical space between the board and the tray,
    // then size tray pieces so all of them fit the tray band without it
    // needing to scroll (small piece counts get full-size icons, large
    // ones shrink to fit).
    const availH = this._availableHeight();
    const availW = window.innerWidth - 48;
    const trayBandH = clamp(availH * 0.26, 90, 220);
    const boardBandH = availH - trayBandH - 14;
    const scale = this._computeScale(level.canvas, boardBandH);
    const traySize = clamp(Math.sqrt((availW * trayBandH) / toPlaceCount) * 0.74, 30, 78);

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
    this.el.toggleLabelsWrap.hidden = true;
    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Найди штат (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const promptH = this.el.quizPrompt.offsetHeight + 10; // + gap to the map
    const scale = this._computeScale(level.canvas, this._availableHeight(promptH));
    this.board = new QuizBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      scale,
      onProgress: (p) => this._onQuizProgress(p),
      onFinish: (stats) =>
        this._onFinish(
          'РАУНД ЗАВЕРШЁН',
          `Время: ${formatTime(this.seconds)} · Ошибок: ${stats.mistakes} из ${stats.total} штатов`
        ),
    });
  }

  _startCityQuiz(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Найди город (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.textContent = 'Ошибки: 0';

    const promptH = this.el.quizPrompt.offsetHeight + 10;
    const scale = this._computeScale(level.canvas, this._availableHeight(promptH));
    this.board = new CityQuizBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      scale,
      onProgress: (p) => this._onQuizProgress(p),
      onFinish: (stats) =>
        this._onFinish(
          'РАУНД ЗАВЕРШЁН',
          `Время: ${formatTime(this.seconds)} · Ошибок: ${stats.mistakes} из ${stats.total} городов`
        ),
    });
  }

  _startCityPins(level) {
    this.el.toggleHintsWrap.hidden = true;
    this.el.toggleLabelsWrap.hidden = true;
    this.el.quizPrompt.hidden = false;

    this.el.hudLevel.textContent = `${level.title} · Расставь метки (${this.quizRounds})`;
    this.el.hudProgress.textContent = `0/${this.quizRounds}`;
    this.el.hudGroups.textContent = 'Ср. ошибка: —';

    const promptH = this.el.quizPrompt.offsetHeight + 10;
    const actionBarH = 50; // the board builds its own confirm/next bar below the map
    const scale = this._computeScale(level.canvas, this._availableHeight(promptH + actionBarH));
    this.board = new CityPinBoard(this.el.boardContainer, level, {
      rounds: this.quizRounds,
      scale,
      onProgress: (p) => this._onPinProgress(p),
      onFinish: (stats) =>
        this._onFinish(
          'РАУНД ЗАВЕРШЁН',
          `Городов: ${stats.rounds} · Средняя ошибка: ${stats.avgDistanceKm} км`
        ),
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

  _onPinProgress({ index, total, avgDistanceKm, promptRu, promptName }) {
    this.el.hudProgress.textContent = `${index}/${total}`;
    this.el.hudGroups.textContent = avgDistanceKm == null ? 'Ср. ошибка: —' : `Ср. ошибка: ${avgDistanceKm} км`;
    this.el.quizPromptName.textContent = promptName ? `${promptRu} (${promptName})` : promptRu;
  }

  _onFinish(title, statsText) {
    clearInterval(this.timerHandle);
    this.el.winTitle.textContent = title;
    this.el.winStats.textContent = statsText;
    this.el.winOverlay.hidden = false;
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
  }
}
