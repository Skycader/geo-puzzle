import { shuffle, clamp, levenshtein, weightedSampleWithoutReplacement } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { loadSuccessStats, recordOutcome } from './successStats.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Separate scope from quiz-states/name-state-states — knowing a state's
// neighbors is a distinct skill from finding or naming the state itself.
// Stats stay keyed by the SOURCE state's id (not the neighbor's), so the
// eligibility checklist's existing "Успехов" column reads as "how well do
// I know THIS state's neighbors."
const SUCCESS_SCOPE = 'neighbor-states';
const OPTION_COUNT = 4; // easy mode: 1 correct + this many distractors
const ADVANCE_DELAY_MS = 650;
const WRONG_FLASH_MS = 500;
const FUZZY_MATCH_MAX_DIST = 1;
// How much of the source state's sampled outline (as a fraction of the
// total sample count) gets highlighted as "the border facing the
// neighbor" — see _borderGlowPoints.
const BORDER_ARC_FRACTION = 0.12;
const BORDER_SAMPLE_COUNT = 60;
// Empty margin kept around the source state's own bounding box when
// cropping the view to just that one shape (as a fraction of its width/
// height) — enough room for the border-glow to read clearly without being
// clipped at the edge.
const CROP_PAD_FRACTION = 0.35;

