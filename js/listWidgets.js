import { t } from './i18n.js';

// Shared by OverviewBoard's side panel and EligibilityList — both render
// the same city rows and the same search box.

// ★ = state capital, ◆ = drawn with a real municipal boundary instead of a
// dot (see scripts/build_city_silhouettes.js); each gets a hover hint.
export function cityMarkersHtml(it) {
  return (
    (it.capital ? ` <span class="overview-marker" title="${t('markerCapital')}">★</span>` : '') +
    (it.d ? ` <span class="overview-marker" title="${t('markerShape')}">◆</span>` : '')
  );
}

// The × is hidden by CSS (:placeholder-shown) whenever the box is empty, so
// it also stays correct when code resets the value (tab switches).
export function searchBoxHtml() {
  return `<div class="overview-search-wrap">
        <input type="text" class="overview-search" placeholder="${t('eligSearch')}" autocomplete="off" />
        <button type="button" class="overview-search-clear" title="${t('searchClear')}" aria-label="${t('searchClear')}">×</button>
      </div>`;
}

export function bindSearchClear(root) {
  const input = root.querySelector('.overview-search');
  root.querySelector('.overview-search-clear').addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
}
