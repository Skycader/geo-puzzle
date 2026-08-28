import { levenshtein, unionBBox, pieceStrokeWidth } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { loadSuccessStats, recordOutcome } from './successStats.js';
import { flyCoinToBalance } from './coins.js';
import { REWARDS } from './constants.js';
import { t, itemName, bilingualLabel, journeyProgressText, journeyNearestChainStateText, journeyNotAdjacentText } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SUCCESS_SCOPE = 'journey-states';
const ADVANCE_DELAY_MS = 650;
const WRONG_FLASH_MS = 500;
// How long a rejected guess's shape (not adjacent to anything accepted
// yet) stays visible as a red flash before it's removed — see
// _flashRejectedState. Deliberately much longer than WRONG_FLASH_MS
// (the answer bar's own shake, which is about the TEXT input being
// wrong) since this is showing the player WHERE the state they typed
// actually is, not just that it was rejected.
const REJECT_FLASH_MS = 3000;
// How long the "already in the chain" gold pulse animation runs — see
// _pulseAlreadyAccepted. Matches journey-state-already-pulse's own
// duration in style.css.
const ALREADY_PULSE_MS = 800;
// Same tolerance as nameStateBoard.js's identical constant — a typed name
// within 1 edit of a real state name counts as "recognized".
const FUZZY_MATCH_MAX_DIST = 1;
const LABEL_PX = 16;
const LABEL_STROKE_PX = 3.5;

