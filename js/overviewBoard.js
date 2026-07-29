import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATE_LABEL_PX = 12;
const STATE_LABEL_STROKE_PX = 3;
const CITY_LABEL_PX = 10;
const CITY_LABEL_STROKE_PX = 2.5;
const CITY_LABEL_OFFSET_PX = 10; // gap between a city dot and its label, above it
const CITY_DOT_R = 3;
const CITY_DOT_STROKE_PX = 1;

// Free-look mode: every state sits filled at its true spot (like an
// already-solved puzzle) and every city is a dot, all at once — nothing
// to click, answer or assemble. "Full info" keeps every name permanently
// on screen; "hidden info" hides them and relies on each shape's native
// <title> element, which the browser shows as a hover tooltip.
export class OverviewBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.scale = opts.scale || 1;
    this.labelsVisible = opts.labelsVisible !== false;
    this.allLabelEls = [];
    this.stateLabels = []; // { el }
    this.cityLabels = []; // { el, cx, cy }
    this.cityDots = []; // { el }

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
    this.svg.classList.add('board-svg');

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <linearGradient id="piece-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--piece-a)" />
        <stop offset="1" stop-color="var(--piece-b)" />
      </linearGradient>`;
    this.svg.appendChild(defs);

    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('class', 'piece-shape placed');
      path.setAttribute('fill', 'url(#piece-grad)');
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${p.ru} (${p.name})`;
      path.appendChild(title);
      this.svg.appendChild(path);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', p.cx);
      label.setAttribute('y', p.cy);
      label.setAttribute('class', 'piece-label');
      label.textContent = p.id;
      this.svg.appendChild(label);
      this.allLabelEls.push(label);
      this.stateLabels.push({ el: label });
    }

    for (const c of this.level.cities) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', c.cx);
      dot.setAttribute('cy', c.cy);
      dot.setAttribute('class', 'overview-city-dot');
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${c.ru} (${c.name})`;
      dot.appendChild(title);
      this.svg.appendChild(dot);
      this.cityDots.push({ el: dot });

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', c.cx);
      label.setAttribute('class', 'overview-city-label');
      label.textContent = c.ru;
      this.svg.appendChild(label);
      this.allLabelEls.push(label);
      this.cityLabels.push({ el: label, cx: c.cx, cy: c.cy });
    }

    this.zoomViewport.appendChild(this.svg);
    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
      onZoomChange: (zoom) => this._rescaleForZoom(zoom),
    });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this.container.appendChild(this.zoomWrap);
    this._rescaleForZoom(1);
    this.setLabelsVisible(this.labelsVisible);
  }

  // Keeps text/dot sizes a constant number of *screen* pixels regardless of
  // zoom level. The board's width/height attributes scale relative to a
  // fixed viewBox (see zoomPan.js), so every native SVG unit maps to more
  // screen pixels as you zoom in — sizes expressed in native units (font
  // sizes, radii, stroke widths) would otherwise balloon and overlap.
  _rescaleForZoom(zoom) {
    const effScale = this.scale * zoom;
    for (const { el } of this.stateLabels) {
      el.style.fontSize = `${(STATE_LABEL_PX / effScale).toFixed(2)}px`;
      el.style.strokeWidth = `${(STATE_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
    }
    for (const { el, cx, cy } of this.cityLabels) {
      el.style.fontSize = `${(CITY_LABEL_PX / effScale).toFixed(2)}px`;
      el.style.strokeWidth = `${(CITY_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
      el.setAttribute('y', cy - CITY_LABEL_OFFSET_PX / effScale);
    }
    for (const { el } of this.cityDots) {
      el.setAttribute('r', (CITY_DOT_R / effScale).toFixed(2));
      el.style.strokeWidth = `${(CITY_DOT_STROKE_PX / effScale).toFixed(2)}px`;
    }
  }

  setLabelsVisible(visible) {
    this.labelsVisible = visible;
    for (const label of this.allLabelEls) label.style.opacity = visible ? '' : '0';
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
