// Overview camera <-> URL hash, so a reload or a shared link reopens the same map view:
//   #overview?level=countries&z=3.32&x=345.2&y=210.8
// level = level id; z = zoom; x, y = the view's center in the level's native canvas
// units (the same units as the pieces' cx/cy). Only Overview writes it (replaceState,
// so panning doesn't pile up history entries); every other screen clears it.
const PREFIX = '#overview?';
// Overview zoom is uncapped in zoomPan (deep place/telescope views reach thousands);
// this only rejects absurd/corrupt values so a bad link still falls back to the menu
// instead of hanging the board on NaN/Infinity.
const MAX_ZOOM = 1e7;

// -> { levelId, zoom, x, y } | null when the hash isn't a valid Overview view.
// A valid level with a missing/out-of-range camera still restores Overview (zoom/x/y
// omitted) — better than dumping the player into the menu after a deep-zoom reload.
export function readOverviewView(levels) {
  if (!location.hash.startsWith(PREFIX)) return null;
  const params = new URLSearchParams(location.hash.slice(PREFIX.length));
  const levelId = params.get('level');
  if (!levelId || !(levelId in levels)) return null;
  const zoom = Number(params.get('z'));
  const x = Number(params.get('x'));
  const y = Number(params.get('y'));
  if (![zoom, x, y].every(Number.isFinite) || zoom <= 0 || zoom > MAX_ZOOM) {
    return { levelId, zoom: null, x: null, y: null };
  }
  return { levelId, zoom, x, y };
}

export function writeOverviewView(levelId, { zoom, x, y }) {
  const hash = `${PREFIX}level=${encodeURIComponent(levelId)}&z=${zoom.toFixed(2)}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`;
  try {
    history.replaceState(null, '', hash);
  } catch {
    // history can be unavailable (sandboxed frames) — the URL just stays as it was
  }
}

export function clearOverviewView() {
  if (!location.hash) return;
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    // see writeOverviewView
  }
}
