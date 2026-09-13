import { clamp, shuffle } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { flyCoinToBalance } from './coins.js';
import { REWARDS } from './constants.js';
import { t, itemName } from './i18n.js';
import usaOutline from '../levels/usaOutline.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Same red->green interpolation as js/cityPinBoard.js's hot/cold pin —
// reused here for the medium-tier drag tint, see openspec's design.md
// ("почти вся механика уже есть... просто ни разу не скомбинирована").
const RED = [220, 50, 47];
const GREEN = [133, 153, 0];
function lerpColor(frac) {
  const r = Math.round(RED[0] + (GREEN[0] - RED[0]) * frac);
  const g = Math.round(RED[1] + (GREEN[1] - RED[1]) * frac);
  const b = Math.round(RED[2] + (GREEN[2] - RED[2]) * frac);
  return `rgb(${r},${g},${b})`;
}

// Easy's tolerance is a FRACTION of each state's own "equivalent radius"
// (sqrt(area/π) — radius of a circle with the same real area), not a flat
// km number — a flat km tolerance would make Rhode Island effectively
// impossible and Texas trivial at the same setting, and Easy has no
// numeric feedback anyway (just the arrow), so per-state scaling doesn't
// need to be legible as a number. Medium/Hard/Custom went the other way
// (see js/modes.js's PLACE_STATE_TOLERANCE_KM) — a flat, player-set km
// value, exposed as a slider, since those tiers DO show/imply a concrete
// number and the player wanted direct control over it.
const EASY_TOLERANCE_FRACTION = 0.5;
const HEARTS_START = 3;
// Color-tint distance reference for medium's hot/cold feedback — beyond
// this many tolerance-radii away reads as fully red, same "some sane cap,
// not infinite" reasoning as cityPinBoard.js's MAX_DISTANCE_KM.
const HOTCOLD_RADII = 6;

const HEART_PATH =
  'M12 21s-7.5-4.6-10.1-9.1C.4 9.6 1 6.4 3.6 4.9c2.2-1.3 4.8-.7 6.4 1.1.6.7 1.4 1.7 2 2.5.6-.8 1.4-1.8 2-2.5 1.6-1.8 4.2-2.4 6.4-1.1 2.6 1.5 3.2 4.7 1.7 7-2.6 4.5-10.1 9.1-10.1 9.1z';

// The outline's own bbox, padded a bit so the silhouette doesn't touch the
// viewport edges — used for BOTH the SVG's viewBox (below) and js/game.js's
// scale computation (_startPlaceState), so the two stay in sync. Every
// other USA-level mode sizes its SVG to the full level.canvas, which
// reserves large unused margins for the Alaska/Hawaii inset boxes this
// mode's outline doesn't have; those modes fill that space with all-50
// content so it never reads as empty. Here it would sit blank, visibly
// darker than the outline's own filled area — like a smaller box inset
// into a bigger frame (found via user bug report). Fitting the viewBox to
// just the outline's bbox instead removes that dead space entirely.
const BBOX_PAD_FRAC = 0.06;
export function outlineViewBox() {
  const [bx0, by0, bx1, by1] = usaOutline.bbox;
  const padX = (bx1 - bx0) * BBOX_PAD_FRAC;
  const padY = (by1 - by0) * BBOX_PAD_FRAC;
  return { x: bx0 - padX, y: by0 - padY, width: bx1 - bx0 + 2 * padX, height: by1 - by0 + 2 * padY };
}

