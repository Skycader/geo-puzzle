import { openModal, renderInlineMarkdown, escapeHtml } from './modal.js';
import { getLang, t, itemName } from './i18n.js';
import { STATEHOOD, STATEHOOD_TEXT } from '../levels/usaStatehood.js';

// The "(i)" window of the "Номера штатов" mode: why the numbers are what they are, the table of
// admission dates, and a few facts. `level` supplies the state names (levels/usa.js pieces).
export function openStateNumbersInfo(level) {
  const lang = getLang() === 'en' ? 'en' : 'ru';
  const txt = STATEHOOD_TEXT[lang];
  const byId = new Map(level.pieces.map((p) => [p.id, p]));
  const dateFmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const rows = STATEHOOD.map((s) => {
    const piece = byId.get(s.id);
    const tie = s.id === 'ND' || s.id === 'SD' ? '*' : '';
    return `<div class="sn-row${s.order <= 13 ? ' sn-row-original' : ''}">
      <span class="sn-row-no">${s.order}</span>
      <span class="sn-row-name">${escapeHtml(piece ? itemName(piece) : s.id)}${tie}</span>
      <span class="sn-row-date">${dateFmt.format(new Date(`${s.date}T00:00:00Z`))}</span>
    </div>`;
  }).join('');

  const { contentEl } = openModal({ title: t('stateNumbersTitle'), icon: 'info' });
  contentEl.innerHTML = `
    <div class="modal-body sn-info">
      ${txt.why.map((p) => `<p>${renderInlineMarkdown(p)}</p>`).join('')}
      <h3 class="modal-h2">${txt.tableHeading}</h3>
      <p class="sn-note">${txt.originalNote}</p>
      <div class="sn-table">${rows}</div>
      <p class="sn-note">${txt.tieNote}</p>
      <h3 class="modal-h2">${txt.factsHeading}</h3>
      <ul>${txt.facts.map((f) => `<li>${renderInlineMarkdown(f)}</li>`).join('')}</ul>
    </div>`;
}
