// Builds a highway "which states does this route pass through, in what
// order" dataset, plus the state-to-state adjacency graph derived from it
// (two states are adjacent here if some single Interstate crosses directly
// between them) — powers the "Путешествие" (Journey) mode's route-chaining
// (js/journeyRoute.js) and per-route state sequence (js/journeyNameBoard.js,
// js/puzzleBoard.js's Journey usage).
//
// Nothing upstream computes this today: levels/usaHighways.js only stores
// each route's raw line geometry (build script: scripts/build_usa_highways.js),
// with no state-membership field at all.
//
// Reads levels/usa.js (state polygons + real shared-border `neighbors`,
// already computed by scripts/build_usa_level.js) and levels/usaHighways.js
// (65 Interstate routes) — both already share the identical Albers canvas
// coordinate space, so no reprojection is needed here, just 2D geometry.
//
// Regenerate: node scripts/build_usa_route_graph.js
// (re-run whenever levels/usa.js or levels/usaHighways.js changes)
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// ---- path-string parsing ----
// Both levels/usa.js ("M x,y L x,y ... Z", possibly several M..Z rings per
// state for offshore islands) and levels/usaHighways.js ("M x,y L x,y ...",
// several disjoint M..L subpaths per route, no Z — open lines) use the same
// simple straight-segment-only syntax, so one parser covers both: split on
// M/L tokens, collect each M-started run as its own subpath/ring.
function parsePath(d) {
  const tokens = d.match(/[ML]|-?\d+\.?\d*/g) || [];
  const subpaths = [];
  let current = null;
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === 'M' || tok === 'L') {
      i++;
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      if (tok === 'M') {
        current = [[x, y]];
        subpaths.push(current);
      } else if (current) {
        current.push([x, y]);
      }
    } else {
      i++; // stray number outside an M/L run — shouldn't happen, skip defensively
    }
  }
  return subpaths;
}

// ---- point-in-polygon ----
// Standard even-odd ray cast, one ring. A state's real membership test is
// the OR across ALL of its rings (see pointInRings) — several states (e.g.
// coastal ones with offshore islands, confirmed by grepping levels/usa.js
// for multi-"M" `d` strings) are more than one ring, and each ring is an
// independent landmass, not a hole to subtract.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
function pointInRings(x, y, rings) {
  for (const ring of rings) if (pointInRing(x, y, ring)) return true;
  return false;
}
function bboxOfPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

// ---- ordering: primary (real shared-border adjacency) ----
// If the touched-state set forms a simple path under levels/usa.js's own
// already-trusted `neighbors` adjacency (every real border shared with
// another state on this route), that path IS the true crossing order —
// derived from real geometry, immune to however much the route itself
// bends. Returns null (not applicable) for anything that isn't a clean
// simple path: a branch (route's states aren't a single chain — e.g. it
// clips a state that borders two others also on the route), a cycle, or a
// disconnected touched-set (route jumps between non-adjacent states, e.g.
// briefly leaving and re-entering the interstate system's mapped span).
function tryNeighborOrdering(touchedIds, stateById) {
  const n = touchedIds.length;
  if (n === 1) return touchedIds;
  const idSet = new Set(touchedIds);
  const adj = new Map();
  for (const id of touchedIds) {
    adj.set(id, (stateById.get(id).neighbors || []).filter((nb) => idSet.has(nb)));
  }
  if (touchedIds.some((id) => adj.get(id).length > 2)) return null; // branching
  const ends = touchedIds.filter((id) => adj.get(id).length === 1);
  if (ends.length !== 2) return null; // not exactly one path with 2 ends (0 = cycle/none, >2 impossible given degree<=2 check)
  let edgeCount = 0;
  for (const id of touchedIds) edgeCount += adj.get(id).length;
  edgeCount /= 2;
  if (edgeCount !== n - 1) return null; // must be a tree with n-1 edges (rules out a disconnected touched-set)
  const order = [ends[0]];
  let prev = null;
  let curr = ends[0];
  while (order.length < n) {
    const next = adj.get(curr).find((x) => x !== prev);
    if (!next) return null; // shouldn't happen given the checks above — safety net
    order.push(next);
    prev = curr;
    curr = next;
  }
  return order;
}

