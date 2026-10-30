import { shuffle, levenshtein } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { t, itemName } from './i18n.js';
import { STATEHOOD_BY_ID } from '../levels/usaStatehood.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Same forgiveness as nameStateBoard.js: a typed name within one edit of a real state name (RU or
// EN) counts as that state.
const FUZZY_MATCH_MAX_DIST = 1;
const ADVANCE_CORRECT_MS = 350; // keeps the pace up — the clock is running
const ADVANCE_WRONG_MS = 1200; // long enough to read the revealed answer
const TICK_MS = 200;

// "Номера штатов": the prompt is a state's number (its order of joining the Union, 1–50,
// levels/usaStatehood.js), the player names / clicks that state. Two submodes:
//   - 'type': a big number and a text input (RU or EN name, typo-tolerant); no map shown, since a
//     highlighted state would give the answer away.
//   - 'map': the number is the prompt bar's text (set by game.js from onProgress.promptText) and
//     the player clicks the state on the map — one click answers (speed matters when timed).
// A wrong answer costs a mistake, shows the right one for a moment and moves on. The run ends when
// the time is up (optional, `timeLimit` s), when mistakes exceed `maxMistakes`, or when all 50
// states have been asked; an overlay then shows the score.
export class StateNumbersBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.scale = opts.scale || 1;
    this.submode = opts.submode === 'map' ? 'map' : 'type';
    this.timed = opts.timed !== false;
    this.timeLimit = opts.timeLimit ?? 60;
    this.maxMistakes = opts.maxMistakes ?? 3;
    this.onProgress = opts.onProgress || (() => {});
    this.onTick = opts.onTick || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    this.queue = shuffle(level.pieces.filter((p) => STATEHOOD_BY_ID.has(p.id)));
    this.index = 0;
    this.correct = 0;
    this.mistakes = 0;
    this.locked = false;
    this.finished = false;
    this.current = null;
    this.paths = new Map();
    this.matchedPiece = null;
    this._timeouts = new Set();
    this._build();
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timeouts.delete(id);
      fn();
    }, ms);
    this._timeouts.add(id);
  }

  _build() {
    this.container.innerHTML = '';
    if (this.submode === 'map') this._buildMap();
    else this._buildTypeStage();
    if (this.timed) this._startClock();
    this._nextQuestion();
  }

  // ---- 'map' submode: a plain unlabeled map, same drawing/zoom setup as quizBoard.js ----
  _buildMap() {
    const { width, height } = this.level.canvas;
    const baseW = Math.round(width * this.scale);
    const baseH = Math.round(height * this.scale);
    const { wrap, viewport } = createZoomWrap(baseW, baseH, this.container);
    this.zoomWrap = wrap;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', baseW);
    this.svg.setAttribute('height', baseH);
    this.svg.classList.add('quiz-svg');
    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', 'quiz-path');
      path.dataset.id = p.id;
      this.svg.appendChild(path);
      this.paths.set(p.id, path);
    }
    viewport.appendChild(this.svg);
    this.container.appendChild(wrap); // attached before attachZoomPan, which measures the viewport
    this.zoomCtl = attachZoomPan(viewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
      onTap: (ev) => {
        const id = ev.target?.dataset?.id;
        if (id) this._answerMap(id);
      },
    });
    this.container.appendChild(createZoomControls(this.zoomCtl));
    this.container.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));
  }

  // ---- 'type' submode: number + input, centred in the board area ----
  _buildTypeStage() {
    const stage = document.createElement('div');
    stage.className = 'sn-stage';
    stage.innerHTML = `
      <div class="sn-number"><span class="sn-number-label">${t('numbersNumberLabel')}</span><span class="sn-number-value"></span></div>
      <div class="name-answer-bar sn-answer">
        <div class="name-input-row">
          <button type="button" class="name-hint-btn" title="${t('numbersSkipTitle')}">?</button>
          <div class="name-input-wrap">
            <input type="text" class="name-input" placeholder="${t('inputPlaceholderState')}" autocomplete="off" />
            <span class="name-match-icon"></span>
          </div>
          <button type="button" class="name-confirm-btn" title="${t('confirmBtnTitle')}" disabled>✓</button>
        </div>
        <span class="name-feedback" hidden></span>
      </div>`;
    this.container.appendChild(stage);
    // game.js anchors the finish bar to board.zoomWrap (the rendered map); with no map here, the
    // whole board area plays that part.
    this.zoomWrap = this.container;
    this.stageEl = stage;
    this.numberEl = stage.querySelector('.sn-number-value');
    this.answerBar = stage.querySelector('.sn-answer');
    this.inputEl = stage.querySelector('.name-input');
    this.matchIconEl = stage.querySelector('.name-match-icon');
    this.confirmBtn = stage.querySelector('.name-confirm-btn');
    this.feedbackEl = stage.querySelector('.name-feedback');
    this.inputEl.addEventListener('input', () => this._onInput());
    this.inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this._confirmTyped();
    });
    this.confirmBtn.addEventListener('click', () => this._confirmTyped());
    stage.querySelector('.name-hint-btn').addEventListener('click', () => this._skip());
  }

  _setFeedback(text, kind) {
    if (!this.feedbackEl) return;
    this.feedbackEl.textContent = text || '';
    this.feedbackEl.hidden = !text;
    this.feedbackEl.classList.toggle('name-feedback-correct', kind === 'correct');
    this.feedbackEl.classList.toggle('name-feedback-wrong', kind === 'wrong');
  }

  _numberOf(piece) {
    return STATEHOOD_BY_ID.get(piece.id).order;
  }

  _startClock() {
    this.deadline = performance.now() + this.timeLimit * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000));
      this.onTick(left);
      if (left <= 0) this._finish('time');
    };
    this._clock = setInterval(tick, TICK_MS);
    this.onTick(this.timeLimit);
  }

  _nextQuestion() {
    if (this.finished) return;
    if (this.index >= this.queue.length) return this._finish('all');
    this.locked = false;
    this.current = this.queue[this.index];
    if (this.submode === 'type') {
      this.numberEl.textContent = this._numberOf(this.current);
      this._setFeedback('');
      this.inputEl.value = '';
      this.inputEl.disabled = false;
      this.matchedPiece = null;
      this.matchIconEl.textContent = '';
      this.matchIconEl.classList.remove('name-match-yes', 'name-match-no');
      this.confirmBtn.disabled = true;
      this.inputEl.focus();
    }
    this._reportProgress();
  }

  _reportProgress() {
    this.onProgress({
      correct: this.correct,
      mistakes: this.mistakes,
      maxMistakes: this.maxMistakes,
      total: this.queue.length,
      promptText: this.current ? `№ ${this._numberOf(this.current)}` : '',
    });
  }

  // ---- answering ----
  _right() {
    this.locked = true;
    this.correct++;
    playSnap();
    this._reportProgress();
    this._later(() => {
      this.index++;
      this._nextQuestion();
    }, ADVANCE_CORRECT_MS);
  }

  // `revealText`: what to show next to the answer ('type'); the map submode highlights the state.
  _wrong() {
    this.locked = true;
    this.mistakes++;
    playError();
    this._reportProgress();
    const tooMany = this.mistakes > this.maxMistakes;
    this._later(() => {
      if (tooMany) return this._finish('mistakes');
      this.index++;
      this._nextQuestion();
    }, ADVANCE_WRONG_MS);
  }

  _answerMap(id) {
    if (this.locked || this.finished || !this.current) return;
    const path = this.paths.get(id);
    const target = this.paths.get(this.current.id);
    if (id === this.current.id) {
      path.classList.add('quiz-correct');
      this._later(() => {
        path.classList.remove('quiz-correct');
        path.classList.add('quiz-used');
      }, ADVANCE_CORRECT_MS);
      this._right();
    } else {
      path.classList.add('quiz-wrong');
      target.classList.add('quiz-hint');
      this._later(() => {
        path.classList.remove('quiz-wrong');
        target.classList.remove('quiz-hint');
        target.classList.add('quiz-used');
      }, ADVANCE_WRONG_MS - 50);
      this._wrong();
    }
  }

  // Closest real state name (RU or EN) to the typed text — same idea as nameStateBoard.js.
  _closestPiece(text) {
    const q = text.trim().toLowerCase();
    if (!q) return { piece: null, dist: Infinity };
    let best = null;
    let bestDist = Infinity;
    for (const p of this.level.pieces) {
      const d = Math.min(levenshtein(q, p.ru.toLowerCase()), levenshtein(q, p.name.toLowerCase()));
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return { piece: best, dist: bestDist };
  }

  _onInput() {
    if (this.locked) return;
    const { piece, dist } = this._closestPiece(this.inputEl.value);
    this.matchedPiece = dist <= FUZZY_MATCH_MAX_DIST ? piece : null;
    const typed = !!this.inputEl.value.trim();
    this.matchIconEl.textContent = this.matchedPiece ? '✓' : typed ? '✗' : '';
    this.matchIconEl.classList.toggle('name-match-yes', !!this.matchedPiece);
    this.matchIconEl.classList.toggle('name-match-no', !this.matchedPiece && typed);
    this.confirmBtn.disabled = !this.matchedPiece;
  }

  _reveal() {
    return `№ ${this._numberOf(this.current)} — ${itemName(this.current)}`;
  }

  _confirmTyped() {
    if (this.locked || this.finished) return;
    if (this.inputEl.value.trim() === '?') return this._skip();
    if (!this.matchedPiece) {
      // Not a recognizable state name: nudge, but it isn't a wrong answer.
      this.answerBar.classList.add('name-shake');
      this._later(() => this.answerBar.classList.remove('name-shake'), 400);
      return;
    }
    this.inputEl.disabled = true;
    this.confirmBtn.disabled = true;
    if (this.matchedPiece.id === this.current.id) {
      this._setFeedback(t('correctFeedback'), 'correct');
      this._right();
    } else {
      this._setFeedback(`${t('numbersWrongPrefix')} ${this._reveal()}`, 'wrong');
      this.answerBar.classList.add('name-shake');
      this._later(() => this.answerBar.classList.remove('name-shake'), 400);
      this._wrong();
    }
  }

  // "Не знаю": reveals the answer and counts as a mistake.
  _skip() {
    if (this.locked || this.finished) return;
    this.inputEl.disabled = true;
    this.confirmBtn.disabled = true;
    this._setFeedback(`${t('numbersWrongPrefix')} ${this._reveal()}`, 'wrong');
    this._wrong();
  }

  // ---- end of the run ----
  _finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.locked = true;
    clearInterval(this._clock);
    for (const id of this._timeouts) clearTimeout(id);
    this._timeouts.clear();
    if (this.stageEl) this.stageEl.hidden = true;
    const titleKey = reason === 'time' ? 'numbersResultTime' : reason === 'mistakes' ? 'numbersResultMistakes' : 'numbersResultAll';
    const card = document.createElement('div');
    card.className = 'sn-result';
    card.innerHTML = `
      <div class="sn-result-title">${t(titleKey)}</div>
      <div class="sn-result-score"><b>${this.correct}</b><span>${t('numbersResultOf')} ${this.queue.length}</span></div>
      <div class="sn-result-line">${t('mistakes')}: ${this.mistakes}</div>`;
    this.container.appendChild(card);
    this.resultEl = card;
    setTimeout(() => playWin(), 100);
    this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.queue.length, reason });
  }

  destroy() {
    clearInterval(this._clock);
    for (const id of this._timeouts) clearTimeout(id);
    this._timeouts.clear();
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
