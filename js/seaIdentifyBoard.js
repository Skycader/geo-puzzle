import { shuffle, clamp, levenshtein } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { buildStateBackground } from './mapBackground.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OPTION_COUNT = 4;
const ADVANCE_DELAY_MS = 650;
const WRONG_FLASH_MS = 500;
const FUZZY_MATCH_MAX_DIST = 1;

// "Определи море или океан" — started as a fork of identifyStateBoard.js's
// isolated-shape-crop, but seas don't work the same way states do: a
// state's outline is self-contained and recognizable on its own, while a
// sea's shape IS its coastline — cropping away the land left the target
// floating in blank space (looked like missing geography, e.g. "no
// Africa" for a sea bordering it). So this instead shows the whole world
// map (like seaQuizBoard.js) with land context and the target sea
// highlighted, the same yellow-glow language as every other board's
// post-mistake hint reveal (.quiz-path.quiz-hint in style.css) — just
// shown proactively here since the round IS "identify this highlighted
// shape", not "find and click it". Same fuzzy typed-answer matching
// against BOTH `.ru` and `.name` as before (accepts English names for
// free). Only two difficulty tiers (no rotated/hardcore third tier —
// wasn't asked for here, and a lot of these shapes are already
// irregular/hard to place at a glance without adding rotation on top).
export class SeaIdentifyBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.difficulty = opts.difficulty === 'hard' ? 'hard' : 'easy';
    this.scale = opts.scale || 1;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    const pool = opts.eligibleIds && opts.eligibleIds.size ? level.pieces.filter((p) => opts.eligibleIds.has(p.id)) : level.pieces;
    const rounds = clamp(opts.rounds ?? 15, 1, pool.length);
    this.queue = shuffle(pool).slice(0, rounds);
    this.index = 0;
    this.correct = 0;
    this.mistakes = 0;
    this.locked = false;
    this.current = null;
    this.wrongOptionIds = new Set();
    this.roundNeededHelp = false;
    this.matchedPiece = null;
    this.zoomWrap = null;
    this.zoomCtl = null;

    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this._buildAnswerBar();
    this._nextQuestion();
  }

  _buildAnswerBar() {
    const bar = document.createElement('div');
    bar.className = 'name-answer-bar';
    if (this.difficulty === 'easy') {
      bar.innerHTML = `<div class="name-options"></div><span class="name-feedback"></span>`;
      this.optionsEl = bar.querySelector('.name-options');
    } else {
      bar.innerHTML = `
        <div class="name-input-row">
          <button type="button" class="name-hint-btn" data-action="hint" title="Не могу вспомнить — показать название">?</button>
          <div class="name-input-wrap">
            <input type="text" class="name-input" placeholder="Впиши название моря/океана..." autocomplete="off" />
            <span class="name-match-icon"></span>
          </div>
          <button type="button" class="name-confirm-btn" data-action="confirm" title="Подтвердить" disabled>✓</button>
        </div>
        <span class="name-feedback"></span>
      `;
      this.inputEl = bar.querySelector('.name-input');
      this.matchIconEl = bar.querySelector('.name-match-icon');
      this.confirmBtn = bar.querySelector('.name-confirm-btn');
      this.hintBtn = bar.querySelector('.name-hint-btn');
      this.inputEl.addEventListener('input', () => this._onInput());
      this.inputEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') this._confirmHard();
      });
      this.confirmBtn.addEventListener('click', () => this._confirmHard());
      this.hintBtn.addEventListener('click', () => this._revealHint());
    }
    this.feedbackEl = bar.querySelector('.name-feedback');
    this.container.appendChild(bar);
    this.answerBar = bar;
  }

  // Whole world map (land context + every sea outline drawn but only the
  // target one visibly highlighted), zoomed/panned like every other
  // full-map board — not cropped to this.current's own bounding box.
  _renderRoundBoard() {
    this.zoomCtl?.destroy();
    this.zoomWrap?.remove();

    const { width, height } = this.level.canvas;
    const baseW = Math.round(width * this.scale);
    const baseH = Math.round(height * this.scale);

    const { wrap, viewport } = createZoomWrap(baseW, baseH);
    this.zoomWrap = wrap;
    this.zoomViewport = viewport;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', baseW);
    this.svg.setAttribute('height', baseH);
    this.svg.classList.add('quiz-svg');
    this.svg.appendChild(buildStateBackground(this.level.land, { pathClass: 'world-bg-path' }));

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', this.current.d);
    path.setAttribute('class', 'quiz-path sea-path quiz-hint');
    this.svg.appendChild(path);

    this.zoomViewport.appendChild(this.svg);
    this.container.insertBefore(this.zoomWrap, this.answerBar);

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, { panFromAnywhere: true });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));
  }

  _nextQuestion() {
    if (this.index >= this.queue.length) {
      setTimeout(() => playWin(), 100);
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.queue.length });
      return;
    }
    this.locked = false;
    this.current = this.queue[this.index];

    this._renderRoundBoard();

    this.feedbackEl.textContent = '';
    this.wrongOptionIds.clear();
    this.roundNeededHelp = false;

    if (this.difficulty === 'easy') this._renderOptions();
    else this._resetHardInput();

    this._reportProgress();
  }

  _renderOptions() {
    const distractors = shuffle(this.level.pieces.filter((p) => p.id !== this.current.id)).slice(0, OPTION_COUNT - 1);
    const options = shuffle([this.current, ...distractors]);
    this.optionsEl.innerHTML = '';
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'name-option-btn';
      btn.textContent = opt.ru;
      btn.dataset.id = opt.id;
      btn.addEventListener('click', () => this._answerEasy(opt.id, btn));
      this.optionsEl.appendChild(btn);
    }
  }

  _onCorrect() {
    this.locked = true;
    playSnap();
    this.correct++;
    this.feedbackEl.textContent = 'Верно!';
    this.feedbackEl.classList.remove('name-feedback-wrong');
    this.feedbackEl.classList.add('name-feedback-correct');
    setTimeout(() => {
      if (this.inputEl) this.inputEl.disabled = false;
      this.index++;
      this._nextQuestion();
    }, ADVANCE_DELAY_MS);
  }

  _answerEasy(id, btn) {
    if (this.locked || this.wrongOptionIds.has(id)) return;
    if (id === this.current.id) {
      btn.classList.add('name-option-correct');
      for (const b of this.optionsEl.querySelectorAll('.name-option-btn')) b.disabled = true;
      this._onCorrect();
    } else {
      this.wrongOptionIds.add(id);
      this.roundNeededHelp = true;
      btn.classList.add('name-option-wrong');
      btn.disabled = true;
      playError();
      this.mistakes++;
      this.feedbackEl.textContent = 'Не то море/океан — попробуй ещё';
      this.feedbackEl.classList.remove('name-feedback-correct');
      this.feedbackEl.classList.add('name-feedback-wrong');
      this._reportProgress();
    }
  }

  // Checks against both `.ru` and `.name` (English) — same helper as every
  // other typed-answer board here, which is also what makes accepting
  // English names "free": nothing sea-specific needed for that.
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
    const matched = dist <= FUZZY_MATCH_MAX_DIST ? piece : null;
    this.matchedPiece = matched;
    this.matchIconEl.textContent = matched ? '✓' : this.inputEl.value.trim() ? '✗' : '';
    this.matchIconEl.classList.toggle('name-match-yes', !!matched);
    this.matchIconEl.classList.toggle('name-match-no', !matched && !!this.inputEl.value.trim());
    this.confirmBtn.disabled = !matched;
  }

  _revealHint() {
    if (this.locked || !this.current) return;
    this.roundNeededHelp = true;
    this.feedbackEl.textContent = `Ответ: ${this.current.ru} (${this.current.name})`;
    this.feedbackEl.classList.remove('name-feedback-correct', 'name-feedback-wrong');
  }

  _resetHardInput() {
    this.inputEl.value = '';
    this.matchedPiece = null;
    this.matchIconEl.textContent = '';
    this.matchIconEl.classList.remove('name-match-yes', 'name-match-no');
    this.confirmBtn.disabled = true;
    this.inputEl.focus();
  }

  _confirmHard() {
    if (this.inputEl.value === '?') this._revealHint();
    if (this.locked || !this.matchedPiece) return;
    if (this.matchedPiece.id === this.current.id) {
      this.inputEl.disabled = true;
      this.confirmBtn.disabled = true;
      this._onCorrect();
    } else {
      this.roundNeededHelp = true;
      playError();
      this.mistakes++;
      this.feedbackEl.textContent = `«${this.matchedPiece.ru}» — не то, попробуй ещё`;
      this.feedbackEl.classList.remove('name-feedback-correct');
      this.feedbackEl.classList.add('name-feedback-wrong');
      this.answerBar.classList.add('name-shake');
      setTimeout(() => this.answerBar.classList.remove('name-shake'), WRONG_FLASH_MS);
      this._reportProgress();
    }
  }

  _reportProgress() {
    this.onProgress({
      index: this.index + 1,
      total: this.queue.length,
      mistakes: this.mistakes,
    });
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