// "Путешествие" · "Назови штаты" — shows only the 2 endpoint states plus
// the real highway(s) connecting them (js/game.js's _startJourney resolves
// the route via js/journeyRoute.js before constructing this board). The
// player names states in ANY order, from either endpoint, freely detouring
// off the precomputed route — a guess is accepted (drawn on the map) the
// moment it's a real neighbor (level.pieces[].neighbors) of ANY state
// already accepted (this.accepted, seeded with both endpoints), regardless
// of whether it's actually part of this.chain. The round ends the instant
// the accepted set connects start to end (_isConnected) — not when every
// this.chain state specifically has been named, since a real detour still
// counts as having made the journey. Only states that ARE part of
// this.chain earn coins/streak credit (this.toGuess) — a valid-but-off-
// chain detour is drawn (free exploration is allowed) but doesn't pay.
// A guess that borders nothing accepted yet is rejected: flashed red on
// the map for REJECT_FLASH_MS, never added to this.accepted. Re-typing a
// state that's already in this.accepted pulses its existing shape gold
// instead of being treated as either a fresh success or a mistake.
// Reuses nameStateBoard.js's typo-tolerant fuzzy-match input (levenshtein,
// FUZZY_MATCH_MAX_DIST) and answer-bar visual language.
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
    // Hard-mode toggles (js/game.js's journeyLabelStates/journeyShowDestination,
    // set via the "Назови штаты"-only checkboxes in the journey settings
    // panel) — both default true, matching this class's original behavior.
    this.labelStates = opts.labelStates !== false;
    this.showDestination = opts.showDestination !== false;
    // The states that actually earn coins/streak credit when named —
    // excludes both endpoints (they're given, shown on the map already).
    // NOT the same as "states the player is required to name" any more —
    // see the class comment.
    this.toGuess = this.chain.slice(1, -1);
    // Every state currently drawn on the map, whether or not it's part of
    // this.chain — the single source of truth both _confirm's adjacency
    // check and _isConnected's win check grow/read from. Seeded with both
    // endpoints since they're already on the map from the start — UNLESS
    // the destination is hidden ("Показывать штат назначения" off), in
    // which case it's deliberately left OUT of the seed: the round must
    // only finish once the player actually types its name (which passes
    // through the same isAdjacent-gated success path as any other guess,
    // see _confirm), not the instant some other accepted state happens to
    // border it. Building "from the destination outward" via free detours
    // (the whole point of seeding it) only makes sense once its identity
    // is actually known.
    this.accepted = new Set([this.startPiece.id, ...(this.showDestination ? [this.endPiece.id] : [])]);
    // id -> its real <path> element, so a repeat guess (_pulseAlreadyAccepted)
    // and the reject flash (_flashRejectedState, which needs the SHAPE data
    // for a state that was never accepted at all) both have somewhere to
    // look up geometry/elements by id instead of re-scanning stateLayer.
    this.stateShapeEls = new Map();
    // Count of this.toGuess entries currently in this.accepted — reported
    // as `chainIndex` in _reportProgress for game.js's existing progress
    // HUD, which just displays it as "N/total" and has no reason to care
    // that the underlying mechanic changed from a strict position index to
    // a plain count.
    this.correct = 0;
    this.mistakes = 0;
    this.locked = false;
    // Every this.chain id the hint button has ever revealed — mirrors the
    // old per-step stepNeededHelp, just keyed by state id instead of by
    // array position, since there's no single "current" position any more
    // (see _nearestUnguessedChainState). A state in this set never earns
    // coins/streak credit, whenever it's eventually actually named.
    this.chainHintsUsed = new Set();
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
    // "Показывать штат назначения" off — the destination's real shape/name
    // stays hidden (only its route dot, drawn above, marks its position)
    // until the player either names it directly or reaches it by
    // connecting through some other accepted state — see _confirm and the
    // finish path below, which both reveal it at that point.
    if (this.showDestination) this._buildEndpointPiece(this.endPiece);

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

    // Defensive, not expected in practice — every js/game.js caller picks
    // a route with at least 1 in-between state (JOURNEY_DIFFICULTIES'
    // lowest tier is minBetween: 1) — but if the two endpoints were ever
    // handed over already bordering each other, the journey is complete
    // before the player types anything; finishing immediately avoids a
    // round that's silently already won but still waiting for input.
    if (this._isConnected()) {
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.toGuess.length });
      return;
    }

    this.locked = false;
    this._setFeedback('');
    this._resetInput();
    this._updateProgressText();
    this._reportProgress();
  }

  _buildStatePiece(data, { animate = false } = {}) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data.d);
    path.setAttribute('class', animate ? 'piece-shape journey-state-reveal' : 'piece-shape');
    path.setAttribute('fill', 'url(#piece-grad)');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = bilingualLabel(data);
    path.appendChild(title);
    this.stateLayer.appendChild(path);
    this.stateShapeEls.set(data.id, path);

    // "Подписывать штаты" off — shapes still appear on the map (so the
    // player gets visual confirmation something was placed), just without
    // the name written on them.
    if (this.labelStates) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', data.cx);
      label.setAttribute('y', data.cy);
      label.setAttribute('class', animate ? 'piece-label journey-state-reveal' : 'piece-label');
      label.textContent = itemName(data);
      this.stateLayer.appendChild(label);
      this.labelEls.push(label);
    }
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
        <button type="button" class="name-hint-btn" data-action="hint" title="${t('hintBtnTitle')}">?</button>
        <div class="name-input-wrap">
          <input type="text" class="name-input" placeholder="${t('inputPlaceholderState')}" autocomplete="off" />
          <span class="name-match-icon"></span>
        </div>
        <button type="button" class="name-confirm-btn" data-action="confirm" title="${t('confirmBtnTitle')}" disabled>✓</button>
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

  // Chain progress (for coins/streak), not "are we done" — see
  // _isConnected for the actual win condition, which can trip on an
  // accepted state that ISN'T in this.chain at all.
  _updateProgressText() {
    const hideEnd = !this.showDestination && !this.stateShapeEls.has(this.endPiece.id);
    this.progressEl.textContent = journeyProgressText(this.correct, this.toGuess.length, this.startPiece, this.endPiece, hideEnd);
  }

  // BFS from the start, over the subgraph induced by this.accepted (a
  // neighbor only counts if IT is also accepted) — true the moment the
  // end is reachable. Runs after every newly-accepted state, chain member
  // or not: a real detour (Arizona/Utah in the class comment's example)
  // extends the connected component exactly the same way a chain state
  // does, and finishing the journey only cares that a real path exists,
  // not that it's the particular one this.chain happened to precompute.
  _isConnected() {
    const seen = new Set([this.startPiece.id]);
    const queue = [this.startPiece.id];
    while (queue.length) {
      const id = queue.pop();
      if (id === this.endPiece.id) return true;
      const piece = this.level.pieces.find((p) => p.id === id);
      for (const n of piece?.neighbors || []) {
        if (this.accepted.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen.has(this.endPiece.id);
  }

  // Nearest not-yet-accepted this.chain state to whatever's already
  // accepted, measured as position-distance along this.chain (index 0 =
  // start, last = end) — "nearest" so a hint always points at a state the
  // player can reach RIGHT NOW by extending from either end they've
  // already started building from, never one stranded behind other
  // unguessed chain states. Returns null once every this.chain state is
  // already accepted (nothing left to hint).
  _nearestUnguessedChainState() {
    let best = null;
    let bestDist = Infinity;
    this.toGuess.forEach((id, i) => {
      if (this.accepted.has(id)) return;
      const pos = i + 1; // this.toGuess[i] sits at this.chain[i + 1]
      for (let j = 0; j < this.chain.length; j++) {
        if (!this.accepted.has(this.chain[j])) continue;
        const d = Math.abs(pos - j);
        if (d < bestDist) {
          bestDist = d;
          best = id;
        }
      }
    });
    return best ? this.level.pieces.find((p) => p.id === best) : null;
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
    const target = this._nearestUnguessedChainState();
    if (!target) return; // every this.chain state is already accepted
    this.chainHintsUsed.add(target.id);
    this._setFeedback(journeyNearestChainStateText(target));
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
    const id = this.matchedPiece.id;

    // Third outcome, neither correct nor wrong — the state is real and
    // already part of the journey, just redundant. No mistake counted, no
    // new credit either.
    if (this.accepted.has(id)) {
      this._pulseAlreadyAccepted(id);
      this._setFeedback(t('journeyAlreadyMarked'), 'correct');
      this._resetInput();
      return;
    }

    const isAdjacent = (this.matchedPiece.neighbors || []).some((n) => this.accepted.has(n));
    if (!isAdjacent) {
      playError();
      this.mistakes++;
      this._flashRejectedState(id);
      this._setFeedback(journeyNotAdjacentText(this.matchedPiece), 'wrong');
      this.answerBar.classList.add('name-shake');
      setTimeout(() => this.answerBar.classList.remove('name-shake'), WRONG_FLASH_MS);
      this._reportProgress();
      this._resetInput();
      return;
    }

    this.locked = true;
    this.inputEl.disabled = true;
    this.confirmBtn.disabled = true;
    playSnap();
    this._revealState(id);
    this.accepted.add(id);

    // Only a real this.chain member earns coins/streak credit — a valid
    // (adjacent, drawn) detour like Arizona/Utah in the class comment's
    // example is still allowed, just doesn't pay. See the class comment.
    const isChainState = this.toGuess.includes(id);
    // Naming the hidden destination itself (only reachable this way now —
    // see the accepted-seeding comment above) isn't a "chain state" either
    // (toGuess excludes both endpoints, same as it always did), but it's
    // not an aimless detour — give it its own "Верно!" rather than the
    // "off route, no coins" wording that'd otherwise apply.
    const isRevealedDestination = id === this.endPiece.id;
    if (isChainState || isRevealedDestination) {
      if (isChainState) {
        const hadHint = this.chainHintsUsed.has(id);
        this.correct++;
        if (this.levelId) recordOutcome(this.levelId, SUCCESS_SCOPE, id, hadHint);
        const reward = REWARDS[this.levelId]?.journey ?? 0;
        if (reward > 0 && !hadHint) {
          const r = this.confirmBtn.getBoundingClientRect();
          flyCoinToBalance(r.left + r.width / 2, r.top + r.height / 2, reward);
        }
      }
      this._setFeedback(t('correctFeedback'), 'correct');
    } else {
      this._setFeedback(t('journeyOffRoute'), 'correct');
    }
    this._reportProgress();

    // Checked right after accepting, not inside the setTimeout below — the
    // win state itself (this.accepted's connectivity) is already final the
    // instant the new state is added; the delay past this point is purely
    // cosmetic (letting the reveal animation play before either finishing
    // or unlocking the input for the next guess).
    const finished = this._isConnected();
    // this.endPiece.id can only ever reach this.accepted by going through
    // this exact success path above (see the accepted-seeding comment in
    // the constructor) — so if we just got here, it's already drawn,
    // and the progress bar's "???" placeholder (if it was ever showing
    // one) is already stale; refresh it.
    this._updateProgressText();
    setTimeout(() => {
      this.inputEl.disabled = false;
      if (finished) {
        setTimeout(() => playWin(), 100);
        this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.toGuess.length });
        return;
      }
      this.locked = false;
      this._resetInput();
    }, ADVANCE_DELAY_MS);
  }

  // Re-typing a state that's already on the map — briefly pulses its
  // EXISTING shape gold (see .journey-state-already in style.css) instead
  // of drawing anything new. classList remove-then-reflow-then-add is
  // needed (not just add) so mashing the same repeat guess restarts the
  // animation each time instead of it silently no-op'ing after the first.
  _pulseAlreadyAccepted(id) {
    const el = this.stateShapeEls.get(id);
    if (!el) return;
    el.classList.remove('journey-state-already');
    void el.offsetWidth;
    el.classList.add('journey-state-already');
    setTimeout(() => el.classList.remove('journey-state-already'), ALREADY_PULSE_MS);
  }

  // A guess that doesn't border anything accepted yet — its real shape
  // flashes red at its true position for REJECT_FLASH_MS, then is removed;
  // it never joins this.accepted or this.stateShapeEls (a repeat guess of
  // the SAME rejected state re-flashes it from scratch, which is correct —
  // it's still not connected to anything).
  _flashRejectedState(id) {
    const data = this.level.pieces.find((p) => p.id === id);
    if (!data) return;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data.d);
    // piece-shape too (not just journey-state-reject) — same reason every
    // other shape in this file carries it: picks up --piece-stroke-width
    // so the border reads at the same real-world scale as everything
    // else instead of falling back to a bare 1-native-unit default.
    path.setAttribute('class', 'piece-shape journey-state-reject');
    this.stateLayer.appendChild(path);
    setTimeout(() => path.remove(), REJECT_FLASH_MS);
  }

  _reportProgress() {
    this.onProgress({ chainIndex: this.correct, total: this.toGuess.length, mistakes: this.mistakes });
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
