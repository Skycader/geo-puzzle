// Backup/restore of everything this game persists to localStorage — coin
// balance, adaptive-mode success streaks, per-list eligibility selections,
// last-used settings, color scheme. Exported as one JSON file the player
// can save externally and re-import later (e.g. after clearing browser
// data, or to move progress to another browser/device) — there's no
// server-side account system, localStorage is the only copy that exists.
//
// Every key this game writes uses one of two prefixes (checked against
// actual usage: 'geoPuzzle' for single-value settings like the coin
// balance, 'geo-puzzle:' for the per-level/per-scope dynamic ones like
// adaptive-mode streaks) — sweeping up anything matching either, rather
// than hardcoding each individual feature's key, means a future persisted
// feature is included in export/import automatically as long as it
// follows the same naming convention.
const KEY_PREFIXES = ['geoPuzzle', 'geo-puzzle:'];
const FORMAT_VERSION = 1;

function isOwnKey(key) {
  return KEY_PREFIXES.some((p) => key.startsWith(p));
}

export function exportProgressData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isOwnKey(key)) data[key] = localStorage.getItem(key);
  }
  return { version: FORMAT_VERSION, exportedAt: new Date().toISOString(), data };
}

// Triggers a browser download of the current progress as a JSON file —
// an in-memory Blob + a throwaway <a download>, no server round-trip.
export function downloadProgressExport() {
  const payload = exportProgressData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = payload.exportedAt.slice(0, 10);
  a.href = url;
  a.download = `geo-puzzle-progress-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Reads and validates a File (from an <input type="file"> change event),
// restoring every recognized key. Throws an Error with a player-facing
// Russian message on anything that doesn't look like our own export —
// callers are expected to catch and display it. Returns the number of
// keys actually restored on success.
export async function importProgressFile(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Файл повреждён или это не JSON.');
  }
  if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
    throw new Error('Это не похоже на файл экспорта GEO PUZZLE.');
  }
  const entries = Object.entries(payload.data).filter(([key, value]) => isOwnKey(key) && typeof value === 'string');
  if (!entries.length) {
    throw new Error('В файле не нашлось данных для восстановления.');
  }
  for (const [key, value] of entries) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can fail (quota, disabled, private browsing) — best-effort,
      // whatever DID fit is still restored.
    }
  }
  return entries.length;
}
