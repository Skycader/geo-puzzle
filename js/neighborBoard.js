import { shuffle, clamp, levenshtein, weightedSampleWithoutReplacement } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { loadSuccessStats, recordOutcome } from './successStats.js';
import { flyCoinToBalance } from './coins.js';
import { REWARDS } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Separate scope from quiz-states/name-state-states — knowing a state's
// neighbors is a distinct skill from finding or naming the state itself.
// Stats stay keyed by the SOURCE state's id (not the neighbor's), so the
// eligibility checklist's existing "Успехов" column reads as "how well do
// I know THIS state's neighbors."
const SUCCESS_SCOPE = 'neighbor-states';
const OPTION_COUNT = 4; // easy mode: 1 correct + this many distractors
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
// "ultra" difficulty rotates the state by a random angle in this range —
// kept away from 0/360 (and the range is wide enough that landing near a
// multiple of 90 is rare and harmless anyway) so the rotation always
// actually removes the orientation as a recognition cue.
const ROTATION_MIN_DEG = 15;
const ROTATION_MAX_DEG = 345;

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
    this.difficulty = ['hard', 'ultra'].includes(opts.difficulty) ? opts.difficulty : 'easy';
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
    // Explicit rather than relying on the focused "Далее" button's native
    // Enter-activation — that didn't fire reliably (focus moving to a
    // <button> mid-keydown doesn't consistently pick up the SAME keypress
    // in every environment). This works regardless of what currently has
    // focus, as long as the round is actually locked/waiting to advance.
    //
    // The `ev.target === this.inputEl` guard matters: keydown BUBBLES, so
    // the exact same Enter press that just submitted a correct hard-mode
    // answer (target: inputEl, handled by its own listener, which sets
    // this.locked = true before returning) would otherwise reach this
    // document-level listener too, in that same synchronous dispatch — and
    // since this.locked is already true by then, it would immediately
    // call _advance() right after submitting, collapsing the two-step
    // confirm-then-next back into one. Skipping events whose target IS
    // the input makes sure only a genuinely SEPARATE later Enter press
    // (target has moved elsewhere by then) can advance.
    this._onKeydown = (ev) => {
      if (ev.key !== 'Enter' || ev.target === this.inputEl) return;
      if (this.locked && this.nextBtn && !this.nextBtn.hidden) {
        ev.preventDefault();
        this._advance();
      }
    };
    document.addEventListener('keydown', this._onKeydown);
  }

  _buildAnswerBar() {
    const bar = document.createElement('div');
    bar.className = 'name-answer-bar';
    if (this.difficulty === 'easy') {
      bar.innerHTML = `<div class="name-options"></div><span class="name-feedback"></span><button type="button" class="btn btn-primary name-next-btn" hidden>Далее ▶</button>`;
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
        <button type="button" class="btn btn-primary name-next-btn" hidden>Далее ▶</button>
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
    this.nextBtn = bar.querySelector('.name-next-btn');
    // Focusing this button (see _onCorrect) means a plain Enter press
    // advances too — native <button> behavior — without needing a separate
    // keydown listener for it.
    this.nextBtn.addEventListener('click', () => this._advance());
    // Not appended here — see identifyStateBoard.js's _buildAnswerBar
    // comment (same per-round zoomWrap-rebuild pattern).
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
  // DOM here, so there's no full map and no neighbor to see during the
  // guessing phase, by construction rather than by hiding.
  //
  // `reveal` (passed once the round is answered correctly — see
  // _onCorrect) switches to a DIFFERENT crop: both this.current's AND
  // this.currentNeighbor's real shapes, side by side, so the player
  // actually sees the two states touching instead of just being told the
  // neighbor's name. Never rotated (rotation was only ever meant to make
  // the *guess* harder, not to obscure the ground truth once it's been
  // answered), and both get a label regardless of difficulty.
  _renderRoundBoard(reveal = false) {
    this.zoomCtl?.destroy();
    this.zoomWrap?.remove();
    // zoom-controls/scale-bar now live in this.container (see below), not
    // this.zoomWrap — removing the wrap above no longer cleans these up,
    // so each round's stale copies need removing explicitly before the
    // fresh ones are appended.
    this.zoomControlsEl?.remove();
    this.scaleBarEl?.remove();

    const [minX, minY, maxX, maxY] = reveal ? this._combinedBbox(this.current.bbox, this.currentNeighbor.bbox) : this.current.bbox;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let vbX, vbY, vbW, vbH;
    if (this.difficulty === 'ultra' && !reveal) {
      // Rotating around the shape's own center means any point can end up
      // as far as the bbox's half-diagonal from that center, in any
      // direction — a square crop of that radius (+ padding) always
      // contains the rotated shape fully, whatever the angle turns out to
      // be, unlike the tighter axis-aligned box used below.
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

    const { wrap, viewport } = createZoomWrap(baseW, baseH, this.container);
    this.zoomWrap = wrap;
    this.zoomViewport = viewport;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    this.svg.setAttribute('width', baseW);
    this.svg.setAttribute('height', baseH);
    this.svg.classList.add('quiz-svg');

    // "ultra" wraps the path (and its border-glow, so the two rotate
    // together and stay consistent) in a <g> rotated around the shape's
    // own center — the geometry underneath (the `d` string, the sampled
    // outline points used for the glow) is never touched, only how it's
    // displayed, so _borderGlowPoints below still works in the path's own
    // untransformed coordinate space.
    const rotateDeg = this.difficulty === 'ultra' && !reveal ? ROTATION_MIN_DEG + Math.random() * (ROTATION_MAX_DEG - ROTATION_MIN_DEG) : 0;
    const group = document.createElementNS(SVG_NS, 'g');
    if (rotateDeg) group.setAttribute('transform', `rotate(${rotateDeg.toFixed(2)} ${cx} ${cy})`);
    this.svg.appendChild(group);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', this.current.d);
    path.setAttribute('class', 'quiz-path');
    group.appendChild(path);

    if (reveal) {
      // The real border is directly visible now that both actual shapes
      // are drawn — the approximate glow (built for the single-shape
      // guessing view) would only risk looking slightly misaligned next to
      // it, so it's skipped here rather than shown.
      const neighborPath = document.createElementNS(SVG_NS, 'path');
      neighborPath.setAttribute('d', this.currentNeighbor.d);
      neighborPath.setAttribute('class', 'quiz-path quiz-correct');
      group.appendChild(neighborPath);
    } else {
      const glowPoints = this._borderGlowPoints(path, this.currentNeighbor);
      if (glowPoints.length) {
        const glow = document.createElementNS(SVG_NS, 'polyline');
        glow.setAttribute('points', glowPoints.map((p) => `${p.x},${p.y}`).join(' '));
        glow.setAttribute('class', 'neighbor-border-glow');
        group.appendChild(glow);
      }
    }

    if (reveal) {
      this._addPieceLabel(this.current, 'neighbor-source-label');
      this._addPieceLabel(this.currentNeighbor, 'neighbor-source-label neighbor-reveal-label');
    } else if (this.difficulty === 'easy') {
      this._addPieceLabel(this.current, 'neighbor-source-label');
    }

    this.zoomViewport.appendChild(this.svg);
    this.container.appendChild(this.zoomWrap);
    // Appended to this.container (#board-container), NOT this.zoomWrap —
    // .zoom-wrap is deliberately oversized by "cover" fit and gets
    // clipped, so a position:absolute child anchored to ITS edges can
    // land off-screen at extreme aspect ratios. See nameStateBoard.js's
    // matching comment (same fix as .overview-panel's). Re-appending on
    // every round still re-parents the persistent bar correctly, just to
    // the stable container instead of each round's fresh wrap.
    this.container.appendChild(this.answerBar);

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, { panFromAnywhere: true });
    this.zoomControlsEl = createZoomControls(this.zoomCtl);
    this.scaleBarEl = createScaleBar(this.zoomCtl, { baseScale: fitScale, kmPerUnit: this.level.kmPerUnit });
    this.container.appendChild(this.zoomControlsEl);
    this.container.appendChild(this.scaleBarEl);
  }

  _addPieceLabel(piece, className) {
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', piece.cx);
    label.setAttribute('y', piece.cy);
    label.setAttribute('class', className);
    label.textContent = piece.ru;
    this.svg.appendChild(label);
  }

  _combinedBbox(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
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

  // Once answered correctly, actually DRAW the neighbor next to the
  // source (see _renderRoundBoard's `reveal` mode) rather than just naming
  // it — the player should see the two real shapes touching, not take the
  // adjacency on faith. No auto-advance timer either — the round now waits
  // for an explicit "Далее" click or Enter press (focusing the button
  // makes Enter work natively), so there's no rush to look before it
  // disappears.
  _onCorrect() {
    this.locked = true;
    playSnap();
    this.correct++;
    if (this.levelId) recordOutcome(this.levelId, SUCCESS_SCOPE, this.current.id, this.roundNeededHelp);
    const reward = REWARDS[this.levelId]?.neighbor ?? 0;
    if (reward > 0 && !this.roundNeededHelp) {
      const r = this.svg.getBoundingClientRect();
      flyCoinToBalance(r.left + r.width / 2, r.top + r.height / 2, reward);
    }
    this.feedbackEl.textContent = `Верно! Сосед: ${this.currentNeighbor.ru} (${this.currentNeighbor.name})`;
    this.feedbackEl.classList.remove('name-feedback-wrong');
    this.feedbackEl.classList.add('name-feedback-correct');
    this._renderRoundBoard(true);
    this.nextBtn.hidden = false;
    // Deferred to the next tick on purpose: when this fires from an Enter
    // keydown on inputEl (submitting the answer), focusing nextBtn
    // SYNCHRONOUSLY within that same handler let the browser's native
    // "Enter activates the focused button" behavior apply to THIS SAME
    // keypress — so one Enter press submitted the answer AND immediately
    // advanced, collapsing the intended two-step confirm+next into one.
    // Moving the focus() call to a fresh task lets the current keydown's
    // event/default-action handling finish first, so a second, separate
    // Enter press is what's actually needed to advance.
    setTimeout(() => this.nextBtn.focus(), 0);
  }

  // Advances to the next round — called by the "Далее" button (or Enter,
  // since focusing that button gives Enter its native activation
  // behavior). Re-enabling the (hard-mode-only) input HERE, before
  // _nextQuestion(), guarantees it happens before _resetHardInput()'s
  // .focus() call runs — focusing a still-disabled input is a silent
  // no-op, which was the bug the whole "wait for explicit advance" design
  // replaces a timer-based version of.
  _advance() {
    if (!this.locked) return;
    this.nextBtn.hidden = true;
    if (this.inputEl) this.inputEl.disabled = false;
    this.index++;
    this._nextQuestion();
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
      this._onCorrect(); // stays disabled until _advance() re-enables it — see its comment
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
    document.removeEventListener('keydown', this._onKeydown);
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
