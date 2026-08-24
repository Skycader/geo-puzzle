export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Small deterministic string hash (djb2) used to derive stable tab/blank
// signs for jigsaw edges so both neighboring pieces agree without needing
// shared mutable state.
export function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

// Shoelace formula — unsigned area of a closed polygon (`points` need not
// repeat the first point at the end; the closing edge is implicit). Used
// by overviewBoard.js's ruler tool to turn 3+ placed points into an area
// reading, in whatever unit² the input points are in (native map units —
// callers convert to real km² by multiplying by kmPerUnit²).
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Weighted random sample, no replacement — repeatedly draws one item
// proportional to its current weight and removes it from the pool, so
// earlier draws don't change the RELATIVE odds among what's left. Used by
// quizBoard.js's adaptive mode to favor states with a low success streak
// without ever making a well-known state literally impossible to draw.
export function weightedSampleWithoutReplacement(items, getWeight, k) {
  const pool = items.map((it) => ({ it, w: Math.max(getWeight(it), 1e-6) }));
  const picked = [];
  while (picked.length < k && pool.length) {
    const total = pool.reduce((sum, p) => sum + p.w, 0);
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool[idx].it);
    pool.splice(idx, 1);
  }
  return picked;
}

// Smallest bbox [minX,minY,maxX,maxY] containing every input bbox — used by
// journeyNameBoard.js/game.js's Journey mode to frame the camera around
// several states' pieces at once (see zoomPan.js's focusOnBBox).
export function unionBBox(bboxes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x0, y0, x1, y1] of bboxes) {
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  }
  return [minX, minY, maxX, maxY];
}

// Standard edit distance (insert/delete/substitute, each cost 1) — used by
// nameStateBoard.js's hard-difficulty text input to tell "close enough,
// just a typo" apart from "not a real state name" without requiring exact
// spelling.
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
