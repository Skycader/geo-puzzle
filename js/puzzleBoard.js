import { shuffle, clamp } from './utils.js';
import { translatePath } from './pieceShape.js';
import { playPickup, playSnap, playWin } from './audio.js';
import { attachZoomPan, createZoomControls, createZoomWrap } from './zoomPan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TRAY_PAD = 6;
const LABEL_PX = 11;
const LABEL_STROKE_PX = 3;
const SNAP_THRESHOLD = 34; // native canvas units

// A free-form jigsaw: pieces can be dropped anywhere on the workspace.
// Every piece keeps a "group" (a rigid cluster sharing one offset). On
// drop we check whether the dragged group's offset lines up with any
// other group's offset within SNAP_THRESHOLD — since every piece's `d`
// and cx/cy live in one shared true-map coordinate system, two groups
// only ever line up when they're genuinely, correctly adjacent. A match
// snaps the offset exactly and merges the groups into one draggable
// cluster. Win = every piece merged into a single group.
export class PuzzleBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.toPlaceCount = opts.toPlaceCount ?? level.pieces.length;
    this.scale = opts.scale || 1;
    this.traySize = opts.traySize || 78;
    this.hintsVisible = opts.hintsVisible !== false;
    this.labelsVisible = opts.labelsVisible !== false;
    this.onProgress = opts.onProgress || (() => {});
    this.onWin = opts.onWin || (() => {});

    this.byId = new Map();
    for (const p of level.pieces) this.byId.set(p.id, p);

    this.trayWraps = new Map(); // id -> tray wrap div (kept around to allow un-placing)
    this.pieceEls = new Map(); // id -> { g, path, label }
    this.pieceGroup = new Map(); // id -> groupId (only for placed pieces)
    this.groups = new Map(); // groupId -> { offsetX, offsetY, members:Set<id>, locked }
    this.allLabelEls = [];
    this.nextGroupId = 1;
    this.placedCount = 0;
    this.won = false;

    this._boundTrayMove = this._onTrayPointerMove.bind(this);
    this._boundTrayUp = this._onTrayPointerUp.bind(this);
    this._boundWsMove = this._onWorkspacePointerMove.bind(this);
    this._boundWsUp = this._onWorkspacePointerUp.bind(this);

    this._build();
  }

  _build() {
    const { width, height } = this.level.canvas;
    const padX = Math.round(width * 0.16);
    const padY = Math.round(height * 0.12);

    this.container.innerHTML = '';
    this.wrapEl = document.createElement('div');
    this.wrapEl.className = 'puzzle-wrap';

    const baseW = Math.round((width + padX * 2) * this.scale);
    const baseH = Math.round((height + padY * 2) * this.scale);

    const { wrap: zoomWrap, viewport: zoomViewport } = createZoomWrap(baseW, baseH);
    this.zoomWrap = zoomWrap;
    this.zoomViewport = zoomViewport;

    this.boardSvg = document.createElementNS(SVG_NS, 'svg');
    this.boardSvg.setAttribute('viewBox', `${-padX} ${-padY} ${width + padX * 2} ${height + padY * 2}`);
    this.boardSvg.setAttribute('width', baseW);
    this.boardSvg.setAttribute('height', baseH);
    this.boardSvg.classList.add('board-svg');
    this.boardSvg.classList.toggle('hide-hints', !this.hintsVisible);

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <linearGradient id="piece-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--piece-a)" />
        <stop offset="1" stop-color="var(--piece-b)" />
      </linearGradient>`;
    this.boardSvg.appendChild(defs);

    this.hintLayer = document.createElementNS(SVG_NS, 'g');
    this.hintLayer.setAttribute('class', 'hint-layer');
    for (const p of this.level.pieces) {
      const hint = document.createElementNS(SVG_NS, 'path');
      hint.setAttribute('d', p.d);
      hint.setAttribute('class', 'hint-path' + (p.inset ? ' hint-inset' : ''));
      this.hintLayer.appendChild(hint);
    }
    this.boardSvg.appendChild(this.hintLayer);

    this.trayEl = document.createElement('div');
    this.trayEl.className = 'tray';

    this.zoomViewport.appendChild(this.boardSvg);
    this.zoomCtl = attachZoomPan(this.zoomViewport, this.boardSvg, { baseWidth: baseW, baseHeight: baseH });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));

    this.wrapEl.appendChild(this.zoomWrap);
    this.wrapEl.appendChild(this.trayEl);
    this.container.appendChild(this.wrapEl);

    const count = clamp(this.toPlaceCount, 1, this.level.pieces.length);
    const toPlaceIds = new Set(shuffle(this.level.pieces.map((p) => p.id)).slice(0, count));
    this.totalToPlace = toPlaceIds.size;

    // pieces NOT chosen for the tray start pre-assembled as one group
    // sitting at its true position (only relevant when toPlaceCount is
    // less than the full set) — it's already-connected, so like any
    // connected cluster it's draggable as a whole.
    const preplaced = this.level.pieces.filter((p) => !toPlaceIds.has(p.id));
    if (preplaced.length) {
      const groupId = 'g' + this.nextGroupId++;
      this.groups.set(groupId, { offsetX: 0, offsetY: 0, members: new Set() });
      for (const p of preplaced) {
        this._createWorkspacePiece(p, 0, 0, groupId);
        this.groups.get(groupId).members.add(p.id);
        this.pieceGroup.set(p.id, groupId);
      }
      this.placedCount += preplaced.length;
    }

    const trayOrder = shuffle([...toPlaceIds]);
    for (const id of trayOrder) {
      const piece = this._createTrayPiece(this.byId.get(id));
      this.trayWraps.set(id, piece.wrap);
      this.trayEl.appendChild(piece.wrap);
      this._attachTrayDrag(id, piece.wrap);
    }

    this.setLabelsVisible(this.labelsVisible);
    this._afterChange();
  }

  // ---------------- tray pieces ----------------

  _createTrayPiece(data) {
    const [bx0, by0, bx1, by1] = data.bbox;
    const w = bx1 - bx0;
    const h = by1 - by0;
    const fit = this.traySize / Math.max(w, h, 1);
    const padNative = TRAY_PAD / fit;
    const vbW = w + padNative * 2;
    const vbH = h + padNative * 2;
    const localD = translatePath(data.d, bx0 - padNative, by0 - padNative);

    const wrap = document.createElement('div');
    wrap.className = 'piece';
    wrap.title = `${data.ru} (${data.name})`;
    wrap.dataset.id = data.id;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
    svg.setAttribute('width', Math.round(vbW * fit));
    svg.setAttribute('height', Math.round(vbH * fit));
    svg.dataset.trayWidth = Math.round(vbW * fit);
    svg.dataset.trayHeight = Math.round(vbH * fit);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', localD);
    path.setAttribute('class', 'piece-shape');
    path.setAttribute('fill', 'url(#piece-grad)');
    svg.appendChild(path);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', data.cx - bx0 + padNative);
    label.setAttribute('y', data.cy - by0 + padNative);
    label.setAttribute('class', 'piece-label');
    label.style.fontSize = `${(LABEL_PX / fit).toFixed(2)}px`;
    label.style.strokeWidth = `${(LABEL_STROKE_PX / fit).toFixed(2)}px`;
    label.textContent = data.id;
    svg.appendChild(label);
    this.allLabelEls.push(label);

    wrap.appendChild(svg);
    return { data, wrap, svg };
  }

  _attachTrayDrag(id, wrap) {
    wrap.style.touchAction = 'none';
    wrap.addEventListener('pointerdown', (ev) => {
      if (this.activeTrayDrag || this.activeWsDrag) return;
      ev.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const grabFracX = (ev.clientX - rect.left) / rect.width;
      const grabFracY = (ev.clientY - rect.top) / rect.height;

      wrap.classList.add('dragging');
      wrap.style.position = 'fixed';
      wrap.style.left = rect.left + 'px';
      wrap.style.top = rect.top + 'px';
      wrap.style.zIndex = 1000;
      document.body.appendChild(wrap);

      // Switch the dragged piece to its true board-scale size right away,
      // instead of only at drop — the tray icon is a shrunk/enlarged
      // stand-in, but while it's actually being placed it should look
      // like what you're about to get. Re-anchor the fixed position so
      // the resize happens under the pointer, not from the old corner.
      this._resizeToTrueSize(wrap);
      const newRect = wrap.getBoundingClientRect();
      const newLeft = ev.clientX - grabFracX * newRect.width;
      const newTop = ev.clientY - grabFracY * newRect.height;
      wrap.style.left = newLeft + 'px';
      wrap.style.top = newTop + 'px';

      this.activeTrayDrag = {
        id,
        offsetX: ev.clientX - newLeft,
        offsetY: ev.clientY - newTop,
      };
      playPickup();
      window.addEventListener('pointermove', this._boundTrayMove);
      window.addEventListener('pointerup', this._boundTrayUp);
    });
  }

  _resizeToTrueSize(wrap) {
    const svg = wrap.querySelector('svg');
    const vbW = svg.viewBox.baseVal.width;
    const vbH = svg.viewBox.baseVal.height;
    const effScale = this.scale * (this.zoomCtl?.getZoom() ?? 1);
    svg.setAttribute('width', Math.max(1, Math.round(vbW * effScale)));
    svg.setAttribute('height', Math.max(1, Math.round(vbH * effScale)));
  }

  _resizeToTraySize(wrap) {
    const svg = wrap.querySelector('svg');
    svg.setAttribute('width', svg.dataset.trayWidth);
    svg.setAttribute('height', svg.dataset.trayHeight);
  }

  _onTrayPointerMove(ev) {
    if (!this.activeTrayDrag) return;
    const { id, offsetX, offsetY } = this.activeTrayDrag;
    const wrap = this.trayWraps.get(id);
    wrap.style.left = ev.clientX - offsetX + 'px';
    wrap.style.top = ev.clientY - offsetY + 'px';
  }

  _onTrayPointerUp(ev) {
    if (!this.activeTrayDrag) return;
    const { id } = this.activeTrayDrag;
    window.removeEventListener('pointermove', this._boundTrayMove);
    window.removeEventListener('pointerup', this._boundTrayUp);
    const wrap = this.trayWraps.get(id);
    wrap.classList.remove('dragging');
    const rect = wrap.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    this.activeTrayDrag = null;

    const boardRect = this.boardSvg.getBoundingClientRect();
    if (!this._pointInRect(clientX, clientY, boardRect)) {
      this._returnPieceToTray(id);
      return;
    }

    const native = this._clientToNative(clientX, clientY, boardRect);
    const data = this.byId.get(id);
    const offsetX = native.x - data.cx;
    const offsetY = native.y - data.cy;

    const groupId = 'g' + this.nextGroupId++;
    this.groups.set(groupId, { offsetX, offsetY, members: new Set([id]) });
    this.pieceGroup.set(id, groupId);
    this._createWorkspacePiece(data, offsetX, offsetY, groupId);
    this.trayWraps.get(id).remove();
    this.placedCount++;

    this._trySnap(groupId);
    this._afterChange();
  }

  _returnPieceToTray(id) {
    const wrap = this.trayWraps.get(id);
    this._resizeToTraySize(wrap);
    wrap.style.position = 'relative';
    wrap.style.left = '';
    wrap.style.top = '';
    wrap.style.zIndex = '';
    this.trayEl.appendChild(wrap);
  }

  // ---------------- workspace pieces ----------------

  _createWorkspacePiece(data, offsetX, offsetY, groupId) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'ws-piece');
    g.setAttribute('transform', `translate(${offsetX.toFixed(1)},${offsetY.toFixed(1)})`);
    g.dataset.id = data.id;

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data.d);
    path.setAttribute('class', 'piece-shape placed');
    path.setAttribute('fill', 'url(#piece-grad)');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${data.ru} (${data.name})`;
    path.appendChild(title);
    g.appendChild(path);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', data.cx);
    label.setAttribute('y', data.cy);
    label.setAttribute('class', 'piece-label');
    label.style.fontSize = `${(LABEL_PX / this.scale).toFixed(2)}px`;
    label.style.strokeWidth = `${(LABEL_STROKE_PX / this.scale).toFixed(2)}px`;
    label.style.opacity = this.labelsVisible ? '' : '0';
    label.textContent = data.id;
    g.appendChild(label);
    this.allLabelEls.push(label);

    this.boardSvg.appendChild(g);
    this.pieceEls.set(data.id, { g, path, label });

    g.style.touchAction = 'none';
    g.addEventListener('pointerdown', (ev) => this._onWorkspacePointerDown(ev, data.id));
    return g;
  }

  _onWorkspacePointerDown(ev, id) {
    if (this.activeTrayDrag || this.activeWsDrag) return;
    const groupId = this.pieceGroup.get(id);
    const group = this.groups.get(groupId);
    if (!group) return;
    ev.preventDefault();

    const boardRect = this.boardSvg.getBoundingClientRect();
    const startNative = this._clientToNative(ev.clientX, ev.clientY, boardRect);
    this.activeWsDrag = {
      groupId,
      startOffsetX: group.offsetX,
      startOffsetY: group.offsetY,
      startNativeX: startNative.x,
      startNativeY: startNative.y,
    };
    for (const memberId of group.members) this.pieceEls.get(memberId).g.classList.add('dragging');
    window.addEventListener('pointermove', this._boundWsMove);
    window.addEventListener('pointerup', this._boundWsUp);
    playPickup();
  }

  _onWorkspacePointerMove(ev) {
    if (!this.activeWsDrag) return;
    const { groupId, startOffsetX, startOffsetY, startNativeX, startNativeY } = this.activeWsDrag;
    const boardRect = this.boardSvg.getBoundingClientRect();
    const native = this._clientToNative(ev.clientX, ev.clientY, boardRect);
    const ox = startOffsetX + (native.x - startNativeX);
    const oy = startOffsetY + (native.y - startNativeY);
    const group = this.groups.get(groupId);
    group.offsetX = ox;
    group.offsetY = oy;
    for (const memberId of group.members) {
      this.pieceEls.get(memberId).g.setAttribute('transform', `translate(${ox.toFixed(1)},${oy.toFixed(1)})`);
    }
  }

  _onWorkspacePointerUp() {
    if (!this.activeWsDrag) return;
    const { groupId } = this.activeWsDrag;
    window.removeEventListener('pointermove', this._boundWsMove);
    window.removeEventListener('pointerup', this._boundWsUp);
    const group = this.groups.get(groupId);
    for (const memberId of group.members) this.pieceEls.get(memberId).g.classList.remove('dragging');
    this.activeWsDrag = null;

    // solo pieces dropped back over the tray get un-placed
    if (group.members.size === 1) {
      const [onlyId] = group.members;
      const boardRect = this.boardSvg.getBoundingClientRect();
      const trayRect = this.trayEl.getBoundingClientRect();
      const g = this.pieceEls.get(onlyId).g;
      const gRect = g.getBoundingClientRect();
      const cx = gRect.left + gRect.width / 2;
      const cy = gRect.top + gRect.height / 2;
      if (!this._pointInRect(cx, cy, boardRect) && this._pointInRect(cx, cy, trayRect)) {
        this._unplacePiece(onlyId);
        this._afterChange();
        return;
      }
    }

    this._trySnap(groupId);
    this._afterChange();
  }

  _unplacePiece(id) {
    const groupId = this.pieceGroup.get(id);
    this.groups.delete(groupId);
    this.pieceGroup.delete(id);
    const { g } = this.pieceEls.get(id);
    g.remove();
    this.pieceEls.delete(id);
    this.placedCount--;

    const wrap = this.trayWraps.get(id);
    this._resizeToTraySize(wrap);
    wrap.style.position = 'relative';
    wrap.style.left = '';
    wrap.style.top = '';
    wrap.style.zIndex = '';
    this.trayEl.appendChild(wrap);
  }

  // ---------------- snapping / merging ----------------

  _trySnap(groupId) {
    const group = this.groups.get(groupId);
    let bestId = null;
    let bestDist = Infinity;
    for (const [otherId, other] of this.groups) {
      if (otherId === groupId) continue;
      const d = Math.hypot(group.offsetX - other.offsetX, group.offsetY - other.offsetY);
      if (d < SNAP_THRESHOLD && d < bestDist) {
        bestDist = d;
        bestId = otherId;
      }
    }
    if (!bestId) return;
    this._mergeGroups(bestId, groupId);
  }

  _mergeGroups(anchorId, otherId) {
    const anchor = this.groups.get(anchorId);
    const other = this.groups.get(otherId);
    const movedMembers = [...other.members];
    const existingMembers = [...anchor.members];

    for (const id of movedMembers) {
      this.pieceGroup.set(id, anchorId);
      const { g, path } = this.pieceEls.get(id);
      g.setAttribute('transform', `translate(${anchor.offsetX.toFixed(1)},${anchor.offsetY.toFixed(1)})`);
      anchor.members.add(id);
      path.classList.add('just-connected');
      setTimeout(() => path.classList.remove('just-connected'), 500);
    }
    this.groups.delete(otherId);

    playSnap();
    this._spawnConnectSparks(anchor, movedMembers, existingMembers);

    // a merge can bring the combined group's offset in line with yet
    // another already-settled group (e.g. two separate chains both
    // touching a third) — keep folding those in too.
    this._trySnap(anchorId);
  }

  _spawnConnectSparks(group, newIds, existingIds) {
    const existingSet = new Set(existingIds);
    for (const nId of newIds) {
      const nData = this.byId.get(nId);
      for (const neighborId of nData.neighbors || []) {
        if (!existingSet.has(neighborId)) continue;
        const neighborData = this.byId.get(neighborId);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', nData.cx + group.offsetX);
        line.setAttribute('y1', nData.cy + group.offsetY);
        line.setAttribute('x2', neighborData.cx + group.offsetX);
        line.setAttribute('y2', neighborData.cy + group.offsetY);
        line.setAttribute('class', 'spark');
        this.boardSvg.appendChild(line);
        setTimeout(() => line.remove(), 750);
      }
    }
  }

  // ---------------- helpers ----------------

  _pointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  _clientToNative(clientX, clientY, boardRect) {
    const { width, height } = this.level.canvas;
    const padX = Math.round(width * 0.16);
    const padY = Math.round(height * 0.12);
    const totalW = width + padX * 2;
    const totalH = height + padY * 2;
    return {
      x: ((clientX - boardRect.left) / boardRect.width) * totalW - padX,
      y: ((clientY - boardRect.top) / boardRect.height) * totalH - padY,
    };
  }

  _afterChange() {
    if (this.won) return;
    this.onProgress({
      placed: this.placedCount,
      total: this.level.pieces.length,
      groups: this.groups.size,
    });

    const trayEmpty = this.trayEl.children.length === 0;
    if (trayEmpty && this.groups.size === 1 && this.placedCount === this.level.pieces.length) {
      this.won = true;
      setTimeout(() => playWin(), 150);
      this.onWin({});
    }
  }

  setHintsVisible(visible) {
    this.hintsVisible = visible;
    this.boardSvg.classList.toggle('hide-hints', !visible);
  }

  setLabelsVisible(visible) {
    this.labelsVisible = visible;
    for (const label of this.allLabelEls) label.style.opacity = visible ? '' : '0';
  }

  destroy() {
    window.removeEventListener('pointermove', this._boundTrayMove);
    window.removeEventListener('pointerup', this._boundTrayUp);
    window.removeEventListener('pointermove', this._boundWsMove);
    window.removeEventListener('pointerup', this._boundWsUp);
    this.zoomCtl?.destroy();
    this.container.innerHTML = '';
  }
}
