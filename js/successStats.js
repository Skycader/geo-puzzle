// Per-state "success streak" for quizBoard.js's adaptive mode — a single
// counter per state, not a full pass/fail history: answering correctly
// (without ever triggering the hint) increments it, any mistake resets it
// straight to 0. See js/game.js's adaptive-mode checkbox for how this
// drives which states get asked about.
const PREFIX = 'geo-puzzle:success';

export function loadSuccessStats(levelId, scope) {
  try {
    const raw = localStorage.getItem(`${PREFIX}:${levelId}:${scope}`);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

// hinted: true if the player ever saw the hint this round (i.e. made at
// least one mistake) — resets the streak; otherwise it grows by one.
export function recordOutcome(levelId, scope, id, hinted) {
  const stats = loadSuccessStats(levelId, scope);
  stats[id] = hinted ? 0 : (stats[id] || 0) + 1;
  try {
    localStorage.setItem(`${PREFIX}:${levelId}:${scope}`, JSON.stringify(stats));
  } catch {
    // Storage can fail (private browsing, quota, disabled) — the session
    // still plays fine, the streak just won't persist.
  }
  return stats;
}

// Directly sets a streak to an exact value, rather than incrementing/
// resetting it by playing a round — used by Overview's "progress heatmap"
// toggle (js/overviewBoard.js) to let the player manually correct a
// state's count from the map itself.
export function setSuccessCount(levelId, scope, id, value) {
  const stats = loadSuccessStats(levelId, scope);
  stats[id] = value;
  try {
    localStorage.setItem(`${PREFIX}:${levelId}:${scope}`, JSON.stringify(stats));
  } catch {
    // Storage can fail — the change still applies for the current session.
  }
  return stats;
}