// ---- ordering: fallback (PCA projection) ----
// Used only when the touched-state set isn't a clean neighbor-chain.
// Projects every one of the route's own points onto its dominant axis
// (largest-eigenvalue eigenvector of the 2x2 point covariance matrix — a
// closed-form 2x2 solve, no iteration needed) and orders states by the
// MEDIAN projected position of their own points. A documented
// approximation (like this project's other "real underlying data,
// pragmatic simplification" choices, e.g. TIGER's lengthKm quirk) — a
// route with a sharp bend not well-approximated by one straight axis could
// mis-order two adjacent states; each fallback use is logged below for
// spot-checking.
function pcaOrdering(touchedByState) {
  const allPts = [];
  for (const pts of touchedByState.values()) allPts.push(...pts);
  const n = allPts.length;
  const meanX = allPts.reduce((s, p) => s + p[0], 0) / n;
  const meanY = allPts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of allPts) {
    const dx = x - meanX, dy = y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const lambda1 = trace / 2 + Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  let vx, vy;
  if (Math.abs(sxy) > 1e-9) {
    vx = lambda1 - syy;
    vy = sxy;
  } else {
    vx = sxx >= syy ? 1 : 0;
    vy = sxx >= syy ? 0 : 1;
  }
  const norm = Math.hypot(vx, vy) || 1;
  vx /= norm; vy /= norm;
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const keyed = [...touchedByState.entries()].map(([id, pts]) => ({
    id,
    key: median(pts.map(([x, y]) => (x - meanX) * vx + (y - meanY) * vy)),
  }));
  keyed.sort((a, b) => a.key - b.key);
  return keyed.map((k) => k.id);
}

