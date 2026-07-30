import { attachZoomPan, createZoomControls, createZoomWrap, createScaleBar } from './zoomPan.js';
import { mark } from './perfDebug.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATE_LABEL_PX = 12;
const STATE_LABEL_STROKE_PX = 3;
const CITY_LABEL_PX = 10;
const CITY_LABEL_STROKE_PX = 2.5;
const CITY_DOT_STROKE_PX = 1;

// City name labels hang off a leader line from the dot's exact center
// (point-mark -> diagonal -> horizontal, text above the horizontal run) —
// all sizes below are constant *screen* px, like the other label styling.
const LEADER_POINT_R_PX = 2.2;
const LEADER_POINT_STROKE_PX = 0.8;
const LEADER_DIAG_PX = 14; // 45°-down-left diagonal segment length
const LEADER_STROKE_PX = 1.2;
const LEADER_PAD_PX = 3; // horizontal run's overshoot past the text on the far end
const LEADER_TEXT_GAP_PX = 3; // gap between the horizontal run and the text sitting above it

// Width of the side list panel — game.js subtracts this from the available
// width before computing the board's fit scale, so the map doesn't get
// squeezed by a panel it doesn't know about yet. Keep in sync with
// .overview-panel's width in style.css.
export const OVERVIEW_PANEL_W = 300;

