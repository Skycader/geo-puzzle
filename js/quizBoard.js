import { shuffle, clamp, weightedSampleWithoutReplacement } from './utils.js';
import { playSnap, playError, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { loadSuccessStats, recordOutcome } from './successStats.js';
import { flyCoinToBalance } from './coins.js';
import { REWARDS } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SUCCESS_SCOPE = 'quiz-states';

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
    this.levelId = opts.levelId;
    this.scale = opts.scale || 1;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    // eligibleIds (from the pre-game checklist — see js/eligibilityList.js
    // and game.js's _startQuiz) restricts which states can be ASKED about;
    // the full map is still drawn either way (see the loop below), so a
    // wrong click can still land on a non-eligible state, it just never
    // becomes the prompt itself.
    const pool = opts.eligibleIds && opts.eligibleIds.size ? level.pieces.filter((p) => opts.eligibleIds.has(p.id)) : level.pieces;
    const rounds = clamp(opts.rounds ?? 15, 1, pool.length);
    if (opts.adaptive && this.levelId) {
      // Adaptive mode: draw states weighted by 1/(streak+1), so a state
      // with a 0 streak (never answered right in a row, or just missed
      // one) is far likelier to be picked than one the player has been
      // consistently nailing — see js/successStats.js and game.js's
      // "Адаптивный режим" checkbox for the full picture. Shuffled again
      // after picking so the weighting only affects WHICH states are
      // asked, not the order they come up in.
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

    const { wrap: zoomWrap, viewport: zoomViewport } = createZoomWrap(baseW, baseH, this.container);
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

  // Click #1 on a state only selects/highlights it — click #2 on that same
  // (still-selected) state is what actually submits it as the answer. This
  // gives a misclick an escape hatch: clicking a different state just moves
  // the highlight instead of immediately counting as a wrong answer.
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
      // Recorded regardless of whether adaptive mode is on right now — the
      // streak should keep building from ordinary play too, so turning
      // adaptive mode on later isn't starting from a blank slate.
      if (this.levelId) recordOutcome(this.levelId, SUCCESS_SCOPE, this.current.id, this.hinted);
      const reward = REWARDS[this.levelId]?.quiz ?? 0;
      if (reward > 0 && !this.hinted) {
        const r = path.getBoundingClientRect();
        flyCoinToBalance(r.left + r.width / 2, r.top + r.height / 2, reward);
      }
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