// ---- split into physically-connected components ----
// The US Interstate system genuinely reuses 2-digit numbers for entirely
// separate, geographically distant segments (e.g. real-world I-84 has an
// Oregon/Idaho/Utah segment AND an unrelated Pennsylvania/Connecticut/
// Massachusetts segment thousands of km apart; I-76/I-86/I-88 have the
// same duplicate-number pattern) — scripts/build_usa_highways.js merges
// every subpath sharing a route number under one `id`/`d`, with no
// awareness of this, so a route's own subpaths can legitimately belong to
// two-plus unrelated physical highways. Treating them as one continuous
// path would fabricate a fake adjacency edge between states that have no
// real road connecting them (confirmed by manual spot-check: an early,
// un-split version of this script produced a UT-PA "i84" edge that doesn't
// exist in reality).
//
// Union-find over each subpath's own endpoints (interior points of one
// subpath are already connected by construction — TIGER segments genuinely
// share endpoints within one real corridor, same technique this project's
// highway-continuity analysis already used once before) — a THRESHOLD_UNITS
// gap is generous enough to bridge the small (single-digit-km) real gaps
// TIGER itself has, while staying far below the thousands-of-km distance
// between genuinely separate reused-number segments.
const CLUSTER_THRESHOLD_UNITS = 30;
function clusterSubpaths(subpaths, threshold) {
  const n = subpaths.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const endpoints = subpaths.map((sp) => [sp[0], sp[sp.length - 1]]);
  for (let i = 0; i < n; i++) {
    const [a0, a1] = endpoints[i];
    for (let j = i + 1; j < n; j++) {
      const [b0, b1] = endpoints[j];
      const d = Math.min(
        Math.hypot(a0[0] - b0[0], a0[1] - b0[1]),
        Math.hypot(a0[0] - b1[0], a0[1] - b1[1]),
        Math.hypot(a1[0] - b0[0], a1[1] - b0[1]),
        Math.hypot(a1[0] - b1[0], a1[1] - b1[1]),
      );
      if (d < threshold) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(...subpaths[i]);
  }
  return [...groups.values()];
}

// ---- main ----
async function main() {
  const { default: usa } = await import(pathToFileURL(path.join(__dirname, '..', 'levels', 'usa.js')));
  const { default: highways } = await import(pathToFileURL(path.join(__dirname, '..', 'levels', 'usaHighways.js')));

  // Alaska/Hawaii are separate inset mini-projections (levels/usa.js's
  // `inset: true` pieces) — usaHighways.js's coordinate space only covers
  // the contiguous 48 states (build_usa_highways.js's own SKIP set), so
  // they'd never match any route's points anyway; excluding them up front
  // just saves the wasted polygon tests.
  const states = usa.pieces.filter((p) => !p.inset);
  const stateById = new Map(states.map((p) => [p.id, p]));
  const stateRings = new Map(states.map((p) => [p.id, parsePath(p.d)]));

  const routeStates = {};
  const adjacency = {};
  // baseRouteId is what runtime code looks up in level.highways when it
  // needs the route's own real d/number (routeId may carry a `-a`/`-b`
  // split suffix — see clusterSubpaths above — that only matters for
  // graph correctness). js/journeyNameBoard.js/puzzleBoard.js don't draw
  // this geometry directly (see their own comments — a dot-to-dot dashed
  // line replaced it, real highway geometry proved unreliable to clip
  // cleanly for a long, many-hop chain) but routeNumber is still shown
  // where useful (e.g. a future "via I-90" label).
  function addEdge(a, b, routeId, routeNumber, baseRouteId) {
    if (!adjacency[a]) adjacency[a] = [];
    if (!adjacency[b]) adjacency[b] = [];
    adjacency[a].push({ to: b, routeId, routeNumber, baseRouteId });
    adjacency[b].push({ to: a, routeId, routeNumber, baseRouteId });
  }

  let fallbackCount = 0;
  const fallbackRoutes = [];
  let splitRouteCount = 0;

  for (const route of highways) {
    const subpaths = parsePath(route.d);
    if (!subpaths.length) continue;
    const components = clusterSubpaths(subpaths, CLUSTER_THRESHOLD_UNITS);
    if (components.length > 1) splitRouteCount++;

    components.forEach((allPoints, componentIndex) => {
      // Only suffix the id when a route genuinely split into 2+ physically
      // separate segments (the common case, 1 component, keeps the plain
      // route.id unchanged) — both still report the same real route.number
      // ("I-84" either way), since that's genuinely correct: they're the
      // same Interstate number, just two unrelated physical roads.
      const routeId = components.length > 1 ? `${route.id}-${String.fromCharCode(97 + componentIndex)}` : route.id;
      const routeBBox = bboxOfPoints(allPoints);

      const candidateStates = states.filter((s) => bboxesOverlap(routeBBox, s.bbox));
      const touchedByState = new Map();
      for (const [x, y] of allPoints) {
        for (const s of candidateStates) {
          if (pointInRings(x, y, stateRings.get(s.id))) {
            if (!touchedByState.has(s.id)) touchedByState.set(s.id, []);
            touchedByState.get(s.id).push([x, y]);
          }
        }
      }
      const touchedIds = [...touchedByState.keys()];
      if (touchedIds.length === 0) return;

      let order = tryNeighborOrdering(touchedIds, stateById);
      if (!order) {
        order = pcaOrdering(touchedByState);
        fallbackCount++;
        fallbackRoutes.push(routeId === route.id ? `I-${route.number}` : `I-${route.number} (${routeId})`);
      }

      routeStates[routeId] = order;
      for (let i = 0; i < order.length - 1; i++) {
        addEdge(order[i], order[i + 1], routeId, route.number, route.id);
      }
    });
  }

  const out =
    `// Auto-generated by scripts/build_usa_route_graph.js from levels/usa.js's\n` +
    `// state polygons/neighbors and levels/usaHighways.js's route geometry.\n` +
    `// See the build script's own comments for the ordering algorithm\n` +
    `// (real shared-border adjacency, falling back to a PCA-projection\n` +
    `// approximation for routes whose touched-state set isn't a clean chain).\n` +
    `// Regenerate: node scripts/build_usa_route_graph.js\n` +
    `export default ${JSON.stringify({ routeStates, adjacency }, null, 2)};\n`;
  const outPath = path.join(__dirname, '..', 'levels', 'usaRouteGraph.js');
  fs.writeFileSync(outPath, out, 'utf8');

  console.error(`routes processed: ${highways.length}`);
  console.error(`routes split into 2+ disconnected physical segments: ${splitRouteCount}`);
  console.error(`PCA fallback used: ${fallbackCount} (${fallbackRoutes.join(', ')})`);
  console.error(`wrote ${outPath}, ${out.length} bytes`);

  // ---- diagnostic: shortest-chain "states between" histogram, to
  // calibrate js/modes.js's JOURNEY_DIFFICULTIES tiers from real numbers
  // instead of guesses. Standalone BFS (deliberately not importing
  // js/journeyRoute.js — scripts/ and js/ don't share code elsewhere in
  // this project either).
  function bfsBetweenCount(a, b) {
    if (a === b) return null;
    const queue = [a];
    const dist = new Map([[a, 0]]);
    while (queue.length) {
      const curr = queue.shift();
      if (curr === b) return dist.get(curr) - 1;
      for (const edge of adjacency[curr] || []) {
        if (dist.has(edge.to)) continue;
        dist.set(edge.to, dist.get(curr) + 1);
        queue.push(edge.to);
      }
    }
    return null;
  }
  const reachableIds = Object.keys(adjacency);
  const histogram = new Map();
  let pairCount = 0;
  for (let i = 0; i < reachableIds.length; i++) {
    for (let j = i + 1; j < reachableIds.length; j++) {
      const between = bfsBetweenCount(reachableIds[i], reachableIds[j]);
      if (between === null) continue;
      pairCount++;
      histogram.set(between, (histogram.get(between) || 0) + 1);
    }
  }
  const sortedKeys = [...histogram.keys()].sort((a, b) => a - b);
  console.error(`states-between histogram over ${pairCount} reachable pairs:`);
  for (const k of sortedKeys) console.error(`  ${k} between: ${histogram.get(k)} pairs`);
}

main();