// "Назови соседа" — unlike every other board here, this one deliberately
// shows ONLY the single state in question (cropped/zoomed to just its own
// shape), never the full map and never the neighbor itself: recognizing
// the neighbor purely from the source's shape + the glowing border is the
// whole point, so nothing else can leak into view as a shortcut. Labeled
// (easy) or unlabeled (hard, guess the shape yourself) — same axis as
// "Назови штат"'s difficulty, with the answer given the same way (multiple
// choice vs typed, fuzzy-matched).
//
// No exact border-segment geometry exists in the level data (states are
// single flattened SVG paths from independently-traced GeoJSON rings — see
// scripts/build_usa_level.js), so the glow is an approximation: the source
// path's outline is sampled into points, and the arc of points closest to
// the neighbor's centroid is highlighted. Good enough to read as "this
// side of the state" without needing new build-time geometry.
export class NeighborBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.levelId = opts.levelId;
    this.difficulty = opts.difficulty === 'hard' ? 'hard' : 'easy';
    // Raw available pixel space (not a pre-baked scale like other boards
    // take) — each round crops to a DIFFERENT native-unit bounding box (a
    // different state's own size), so the fit-to-viewport scale has to be
    // recomputed per round rather than once up front. See _renderRoundBoard.
    this.availW = opts.availW || window.innerWidth - 48;
    this.availH = opts.availH || window.innerHeight - 200;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    const eligible =
      opts.eligibleIds && opts.eligibleIds.size ? level.pieces.filter((p) => opts.eligibleIds.has(p.id)) : level.pieces;
    // States with no land neighbors (e.g. Hawaii) can't be asked about at
    // all — excluded from the pool outright, not just skipped per-round.
    const pool = eligible.filter((p) => p.neighbors && p.neighbors.length > 0);
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
    this.current = null; // source state
    this.currentNeighbor = null; // neighbor piece to be named
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
            <input type="text" class="name-input" placeholder="Впиши название соседа..." autocomplete="off" />
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

  // Samples the source path's outline and returns the polyline points (an
  // arc centered on whichever sampled point is closest to the neighbor's
  // centroid) to draw as the border-glow overlay.
  _borderGlowPoints(sourcePath, neighbor) {
    const total = sourcePath.getTotalLength();
    if (!total) return [];
    const samples = [];
    for (let i = 0; i < BORDER_SAMPLE_COUNT; i++) {
      samples.push(sourcePath.getPointAtLength((i / BORDER_SAMPLE_COUNT) * total));
    }
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const d = Math.hypot(samples[i].x - neighbor.cx, samples[i].y - neighbor.cy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const half = Math.max(1, Math.round((BORDER_ARC_FRACTION * BORDER_SAMPLE_COUNT) / 2));
    const arc = [];
    for (let off = -half; off <= half; off++) {
      const idx = (((bestIdx + off) % samples.length) + samples.length) % samples.length;
      arc.push(samples[idx]);
    }
    return arc;
  }

  // Rebuilds the entire map area for the current round: a fresh SVG,
  // cropped/zoomed to just this.current's own bounding box, containing
  // ONLY that one path — nothing else from the level is ever added to the
  // DOM here, so there's no full map and no neighbor to see, by
  // construction rather than by hiding.
  _renderRoundBoard() {
    this.zoomCtl?.destroy();
    this.zoomWrap?.remove();

    const [minX, minY, maxX, maxY] = this.current.bbox;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const padX = w * CROP_PAD_FRACTION;
    const padY = h * CROP_PAD_FRACTION;
    const vbX = minX - padX;
    const vbY = minY - padY;
    const vbW = w + padX * 2;
    const vbH = h + padY * 2;

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

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', this.current.d);
    path.setAttribute('class', 'quiz-path');
    this.svg.appendChild(path);

    const glowPoints = this._borderGlowPoints(path, this.currentNeighbor);
    if (glowPoints.length) {
      const glow = document.createElementNS(SVG_NS, 'polyline');
      glow.setAttribute('points', glowPoints.map((p) => `${p.x},${p.y}`).join(' '));
      glow.setAttribute('class', 'neighbor-border-glow');
      this.svg.appendChild(glow);
    }

    if (this.difficulty === 'easy') {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', this.current.cx);
      label.setAttribute('y', this.current.cy);
      label.setAttribute('class', 'neighbor-source-label');
      label.textContent = this.current.ru;
      this.svg.appendChild(label);
    }

    this.zoomViewport.appendChild(this.svg);
    this.container.insertBefore(this.zoomWrap, this.answerBar);

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, { panFromAnywhere: true });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: fitScale, kmPerUnit: this.level.kmPerUnit }));
  }

  _nextQuestion() {
    if (this.index >= this.queue.length) {
      // Leave the last-answered state's crop on screen instead of tearing
      // it down — same as every other board here (quizBoard.js,
      // nameStateBoard.js never clear their map on finish either), so the
      // player can keep looking at it while the win bar shows.
      setTimeout(() => playWin(), 100);
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.queue.length });
      return;
    }
    this.locked = false;
    this.current = this.queue[this.index];
    this.currentNeighbor = shuffle(this.current.neighbors.map((id) => this.level.pieces.find((p) => p.id === id)).filter(Boolean))[0];

    this._renderRoundBoard();

    this.feedbackEl.textContent = '';
    this.wrongOptionIds.clear();
    this.roundNeededHelp = false;

    if (this.difficulty === 'easy') this._renderOptions();
    else this._resetHardInput();

    this._reportProgress();
  }

  _renderOptions() {
    // Distractors exclude both the correct neighbor AND the source state
    // itself — the source is already labeled on the map (in easy mode), so
    // offering it as an option would just be confusing, not a real
    // distractor.
    const distractors = shuffle(
      this.level.pieces.filter((p) => p.id !== this.currentNeighbor.id && p.id !== this.current.id)
    ).slice(0, OPTION_COUNT - 1);
    const options = shuffle([this.currentNeighbor, ...distractors]);
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

  // No map reveal here (unlike quizBoard.js/nameStateBoard.js) — the
  // neighbor is never rendered in this mode, so feedback is text-only.
  _onCorrect() {
    this.locked = true;
    playSnap();
    this.correct++;
    if (this.levelId) recordOutcome(this.levelId, SUCCESS_SCOPE, this.current.id, this.roundNeededHelp);
    this.feedbackEl.textContent = 'Верно!';
    this.feedbackEl.classList.remove('name-feedback-wrong');
    this.feedbackEl.classList.add('name-feedback-correct');
    setTimeout(() => {
      this.index++;
      this._nextQuestion();
    }, ADVANCE_DELAY_MS);
  }

  _answerEasy(id, btn) {
    if (this.locked || this.wrongOptionIds.has(id)) return;
    if (id === this.currentNeighbor.id) {
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
      this.feedbackEl.textContent = 'Не тот сосед — попробуй ещё';
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
    this.feedbackEl.textContent = `Ответ: ${this.currentNeighbor.ru} (${this.currentNeighbor.name})`;
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
    if (this.matchedPiece.id === this.currentNeighbor.id) {
      this.inputEl.disabled = true;
      this.confirmBtn.disabled = true;
      this._onCorrect();
      setTimeout(() => {
        this.inputEl.disabled = false;
      }, ADVANCE_DELAY_MS);
    } else {
      this.roundNeededHelp = true;
      playError();
      this.mistakes++;
      this.feedbackEl.textContent = `«${this.matchedPiece.ru}» — не тот сосед, попробуй ещё`;
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
