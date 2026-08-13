// First pass at a rewards system — a single shared coin balance (not
// per-level/per-mode, unlike successStats.js's streaks), currently only
// earned from identifyStateBoard.js's correct answers. Deliberately
// minimal: no shop, no per-source ledger, just a balance you can earn into
// and "Списать" (write off) back to zero from the topbar.
const STORAGE_KEY = 'geoPuzzleCoins';
// Other tabs/components reacting to a balance change (the topbar chip)
// can't just re-read after calling addCoins/spendAllCoins in the same
// script — they need to know a change happened. A DOM CustomEvent keeps
// this module decoupled from game.js's UI instead of importing it back.
const CHANGE_EVENT = 'geo-puzzle-coins-changed';

export function getCoins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function setCoins(n) {
  try {
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    // Storage can fail (private browsing, quota, disabled) — the balance
    // just won't persist across reloads; still works within the session
    // since getCoins() would keep returning the pre-failure value cached
    // nowhere, so callers always re-read from storage rather than trust
    // an in-memory copy that could drift from it.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { balance: n } }));
}

export function addCoins(amount) {
  const next = getCoins() + amount;
  setCoins(next);
  return next;
}

// "Списать" — zeroes the balance out and reports how much was cleared, so
// the caller can show something like "Списано: 12".
export function spendAllCoins() {
  const spent = getCoins();
  if (spent > 0) setCoins(0);
  return spent;
}

export function onCoinsChanged(handler) {
  const listener = (ev) => handler(ev.detail.balance);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
