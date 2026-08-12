// A searchable, sortable checklist for picking which states/cities are
// allowed to appear in a quiz round pool — same look and search/sort
// behavior as OverviewBoard's side panel list (js/overviewBoard.js), reused
// here as a standalone component so it can be dropped into any settings
// panel (currently: "Найди штат" and "Найди город"'s pre-game settings) and
// extended to other lists later without duplicating the list logic again.
//
// Selection persists to localStorage per (level, kind) so it survives a
// reload; missing/corrupt/stale storage (e.g. an id that no longer exists
// in this level's data) falls back to "everything selected".
export class EligibilityList {
  constructor(container, items, opts = {}) {
    this.container = container;
    this.items = items;
    this.kind = opts.kind; // 'states' | 'cities' | 'places' | 'seas' — see _areaOf/_mainColumnHtml for what each actually changes
    this.storageKey = opts.storageKey;
    this.onChange = opts.onChange || (() => {});
    // Optional extra column (e.g. "Найди штат"'s adaptive-mode success
    // streak) — omit both to keep the plain name/area layout.
    this.getStat = opts.getStat || null;
    this.statLabel = opts.statLabel || '';
    this.searchQuery = '';
    this.sortBy = null; // null (alphabetical) | 'area' | 'stat'
    this.sortDir = 'desc';
    this.selected = this._loadSelection();
    this._build();
  }

  getSelectedIds() {
    return this.selected;
  }

  // States, seas, and countries all carry a real precomputed `.area` (km²,
  // built into the level data); cities/places only store a radius, so
  // their area is derived (they're rendered as a circle of that radius to
  // begin with).
  _areaOf(it) {
    return this.kind === 'states' || this.kind === 'seas' || this.kind === 'countries' ? it.area : Math.PI * it.radiusKm * it.radiusKm;
  }

  // 'states': short `.id` codes (AL, CA…) fit a dedicated abbreviation
  // column. 'cities': capital/silhouette markers + a state sub-label.
  // Everything else ('places', 'seas', 'countries' — a country's `.id` is
  // its ISO_A3 code where one exists, but ~20% fall back to a full
  // slugify(name) like "south_ossetia" when it doesn't, so it's not
  // reliably short either) just gets a plain name — this used to fall
  // into the 'cities' template by default, which rendered a literal
  // "undefined" sub-label for anything without a `.state` field.
  _mainColumnHtml(it) {
    if (this.kind === 'states') {
      return `<span class="overview-item-main"><span class="overview-item-abbr">${it.id}</span><span class="overview-item-name">${it.ru}</span></span>`;
    }
    if (this.kind === 'cities') {
      return `<span class="overview-item-main"><span class="overview-item-name">${it.ru}${it.capital ? ' ★' : ''}${it.d ? ' ◆' : ''}</span><span class="overview-item-sub">${it.state || ''}</span></span>`;
    }
    return `<span class="overview-item-main"><span class="overview-item-name">${it.ru}</span></span>`;
  }

