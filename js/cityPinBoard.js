import { shuffle, clamp } from './utils.js';
import { playSnap, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { buildStateBackground } from './mapBackground.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const MAX_DISTANCE_KM = 400; // guesses this far or farther read as fully red
const TRUE_MARK_R = 5;

const RED = [220, 50, 47];
const GREEN = [133, 153, 0];

function lerpColor(t) {
  const r = Math.round(RED[0] + (GREEN[0] - RED[0]) * t);
  const g = Math.round(RED[1] + (GREEN[1] - RED[1]) * t);
  const b = Math.round(RED[2] + (GREEN[2] - RED[2]) * t);
  return `rgb(${r},${g},${b})`;
}

const PIN_PATH = 'M 0,0 C -7,-11 -7,-19 0,-19 C 7,-19 7,-11 0,0 Z';

// "Place the pin" mode: the player is prompted with a city's name and
// drops/drags a pin anywhere on the map — no target is shown. The pin's
// color interpolates red→green live as it moves, based on distance to the
// true location. Confirming locks it in, reveals the true spot and the
// distance, then the player advances to the next city.
export class CityPinBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.scale = opts.scale || 1;
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    // items defaults to level.cities so nothing breaks if ever constructed
    // the old way — game.js's merged "Города и места" mode passes
    // level.places instead when the entity toggle is set to "места".
    this.items = opts.items || level.cities;

    const rounds = clamp(opts.rounds ?? 15, 1, this.items.length);
    this.queue = shuffle(this.items).slice(0, rounds);
    this.index = 0;
    this.current = null;
    this.confirmed = false;
    this.pinNative = null; // {x,y} in canvas-native units
    this.totalDistanceKm = 0;
    this.roundsAnswered = 0;

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
    this.svg.appendChild(buildStateBackground(this.level.pieces));

    this.revealLayer = document.createElementNS(SVG_NS, 'g');
    this.svg.appendChild(this.revealLayer);

    this.pinGroup = document.createElementNS(SVG_NS, 'g');
    this.pinGroup.setAttribute('class', 'pin');
    this.pinGroup.hidden = true;
    this.pinPath = document.createElementNS(SVG_NS, 'path');
    this.pinPath.setAttribute('d', PIN_PATH);
    this.pinGroup.appendChild(this.pinPath);
    this.svg.appendChild(this.pinGroup);
    this.pinGroup.addEventListener('pointerdown', (ev) => this._onPinPointerDown(ev));

    this.zoomViewport.appendChild(this.svg);
    // The wrap must be attached to the live document BEFORE attachZoomPan()
    // runs — it measures viewport.clientWidth/Height immediately (for pan
    // clamping), which reads 0 on a detached element.
    this.container.appendChild(this.zoomWrap);

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
      onTap: (ev) => this._placePinAtClient(ev.clientX, ev.clientY),
      onZoomChange: () => this._onZoomChange(),
    });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this._buildActionBar();
    this._nextQuestion();
  }

  _buildActionBar() {
    const bar = document.createElement('div');
    bar.className = 'city-actions';
    bar.innerHTML = `
      <span class="pin-feedback" id="pin-feedback"></span>
      <button type="button" class="btn btn-primary" data-action="confirm">Подтвердить</button>
      <button type="button" class="btn btn-primary" data-action="next" hidden>Далее ▶</button>
    `;
    this.feedbackEl = bar.querySelector('.pin-feedback');
    this.confirmBtn = bar.querySelector('[data-action="confirm"]');
    this.nextBtn = bar.querySelector('[data-action="next"]');
    this.confirmBtn.disabled = true;
    this.confirmBtn.addEventListener('click', () => this._confirm());
    this.nextBtn.addEventListener('click', () => this._next());
    this.container.appendChild(bar);
    this.actionBar = bar;
  }

  _nextQuestion() {
    if (this.index >= this.queue.length) {
      const avg = this.roundsAnswered ? Math.round(this.totalDistanceKm / this.roundsAnswered) : 0;
      setTimeout(() => playWin(), 100);
      this.onFinish({ rounds: this.roundsAnswered, avgDistanceKm: avg, total: this.queue.length });
      return;
    }
    this.current = this.queue[this.index];
    this.confirmed = false;
    this.pinNative = null;
    this.pinGroup.hidden = true;
    this.revealLayer.innerHTML = '';
    this.trueMarkGroup = null;
    this.confirmBtn.disabled = true;
    this.confirmBtn.hidden = false;
    this.nextBtn.hidden = true;
    this.feedbackEl.textContent = '';
    this._reportProgress();
  }

  _clientToNative(clientX, clientY) {
    // Reads the SVG's OWN live viewBox rather than the zoom=1 canvas size —
    // see the matching comment in puzzleBoard.js's _clientToNative.
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    return {
      x: ((clientX - rect.left) / rect.width) * vb.width + vb.x,
      y: ((clientY - rect.top) / rect.height) * vb.height + vb.y,
    };
  }

  _placePinAtClient(clientX, clientY) {
    if (this.confirmed || !this.current) return;
    this.pinNative = this._clientToNative(clientX, clientY);
    this.pinGroup.hidden = false;
    this.confirmBtn.disabled = false;
    this._renderPin();
  }

  _onPinPointerDown(ev) {
    if (this.confirmed) return;
    ev.stopPropagation();
    ev.preventDefault();
    const move = (mv) => this._placePinAtClient(mv.clientX, mv.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _distanceKm() {
    if (!this.pinNative || !this.current) return Infinity;
    const dNative = Math.hypot(this.pinNative.x - this.current.cx, this.pinNative.y - this.current.cy);
    return dNative * this.level.kmPerUnit;
  }

  // The pin/true-mark are drawn once in fixed local units and kept a
  // constant screen size via a compensating `scale(1/effScale)` on their
  // group transform — same idea as the label/dot rescaling elsewhere,
  // just done with a transform instead of a geometry attribute since
  // these are drawn shapes, not text/circles sized by a single number.
  _invScale() {
    return 1 / (this.scale * (this.zoomCtl?.getZoom() ?? 1));
  }

  _renderPin() {
    const { x, y } = this.pinNative;
    const inv = this._invScale().toFixed(4);
    this.pinGroup.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${inv})`);
    const t = clamp(1 - this._distanceKm() / MAX_DISTANCE_KM, 0, 1);
    this.pinPath.style.fill = lerpColor(t);
  }

  _onZoomChange() {
    if (this.pinNative && !this.pinGroup.hidden) this._renderPin();
    if (this.trueMarkGroup) {
      const inv = this._invScale().toFixed(4);
      const { x, y } = this.trueMarkCenter;
      this.trueMarkGroup.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${inv})`);
    }
  }

  _confirm() {
    if (this.confirmed || !this.pinNative || !this.current) return;
    this.confirmed = true;
    const distKm = Math.round(this._distanceKm());
    this.totalDistanceKm += distKm;
    this.roundsAnswered++;

    const { cx, cy } = this.current;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', this.pinNative.x);
    line.setAttribute('y1', this.pinNative.y);
    line.setAttribute('x2', cx);
    line.setAttribute('y2', cy);
    line.setAttribute('class', 'pin-connector');
    this.revealLayer.appendChild(line);

    const trueMarkGroup = document.createElementNS(SVG_NS, 'g');
    const inv = this._invScale().toFixed(4);
    trueMarkGroup.setAttribute('transform', `translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${inv})`);
    const trueMark = document.createElementNS(SVG_NS, 'circle');
    trueMark.setAttribute('cx', 0);
    trueMark.setAttribute('cy', 0);
    trueMark.setAttribute('r', TRUE_MARK_R);
    trueMark.setAttribute('class', 'pin-true-mark');
    trueMarkGroup.appendChild(trueMark);
    this.revealLayer.appendChild(trueMarkGroup);
    this.trueMarkGroup = trueMarkGroup;
    this.trueMarkCenter = { x: cx, y: cy };

    if (distKm < 15) playSnap();
    this.feedbackEl.textContent = `${this.current.ru}: ${distKm} км от цели`;
    this.confirmBtn.hidden = true;
    this.nextBtn.hidden = false;
    this._reportProgress();
  }

  _next() {
    if (!this.confirmed) return;
    this.index++;
    this._nextQuestion();
  }

  _reportProgress() {
    this.onProgress({
      index: this.index + 1,
      total: this.queue.length,
      avgDistanceKm: this.roundsAnswered ? Math.round(this.totalDistanceKm / this.roundsAnswered) : null,
      promptRu: this.current ? this.current.ru : '',
      promptName: this.current ? this.current.name : '',
    });
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
