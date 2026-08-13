import { shuffle, clamp, levenshtein, weightedSampleWithoutReplacement } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { loadSuccessStats, recordOutcome } from './successStats.js';
import { addCoins } from './coins.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Distinct scope — identifying a state from its bare, isolated shape is a
// different (and typically harder) skill than "Назови штат"'s highlight-
// on-the-full-map recall, so streaks are tracked separately.
const SUCCESS_SCOPE = 'identify-states';
const OPTION_COUNT = 4;
const ADVANCE_DELAY_MS = 650;
const WRONG_FLASH_MS = 500;
const FUZZY_MATCH_MAX_DIST = 1;
const CROP_PAD_FRACTION = 0.35;
const ROTATION_MIN_DEG = 15;
const ROTATION_MAX_DEG = 345;

// "Определи штат" — a private case of "Назови соседа" (per the user), with
// the neighbor-naming and border-glow stripped out: the player is shown
// ONLY one isolated state's shape (never labeled, in any tier — unlike
// "Назови соседа"'s easy mode, the shown state itself IS the answer here)
// and has to identify it purely from its outline. Three tiers: easy
// (4-choice), medium (typed, fuzzy-matched), hard (shape additionally
// rotated a random angle, same rotation-safe cropping as neighborBoard.js).
export class IdentifyStateBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.levelId = opts.levelId;
    this.difficulty = ['medium', 'hard'].includes(opts.difficulty) ? opts.difficulty : 'easy';
    this.availW = opts.availW || window.innerWidth - 48;
    this.availH = opts.availH || window.innerHeight - 200;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    const pool =
      opts.eligibleIds && opts.eligibleIds.size ? level.pieces.filter((p) => opts.eligibleIds.has(p.id)) : level.pieces;
    const rounds = clamp(opts.rounds ?? 15, 1, pool.length);
    if (opts.adaptive && this.levelId) {
      const stats = loadSuccessStats(this.levelId, SUCCESS_SCOPE);
      const picked = weightedSampleWithoutReplacement(pool, (p) => 1 / ((stats[p.id] || 0) + 1), rounds);
      this.queue = shuffle(picked);
    } else {
      this.queue = shuffle(pool).slice(0, rounds);
    }
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
            <input type="text" class="name-input" placeholder="Впиши название штата..." autocomplete="off" />
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
    // Not appended here — this.zoomWrap doesn't exist yet (built fresh
    // every round by _renderRoundBoard, which re-parents this same
    // persistent element into whichever wrap is current). See
    // nameStateBoard.js's _buildAnswerBar for why it lives inside the map
    // at all rather than reserving its own flow height.
    this.answerBar = bar;
  }

  // Rebuilds the map area for the current round: a fresh SVG cropped/zoomed
  // to just this.current's own bounding box, containing ONLY that one path
  // — same isolated-view construction as neighborBoard.js's
  // _renderRoundBoard, minus the border-glow (nothing to point at here).
  _renderRoundBoard() {
    this.zoomCtl?.destroy();
    this.zoomWrap?.remove();

    const [minX, minY, maxX, maxY] = this.current.bbox;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let vbX, vbY, vbW, vbH;
    if (this.difficulty === 'hard') {
      // Rotation-safe square crop — see neighborBoard.js's identical
      // comment for why the bbox's half-diagonal is the right radius.
      const radius = Math.hypot(w, h) / 2;
      const side = radius * 2 * (1 + CROP_PAD_FRACTION);
      vbX = cx - side / 2;
      vbY = cy - side / 2;
      vbW = side;
      vbH = side;
    } else {
      const padX = w * CROP_PAD_FRACTION;
      const padY = h * CROP_PAD_FRACTION;
      vbX = minX - padX;
      vbY = minY - padY;
      vbW = w + padX * 2;
      vbH = h + padY * 2;
    }

    const fitScale = clamp(Math.min(this.availW / vbW, this.availH / vbH), 0.5, 40);
    const baseW = Math.round(vbW * fitScale);
    const baseH = Math.round(vbH * fitScale);

    const { wrap, viewport } = createZoomWrap(baseW, baseH);
    this.zoomWrap = wrap;
    this.zoomViewport = viewport;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    this.svg.setAttribute('width', baseW);
    this.svg.setAttribute('height', baseH);
    this.svg.classList.add('quiz-svg');

    const rotateDeg = this.difficulty === 'hard' ? ROTATION_MIN_DEG + Math.random() * (ROTATION_MAX_DEG - ROTATION_MIN_DEG) : 0;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', this.current.d);
    path.setAttribute('class', 'quiz-path');
    if (rotateDeg) path.setAttribute('transform', `rotate(${rotateDeg.toFixed(2)} ${cx} ${cy})`);
    this.svg.appendChild(path);

    this.zoomViewport.appendChild(this.svg);
    this.container.appendChild(this.zoomWrap);
    this.zoomWrap.appendChild(this.answerBar); // re-parents the persistent bar into this round's fresh wrap

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, { panFromAnywhere: true });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: fitScale, kmPerUnit: this.level.kmPerUnit }));
  }

  _nextQuestion() {
    if (this.index >= this.queue.length) {
      // Leave the last-answered state's crop on screen — see
      // neighborBoard.js's identical reasoning.
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
    if (this.levelId) recordOutcome(this.levelId, SUCCESS_SCOPE, this.current.id, this.roundNeededHelp);
    // First-pass rewards system — "Определи штат" only, for now (see
    // js/coins.js). One coin per correct answer, hint or no hint; no
    // per-source bookkeeping beyond the shared balance itself.
    addCoins(1);
    this.feedbackEl.textContent = 'Верно!';
    this.feedbackEl.classList.remove('name-feedback-wrong');
    this.feedbackEl.classList.add('name-feedback-correct');
    setTimeout(() => {
      // Re-enabling the (hard-mode-only) input HERE, before _nextQuestion()
      // rather than in a second setTimeout of its own back in _confirmHard,
      // is what guarantees it happens before _resetHardInput()'s
      // .focus() call below runs — focusing a still-disabled input is a
      // silent no-op, which was exactly the bug (focus lost every round,
      // needing a manual click) when this was two separately-scheduled
      // same-delay timers racing each other.
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
      this.feedbackEl.textContent = 'Не тот штат — попробуй ещё';
      this.feedbackEl.classList.remove('name-feedback-correct');
      this.feedbackEl.classList.add('name-feedback-wrong');
      this._reportProgress();
    }
  }

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
      this._onCorrect(); // re-enables inputEl itself, right before focusing it — see _onCorrect's comment
    } else {
      this.roundNeededHelp = true;
      playError();
      this.mistakes++;
      this.feedbackEl.textContent = `«${this.matchedPiece.ru}» — не тот штат, попробуй ещё`;
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