  _loadSelection() {
    const all = () => new Set(this.items.map((it) => it.id));
    if (!this.storageKey) return all();
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return all();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return all();
      const validIds = new Set(this.items.map((it) => it.id));
      const restored = new Set(arr.filter((id) => validIds.has(id)));
      // Stored-but-now-empty (e.g. corrupted data) is treated the same as
      // "nothing saved yet" — an empty pool on first load would be a
      // confusing, silently-broken default.
      return restored.size ? restored : all();
    } catch {
      return all();
    }
  }

  _saveSelection() {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify([...this.selected]));
    } catch {
      // Storage can fail (private browsing, quota, disabled) — selection
      // still works for the current session, it just won't persist.
    }
  }

  _build() {
    this.container.innerHTML = `
      ${this.getStat ? `
      <div class="elig-familiarity">
        <span class="elig-familiarity-label">Знакомство с картой</span>
        <span class="elig-familiarity-value"></span>
      </div>` : ''}
      <div class="elig-header">
        <span class="elig-count"></span>
        <div class="elig-bulk">
          <button type="button" class="elig-bulk-btn" data-bulk="all">Все</button>
          <button type="button" class="elig-bulk-btn" data-bulk="none">Никого</button>
        </div>
      </div>
      <input type="text" class="overview-search" placeholder="Поиск..." autocomplete="off" />
      <div class="overview-list-header${this.getStat ? ' overview-list-header-with-stat' : ''}">
        <span class="overview-col-name">Название</span>
        <button type="button" class="overview-col-sort" data-sort="area">Площадь<span class="overview-sort-arrow" data-arrow="area"></span></button>
        ${this.getStat ? `<button type="button" class="overview-col-sort overview-col-stat" data-sort="stat">${this.statLabel}<span class="overview-sort-arrow" data-arrow="stat"></span></button>` : ''}
      </div>
      <div class="overview-list-scroll"><div class="overview-item-list"></div></div>
    `;
    this.searchInput = this.container.querySelector('.overview-search');
    this.itemListEl = this.container.querySelector('.overview-item-list');
    this.arrowEls = this.container.querySelectorAll('.overview-sort-arrow');
    this.countEl = this.container.querySelector('.elig-count');
    this.familiarityValueEl = this.container.querySelector('.elig-familiarity-value');

    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value.trim().toLowerCase();
      this._renderList();
    });
    this.container.querySelectorAll('.overview-col-sort[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        this.sortDir = this.sortBy === key && this.sortDir === 'desc' ? 'asc' : 'desc';
        this.sortBy = key;
        this._renderList();
      });
    });
    this.container.querySelector('[data-bulk="all"]').addEventListener('click', () => {
      this.selected = new Set(this.items.map((it) => it.id));
      this._commit();
    });
    this.container.querySelector('[data-bulk="none"]').addEventListener('click', () => {
      this.selected = new Set();
      this._commit();
    });

    this._renderList();
  }

  _commit() {
    this._saveSelection();
    this._renderList();
    this.onChange(this.selected);
  }

  _updateCount() {
    this.countEl.textContent = `Выбрано: ${this.selected.size} из ${this.items.length}`;
  }

  // (Количество штатов/городов со success > 0) / всего * 100% — показывает,
  // со сколькими элементами игрок вообще успешно справлялся хоть раз, вне
  // зависимости от текущего поиска/сортировки (поэтому считаем по
  // this.items, а не по filtered/sorted).
  _updateFamiliarity() {
    if (!this.familiarityValueEl) return;
    const known = this.items.filter((it) => this.getStat(it) > 0).length;
    const pct = Math.round((known / this.items.length) * 100);
    this.familiarityValueEl.textContent = `${pct}%`;
    this.familiarityValueEl.title = `${known} из ${this.items.length}`;
  }

  _renderList() {
    const q = this.searchQuery;
    const filtered = q
      ? this.items.filter((it) => it.ru.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q))
      : this.items;

    let sorted;
    if (this.sortBy === 'area') {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      sorted = [...filtered].sort((a, b) => (this._areaOf(a) - this._areaOf(b)) * dir);
    } else if (this.sortBy === 'stat' && this.getStat) {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      sorted = [...filtered].sort((a, b) => (this.getStat(a) - this.getStat(b)) * dir);
    } else {
      sorted = [...filtered].sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));
    }
    this.arrowEls.forEach((el) => {
      el.textContent = this.sortBy === el.dataset.arrow ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    });
    this._updateCount();
    if (this.getStat) this._updateFamiliarity();

    this.itemListEl.innerHTML = '';
    if (!sorted.length) {
      this.itemListEl.innerHTML = '<p class="overview-empty">Ничего не найдено</p>';
      return;
    }

    for (const it of sorted) {
      const row = document.createElement('label');
      row.className = 'overview-item elig-item' + (this.getStat ? ' elig-item-with-stat' : '');
      const areaStr = Math.round(this._areaOf(it)).toLocaleString('ru-RU') + ' км²';
      const checked = this.selected.has(it.id);
      const statHtml = this.getStat ? `<span class="overview-item-stat">${this.getStat(it)}</span>` : '';
      row.innerHTML = `<input type="checkbox" class="elig-checkbox"${checked ? ' checked' : ''} />${this._mainColumnHtml(it)}<span class="overview-item-area">${areaStr}</span>${statHtml}`;
      row.querySelector('.elig-checkbox').addEventListener('change', (ev) => {
        if (ev.target.checked) this.selected.add(it.id);
        else this.selected.delete(it.id);
        this._saveSelection();
        this._updateCount();
        this.onChange(this.selected);
      });
      this.itemListEl.appendChild(row);
    }
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
