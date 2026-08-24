// BFS chain-picking over levels/usaRouteGraph.js's state-adjacency graph
// (scripts/build_usa_route_graph.js) — powers "Путешествие" mode's random
// state-pair selection (js/game.js's _startJourney).

// Shortest state-hop path between two states, recording which highway
// (routeId/routeNumber) connects each consecutive pair AS it's found
// during the search — avoids a separate post-hoc re-scan that would have
// no defined tie-break when two different Interstates connect the same
// pair of states.
export function bfsChain(routeGraph, startId, endId) {
  if (startId === endId) return null;
  const cameFrom = new Map(); // stateId -> { from, routeId, routeNumber }
  const visited = new Set([startId]);
  const queue = [startId];
  let qi = 0;
  while (qi < queue.length) {
    const curr = queue[qi++];
    if (curr === endId) break;
    for (const edge of routeGraph.adjacency[curr] || []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      cameFrom.set(edge.to, { from: curr, routeId: edge.routeId, routeNumber: edge.routeNumber, baseRouteId: edge.baseRouteId });
      queue.push(edge.to);
    }
  }
  if (!visited.has(endId)) return null;

  const chain = [endId];
  const hops = [];
  let curr = endId;
  while (curr !== startId) {
    const step = cameFrom.get(curr);
    hops.unshift({ from: step.from, to: curr, routeId: step.routeId, routeNumber: step.routeNumber, baseRouteId: step.baseRouteId });
    chain.unshift(step.from);
    curr = step.from;
  }
  return { chain, hops };
}

// Random-samples pairs from candidateIds, retries until the shortest
// chain's "states between" (chain.length - 2, excluding both endpoints)
// falls within [minBetween, maxBetween], or gives up after maxAttempts.
export function pickJourneyPair(candidateIds, routeGraph, { minBetween, maxBetween, maxAttempts = 500 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const i = Math.floor(Math.random() * candidateIds.length);
    let j = Math.floor(Math.random() * candidateIds.length);
    if (j === i) j = (j + 1) % candidateIds.length;
    const startId = candidateIds[i];
    const endId = candidateIds[j];
    const result = bfsChain(routeGraph, startId, endId);
    if (!result) continue;
    const between = result.chain.length - 2;
    if (between < minBetween || between > maxBetween) continue;
    return { startId, endId, chain: result.chain, hops: result.hops };
  }
  return null;
}
