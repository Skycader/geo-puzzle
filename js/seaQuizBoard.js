import { shuffle, clamp } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { buildStateBackground } from './mapBackground.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// "Найди море или океан" — a fork of quizBoard.js for levels.world's
// sea/ocean pieces: same full-map click-to-find + two-click confirm (first
// click only highlights, second click on the SAME still-highlighted shape
// submits — see quizBoard.js's _onClick for why). The one real difference:
// land is drawn as a background layer (buildStateBackground, same helper
// the city modes already use for state-outline context) so the sea shapes
// have coastlines to be found relative to, instead of floating in blank
// space.
export class SeaQuizBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
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
    this.hinted = false;
    this.selectedId = null;
    this.paths = new Map();

    this._build();
  }

  _build() {
    const { width, height } = this.level.canvas;
    this.container.innerHTML = '';

    const baseW = Math.round(width * this.scale);
    const baseH = Math.round(height * this.scale);

    const { wrap: zoomWrap, viewport: zoomViewport } = createZoomWrap(baseW, baseH);
    this.zoomWrap = zoomWrap;
    this.zoomViewport = zoomViewport;

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', baseW);
    this.svg.setAttribute('height', baseH);
    this.svg.classList.add('quiz-svg');
    this.svg.appendChild(buildStateBackground(this.level.land, { pathClass: 'world-bg-path' }));

    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', 'quiz-path sea-path');
      path.dataset.id = p.id;
      this.svg.appendChild(path);
      this.paths.set(p.id, path);
    }

    this.zoomViewport.appendChild(this.svg);
    this.container.appendChild(this.zoomWrap);

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
      onTap: (ev) => {
        const id = ev.target?.dataset?.id;
        if (id) this._onClick(id);
      },
    });
    // Appended to this.container (#board-container), not this.zoomWrap —
    // .zoom-wrap is deliberately oversized by "cover" fit and gets
    // clipped, so a position:absolute child anchored to ITS edges can
    // land off-screen at extreme aspect ratios. See nameStateBoard.js's
    // matching comment (same fix as .overview-panel's).
    this.container.appendChild(createZoomControls(this.zoomCtl));
    this.container.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this._nextQuestion();
  }

  _nextQuestion() {
    if (this.index >= this.queue.length) {
      setTimeout(() => playWin(), 100);
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.queue.length });
      return;
    }
    this.hinted = false;
    this.selectedId = null;
    this.current = this.queue[this.index];
    this._reportProgress();
  }

  _onClick(id) {
    if (this.locked || !this.current) return;
    if (this.selectedId !== id) {
      this._selectPiece(id);
      return;
    }
    this._confirmAnswer(id);
  }

  _selectPiece(id) {
    if (this.selectedId) this.paths.get(this.selectedId)?.classList.remove('quiz-selected');
    this.selectedId = id;
    this.paths.get(id).classList.add('quiz-selected');
  }

  _confirmAnswer(id) {
    const path = this.paths.get(id);
    path.classList.remove('quiz-selected');
    this.selectedId = null;

    if (id === this.current.id) {
      this.locked = true;
      path.classList.remove('quiz-hint');
      path.classList.add('quiz-correct');
      playSnap();
      this.correct++;
      setTimeout(() => {
        path.classList.remove('quiz-correct');
        path.classList.add('quiz-used');
        this.locked = false;
        this.index++;
        this._nextQuestion();
      }, 550);
    } else {
      path.classList.add('quiz-wrong');
      playError();
      this.mistakes++;
      if (!this.hinted) {
        this.hinted = true;
        this.paths.get(this.current.id).classList.add('quiz-hint');
      }
      this._reportProgress();
      setTimeout(() => path.classList.remove('quiz-wrong'), 400);
    }
  }

  _reportProgress() {
    this.onProgress({
      index: this.index + 1,
      total: this.queue.length,
      mistakes: this.mistakes,
      promptRu: this.current ? this.current.ru : '',
      promptName: this.current ? this.current.name : '',
    });
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
