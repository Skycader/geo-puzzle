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

// Coin balance chip in the topbar (index.html) — the flight's landing
// spot, looked up fresh on every call rather than cached, since which
// element that is never changes but its on-screen POSITION does (window
// resizes, HUD wrapping to a second row, etc). The flight targets the
// coin-icon SVG specifically, not the whole button — the button also
// contains the balance number (#coin-balance-value), so the BUTTON's own
// center drifts away from the actual coin glyph as the number's digit
// count changes width.
const BALANCE_EL_ID = 'coin-balance';
const BALANCE_ICON_SELECTOR = '.coin-icon';
const coin_flight = 1000; //ms

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

// Spawns a coin at (fromX, fromY) — viewport/client coordinates, e.g. from
// a correct answer's own on-screen position (the state shape, the clicked
// dot, the dropped pin…) — and flies it in an arc up into the topbar's
// balance chip. `amount` is credited via addCoins() ONLY once the coin
// actually lands (not up front) — the displayed balance shouldn't jump
// before the coin visually arrives. If the balance chip isn't on screen
// for some reason, the reward is still credited immediately as a fallback
// (better than silently dropping a reward the player earned) — only the
// animation itself is skipped.
//
// Driven by a manual rAF loop rather than a CSS offset-path transition —
// offset-path's anchor point (where the box "attaches" to the path) turned
// out to disagree with the (left, top) + negative-margin centering trick
// used to position the coin, landing it consistently off-target instead of
// exactly on the balance chip. Computing the quadratic-Bézier point
// ourselves and applying it as a plain `translate()` has no such ambiguity:
// at t=1 the translate is exactly (dx, dy), so the coin's own (left, top)
// + translate always ends up exactly at the chip's center.
export function flyCoinToBalance(fromX, fromY, amount) {
  const target = document.getElementById(BALANCE_EL_ID);
  if (!target) {
    addCoins(amount);
    return;
  }
  const icon = target.querySelector(BALANCE_ICON_SELECTOR) || target;
  const rect = icon.getBoundingClientRect();
  const toX = rect.left + rect.width / 2;
  const toY = rect.top + rect.height / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;

  const coin = document.createElement('div');
  coin.className = 'flying-coin';
  coin.style.left = `${fromX}px`;
  coin.style.top = `${fromY}px`;
  coin.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />' +
    '<circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.65" />' +
    '</svg>';
  document.body.appendChild(coin);

  // "Вправо-наверх" (up and to the right) as a curve, not a straight
  // line — a quadratic Bézier bowed above the straight start->end line
  // gives that "tossed" arc rather than a flat slide. The bow is measured
  // from the line's own midpoint and capped, rather than measured from
  // y=0 — the balance chip sits near the very top of the screen already,
  // so an un-capped bow could pull the control point past the endpoint's
  // own height, making the coin overshoot above the chip and swoop back
  // down into it instead of arcing straight up into it.
  const midX = dx * 0.5;
  const midY = dy * 0.5;
  const dist = Math.hypot(dx, dy);
  const bow = Math.min(140, dist * 0.22 + 30);
  const controlX = midX;
  const controlY = midY - bow;

  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / coin_flight);
    const e = easeOutCubic(t);
    const inv = 1 - e;
    const x = 2 * inv * e * controlX + e * e * dx;
    const y = 2 * inv * e * controlY + e * e * dy;
    coin.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      coin.remove();
      addCoins(amount);
      target.classList.add('coin-balance-pulse');
      setTimeout(() => target.classList.remove('coin-balance-pulse'), 250);
    }
  };
  requestAnimationFrame(step);
}
