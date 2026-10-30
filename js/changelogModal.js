import { RELEASES } from './version.js';
import { t } from './i18n.js';
import { openModal, renderMarkdown, escapeHtml } from './modal.js';

// "CHANGELOG" modal: accordion list of RELEASES. Newest starts open and loads
// changelog/<version>.md; older entries lazy-load on expand. Fetched HTML is
// kept in-memory so re-expanding does not refetch.

const releaseHtmlCache = new Map();

async function fetchReleaseHtml(version) {
  if (releaseHtmlCache.has(version)) return releaseHtmlCache.get(version);
  try {
    // no-store: the notes are hand-edited; a cached HTTP copy would hide edits.
    const res = await fetch(`./changelog/${version}.md`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const html = renderMarkdown(await res.text());
    releaseHtmlCache.set(version, html);
    return html;
  } catch {
    // Do not cache failures — a later expand can retry after the file appears.
    return `<div class="cl-msg">${escapeHtml(t('changelogMissing').replace(/\{v\}/g, version))}</div>`;
  }
}

async function expandItem(item) {
  const version = item.dataset.version;
  const head = item.querySelector('.cl-item-head');
  const body = item.querySelector('.cl-item-body');
  item.classList.add('open');
  head.setAttribute('aria-expanded', 'true');
  body.hidden = false;
  if (body.dataset.loaded === '1') return;
  body.innerHTML = '<div class="cl-msg">…</div>';
  const html = await fetchReleaseHtml(version);
  if (!body.isConnected) return; // modal closed while loading
  body.innerHTML = html;
  body.dataset.loaded = '1';
}

function collapseItem(item) {
  const head = item.querySelector('.cl-item-head');
  const body = item.querySelector('.cl-item-body');
  item.classList.remove('open');
  head.setAttribute('aria-expanded', 'false');
  body.hidden = true;
}

export function openChangelog(version = RELEASES[0]) {
  // Default: newest release (RELEASES is newest-first). Optional `version` opens that row instead.
  const initial = RELEASES.includes(version) ? version : RELEASES[0];
  const { contentEl } = openModal({ title: t('changelogTitle'), icon: 'doc' });
  contentEl.innerHTML = '<div class="cl-list"></div>';
  const listEl = contentEl.querySelector('.cl-list');

  for (const v of RELEASES) {
    const item = document.createElement('div');
    item.className = 'cl-item';
    item.dataset.version = v;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'cl-item-head';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML =
      `<span class="cl-item-label">${escapeHtml(v)}</span>` +
      `<span class="cl-item-chevron" aria-hidden="true">▸</span>`;

    const body = document.createElement('div');
    body.className = 'cl-item-body modal-body';
    body.hidden = true;

    head.addEventListener('click', () => {
      if (item.classList.contains('open')) collapseItem(item);
      else expandItem(item);
    });

    item.appendChild(head);
    item.appendChild(body);
    listEl.appendChild(item);
  }

  const initialItem = listEl.querySelector(`.cl-item[data-version="${CSS.escape(initial)}"]`);
  if (initialItem) expandItem(initialItem);
}
