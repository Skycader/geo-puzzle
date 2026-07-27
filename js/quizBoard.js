import { shuffle, clamp } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// "Find the state" mode: a plain unlabeled map, the player is prompted
// with a state's name and has to click it. Correct clicks lock briefly
// (a green flash) before moving to the next prompt; wrong clicks just
// flash red and let the player try again — low-friction, no penalty
// beyond a mistake tally.
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
    this.paths = new Map();

    this._build();
  }

  _build() {
    const { width, height } = this.level.canvas;
    this.container.innerHTML = '';

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', Math.round(width * this.scale));
    this.svg.setAttribute('height', Math.round(height * this.scale));
    this.svg.classList.add('quiz-svg');

    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', 'quiz-path');
      path.addEventListener('click', () => this._onClick(p.id));
      this.svg.appendChild(path);
      this.paths.set(p.id, path);
    }

    this.container.appendChild(this.svg);
    this._nextQuestion();
  }

  _nextQuestion() {
    if (this.index >= this.queue.length) {
      setTimeout(() => playWin(), 100);
      this.onFinish({ correct: this.correct, mistakes: this.mistakes, total: this.queue.length });
      return;
    }
    this.current = this.queue[this.index];
    this._reportProgress();
  }

  _onClick(id) {
    if (this.locked || !this.current) return;
    const path = this.paths.get(id);

    if (id === this.current.id) {
      this.locked = true;
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
    this.container.innerHTML = '';
  }
}
