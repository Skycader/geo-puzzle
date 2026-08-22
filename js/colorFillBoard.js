import { shuffle, clamp, weightedSampleWithoutReplacement } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { loadSuccessStats, recordOutcome } from './successStats.js';
import { flyCoinToBalance } from './coins.js';
import { REWARDS } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SUCCESS_SCOPE = 'colorfill-states';
const ADVANCE_DELAY_MS = 650; // pause after a state is fully colored so the last correct flash reads before moving on
const WRONG_FLASH_MS = 400;

// "Раскраска" — a random state is given, its terrain (per scripts/
// build_usa_terrain.js's 8 categories) starts blank, and the player has to
// pick the right color from the palette and click it onto each blank piece.
// A state can need anywhere from 1 (most states) to 4-5 (California, Texas,
// Alaska) correct clicks before the round advances — see
// levels/usaTerrain.js's stateCategories, computed once at build time via
// real polygon-overlap geometry rather than guessed at runtime.
//
// Deliberately no difficulty tiers (unlike puzzle/name-state/etc) — a
// round's real difficulty already varies with which state comes up (South
// Dakota: 2 pieces, California: up to 5), so filtering states by piece-
// count would just be a second, redundant difficulty axis on top of that
// natural variance.
export class ColorFillBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.levelId = opts.levelId;
    this.scale = opts.scale || 1;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});
    // { regions, stateCategories } from levels/usaTerrain.js — passed in
    // already-resolved rather than imported directly here, so this ~480KB
    // module only ever loads when this mode is actually started (see
    // game.js's _startColorFill), not on every page load the way a static
    // top-level import here would (game.js imports every board class
    // up front, regardless of which mode the player picks).
    this.terrainData = opts.terrainData;
    this.regionsByCategory = new Map(this.terrainData.regions.map((r) => [r.category, r]));

    // Hawaii has no entry in stateCategories at all (no CEC coverage) —
    // excluded from the pool entirely rather than reachable as an
    // unsolvable 0-piece round.
    const basePool = opts.eligibleIds && opts.eligibleIds.size ? level.pieces.filter((p) => opts.eligibleIds.has(p.id)) : level.pieces;
    const pool = basePool.filter((p) => this.terrainData.stateCategories[p.id]?.length);
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
    this.currentPath = null;
    this.paths = new Map();
    this.remainingCategories = new Set(); // categories still uncolored for the CURRENT round
    this.selectedCategory = null; // palette color currently "held"
    // Same role as nameStateBoard.js's roundNeededHelp — a wrong click
    // still lets the round finish, but marks it as "needed a retry" for
    // the adaptive-mode streak/coin-reward gate below.
    this.roundNeededHelp = false;

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

    // Reused every round (see _renderPieces) — only clipShape's `d` changes,
    // rather than tearing down/rebuilding the <clipPath> itself each time.
    const defs = document.createElementNS(SVG_NS, 'defs');
    const clipPath = document.createElementNS(SVG_NS, 'clipPath');
    clipPath.id = 'colorfill-clip';
    this.clipShape = document.createElementNS(SVG_NS, 'path');
    clipPath.appendChild(this.clipShape);
    defs.appendChild(clipPath);
    this.svg.appendChild(defs);

    // Plain outline context for every OTHER state — not interactive, just
    // so the rest of the country isn't blank while one state is focused.
    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', 'quiz-path colorfill-context');
      path.dataset.id = p.id;
      this.svg.appendChild(path);
      this.paths.set(p.id, path);
    }

    // The current round's blank/colorable pieces — cleared and rebuilt by
    // _renderPieces every round, clipped down to just the current state's
    // own outline (this.clipShape). One real <path> per category the
    // state actually contains, each just a clipped copy of that category's
    // existing whole-country geometry from terrainData.regions — reuses
    // the exact asset "Рельеф" already built, no new per-state geometry.
    this.pieceGroup = document.createElementNS(SVG_NS, 'g');
    this.pieceGroup.setAttribute('class', 'colorfill-piece-group');
    this.pieceGroup.setAttribute('clip-path', 'url(#colorfill-clip)');
    this.svg.appendChild(this.pieceGroup);
    this.pieceGroup.addEventListener('click', (ev) => this._onPieceClick(ev));

    this.zoomViewport.appendChild(this.svg);
    this.container.appendChild(this.zoomWrap);

    // panFromAnywhere: true — nothing on the CONTEXT layer is clickable, so
    // a press anywhere outside the current state's pieces is free to pan.
    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
    });
    this.container.appendChild(createZoomControls(this.zoomCtl));
    this.container.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this._buildPalette();
    this._nextQuestion();
  }

  _buildPalette() {
    const bar = document.createElement('div');
    bar.className = 'colorfill-palette';
    for (const region of this.terrainData.regions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'colorfill-swatch-btn';
      btn.dataset.category = region.category;
      btn.innerHTML = `<span class="colorfill-swatch" style="background: var(--terrain-${region.category})"></span><span>${region.label}</span>`;
      btn.addEventListener('click', () => this._selectCategory(region.category, btn));
      bar.appendChild(btn);
    }
    // Same "lives inside #board-container, not the oversized zoom-wrap"
    // reasoning as nameStateBoard.js's answer bar — see its own comment.
    this.container.appendChild(bar);
    this.paletteEl = bar;
  }

  _selectCategory(category, btn) {
    if (this.locked) return;
    this.selectedCategory = category;
    for (const b of this.paletteEl.querySelectorAll('.colorfill-swatch-btn')) b.classList.remove('selected');
    btn.classList.add('selected');
  }

  _nextQuestion() {
    this.currentPath?.classList.remove('colorfill-context-active');
    if (this.index >= this.queue.length) {
      setTimeout(() => playWin(), 100);
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.queue.length });
      return;
    }
    this.locked = false;
    this.current = this.queue[this.index];
    this.currentPath = this.paths.get(this.current.id);
    this.currentPath.classList.add('colorfill-context-active');
    this.selectedCategory = null;
    this.roundNeededHelp = false;
    this.paletteEl.querySelectorAll('.colorfill-swatch-btn').forEach((b) => b.classList.remove('selected'));

    this.clipShape.setAttribute('d', this.current.d);
    const categories = this.terrainData.stateCategories[this.current.id] || [];
    this.remainingCategories = new Set(categories);
    this._renderPieces(categories);

    // Same camera-carry-to-target behavior as nameStateBoard.js's own
    // focusOnBBox call — see its comment.
    this.zoomCtl.focusOnBBox(this.current.bbox, { avoidBottomPx: this.paletteEl.offsetHeight });
    this._reportProgress();
  }

  _renderPieces(categories) {
    this.pieceGroup.innerHTML = '';
    for (const category of categories) {
      const region = this.regionsByCategory.get(category);
      if (!region) continue; // shouldn't happen — stateCategories is derived from the same regions list
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', region.d);
      path.setAttribute('class', 'colorfill-piece colorfill-piece-blank');
      path.dataset.category = category;
      this.pieceGroup.appendChild(path);
    }
  }

  _onPieceClick(ev) {
    if (this.locked) return;
    const path = ev.target.closest?.('.colorfill-piece');
    if (!path) return;
    const category = path.dataset.category;
    if (!this.remainingCategories.has(category)) return; // already solved this round
    if (!this.selectedCategory) {
      // No color picked yet — nudge instead of counting as a wrong guess;
      // "click before you've chosen anything" isn't really an answer.
      path.classList.add('colorfill-piece-nudge');
      setTimeout(() => path.classList.remove('colorfill-piece-nudge'), WRONG_FLASH_MS);
      return;
    }
    // Wrong guesses are settled immediately, not re-prompted — one guess
    // per piece, then either it's colored because the player got it right,
    // or it's revealed because they didn't. There's no real benefit to
    // making the player cycle through the remaining 7 colors by trial and
    // error once a piece is already known to be wrong; a mistake already
    // counted for it. roundNeededHelp (set below) is what actually gates
    // the coin reward at round-completion time.
    const isCorrect = this.selectedCategory === category;
    path.classList.remove('colorfill-piece-blank');
    path.style.fill = `var(--terrain-${category})`;
    if (isCorrect) {
      path.classList.add('colorfill-piece-filled');
      playSnap();
    } else {
      this.roundNeededHelp = true;
      this.mistakes++;
      playError();
      // Stays visibly distinct from a self-solved piece (colorfill-piece-
      // revealed keeps a dashed border, see style.css) even after the red
      // flash fades — a quick glance at the finished state should show
      // which pieces the player actually got right.
      path.classList.add('colorfill-piece-revealed', 'colorfill-piece-wrong');
      setTimeout(() => path.classList.remove('colorfill-piece-wrong'), WRONG_FLASH_MS);
    }
    this.remainingCategories.delete(category);
    if (this.remainingCategories.size === 0) {
      this.locked = true;
      this.correct++;
      if (this.levelId) recordOutcome(this.levelId, SUCCESS_SCOPE, this.current.id, this.roundNeededHelp);
      const reward = REWARDS[this.levelId]?.colorfill ?? 0;
      if (reward > 0 && !this.roundNeededHelp) {
        const r = path.getBoundingClientRect();
        flyCoinToBalance(r.left + r.width / 2, r.top + r.height / 2, reward);
      }
      setTimeout(() => {
        this.index++;
        this._nextQuestion();
      }, ADVANCE_DELAY_MS);
    } else {
      this._reportProgress();
    }
  }

  _reportProgress() {
    this.onProgress({ index: this.index + 1, total: this.queue.length, mistakes: this.mistakes });
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
