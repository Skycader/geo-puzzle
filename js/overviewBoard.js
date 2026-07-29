import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATE_LABEL_PX = 12;
const STATE_LABEL_STROKE_PX = 3;
const CITY_LABEL_PX = 10;
const CITY_LABEL_STROKE_PX = 2.5;
const CITY_LABEL_OFFSET_PX = 10; // gap between a city dot and its label, above it
const CITY_DOT_STROKE_PX = 1;
const CITY_RADIUS_LABEL_PX = 9;
const CITY_RADIUS_LABEL_STROKE_PX = 2;
const CITY_RADIUS_LABEL_GAP_PX = 6; // gap between a dot's edge and its radius label, below it

// Width of the side list panel — game.js subtracts this from the available
// width before computing the board's fit scale, so the map doesn't get
// squeezed by a panel it doesn't know about yet. Keep in sync with
// .overview-panel's width in style.css.
export const OVERVIEW_PANEL_W = 300;

const STATE_FOCUS_FILL = 0.6; // fraction of the viewport a focused state's bbox should fill

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
    this.cityRadiusLabels = []; // { el, cx, cy, radiusNative }
    this.cityDots = []; // { el }
    this.statesById = new Map(); // id -> { data, pathEl }
    this.citiesById = new Map(); // id -> { data, dotEl }
    this.activeTab = 'states';
    this.searchQuery = '';
    this.focusedEl = null;

    this._build();
  }

  _build() {
    const { width, height } = this.level.canvas;
    this.container.innerHTML = '';

    const baseW = Math.round(width * this.scale);
    const baseH = Math.round(height * this.scale);

    this.wrapEl = document.createElement('div');
    this.wrapEl.className = 'overview-wrap';
    // The side panel has no natural height of its own (its list wants to
    // grow with content) — pin the row to the map's fixed height so the
    // panel's flex:1 list-scroll area actually has something to be 1/N of,
    // instead of the whole row growing to fit every list item.
    this.wrapEl.style.height = baseH + 'px';

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
      this.statesById.set(p.id, { data: p, pathEl: path });
    }

    for (const c of this.level.cities) {
      // A true-to-scale radius (derived at build time from real land area,
      // see scripts/build_usa_cities.js) — fixed in native units so it
      // grows/shrinks with zoom exactly like the state borders do, instead
      // of the artificial constant-screen-px sizing used for labels/etc.
      const radiusNative = c.radiusKm / this.level.kmPerUnit;

      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', c.cx);
      dot.setAttribute('cy', c.cy);
      dot.setAttribute('r', radiusNative.toFixed(3));
      dot.setAttribute('class', 'overview-city-dot');
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${c.ru} (${c.name}) — R ${c.radiusKm.toFixed(1)} км`;
      dot.appendChild(title);
      this.svg.appendChild(dot);
      this.cityDots.push({ el: dot });
      this.citiesById.set(c.id, { data: c, dotEl: dot });

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', c.cx);
      label.setAttribute('class', 'overview-city-label');
      label.textContent = c.ru;
      this.svg.appendChild(label);
      this.allLabelEls.push(label);
      this.cityLabels.push({ el: label, cx: c.cx, cy: c.cy });

      const radiusLabel = document.createElementNS(SVG_NS, 'text');
      radiusLabel.setAttribute('x', c.cx);
      radiusLabel.setAttribute('class', 'overview-city-radius-label');
      radiusLabel.textContent = `R ${c.radiusKm.toFixed(1)} км`;
      this.svg.appendChild(radiusLabel);
      this.allLabelEls.push(radiusLabel);
      this.cityRadiusLabels.push({ el: radiusLabel, cx: c.cx, cy: c.cy, radiusNative });
    }

    this.zoomViewport.appendChild(this.svg);
    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      baseScale: this.scale,
      panFromAnywhere: true,
      onZoomChange: (zoom) => this._rescaleForZoom(zoom),
    });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this.wrapEl.appendChild(this.zoomWrap);
    this.wrapEl.appendChild(this._buildSidePanel());
    this.container.appendChild(this.wrapEl);

    this._rescaleForZoom(1);
    this.setLabelsVisible(this.labelsVisible);
  }

  // ---------------- side panel: search + tabbed state/city list ----------------

  _buildSidePanel() {
    const panel = document.createElement('div');
    panel.className = 'overview-panel';
    panel.innerHTML = `
      <div class="overview-tabs">
        <button type="button" class="overview-tab active" data-tab="states">Штаты</button>
        <button type="button" class="overview-tab" data-tab="cities">Города</button>
      </div>
      <input type="text" class="overview-search" placeholder="Поиск..." autocomplete="off" />
      <div class="overview-list-scroll"><div class="overview-item-list"></div></div>
    `;

    this.searchInput = panel.querySelector('.overview-search');
    this.itemListEl = panel.querySelector('.overview-item-list');

    for (const btn of panel.querySelectorAll('.overview-tab')) {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === this.activeTab) return;
        this.activeTab = btn.dataset.tab;
        for (const b of panel.querySelectorAll('.overview-tab')) b.classList.toggle('active', b === btn);
        this.searchInput.value = '';
        this.searchQuery = '';
        this._renderList();
      });
    }
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value.trim().toLowerCase();
      this._renderList();
    });

    this._renderList();
    return panel;
  }

  _renderList() {
    const items = this.activeTab === 'states' ? this.level.pieces : this.level.cities;
    const q = this.searchQuery;
    const filtered = q
      ? items.filter((it) => it.ru.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q))
      : items;
    const sorted = [...filtered].sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));

    this.itemListEl.innerHTML = '';
    if (!sorted.length) {
      this.itemListEl.innerHTML = '<p class="overview-empty">Ничего не найдено</p>';
      return;
    }

    for (const it of sorted) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'overview-item';
      row.innerHTML =
        this.activeTab === 'states'
          ? `<span class="overview-item-abbr">${it.id}</span><span class="overview-item-name">${it.ru}</span>`
          : `<span class="overview-item-name">${it.ru}${it.capital ? ' ★' : ''}</span><span class="overview-item-sub">${it.state}</span>`;
      row.addEventListener('click', () => {
        if (this.activeTab === 'states') this._focusState(it.id);
        else this._focusCity(it.id);
      });
      this.itemListEl.appendChild(row);
    }
  }

  // ---------------- focus / highlight ----------------

  _focusState(id) {
    const entry = this.statesById.get(id);
    if (!entry) return;
    const { data } = entry;
    const [bx0, by0, bx1, by1] = data.bbox;
    const bboxW = Math.max(bx1 - bx0, 1);
    const bboxH = Math.max(by1 - by0, 1);
    const vw = this.zoomViewport.clientWidth;
    const vh = this.zoomViewport.clientHeight;
    const targetZoom = Math.max(1, Math.min((vw * STATE_FOCUS_FILL) / (bboxW * this.scale), (vh * STATE_FOCUS_FILL) / (bboxH * this.scale)));
    this.zoomCtl.focusOn(data.cx, data.cy, targetZoom);

    this._clearFocus();
    // Neighboring states painted after this one in document order would
    // otherwise cover parts of its glow along shared borders — a fresh
    // copy of the shape appended last (topmost in SVG paint order) always
    // renders fully on top, whichever state it is.
    const glow = document.createElementNS(SVG_NS, 'path');
    glow.setAttribute('d', data.d);
    glow.setAttribute('class', 'overview-focus-glow');
    this.svg.appendChild(glow);
    this.focusGlowEl = glow;
  }

  _focusCity(id) {
    const entry = this.citiesById.get(id);
    if (!entry) return;
    const { data, dotEl } = entry;
    // Point features read best at the closest zoom the map allows —
    // focusOn() clamps to the shared max itself.
    this.zoomCtl.focusOn(data.cx, data.cy, Infinity);

    this._clearFocus();
    dotEl.classList.add('overview-focused');
    this.focusedEl = dotEl;
  }

  _clearFocus() {
    this.focusedEl?.classList.remove('overview-focused');
    this.focusedEl = null;
    this.focusGlowEl?.remove();
    this.focusGlowEl = null;
  }

  // Keeps text (and stroke widths) a constant number of *screen* pixels
  // regardless of zoom level. The board's width/height attributes scale
  // relative to a fixed viewBox (see zoomPan.js), so every native SVG unit
  // maps to more screen pixels as you zoom in — sizes expressed in native
  // units would otherwise balloon and overlap. City dot radii are the one
  // exception: those are meant to grow/shrink with zoom, so they're set
  // once at creation and never touched here.
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
    for (const { el, cx, cy, radiusNative } of this.cityRadiusLabels) {
      el.style.fontSize = `${(CITY_RADIUS_LABEL_PX / effScale).toFixed(2)}px`;
      el.style.strokeWidth = `${(CITY_RADIUS_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
      el.setAttribute('y', cy + radiusNative + CITY_RADIUS_LABEL_GAP_PX / effScale);
    }
    // dot radius is NOT rescaled here — it's fixed in native units (true
    // geographic size), only the outline stroke stays a constant screen px.
    for (const { el } of this.cityDots) {
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