// "Расположи штат" — a session of several rounds (same "N rounds per
// session" shape as every other USA-level mode — quizBoard.js,
// nameStateBoard.js, etc. — not a one-shot single placement), each
// handing the player one random mainland state (Alaska/Hawaii excluded,
// same `.inset` flag js/game.js's _startJourney already uses to skip
// them) as a draggable real SVG piece, offset away from its true position
// on a gray, border-less USA silhouette (levels/usaOutline.js). Reuses
// js/cityPinBoard.js's distance/color technique (just applied to a
// shape's centroid instead of a pin) and js/puzzleBoard.js's
// translate-offset drag technique (a piece's `d` is already drawn at its
// TRUE canvas position, so dragging is just moving an offset — offset
// (0,0) IS the correct answer).
export class StatePlacementBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.levelId = opts.levelId;
    this.scale = opts.scale || 1;
    this.difficulty = ['medium', 'hard', 'custom'].includes(opts.difficulty) ? opts.difficulty : 'easy';
    // Only meaningful for medium/hard/custom (js/game.js's tolerance
    // slider) — falls back to a sane default if omitted so a stale saved
    // setting or a direct-construction call can't leave it undefined.
    this.toleranceKm = Number.isFinite(opts.toleranceKm) ? opts.toleranceKm : 100;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    const candidates = level.pieces.filter((p) => !p.inset);
    const rounds = clamp(opts.rounds ?? 15, 1, candidates.length);
    this.queue = shuffle(candidates).slice(0, rounds);
    this.index = 0;
    this.piece = null;

    this.hearts = HEARTS_START;
    this.solved = false;
    this.failed = false;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dragging = false;

    this.roundsPassed = 0;
    this.totalErrorKm = 0;
    this.answeredRounds = 0;

    this._build();
  }

  // Places the piece's initial offset far enough from (0,0) — true
  // position — that the round never starts pre-solved: a random point
  // inside the blank silhouette's own bbox, retried until it's at least
  // 3 tolerance-radii away (generous margin, matters most on the easy
  // tier where the tolerance itself is already large) AND not hidden
  // behind one of the floating overlays (action bar, zoom controls, scale
  // bar) — found via live testing: a state spawning under the bottom bar
  // or the zoom-controls strip renders fully covered and undraggable.
  _pickStartOffset() {
    const [bx0, by0, bx1, by1] = usaOutline.bbox;
    const minDist = Math.max(this.toleranceNative * 3, 40);
    const keepoutRects = this._uiKeepoutRects();
    for (let i = 0; i < 80; i++) {
      const x = bx0 + Math.random() * (bx1 - bx0);
      const y = by0 + Math.random() * (by1 - by0);
      const ox = x - this.piece.cx;
      const oy = y - this.piece.cy;
      if (Math.hypot(ox, oy) < minDist) continue;
      if (this._pointUnderUi(x, y, keepoutRects)) continue;
      return { ox, oy };
    }
    // Defensive fallback (shouldn't be reachable — the bbox is far bigger
    // than any single state's tolerance radius): offset by the bbox's own
    // width, guaranteed clear of (0,0). Doesn't re-check the UI keepout —
    // by this point 80 random draws already failed, so the viewport is
    // unusually small; better to show the piece somewhere than not at all.
    return { ox: bx1 - bx0, oy: 0 };
  }

  // Current screen-space rects of the floating overlays that sit on top of
  // the map. Recomputed each round (not cached) since they don't move but
  // this keeps the logic simple and cheap either way.
  _uiKeepoutRects() {
    return [this.actionBar, this.zoomControlsEl, this.scaleBarEl].filter(Boolean).map((el) => el.getBoundingClientRect());
  }

  // Would a piece centered at native (x,y) render underneath one of the
  // given screen-space rects? MARGIN is a rough allowance for the piece's
  // own rendered size/label so small states don't just barely peek out
  // from an overlay's edge.
  _pointUnderUi(nativeX, nativeY, rects) {
    if (!rects.length) return false;
    const svgRect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    const sx = svgRect.left + ((nativeX - vb.x) / vb.width) * svgRect.width;
    const sy = svgRect.top + ((nativeY - vb.y) / vb.height) * svgRect.height;
    const MARGIN = 24;
    return rects.some((r) => sx >= r.left - MARGIN && sx <= r.right + MARGIN && sy >= r.top - MARGIN && sy <= r.bottom + MARGIN);
  }

  _build() {
    const vb = outlineViewBox();
    this.container.innerHTML = '';

    const baseW = Math.round(vb.width * this.scale);
    const baseH = Math.round(vb.height * this.scale);

    const { wrap: zoomWrap, viewport: zoomViewport } = createZoomWrap(baseW, baseH, this.container);
    this.zoomWrap = zoomWrap;
    this.zoomViewport = zoomViewport;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
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

    const outlinePath = document.createElementNS(SVG_NS, 'path');
    outlinePath.setAttribute('d', usaOutline.d);
    outlinePath.setAttribute('class', 'state-placement-outline');
    this.svg.appendChild(outlinePath);

    // Reveal layer (medium/hard's "true position" flash on a failed
    // round) — cleared and rebuilt fresh each round, same role as
    // cityPinBoard.js's revealLayer.
    this.revealLayer = document.createElementNS(SVG_NS, 'g');
    this.svg.appendChild(this.revealLayer);

    // Arrow (easy only) — drawn BELOW the piece so the piece itself is
    // never obscured by its own hint.
    this.arrowEl = document.createElementNS(SVG_NS, 'path');
    this.arrowEl.setAttribute('class', 'state-placement-arrow');
    this.arrowEl.hidden = true;
    this.svg.appendChild(this.arrowEl);

    this.pieceGroup = document.createElementNS(SVG_NS, 'g');
    this.pieceGroup.setAttribute('class', 'state-placement-piece');
    this.pieceShape = document.createElementNS(SVG_NS, 'path');
    this.pieceShape.setAttribute('class', 'piece-shape placed');
    this.pieceShape.setAttribute('fill', 'url(#piece-grad)');
    this.pieceGroup.appendChild(this.pieceShape);
    this.pieceLabel = document.createElementNS(SVG_NS, 'text');
    this.pieceLabel.setAttribute('class', 'piece-label');
    this.pieceGroup.appendChild(this.pieceLabel);
    this.svg.appendChild(this.pieceGroup);

    this.pieceGroup.style.touchAction = 'none';
    this.pieceGroup.addEventListener('pointerdown', (ev) => this._onPointerDown(ev));
    this._boundMove = (ev) => this._onPointerMove(ev);
    this._boundUp = () => this._onPointerUp();

    this.zoomViewport.appendChild(this.svg);
    this.container.appendChild(this.zoomWrap);

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: false,
      onZoomChange: () => this._onZoomChange(),
    });
    this.zoomControlsEl = createZoomControls(this.zoomCtl);
    this.container.appendChild(this.zoomControlsEl);
    this.scaleBarEl = createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit });
    this.container.appendChild(this.scaleBarEl);

    this._buildActionBar();
    this._nextRound();
  }

  _buildActionBar() {
    const bar = document.createElement('div');
    bar.className = 'state-placement-bar';
    const needsCheck = this.difficulty !== 'easy';
    bar.innerHTML = `
      <span class="state-placement-prompt"></span>
      <span class="state-placement-hearts" ${needsCheck ? '' : 'hidden'}></span>
      <span class="state-placement-feedback"></span>
      <button type="button" class="btn btn-primary state-placement-check" ${needsCheck ? '' : 'hidden'}>${t('checkBtnTitle')}</button>
    `;
    this.promptEl = bar.querySelector('.state-placement-prompt');
    this.heartsEl = bar.querySelector('.state-placement-hearts');
    this.feedbackEl = bar.querySelector('.state-placement-feedback');
    this.checkBtn = bar.querySelector('.state-placement-check');
    this.checkBtn.addEventListener('click', () => this._check());
    this.container.appendChild(bar);
    this.actionBar = bar;
  }

  // Starts the next round: new random state (already shuffled into
  // this.queue, no repeats within the session), fresh hearts, fresh
  // random offset — or ends the whole session once the queue is spent.
  _nextRound() {
    if (this.index >= this.queue.length) {
      const avgErrorKm = this.answeredRounds ? Math.round(this.totalErrorKm / this.answeredRounds) : 0;
      setTimeout(() => playWin(), 100);
      this.onFinish({ roundsPassed: this.roundsPassed, total: this.queue.length, avgErrorKm });
      return;
    }
    this.piece = this.queue[this.index];
    this.hearts = HEARTS_START;
    this.solved = false;
    this.failed = false;
    this.dragging = false;
    this.revealLayer.innerHTML = '';
    this.arrowEl.hidden = true;

    if (this.difficulty === 'easy') {
      const equivRadiusKm = Math.sqrt(this.piece.area / Math.PI);
      this.toleranceNative = (equivRadiusKm / this.level.kmPerUnit) * EASY_TOLERANCE_FRACTION;
    } else {
      this.toleranceNative = this.toleranceKm / this.level.kmPerUnit;
    }
    const { ox, oy } = this._pickStartOffset();
    this.offsetX = ox;
    this.offsetY = oy;

    this.pieceShape.setAttribute('d', this.piece.d);
    this.pieceShape.style.stroke = '';
    this.pieceShape.style.filter = '';
    this.pieceGroup.classList.remove('solved', 'wrong-shake');
    this.pieceLabel.setAttribute('x', this.piece.cx);
    this.pieceLabel.setAttribute('y', this.piece.cy);
    this.pieceLabel.textContent = itemName(this.piece);
    this._renderPieceTransform();

    this.promptEl.innerHTML = `${t('statePlacementPrompt')}: <strong>${itemName(this.piece)}</strong>`;
    this.feedbackEl.textContent = '';
    this.checkBtn.hidden = this.difficulty === 'easy';
    this._updateHeartsUI();
    this._updateFeedback();
    this._reportProgress();
  }

  _updateHeartsUI() {
    if (!this.heartsEl) return;
    let html = '';
    for (let i = 0; i < HEARTS_START; i++) {
      const lost = i >= this.hearts;
      html += `<svg class="state-placement-heart${lost ? ' lost' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;
    }
    this.heartsEl.innerHTML = html;
  }

  _distanceNative() {
    return Math.hypot(this.offsetX, this.offsetY);
  }

  _invScale() {
    return 1 / (this.scale * (this.zoomCtl?.getZoom() ?? 1));
  }

  _renderPieceTransform() {
    this.pieceGroup.setAttribute('transform', `translate(${this.offsetX.toFixed(1)},${this.offsetY.toFixed(1)})`);
    const inv = this._invScale();
    this.pieceLabel.style.fontSize = `${(16 * inv).toFixed(2)}px`;
    this.pieceLabel.style.strokeWidth = `${(3.5 * inv).toFixed(2)}px`;
    if (this.difficulty === 'easy') this._renderArrow();
  }

  // Arrow from the piece's CURRENT centroid to its TRUE centroid — i.e.
  // pointing along (-offsetX, -offsetY), drawn as a fixed-length shaft (in
  // screen px, via the same inverse-zoom-scale compensation every other
  // constant-screen-size marker in this codebase uses) plus a triangular
  // head, so it reads as "go this way" without spoiling exact distance.
  _renderArrow() {
    if (this.solved || this.failed) {
      this.arrowEl.hidden = true;
      return;
    }
    const dist = this._distanceNative();
    if (dist < 0.01) {
      this.arrowEl.hidden = true;
      return;
    }
    const ux = -this.offsetX / dist;
    const uy = -this.offsetY / dist;
    const inv = this._invScale();
    const shaftLen = 26 * inv;
    const headLen = 9 * inv;
    const headW = 6 * inv;
    const cx = this.piece.cx + this.offsetX;
    const cy = this.piece.cy + this.offsetY;
    const tipX = cx + ux * shaftLen;
    const tipY = cy + uy * shaftLen;
    const baseX = tipX - ux * headLen;
    const baseY = tipY - uy * headLen;
    const perpX = -uy * headW;
    const perpY = ux * headW;
    this.arrowEl.setAttribute(
      'd',
      `M ${cx.toFixed(1)},${cy.toFixed(1)} L ${baseX.toFixed(1)},${baseY.toFixed(1)} ` +
        `M ${tipX.toFixed(1)},${tipY.toFixed(1)} L ${(baseX + perpX).toFixed(1)},${(baseY + perpY).toFixed(1)} ` +
        `L ${(baseX - perpX).toFixed(1)},${(baseY - perpY).toFixed(1)} Z`,
    );
    this.arrowEl.hidden = false;
  }

  _onZoomChange() {
    this._renderPieceTransform();
  }

  _onPointerDown(ev) {
    if (this.solved || this.failed) return;
    ev.preventDefault();
    ev.stopPropagation();
    const boardRect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    const toNative = (clientX, clientY) => ({
      x: ((clientX - boardRect.left) / boardRect.width) * vb.width + vb.x,
      y: ((clientY - boardRect.top) / boardRect.height) * vb.height + vb.y,
    });
    const start = toNative(ev.clientX, ev.clientY);
    this._dragStart = { startOffsetX: this.offsetX, startOffsetY: this.offsetY, startX: start.x, startY: start.y, toNative };
    this.dragging = true;
    this.pieceGroup.classList.add('dragging');
    window.addEventListener('pointermove', this._boundMove);
    window.addEventListener('pointerup', this._boundUp);
  }

  _onPointerMove(ev) {
    if (!this.dragging || !this._dragStart) return;
    const { startOffsetX, startOffsetY, startX, startY, toNative } = this._dragStart;
    const cur = toNative(ev.clientX, ev.clientY);
    this.offsetX = startOffsetX + (cur.x - startX);
    this.offsetY = startOffsetY + (cur.y - startY);
    this._renderPieceTransform();
    this._updateFeedback();
    if (this.difficulty === 'easy' && this._distanceNative() <= this.toleranceNative) this._solve();
  }

  _onPointerUp() {
    this.dragging = false;
    this.pieceGroup.classList.remove('dragging');
    window.removeEventListener('pointermove', this._boundMove);
    window.removeEventListener('pointerup', this._boundUp);
  }

  // Hot/cold tint (medium only) — reuses cityPinBoard.js's red->green
  // interpolation, capped at HOTCOLD_RADII tolerance-radii away. Hard
  // shows nothing at all while dragging, per the spec.
  _updateFeedback() {
    if (this.difficulty !== 'medium') return;
    const frac = clamp(1 - this._distanceNative() / (this.toleranceNative * HOTCOLD_RADII), 0, 1);
    this.pieceShape.style.stroke = lerpColor(frac);
    this.pieceShape.style.filter = `drop-shadow(0 0 ${(4 * frac + 1).toFixed(1)}px ${lerpColor(frac)})`;
  }

  _check() {
    if (this.solved || this.failed || this.difficulty === 'easy') return;
    const dist = this._distanceNative();
    if (dist <= this.toleranceNative) {
      this._solve();
      return;
    }
    this.hearts--;
    this._updateHeartsUI();
    playError();
    this.pieceGroup.classList.add('wrong-shake');
    setTimeout(() => this.pieceGroup.classList.remove('wrong-shake'), 400);
    if (this.difficulty === 'medium') {
      const distKm = Math.round(dist * this.level.kmPerUnit);
      this.feedbackEl.textContent = `${t('placementErrorLabel')}: ${distKm} ${t('kmUnit')}`;
    } else {
      this.feedbackEl.textContent = t('placementWrongLabel');
    }
    this._reportProgress();
    if (this.hearts <= 0) this._fail();
  }

  _solve() {
    this.solved = true;
    this.dragging = false;
    this.pieceGroup.classList.remove('dragging');
    window.removeEventListener('pointermove', this._boundMove);
    window.removeEventListener('pointerup', this._boundUp);
    const errorKm = this._distanceNative() * this.level.kmPerUnit;
    this.totalErrorKm += errorKm;
    this.answeredRounds++;
    this.roundsPassed++;
    this.offsetX = 0;
    this.offsetY = 0;
    this._renderPieceTransform();
    this.arrowEl.hidden = true;
    this.pieceGroup.classList.add('solved');
    playSnap();
    const reward = REWARDS[this.levelId]?.state_placement ?? 0;
    if (reward > 0) {
      const r = this.pieceShape.getBoundingClientRect();
      flyCoinToBalance(r.left + r.width / 2, r.top + r.height / 2, reward);
    }
    this.feedbackEl.textContent = t('correctFeedback');
    this.checkBtn.hidden = true;
    this._reportProgress();
    setTimeout(() => {
      this.index++;
      this._nextRound();
    }, 650);
  }

  // Reveals the true position (a faint dashed outline right where the
  // piece belongs) once all hearts are spent — same "show the answer,
  // then move on" shape as journeyNameBoard.js's rejected-guess flash,
  // just permanent for the rest of THIS round instead of timed.
  _fail() {
    this.failed = true;
    this.dragging = false;
    // Deliberately does NOT touch answeredRounds/totalErrorKm — those
    // track "average error among SOLVED rounds", a meaningless number for
    // a round that was never solved.
    window.removeEventListener('pointermove', this._boundMove);
    window.removeEventListener('pointerup', this._boundUp);
    const trueMark = document.createElementNS(SVG_NS, 'path');
    trueMark.setAttribute('d', this.piece.d);
    trueMark.setAttribute('class', 'state-placement-reveal');
    this.revealLayer.appendChild(trueMark);
    this.arrowEl.hidden = true;
    this.feedbackEl.textContent = t('placementFailedLabel');
    this.checkBtn.hidden = true;
    this._reportProgress();
    setTimeout(() => {
      this.index++;
      this._nextRound();
    }, 1400);
  }

  _reportProgress() {
    this.onProgress({
      index: this.index + 1,
      total: this.queue.length,
      roundsPassed: this.roundsPassed,
      hearts: this.hearts,
      difficulty: this.difficulty,
    });
  }

  destroy() {
    window.removeEventListener('pointermove', this._boundMove);
    window.removeEventListener('pointerup', this._boundUp);
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
