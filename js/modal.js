import { t } from './i18n.js';

// The app's one modal window (header with icon / title / close ×, scrolling content): used by the
// changelog and the "Номера штатов" info. `openModal` returns the empty content element for the
// caller to fill; Esc, the × and a click on the backdrop close it. Only one modal at a time.

const SVG_DOC =
  '<svg class="app-modal-ico" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">' +
  '<path d="M8 3.5H20L25.5 9V28.5H8Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"></path>' +
  '<path d="M19.5 3.5V9.5H25.5M12 14.5H21.5M12 18.5H21.5M12 22.5H18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '</svg>';
const SVG_INFO =
  '<svg class="app-modal-ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="3.5" y="3.5" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"></rect>' +
  '<path d="M12 10.5v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path>' +
  '<rect x="11" y="6" width="2" height="2.5" fill="currentColor"></rect></svg>';
const SVG_X =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2L12 12M12 2L2 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>';
export const MODAL_ICONS = { doc: SVG_DOC, info: SVG_INFO };

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Markdown subset -> HTML (input is escaped first, so file content can't inject markup):
// `#`–`###` headings, `-` lists, **bold**, `code`, [links](https://…), paragraphs.
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export { inline as renderInlineMarkdown };

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
      out.push(`<h${heading[1].length + 1} class="modal-h${heading[1].length}">${inline(heading[2])}</h${heading[1].length + 1}>`);
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

export function closeModal() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}

// -> { contentEl, close }. `icon`: 'doc' | 'info'.
export function openModal({ title, icon = 'doc' }) {
  closeModal();
  overlay = document.createElement('div');
  overlay.className = 'app-modal-overlay';
  overlay.innerHTML = `
    <div class="app-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="app-modal-head">
        ${MODAL_ICONS[icon] ?? SVG_DOC}
        <div class="app-modal-title">${escapeHtml(title)}</div>
        <button class="app-modal-x" type="button" aria-label="${t('changelogClose')}" title="${t('changelogClose')}">${SVG_X}</button>
      </div>
      <div class="app-modal-content"></div>
    </div>`;
  overlay.querySelector('.app-modal-x').addEventListener('click', closeModal);
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) closeModal();
  });
  keyHandler = (ev) => {
    if (ev.key === 'Escape') closeModal();
  };
  window.addEventListener('keydown', keyHandler);
  document.body.appendChild(overlay);
  return { contentEl: overlay.querySelector('.app-modal-content'), close: closeModal };
}
