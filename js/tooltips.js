// The app's own tooltip system, replacing the browser's native ones (the `title` attribute and
// SVG <title> children) — those can't be styled, show up late and paint over our own hover
// readouts (they covered the time-zone readout). One floating stack follows the cursor and shows
// ROWS, each in the app's neon look:
//   1. the pointed element's own tip (`data-tip`), and
//   2. rows from registered providers — map readouts that depend on the cursor position, such as
//      Overview's terrain category and the time-zone clock. Rows from different sources stack
//      up in one box instead of fighting each other.
//
// Existing code needs no changes: on the first pointer entry into an element (or any of its
// ancestors) its native `title` attribute / <title> child is moved into `data-tip`, so the
// browser never gets to show its own. Text may contain "\n" for several lines.
//
// A provider is `(mouseEvent) => row | row[] | null`, with row = { key, parts, accent? }:
// `parts` is [{ text, strong? }, …] (or a plain string), `accent` one of 'c0'|'c1'|'c2' (the
// theme's cyan/pink/violet — see .timezone-c* in style.css), default cyan. Providers are polled
// on every mouse move and once a second (so clocks tick) while the stack is visible; call
// refreshTips() after changing something a provider depends on.

const SVG_NS = 'http://www.w3.org/2000/svg';
const providers = new Set();
let stackEl = null;
let lastEv = null;
let lastKey = '';
let tickTimer = null;
let raf = 0;
let started = false;

export function registerTipProvider(fn) {
  providers.add(fn);
  return () => {
    providers.delete(fn);
    refreshTips();
  };
}

export function refreshTips() {
  if (lastEv) update();
}

// Moves native tooltip sources on `start` and its ancestors into data-tip.
function adoptTitles(start) {
  for (let el = start; el && el.nodeType === 1; el = el.parentElement) {
    const attr = el.getAttribute('title');
    if (attr !== null) {
      el.removeAttribute('title');
      if (attr) {
        el.dataset.tip = attr;
        // A button that only had a title (icon buttons) would lose its accessible name.
        if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', attr);
      }
    }
    for (const child of [...el.children]) {
      if (child.localName === 'title' && child.namespaceURI === SVG_NS) {
        if (child.textContent) el.dataset.tip = child.textContent;
        child.remove();
      }
    }
  }
}

function collectRows(ev) {
  const rows = [];
  const own = ev.target?.closest?.('[data-tip]')?.dataset.tip;
  if (own) rows.push({ key: 'tip:' + own, parts: [{ text: own }] });
  for (const provider of providers) {
    const r = provider(ev);
    if (r) rows.push(...(Array.isArray(r) ? r : [r]));
  }
  return rows;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(rows) {
  const key = JSON.stringify(rows.map((r) => [r.key, r.accent, r.parts]));
  if (key === lastKey) return;
  lastKey = key;
  stackEl.innerHTML = rows
    .map((r) => {
      const parts = typeof r.parts === 'string' ? [{ text: r.parts }] : r.parts;
      const html = parts.map((p) => `<span class="${p.strong ? 'tip-strong' : 'tip-part'}">${escapeHtml(p.text)}</span>`).join('');
      return `<div class="tip-row${r.accent ? ' timezone-' + r.accent : ''}">${html}</div>`;
    })
    .join('');
}

function place(ev) {
  const margin = 8;
  const w = stackEl.offsetWidth;
  const h = stackEl.offsetHeight;
  let left = ev.clientX + 14;
  let top = ev.clientY + 18;
  if (left + w > window.innerWidth - margin) left = ev.clientX - w - 14;
  if (top + h > window.innerHeight - margin) top = ev.clientY - h - 14;
  stackEl.style.left = `${Math.max(margin, left)}px`;
  stackEl.style.top = `${Math.max(margin, top)}px`;
}

function hide() {
  if (!stackEl) return;
  stackEl.hidden = true;
  lastKey = '';
  clearInterval(tickTimer);
  tickTimer = null;
}

function update() {
  const rows = lastEv ? collectRows(lastEv) : [];
  if (!rows.length) return hide();
  render(rows);
  stackEl.hidden = false;
  place(lastEv);
  // Clocks (and anything else a provider recomputes over time) keep running while the cursor rests.
  if (!tickTimer) tickTimer = setInterval(update, 1000);
}

export function initTooltips() {
  if (started) return;
  started = true;
  // No hover (touch-only devices): native title tooltips don't appear there either.
  if (!window.matchMedia('(hover: hover)').matches) return;
  stackEl = document.createElement('div');
  stackEl.className = 'tip-stack';
  stackEl.hidden = true;
  document.body.appendChild(stackEl);
  // Capture phase: runs before the browser decides to show its tooltip for the new element.
  document.addEventListener('pointerover', (ev) => adoptTitles(ev.target), true);
  document.addEventListener('mousemove', (ev) => {
    lastEv = ev;
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    }
  });
  document.documentElement.addEventListener('mouseleave', () => {
    lastEv = null;
    hide();
  });
  window.addEventListener('blur', () => {
    lastEv = null;
    hide();
  });
  // A press or a wheel turn starts something else (drag, zoom, menu): drop the tip until the next move.
  for (const type of ['pointerdown', 'wheel']) {
    document.addEventListener(type, () => hide(), true);
  }
}
