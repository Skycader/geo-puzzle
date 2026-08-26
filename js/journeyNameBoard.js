import { levenshtein, unionBBox, pieceStrokeWidth } from './utils.js';
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
    this.chain = opts.chain || [];
    // The states to actually guess, in order — excludes both endpoints
    // (they're given, shown on the map already).
    this.toGuess = this.chain.slice(1, -1);
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
    this.svg.style.setProperty('--piece-stroke-width', pieceStrokeWidth(this.level));

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <linearGradient id="piece-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--piece-a)" />
        <stop offset="1" stop-color="var(--piece-b)" />
      </linearGradient>`;
    this.svg.appendChild(defs);

    // Route skeleton — always fully visible, bright red, right from the
    // start: dots at every stop's true centroid, connected by a dashed
    // line, in chain order. NOT real highway geometry: an earlier version
    // drew the actual clipped road, but for a long, many-hop chain that
    // routinely produced visible gaps and stray backtracking branches
    // (the per-hop clip picking up unrelated loops of the same physical
    // highway elsewhere within a big state's bounding box). A straight
    // dot-to-dot dashed line can't have either problem — it only needs
    // each state's own real centroid, always connects, never doubles
    // back. Uses this.chain (every stop, not just this.hops's endpoints)
    // since dot positions are shown for ALL stops from the start, even
    // ones not yet named — it's the STATES (their real shape+label) that
    // appear progressively as each is correctly guessed (see
    // _revealState below), not the route itself.
    const routeLayer = document.createElementNS(SVG_NS, 'g');
    routeLayer.setAttribute('class', 'journey-route-layer');
    const chainPieces = this.chain.map((id) => this.level.pieces.find((p) => p.id === id)).filter(Boolean);
    if (chainPieces.length > 1) {
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', 'M ' + chainPieces.map((p) => `${p.cx},${p.cy}`).join(' L '));
      line.setAttribute('class', 'journey-route-line');
      routeLayer.appendChild(line);
    }
    for (const p of chainPieces) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', p.cx);
      dot.setAttribute('cy', p.cy);
      dot.setAttribute('class', 'journey-route-dot');
      routeLayer.appendChild(dot);
    }
    this.svg.appendChild(routeLayer);

    // Given states, drawn immediately — the in-between ones (this.toGuess)
    // are added one at a time by _revealState as they're correctly named,
    // not built here.
    this.stateLayer = document.createElementNS(SVG_NS, 'g');
    this.stateLayer.setAttribute('class', 'journey-state-layer');
    this.svg.appendChild(this.stateLayer);
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

    // Frames the WHOLE chain (both endpoints + every in-between state),
    // not just the 2 endpoints — the road is fully visible from the start
    // (see above), so the camera needs to already show where it leads;
    // otherwise a correctly-named state revealed off-screen would pop in
    // somewhere the player can't even see.
    const chainBBoxes = [this.startPiece.bbox, this.endPiece.bbox, ...this.toGuess.map((id) => this.level.pieces.find((p) => p.id === id)?.bbox).filter(Boolean)];
    this.zoomCtl.focusOnBBox(unionBBox(chainBBoxes), {
      pad: 1,
      animate: false,
      avoidBottomPx: this.answerBar.offsetHeight,
    });
    this._rescaleLabels(this.zoomCtl.getZoom());

    this._nextStep();
  }

  _buildStatePiece(data, { animate = false } = {}) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data.d);
    path.setAttribute('class', animate ? 'piece-shape journey-state-reveal' : 'piece-shape');
    path.setAttribute('fill', 'url(#piece-grad)');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${data.ru} (${data.name})`;
    path.appendChild(title);
    this.stateLayer.appendChild(path);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', data.cx);
    label.setAttribute('y', data.cy);
    label.setAttribute('class', animate ? 'piece-label journey-state-reveal' : 'piece-label');
    label.textContent = data.ru;
    this.stateLayer.appendChild(label);
    this.labelEls.push(label);
  }

  _buildEndpointPiece(data) {
    this._buildStatePiece(data);
  }

  // Called from _confirm() the moment a state is correctly named — makes
  // its real shape pop into existence at its true position on the already-
  // fully-visible road, instead of the round only showing "Верно!" text
  // with no visual change to the map itself.
  _revealState(id) {
    const data = this.level.pieces.find((p) => p.id === id);
    if (!data) return;
    this._buildStatePiece(data, { animate: true });
    // A label added just now needs its font-size set immediately (it
    // wasn't on the map yet for the last _rescaleLabels call to reach).
    this._rescaleLabels(this.zoomCtl.getZoom());
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
      this._revealState(targetId);
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