const STATE_FOCUS_FILL = 0.6; // fraction of the viewport a focused state's bbox should fill
const FOCUS_DURATION_MS = 3000; // how long a click's highlight stays lit before auto-clearing
const VIRTUALIZE_MARGIN = 0.4; // extra fraction of the visible rect's size kept rendered just outside it

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
    // Cities are virtualized — only ones within the visible map area (plus
    // a margin) are actually in the DOM at any given time (see
    // _updateVisibleCities). Each entry tracks its own `appended` state.
    this.cityDotEntries = []; // { id, cx, cy, dot, pointMark, leaderPath, leaderLabel, appended }
    this.cityShapeEntries = []; // { id, cx, cy, bbox, path, label, appended }
    this.statesById = new Map(); // id -> { data, pathEl }
    this.citiesById = new Map(); // id -> { data, dotEl } | { data, pathEl }
    this.activeTab = 'states';
    this.searchQuery = '';
    this.sortBy = null; // null (alphabetical) | 'area'
    this.sortDir = 'desc';
    this.focusedEl = null;
    this.focusTimeoutHandle = null;
    this._revealQueue = [];
    this._revealScheduled = false;
    this._destroyed = false;

    // Perf instrumentation — instance-level overrides (shadow the
    // prototype methods) so the onVisibleRectChange/onZoomChange
    // callbacks wired up in _build() pick up the timed versions.
    this._updateVisibleCities = mark('overview._updateVisibleCities', this._updateVisibleCities.bind(this));
    this._processRevealQueue = mark('overview._processRevealQueue', this._processRevealQueue.bind(this));
    this._rescaleForZoom = mark('overview._rescaleForZoom', this._rescaleForZoom.bind(this));

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

    // City elements are built here but NOT appended yet — _updateVisibleCities
    // (driven by zoomPan's virtualization callback) decides what's actually
    // in the DOM, based on what's currently in view.
    for (const c of this.level.cities) {
      // A handful of large/distinctive cities carry a real projected
      // municipal-boundary shape (see build_city_silhouettes.js) — render
      // those like a mini state piece instead of a radius dot.
      if (c.d) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', c.d);
        path.setAttribute('class', 'overview-city-shape');
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = `${c.ru} (${c.name})`;
        path.appendChild(title);

        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', c.cx);
        label.setAttribute('y', c.cy);
        label.setAttribute('class', 'piece-label');
        label.textContent = c.ru;
        this.allLabelEls.push(label);
        this.stateLabels.push({ el: label });

        const entry = { id: c.id, cx: c.cx, cy: c.cy, bbox: c.bbox, path, label, appended: false };
        this.cityShapeEntries.push(entry);
        this.citiesById.set(c.id, { data: c, pathEl: path });
        continue;
      }

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

      // Leader-line label: a small point-mark at the exact (cx,cy), a line
      // running diagonally down-left then bending horizontal, with the
      // city name sitting above the horizontal run — see _layoutCityLeader.
      const pointMark = document.createElementNS(SVG_NS, 'circle');
      pointMark.setAttribute('class', 'overview-city-point');
      this.allLabelEls.push(pointMark);

      const leaderPath = document.createElementNS(SVG_NS, 'path');
      leaderPath.setAttribute('class', 'overview-city-leader');
      this.allLabelEls.push(leaderPath);

      const leaderLabel = document.createElementNS(SVG_NS, 'text');
      leaderLabel.setAttribute('class', 'overview-city-leader-label');
      leaderLabel.textContent = c.ru;
      this.allLabelEls.push(leaderLabel);

      const entry = { id: c.id, cx: c.cx, cy: c.cy, dot, pointMark, leaderPath, leaderLabel, appended: false };
      this.cityDotEntries.push(entry);
      this.citiesById.set(c.id, { data: c, dotEl: dot });
    }

    this.zoomViewport.appendChild(this.svg);
    // The wrap must be attached to the live document BEFORE attachZoomPan()
    // runs — it measures viewport.clientWidth/Height immediately (for pan
    // clamping and the initial virtualization pass), which reads 0 on a
    // detached element.
    this.wrapEl.appendChild(this.zoomWrap);
    this.wrapEl.appendChild(this._buildSidePanel());
    this.container.appendChild(this.wrapEl);
    this._calibrateCharWidth();

    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      baseScale: this.scale,
      panFromAnywhere: true,
      onZoomChange: (zoom) => this._rescaleForZoom(zoom),
      onVisibleRectChange: (rect) => this._updateVisibleCities(rect),
    });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(createScaleBar(this.zoomCtl, { baseScale: this.scale, kmPerUnit: this.level.kmPerUnit }));

    this._rescaleForZoom(1);
    this.setLabelsVisible(this.labelsVisible);
  }

  // Adds/removes each city's elements from the SVG based on whether it's
  // within the visible native-space rect (plus a margin) — states and
  // their labels stay permanently rendered (only 50 of them), but cities
  // (91, each with several elements) are cheap to keep out of the DOM
  // until they're actually near the camera. Called (debounced) by
  // zoomPan.js after pan/zoom settles, so there's a brief, deliberate delay
  // before newly-panned-into-view cities appear — trading instant pop-in
  // for not paying render cost for off-screen content.
  //
  // Hiding is cheap (just removing nodes) and happens immediately. Showing
  // is NOT cheap — laying out a dot-city's leader line calls
  // getComputedTextLength(), which forces a synchronous layout; doing that
  // for 70+ cities in one synchronous pass (e.g. zooming back out to see
  // the whole map at once) is exactly the kind of single giant frame that
  // tanks the framerate. So reveals go through a small lazy-loading queue
  // instead, a handful per animation frame — cities pop in over a few
  // frames rather than all at once, but every individual frame stays cheap.
  _updateVisibleCities(rect) {
    const mx = (rect.x1 - rect.x0) * VIRTUALIZE_MARGIN;
    const my = (rect.y1 - rect.y0) * VIRTUALIZE_MARGIN;
    this._visBounds = { x0: rect.x0 - mx, x1: rect.x1 + mx, y0: rect.y0 - my, y1: rect.y1 + my };

    const toReveal = [];
    for (const entry of this.cityDotEntries) {
      const visible = this._dotEntryVisible(entry);
      if (visible && !entry.appended) toReveal.push({ kind: 'dot', entry });
      else if (!visible && entry.appended) this._hideDotEntry(entry);
    }
    for (const entry of this.cityShapeEntries) {
      const visible = this._shapeEntryVisible(entry);
      if (visible && !entry.appended) toReveal.push({ kind: 'shape', entry });
      else if (!visible && entry.appended) this._hideShapeEntry(entry);
    }
    this._queueReveals(toReveal);
  }

  _dotEntryVisible(entry) {
    const b = this._visBounds;
    return entry.cx >= b.x0 && entry.cx <= b.x1 && entry.cy >= b.y0 && entry.cy <= b.y1;
  }
  _shapeEntryVisible(entry) {
    const [bx0, by0, bx1, by1] = entry.bbox;
    const b = this._visBounds;
    return !(bx1 < b.x0 || bx0 > b.x1 || by1 < b.y0 || by0 > b.y1);
  }

  _hideDotEntry(entry) {
    entry.dot.remove();
    entry.pointMark.remove();
    entry.leaderPath.remove();
    entry.leaderLabel.remove();
    entry.appended = false;
  }
  _hideShapeEntry(entry) {
    entry.path.remove();
    entry.label.remove();
    entry.appended = false;
  }

  _showDotEntry(entry, effScale) {
    this.svg.appendChild(entry.dot);
    this.svg.appendChild(entry.pointMark);
    this.svg.appendChild(entry.leaderPath);
    this.svg.appendChild(entry.leaderLabel);
    entry.appended = true;
    // Re-lay-out immediately at the current zoom — while detached, its
    // stored geometry could be stale (from whenever it was last visible),
    // and getComputedTextLength() only works once attached.
    this._layoutCityLeader(entry, effScale);
    entry.leaderLabel.style.opacity = this.labelsVisible ? '' : '0';
    entry.pointMark.style.opacity = this.labelsVisible ? '' : '0';
    entry.leaderPath.style.opacity = this.labelsVisible ? '' : '0';
  }
  _showShapeEntry(entry) {
    this.svg.appendChild(entry.path);
    this.svg.appendChild(entry.label);
    entry.appended = true;
    entry.label.style.opacity = this.labelsVisible ? '' : '0';
  }

  _queueReveals(items) {
    if (!items.length) return;
    this._revealQueue = (this._revealQueue || []).concat(items);
    if (this._revealScheduled) return;
    this._revealScheduled = true;
    // City markers carry a permanent drop-shadow filter (see style.css) —
    // cheap once painted, but expensive the instant a *new* filtered element
    // is inserted, since the browser has to rasterize that filter as its own
    // layer right away. Revealing happens right after zoomPan's settle
    // (i.e. once its own 'zoom-interacting' suppression has already been
    // lifted), often right after a rebake just grew the SVG's actual
    // raster size — confirmed via a real recorded session where the
    // dominant stall (400ms+) landed exactly on a reveal batch, not on the
    // zoom itself. Suppressing filter for the duration of the reveal queue
    // avoids paying that cost while cities are still being inserted; it
    // fades back in via each marker's own filter transition once the queue
    // is fully drained.
    this.zoomViewport.classList.add('reveal-busy');
    requestAnimationFrame(() => this._processRevealQueue());
  }

  _processRevealQueue() {
    if (this._destroyed) return;
    const BATCH = 6; // cities revealed per frame — small enough to stay well under a 16ms frame budget
    const effScale = this.scale * (this.zoomCtl?.getZoom() ?? 1);
    let n = 0;
    while (n < BATCH && this._revealQueue.length) {
      const { kind, entry } = this._revealQueue.shift();
      n++;
      if (entry.appended) continue; // already shown by the time its turn came up
      // Re-check visibility — the camera may have moved on since this was
      // queued, and there's no point revealing something no longer in view.
      const stillVisible = kind === 'dot' ? this._dotEntryVisible(entry) : this._shapeEntryVisible(entry);
      if (!stillVisible) continue;
      if (kind === 'dot') this._showDotEntry(entry, effScale);
      else this._showShapeEntry(entry);
    }
    if (this._revealQueue.length) {
      requestAnimationFrame(() => this._processRevealQueue());
    } else {
      this._revealScheduled = false;
      this.zoomViewport.classList.remove('reveal-busy');
    }
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
      <div class="overview-list-header">
        <span class="overview-col-name">Название</span>
        <button type="button" class="overview-col-sort" data-sort="area">Площадь<span class="overview-sort-arrow"></span></button>
      </div>
      <div class="overview-list-scroll"><div class="overview-item-list"></div></div>
    `;

    this.searchInput = panel.querySelector('.overview-search');
    this.itemListEl = panel.querySelector('.overview-item-list');
    this.sortArrowEl = panel.querySelector('.overview-sort-arrow');

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
    panel.querySelector('.overview-col-sort').addEventListener('click', () => {
      this.sortDir = this.sortBy === 'area' && this.sortDir === 'desc' ? 'asc' : 'desc';
      this.sortBy = 'area';
      this._renderList();
    });

    this._renderList();
    return panel;
  }

  // Effective area (km²) of an item — states carry a real `area` field
  // (see build_usa_level.js); cities only store a radius, so their area is
  // derived (they're rendered as a circle of that radius to begin with).
  _areaOf(it) {
    return this.activeTab === 'states' ? it.area : Math.PI * it.radiusKm * it.radiusKm;
  }

  _renderList() {
    const items = this.activeTab === 'states' ? this.level.pieces : this.level.cities;
    const q = this.searchQuery;
    const filtered = q
      ? items.filter((it) => it.ru.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q))
      : items;

    let sorted;
    if (this.sortBy === 'area') {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      sorted = [...filtered].sort((a, b) => (this._areaOf(a) - this._areaOf(b)) * dir);
    } else {
      sorted = [...filtered].sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));
    }
    this.sortArrowEl.textContent = this.sortBy === 'area' ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    this.itemListEl.innerHTML = '';
    if (!sorted.length) {
      this.itemListEl.innerHTML = '<p class="overview-empty">Ничего не найдено</p>';
      return;
    }

    for (const it of sorted) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'overview-item';
      const areaStr = Math.round(this._areaOf(it)).toLocaleString('ru-RU') + ' км²';
      row.innerHTML =
        this.activeTab === 'states'
          ? `<span class="overview-item-main"><span class="overview-item-abbr">${it.id}</span><span class="overview-item-name">${it.ru}</span></span><span class="overview-item-area">${areaStr}</span>`
          : `<span class="overview-item-main"><span class="overview-item-name">${it.ru}${it.capital ? ' ★' : ''}${it.d ? ' ◆' : ''}</span><span class="overview-item-sub">${it.state}</span></span><span class="overview-item-area">${areaStr}</span>`;
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
    this._focusShape(entry.data);
  }

  _focusCity(id) {
    const entry = this.citiesById.get(id);
    if (!entry) return;
    const { data } = entry;
    if (data.bbox) {
      this._focusShape(data);
      return;
    }
    // Point features (plain dots) read best at the closest zoom the map
    // allows — focusOn() clamps to the shared max itself.
    this.zoomCtl.focusOn(data.cx, data.cy, Infinity);
    this._clearFocus();
    entry.dotEl.classList.add('overview-focused');
    this.focusedEl = entry.dotEl;
    this._scheduleAutoClear();
  }

  // Shared by states and by the handful of cities with a real boundary
  // shape: zoom to fit the shape's bbox, then drop a glowing copy of it on
  // top of everything else in paint order (see the comment below).
  _focusShape(data) {
    const [bx0, by0, bx1, by1] = data.bbox;
    const bboxW = Math.max(bx1 - bx0, 1);
    const bboxH = Math.max(by1 - by0, 1);
    const vw = this.zoomViewport.clientWidth;
    const vh = this.zoomViewport.clientHeight;
    const targetZoom = Math.max(1, Math.min((vw * STATE_FOCUS_FILL) / (bboxW * this.scale), (vh * STATE_FOCUS_FILL) / (bboxH * this.scale)));
    this.zoomCtl.focusOn(data.cx, data.cy, targetZoom);

    this._clearFocus();
    // Neighboring shapes painted after this one in document order would
    // otherwise cover parts of its glow along shared borders — a fresh
    // copy appended last (topmost in SVG paint order) always renders fully
    // on top, whichever shape it is.
    const glow = document.createElementNS(SVG_NS, 'path');
    glow.setAttribute('d', data.d);
    glow.setAttribute('class', 'overview-focus-glow');
    this.svg.appendChild(glow);
    this.focusGlowEl = glow;
    this._scheduleAutoClear();
  }

  _scheduleAutoClear() {
    clearTimeout(this.focusTimeoutHandle);
    this.focusTimeoutHandle = setTimeout(() => this._clearFocus(), FOCUS_DURATION_MS);
  }

  _clearFocus() {
    clearTimeout(this.focusTimeoutHandle);
    this.focusTimeoutHandle = null;
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
  // once at creation and never touched here. Only *currently-appended*
  // (i.e. visible — see _updateVisibleCities) city entries are touched —
  // there's no point paying to lay out elements nobody can see.
  _rescaleForZoom(zoom) {
    const effScale = this.scale * zoom;
    for (const { el } of this.stateLabels) {
      el.style.fontSize = `${(STATE_LABEL_PX / effScale).toFixed(2)}px`;
      el.style.strokeWidth = `${(STATE_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
    }
    for (const entry of this.cityDotEntries) {
      if (!entry.appended) continue;
      this._layoutCityLeader(entry, effScale);
      // dot radius is NOT rescaled here — it's fixed in native units (true
      // geographic size), only the outline stroke stays a constant screen px.
      entry.dot.style.strokeWidth = `${(CITY_DOT_STROKE_PX / effScale).toFixed(2)}px`;
    }
  }

  // getComputedTextLength() forces a synchronous layout of the *whole*
  // page, not just the one element — calling it per-city (up to 91 times
  // on first load, and again for every visible city on every zoom step)
  // was the actual cause of the framerate collapsing to single digits,
  // independent of how small the reveal batches were. JetBrains Mono is
  // monospace, so every character has the same advance width — measuring
  // it ONCE here and reusing that ratio arithmetically from then on gets
  // the same result without ever forcing layout again.
  _calibrateCharWidth() {
    const probe = document.createElementNS(SVG_NS, 'text');
    probe.setAttribute('class', 'overview-city-leader-label');
    probe.style.fontSize = '100px';
    probe.style.opacity = '0';
    probe.textContent = 'MW0123456789АБВГДЕЖ';
    this.svg.appendChild(probe);
    const len = probe.getComputedTextLength();
    this.svg.removeChild(probe);
    this._charWidthRatio = len / (probe.textContent.length * 100); // px of width per px of font-size, per character
  }

  // Point-mark -> diagonal -> horizontal run -> text, all sized/positioned
  // in constant screen px regardless of zoom (see the comment above). The
  // horizontal run's length comes from the calibrated char-width ratio
  // (see _calibrateCharWidth) rather than measuring the live element, so
  // laying out a city never forces a page-wide synchronous layout.
  _layoutCityLeader(entry, effScale) {
    const { cx, cy, pointMark, leaderPath, leaderLabel } = entry;
    pointMark.setAttribute('cx', cx);
    pointMark.setAttribute('cy', cy);
    pointMark.setAttribute('r', (LEADER_POINT_R_PX / effScale).toFixed(2));
    pointMark.style.strokeWidth = `${(LEADER_POINT_STROKE_PX / effScale).toFixed(2)}px`;

    const d45 = LEADER_DIAG_PX / effScale / Math.SQRT2;
    const bendX = cx - d45;
    const bendY = cy + d45;

    const fontSizeNative = CITY_LABEL_PX / effScale;
    leaderLabel.style.fontSize = `${fontSizeNative.toFixed(2)}px`;
    leaderLabel.style.strokeWidth = `${(CITY_LABEL_STROKE_PX / effScale).toFixed(2)}px`;
    const textLen = leaderLabel.textContent.length * this._charWidthRatio * fontSizeNative;
    const pad = LEADER_PAD_PX / effScale;
    const lineEndX = bendX - textLen - pad * 2;

    leaderPath.setAttribute('d', `M ${cx.toFixed(1)},${cy.toFixed(1)} L ${bendX.toFixed(1)},${bendY.toFixed(1)} L ${lineEndX.toFixed(1)},${bendY.toFixed(1)}`);
    leaderPath.style.strokeWidth = `${(LEADER_STROKE_PX / effScale).toFixed(2)}px`;

    leaderLabel.setAttribute('x', bendX - pad);
    leaderLabel.setAttribute('y', bendY - LEADER_TEXT_GAP_PX / effScale);
  }

  setLabelsVisible(visible) {
    this.labelsVisible = visible;
    for (const label of this.allLabelEls) label.style.opacity = visible ? '' : '0';
  }

  destroy() {
    this._destroyed = true;
    this._revealQueue = [];
    clearTimeout(this.focusTimeoutHandle);
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
