import { levenshtein, unionBBox } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { loadSuccessStats, recordOutcome } from './successStats.js';
import { flyCoinToBalance } from './coins.js';
import { REWARDS } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SUCCESS_SCOPE = 'journey-states';
const ADVANCE_DELAY_MS = 650;
const WRONG_FLASH_MS = 500;
// Same tolerance as nameStateBoard.js's identical constant — a typed name
// within 1 edit of a real state name counts as "recognized".
const FUZZY_MATCH_MAX_DIST = 1;
const LABEL_PX = 16;
const LABEL_STROKE_PX = 3.5;

// "Путешествие" · "Назови штаты" — shows only the 2 endpoint states plus
// the real highway(s) connecting them (js/game.js's _startJourney resolves
// the route via js/journeyRoute.js before constructing this board); the
// player types every state the route passes through IN BETWEEN, in order.
// Reuses nameStateBoard.js's typo-tolerant fuzzy-match input (levenshtein,
// FUZZY_MATCH_MAX_DIST) and answer-bar visual language, but — unlike every
// other quiz-like board, which is one-answer-per-round — advances through
// several expected answers within the SAME round (this.chain), only
// finishing once the whole in-between sequence is named.
export class JourneyNameBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.levelId = opts.levelId;
    this.scale = opts.scale || 1;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    this.startPiece = level.pieces.find((p) => p.id === opts.startId);
    this.endPiece = level.pieces.find((p) => p.id === opts.endId);
    this.hops = opts.hops || [];
    // The states to actually guess, in order — excludes both endpoints
    // (they're given, shown on the map already).
    this.toGuess = (opts.chain || []).slice(1, -1);
    this.chainIndex = 0;
    this.correct = 0;
    this.mistakes = 0;
    this.locked = false;
    // Reset at the start of each chain step — mirrors nameStateBoard.js's
    // roundNeededHelp, just scoped to one step instead of one round: a
    // mistake or hint on THIS state suppresses ITS reward/streak credit
    // without affecting the other states in the chain.
    this.stepNeededHelp = false;
    this.matchedPiece = null;
    this.labelEls = [];

    this._build();
  }

  _build() {
    const { width, height } = this.level.canvas;
    this.container.innerHTML = '';

    const baseW = Math.round(width * this.scale);
    const baseH = Math.round(height * this.scale);

    const { wrap: zoomWrap, viewport: zoomViewport } = createZoomWrap(baseW, baseH, this.container);
    this.zoomWrap = zoomWrap;
    this.zoomViewport = zoomViewport;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', baseW);
    this.svg.setAttribute('height', baseH);
    this.svg.classList.add('quiz-svg');

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <linearGradient id="piece-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--piece-a)" />
        <stop offset="1" stop-color="var(--piece-b)" />
      </linearGradient>`;
    this.svg.appendChild(defs);

    // Real highway line(s) first, so the 2 given states' fills paint on
    // top of it rather than the road cutting visibly across them.
    const highwayLayer = document.createElementNS(SVG_NS, 'g');
    highwayLayer.setAttribute('class', 'journey-highway-layer');
    for (const hop of this.hops) {
      const hw = this.level.highways?.find((h) => h.id === hop.baseRouteId);
      if (!hw) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', hw.d);
      path.setAttribute('class', 'highway-path');
      highwayLayer.appendChild(path);
    }
    this.svg.appendChild(highwayLayer);

    this._buildEndpointPiece(this.startPiece);
    this._buildEndpointPiece(this.endPiece);

    this.zoomViewport.appendChild(this.svg);
    this.container.appendChild(this.zoomWrap);

    // Nothing on the map is clickable (answers come from the bar below),
    // same reasoning as nameStateBoard.js's panFromAnywhere.
    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
      onZoomChange: (zoom) => this._rescaleLabels(zoom),
    });
    this.container.appendChild(createZoomControls(this.zoomCtl));
    this.container.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this._buildAnswerBar();

    this.zoomCtl.focusOnBBox(unionBBox([this.startPiece.bbox, this.endPiece.bbox]), {
      pad: 2,
      animate: false,
      avoidBottomPx: this.answerBar.offsetHeight,
    });
    this._rescaleLabels(this.zoomCtl.getZoom());

    this._nextStep();
  }

  _buildEndpointPiece(data) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data.d);
    path.setAttribute('class', 'piece-shape');
    path.setAttribute('fill', 'url(#piece-grad)');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${data.ru} (${data.name})`;
    path.appendChild(title);
    this.svg.appendChild(path);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', data.cx);
    label.setAttribute('y', data.cy);
    label.setAttribute('class', 'piece-label');
    label.textContent = data.ru;
    this.svg.appendChild(label);
    this.labelEls.push(label);
  }

  // Keeps endpoint labels a constant on-screen size regardless of zoom —
  // same technique as puzzleBoard.js's _rescaleLabelsForZoom.
  _rescaleLabels(zoom) {
    const effScale = this.scale * zoom;
    for (const label of this.labelEls) {
      label.style.fontSize = `${(LABEL_PX / effScale).toFixed(2)}px`;
      label.style.strokeWidth = `${(LABEL_STROKE_PX / effScale).toFixed(2)}px`;
    }
  }

  _buildAnswerBar() {
    const bar = document.createElement('div');
    bar.className = 'name-answer-bar';
    bar.innerHTML = `
      <div class="name-journey-progress"></div>
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
    this.progressEl = bar.querySelector('.name-journey-progress');
    this.inputEl = bar.querySelector('.name-input');
    this.matchIconEl = bar.querySelector('.name-match-icon');
    this.confirmBtn = bar.querySelector('.name-confirm-btn');
    this.hintBtn = bar.querySelector('.name-hint-btn');
    this.feedbackEl = bar.querySelector('.name-feedback');
    this.inputEl.addEventListener('input', () => this._onInput());
    this.inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this._confirm();
    });
    this.confirmBtn.addEventListener('click', () => this._confirm());
    this.hintBtn.addEventListener('click', () => this._revealHint());

    this.container.appendChild(bar);
    this.answerBar = bar;
  }

  _setFeedback(text, kind) {
    this.feedbackEl.textContent = text || '';
    this.feedbackEl.hidden = !text;
    this.feedbackEl.classList.toggle('name-feedback-correct', kind === 'correct');
    this.feedbackEl.classList.toggle('name-feedback-wrong', kind === 'wrong');
  }

  _nextStep() {
    if (this.chainIndex >= this.toGuess.length) {
      setTimeout(() => playWin(), 100);
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.toGuess.length });
      return;
    }
    this.locked = false;
    this.stepNeededHelp = false;
    this.progressEl.textContent = `Штат ${this.chainIndex + 1} из ${this.toGuess.length}, между ${this.startPiece.ru} и ${this.endPiece.ru}`;
    this._setFeedback('');
    this._resetInput();
    this._reportProgress();
  }

  // Closest real state (by edit distance) to the current input — matched
  // against the FULL level.pieces list (all 50 states, not just the 2
  // shown), so a typo still resolves to "recognized, but wrong" the same
  // way nameStateBoard.js's identical method does.
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
    if (this.locked) return;
    this.stepNeededHelp = true;
    const target = this.level.pieces.find((p) => p.id === this.toGuess[this.chainIndex]);
    this._setFeedback(`Ответ: ${target.ru} (${target.name})`);
  }

  _resetInput() {
    this.inputEl.value = '';
    this.matchedPiece = null;
    this.matchIconEl.textContent = '';
    this.matchIconEl.classList.remove('name-match-yes', 'name-match-no');
    this.confirmBtn.disabled = true;
    this.inputEl.focus();
  }

  _confirm() {
    if (this.inputEl.value === '?') this._revealHint();
    if (this.locked || !this.matchedPiece) return;
    const targetId = this.toGuess[this.chainIndex];
    if (this.matchedPiece.id === targetId) {
      this.locked = true;
      this.inputEl.disabled = true;
      this.confirmBtn.disabled = true;
      playSnap();
      this.correct++;
      if (this.levelId) recordOutcome(this.levelId, SUCCESS_SCOPE, targetId, this.stepNeededHelp);
      const reward = REWARDS[this.levelId]?.journey ?? 0;
      if (reward > 0 && !this.stepNeededHelp) {
        const r = this.confirmBtn.getBoundingClientRect();
        flyCoinToBalance(r.left + r.width / 2, r.top + r.height / 2, reward);
      }
      this._setFeedback('Верно!', 'correct');
      setTimeout(() => {
        this.inputEl.disabled = false;
        this.chainIndex++;
        this._nextStep();
      }, ADVANCE_DELAY_MS);
    } else {
      this.stepNeededHelp = true;
      playError();
      this.mistakes++;
      this._setFeedback(`«${this.matchedPiece.ru}» — не тот штат, попробуй ещё`, 'wrong');
      this.answerBar.classList.add('name-shake');
      setTimeout(() => this.answerBar.classList.remove('name-shake'), WRONG_FLASH_MS);
      this._reportProgress();
    }
  }

  _reportProgress() {
    this.onProgress({ chainIndex: this.chainIndex, total: this.toGuess.length, mistakes: this.mistakes });
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
