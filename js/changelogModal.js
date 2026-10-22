import { APP_VERSION, RELEASES } from './version.js';
import { t } from './i18n.js';

// "CHANGELOG" modal: one tab per release in RELEASES, each showing changelog/<version>.md
// rendered with a tiny markdown subset (headings, lists, **bold**, `code`, [links](https://…)).
// Opened from the version button in the topbar; closed by ×, Esc, or a click on the backdrop.

const SVG_DOC =
  '<svg class="cl-head-ico" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">' +
  '<path d="M8 3.5H20L25.5 9V28.5H8Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"></path>' +
  '<path d="M19.5 3.5V9.5H25.5M12 14.5H21.5M12 18.5H21.5M12 22.5H18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '</svg>';
const SVG_X =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2L12 12M12 2L2 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// Markdown subset -> HTML (input is escaped first, so file content can't inject markup).
export function renderMarkdown(md) {
  const out = [];
  let list = false;
  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length + 1} class="cl-h${heading[1].length}">${inline(heading[2])}</h${heading[1].length + 1}>`);
    } else if (item) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(item[1])}</li>`);
    } else if (line.trim()) {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    } else {
      closeList();
    }
  }
  closeList();
  return out.join('\n');
}

let overlay = null;
let keyHandler = null;

export function closeChangelog() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}

async function showRelease(version, tabsEl, bodyEl) {
  for (const tab of tabsEl.children) tab.classList.toggle('active', tab.dataset.version === version);
  bodyEl.innerHTML = '<div class="cl-msg">…</div>';
  let html;
  try {
    // no-store: the notes are hand-edited, a cached copy would hide edits (same as the info JSON files).
    const res = await fetch(`./changelog/${version}.md`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    html = renderMarkdown(await res.text());
  } catch {
    html = `<div class="cl-msg">${escapeHtml(t('changelogMissing').replace(/\{v\}/g, version))}</div>`;
  }
  if (overlay) bodyEl.innerHTML = html; // the modal may have been closed while loading
}

export function openChangelog(version = APP_VERSION) {
  closeChangelog();
  overlay = document.createElement('div');
  overlay.className = 'cl-overlay';
  overlay.innerHTML = `
    <div class="cl-modal" role="dialog" aria-modal="true" aria-label="${t('changelogTitle')}">
      <div class="cl-head">
        ${SVG_DOC}
        <div class="cl-title">${t('changelogTitle')}</div>
        <button class="cl-x" type="button" aria-label="${t('changelogClose')}" title="${t('changelogClose')}">${SVG_X}</button>
      </div>
      <div class="cl-content">
        <div class="cl-tabs"></div>
        <div class="cl-body"></div>
      </div>
    </div>`;
  const tabsEl = overlay.querySelector('.cl-tabs');
  const bodyEl = overlay.querySelector('.cl-body');
  for (const v of RELEASES) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'cl-tab';
    tab.dataset.version = v;
    tab.innerHTML = `<b>${escapeHtml(v)}.md</b>`;
    tab.addEventListener('click', () => showRelease(v, tabsEl, bodyEl));
    tabsEl.appendChild(tab);
  }
  overlay.querySelector('.cl-x').addEventListener('click', closeChangelog);
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) closeChangelog();
  });
  keyHandler = (ev) => {
    if (ev.key === 'Escape') closeChangelog();
  };
  window.addEventListener('keydown', keyHandler);
  document.body.appendChild(overlay);
  showRelease(RELEASES.includes(version) ? version : RELEASES[0], tabsEl, bodyEl);
}
