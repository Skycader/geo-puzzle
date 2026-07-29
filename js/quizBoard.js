import { shuffle, clamp } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// "Find the state" mode: a plain unlabeled map, the player is prompted
// with a state's name and has to click it. Correct clicks lock briefly
// (a green flash) before moving to the next prompt. A wrong click flashes
// red and, since this is practice rather than an exam, immediately reveals
// the real target with a glowing outline so the player learns where it is
// instead of having to guess blindly over and over.
export class QuizBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.scale = opts.scale || 1;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    const rounds = clamp(opts.rounds ?? 15, 1, level.pieces.length);
    this.queue = shuffle(level.pieces).slice(0, rounds);
    this.index = 0;
    this.correct = 0;
    this.mistakes = 0;
    this.locked = false;
    this.current = null;
    this.hinted = false;
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

    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', 'quiz-path');
      path.dataset.id = p.id;
      this.svg.appendChild(path);
      this.paths.set(p.id, path);
    }

    this.zoomViewport.appendChild(this.svg);
    // The wrap must be attached to the live document BEFORE attachZoomPan()
    // runs — it measures viewport.clientWidth/Height immediately (for pan
    // clamping), which reads 0 on a detached element.
    this.container.appendChild(this.zoomWrap);

    // Every point on this map is *some* state, so panning can't be
    // restricted to "empty background" like the puzzle board — nothing
    // here is otherwise draggable, so a press anywhere is free to become
    // a pan; it only counts as an answer if it never turns into a drag.
    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
      onTap: (ev) => {
        const id = ev.target?.dataset?.id;
        if (id) this._onClick(id);
      },
    });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this._nextQuestion();
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
    const path = this.paths.get(id);

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
