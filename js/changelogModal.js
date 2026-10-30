import { APP_VERSION, RELEASES } from './version.js';
import { t } from './i18n.js';
import { openModal, renderMarkdown, escapeHtml } from './modal.js';

// "CHANGELOG" modal: one tab per release in RELEASES, each showing changelog/<version>.md
// rendered with a tiny markdown subset (js/modal.js's renderMarkdown). Opened from the version
// button in the topbar.

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
  if (bodyEl.isConnected) bodyEl.innerHTML = html; // the modal may have been closed while loading
}

export function openChangelog(version = APP_VERSION) {
  const { contentEl } = openModal({ title: t('changelogTitle'), icon: 'doc' });
  contentEl.innerHTML = '<div class="cl-tabs"></div><div class="modal-body"></div>';
  const tabsEl = contentEl.querySelector('.cl-tabs');
  const bodyEl = contentEl.querySelector('.modal-body');
  for (const v of RELEASES) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'cl-tab';
    tab.dataset.version = v;
    tab.innerHTML = `<b>${escapeHtml(v)}.md</b>`;
    tab.addEventListener('click', () => showRelease(v, tabsEl, bodyEl));
    tabsEl.appendChild(tab);
  }
  showRelease(RELEASES.includes(version) ? version : RELEASES[0], tabsEl, bodyEl);
}
