import { shuffle, clamp } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { buildStateBackground } from './mapBackground.js';
import { flyCoinToBalance } from './coins.js';
import { REWARDS } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_R = 3.2;
const HIT_R = 8; // generous invisible hit-area so tiny dots stay clickable
const DOT_STROKE_PX = 1;

// "Find the city" mode: state borders shown as context, every city is a
// small dot on the map (unlabeled), the player is prompted with a city's
// name and has to click its dot. Same low-friction rules as the state
// quiz: a miss reveals the target after the first wrong click instead of
// forcing blind guessing.
export class CityQuizBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.levelId = opts.levelId;
    this.scale = opts.scale || 1;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    // items defaults to level.cities so nothing breaks if ever constructed
    // the old way — game.js's merged "Города и места" mode passes
    // level.places instead when the entity toggle is set to "места".
    this.items = opts.items || level.cities;

    // eligibleIds (from the pre-game checklist — see js/eligibilityList.js
    // and game.js's _startCityQuiz) restricts which items can be ASKED
    // about; every dot is still drawn either way (see the loop below).
    const pool = opts.eligibleIds && opts.eligibleIds.size ? this.items.filter((c) => opts.eligibleIds.has(c.id)) : this.items;
    const rounds = clamp(opts.rounds ?? 15, 1, pool.length);
    this.queue = shuffle(pool).slice(0, rounds);
    this.index = 0;
    this.correct = 0;
    this.mistakes = 0;
    this.locked = false;
    this.current = null;
    this.hinted = false;
    this.dots = new Map();

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
    this.svg.appendChild(buildStateBackground(this.level.pieces));

    for (const c of this.items) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'city-marker');

      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('cx', c.cx);
      hit.setAttribute('cy', c.cy);
      hit.setAttribute('r', HIT_R);
      hit.setAttribute('class', 'city-hit');
      hit.dataset.id = c.id;

      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', c.cx);
      dot.setAttribute('cy', c.cy);
      dot.setAttribute('r', DOT_R);
      dot.setAttribute('class', 'city-dot');

      g.appendChild(hit);
      g.appendChild(dot);
      this.svg.appendChild(g);
      this.dots.set(c.id, { hit, dot });
    }

    this.zoomViewport.appendChild(this.svg);
    // The wrap must be attached to the live document BEFORE attachZoomPan()
    // runs — it measures viewport.clientWidth/Height immediately (for pan
    // clamping), which reads 0 on a detached element.
    this.container.appendChild(this.zoomWrap);

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
      onTap: (ev) => {
        const id = ev.target?.dataset?.id;
        if (id) this._onClick(id);
      },
      onZoomChange: (zoom) => this._rescaleForZoom(zoom),
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

  // Keeps dots/hit-areas a constant screen size as the board zooms — see
  // the matching comment in overviewBoard.js for why native-unit sizes
  // would otherwise balloon.
  _rescaleForZoom(zoom) {
    const effScale = this.scale * zoom;
    for (const { hit, dot } of this.dots.values()) {
      dot.setAttribute('r', (DOT_R / effScale).toFixed(2));
      dot.style.strokeWidth = `${(DOT_STROKE_PX / effScale).toFixed(2)}px`;
      hit.setAttribute('r', (HIT_R / effScale).toFixed(2));
    }
  }

  _nextQuestion() {
    if (this.index >= this.queue.length) {
      setTimeout(() => playWin(), 100);
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.queue.length });
      return;
    }
    this.hinted = false;
    this.current = this.queue[this.index];
    this._reportProgress();
  }

  _onClick(id) {
    if (this.locked || !this.current) return;
    const { hit, dot } = this.dots.get(id);

    if (id === this.current.id) {
      this.locked = true;
      dot.classList.remove('city-hint');
      dot.classList.add('city-correct');
      playSnap();
      this.correct++;
      const reward = REWARDS[this.levelId]?.city_place ?? 0;
      if (reward > 0 && !this.hinted) {
        const r = dot.getBoundingClientRect();
        flyCoinToBalance(r.left + r.width / 2, r.top + r.height / 2, reward);
      }
      setTimeout(() => {
        dot.classList.remove('city-correct');
        dot.classList.add('city-used');
        this.locked = false;
        this.index++;
        this._nextQuestion();
      }, 550);
    } else {
      dot.classList.add('city-wrong');
      playError();
      this.mistakes++;
      if (!this.hinted) {
        this.hinted = true;
        this.dots.get(this.current.id).dot.classList.add('city-hint');
      }
      this._reportProgress();
      setTimeout(() => dot.classList.remove('city-wrong'), 400);
    }
    void hit; // hit-circle is purely for pointer targeting, never styled
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
