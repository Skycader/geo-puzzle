// Builds the "Страны мира" level from the same Natural Earth 10m admin-0
// countries data already powering levels/world.js's land layer, plus a
// small "extra" companion file (Abkhazia/South Ossetia/Transnistria/Crimea,
// extracted from Natural Earth's ne_10m_admin_0_disputed_areas — same
// "pull one feature into its own tiny GeoJSON" technique already used for
// the Sargasso Sea, see scripts/build_world_seas.js) and a precomputed,
// hand-clipped Western Sahara/Morocco split (see below). Emits
// levels/countries.js in the SAME {id, name, ru, cx, cy, bbox, area,
// neighbors, d} piece shape as levels/usa.js's states, so the 4 requested
// game modes (найти/определи/по форме/сосед) reuse quizBoard.js/
// nameStateBoard.js/identifyStateBoard.js/neighborBoard.js completely
// unchanged — no new board classes needed.
//
// Territory ruling (user-specified, not an editorial choice made here):
//   Independent pieces: Taiwan, Kosovo, Palestine, Abkhazia, South Ossetia,
//   Transnistria, Somaliland (Taiwan/Somaliland are already
//   TYPE=='Sovereign country' in the base file; Kosovo/Palestine are
//   TYPE=='Disputed'/'Indeterminate' there and need explicit promotion).
//   Merged into the controlling country: Crimea -> Russia, N. Cyprus ->
//   Turkey, the Moroccan-controlled ~85% of Western Sahara -> Morocco (the
//   remainder is left out entirely, no piece — see the Sahara section
//   below). Left untouched (matches the base data already, no separate
//   piece): Nagorno-Karabakh, Kurdish regions, tribal/rebel zones.
//
// Western Sahara: no dataset traces the Moroccan Berm/Wall as a line, so
// scripts/data/world-w-sahara-morocco.geojson is a ONE-OFF precomputed
// artifact, not something this script derives — it was produced by hand
// via:
//   npx mapshaper w-sahara-only.geojson -clip sahara-morocco-clip.geojson -o world-w-sahara-morocco.geojson
// where sahara-morocco-clip.geojson (kept in scripts/data/ for
// reproducibility) is a rough hand-picked polygon approximating the wall's
// real route (matches Google Maps' general rendering, not a precise trace
// — deliberate, per direction). Regenerating it means re-picking that clip
// polygon, not re-running this script.
//
// Regenerate: node scripts/build_countries_level.js
const fs = require('fs');
const path = require('path');

const LAND_SRC = path.join(__dirname, 'data', 'world-countries-simplified.geojson');
const EXTRA_SRC = path.join(__dirname, 'data', 'world-countries-extra.geojson');
const SAHARA_SRC = path.join(__dirname, 'data', 'world-w-sahara-morocco.geojson');
const land = JSON.parse(fs.readFileSync(LAND_SRC, 'utf8'));
const extra = JSON.parse(fs.readFileSync(EXTRA_SRC, 'utf8'));
const sahara = JSON.parse(fs.readFileSync(SAHARA_SRC, 'utf8'));

// ---- projection + geometry helpers (copied verbatim from
// build_world_seas.js — same equirectangular projection/antimeridian/pole
// handling, same canvas, so a country level built here lines up with the
// existing "Моря и океаны" level's scale if the two are ever compared) ----
const SCALE = 3.2;
function project(lon, lat) {
  return [(lon + 180) * SCALE, (90 - lat) * SCALE];
}
const CANVAS_W = 360 * SCALE;
const CANVAS_H = 180 * SCALE;
const KM_PER_DEGREE_AT_EQUATOR = 111.32;
const KM_PER_UNIT = KM_PER_DEGREE_AT_EQUATOR / SCALE;

const POLE_LAT_EPSILON = 0.01;
function isAtPole(lat) {
  return Math.abs(lat) > 90 - POLE_LAT_EPSILON;
}
function unwrapRingLons(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const pts = first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  const out = [pts[0]];
  let offset = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i][0] - pts[i - 1][0];
    const poleTouch = isAtPole(pts[i][1]) || isAtPole(pts[i - 1][1]);
    if (!poleTouch) {
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    out.push([pts[i][0] + offset, pts[i][1]]);
  }
  return out;
}
function projectRingPoints(ring) {
  return unwrapRingLons(ring).map(([lon, lat]) => project(lon, lat));
}
function ringToPath(ring) {
  const pts = projectRingPoints(ring);
  const xs = pts.map(([x]) => x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const shifts = [0];
  if (minX < 0) shifts.push(CANVAS_W);
  if (maxX > CANVAS_W) shifts.push(-CANVAS_W);
  return shifts.map((shift) => 'M ' + pts.map(([x, y]) => `${(x + shift).toFixed(2)},${y.toFixed(2)}`).join(' L ') + ' Z').join(' ');
}
function geometryToPath(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringToPath).join(' ');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly.map(ringToPath).join(' ')).join(' ');
  return '';
}
function geometryBbox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visitRing = (ring) => {
    for (const [lon, lat] of ring) {
      const [x, y] = project(lon, lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(visitRing);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach(visitRing));
  return [minX, minY, maxX, maxY];
}
function ringArea(ring) {
  const pts = projectRingPoints(ring);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
function geometryArea(geometry) {
  if (geometry.type === 'Polygon') return ringArea(geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((sum, poly) => sum + ringArea(poly[0]), 0);
  return 0;
}
// Standard area-weighted polygon centroid (outer ring only, same
// simplification as ringArea) — used instead of a bbox midpoint for
// cx/cy. A bbox midpoint is just "halfway between the extremes", which
// for an irregularly-shaped or multi-part country can land somewhere that
// isn't part of the country at all — Canada's label used to sit almost
// exactly in Hudson Bay, because the bbox spans from the far Arctic
// islands down to the US border, and the midpoint of THAT range happens
// to fall in the big bay in the middle rather than on solid ground. The
// area-weighted centroid is the actual "center of mass" of the shape (or,
// for a MultiPolygon, the area-weighted average of each part's own
// centroid) — it can't land outside the shape's own parts the way a bbox
// midpoint can.
function ringCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return null; // degenerate ring (a handful of simplification artifacts)
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}
// One centroid+area per constituent polygon (a plain Polygon is just a
// single-part MultiPolygon here) — used both to build the overall
// area-weighted centroid and, for the one country that needs it (USA —
// see classifyUsaPart below), to tell mainland/Alaska/Hawaii's parts
// apart.
function geometryParts(geometry) {
  const parts = [];
  const addRing = (ring) => {
    const c = ringCentroid(projectRingPoints(ring));
    if (c) parts.push(c);
  };
  if (geometry.type === 'Polygon') addRing(geometry.coordinates[0]);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => addRing(poly[0]));
  return parts;
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function decimate(pts, maxPoints) {
  if (pts.length <= maxPoints) return pts;
  const stride = pts.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(pts[Math.floor(i * stride)]);
  return out;
}
// Raw projected vertices, decimated PER RING (not across the whole
// geometry) — used for neighbor-adjacency sampling below. This matters:
// a first pass decimated the flattened whole-geometry point list down to
// 80 total points, which for a country with a long coastline but a SHORT
// shared land border (France, mostly coastline, with a comparatively
// short border with Germany) diluted the sample so badly that the actual
// shared-border vertices got strided out entirely — France stopped
// registering Germany as a neighbor at all. Decimating each ring
// independently (same approach scripts/build_usa_level.js uses) keeps a
// meaningful sample of every ring regardless of how it compares in length
// to the country's other rings.
function collectRawPoints(geometry, maxPerRing) {
  const pts = [];
  const visitRing = (ring) => {
    const projected = ring.map(([lon, lat]) => project(lon, lat));
    for (const pt of decimate(projected, maxPerRing)) pts.push(pt);
  };
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(visitRing);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach(visitRing));
  return pts;
}

// A wide bbox (~full canvas width) means the piece straddles the
// antimeridian and renders as two disconnected on-screen chunks (a single
// label at the bbox center lands in the empty gap between them) — same
// situation and same fix as build_world_seas.js's Pacific/Arctic/Ross Sea
// pieces, just needed here too: Russia's Far East crosses 180°, so its
// bbox is the full canvas width and its center label would float
// somewhere over Africa. Copied verbatim from build_world_seas.js.
// `centroid` is the dominant-part centroid (see dominantPartCentroid,
// below) — used for the common non-split case instead of a bbox midpoint
// (which can land outside the shape entirely) or a plain weighted average
// across every part (which for an archipelago can land in open water
// between islands — see dominantPartCentroid's own comment).
// `parts` is used for the SPLIT case for the exact same reason: the first
// version of this averaged raw boundary points within each x-cluster,
// which for New Zealand (mainland cluster containing BOTH North and South
// Island, separated by Cook Strait) landed the label in the strait
// between them. Gap DETECTION still uses `rawPoints` (much finer-grained
// than `parts`, so it finds the antimeridian seam precisely); only the
// per-cluster label position switched to "that cluster's dominant part".
function computeLabelPoints(rawPoints, parts, centroid) {
  const xs = rawPoints.map(([x]) => x).sort((a, b) => a - b);
  let maxGap = 0;
  let gapAt = 0;
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapAt = xs[i - 1];
    }
  }
  if (maxGap < CANVAS_W * 0.3) {
    return [[+centroid.x.toFixed(1), +centroid.y.toFixed(1)]];
  }
  const splitX = gapAt + maxGap / 2;
  const clusters = [parts.filter((p) => p.x <= splitX), parts.filter((p) => p.x > splitX)].filter((c) => c.length);
  return clusters.map((c) => {
    const d = dominantPartCentroid(c);
    return [+d.x.toFixed(1), +d.y.toFixed(1)];
  });
}

// ---- exclave labeling: match a disconnected part's centroid against
// Natural Earth's admin-1 (state/province) layer to find its real name
// (e.g. Kaliningrad Oblast, Chatham Islands) — generalizes the USA-only
// Alaska/Hawaii hardcoding below to every country. See
// scripts/data/world-admin1-lookup.geojson's own provenance: slimmed
// (name/name_ru/name_en/admin fields only) and simplified (mapshaper
// -simplify 8% keep-shapes, so tiny island provinces don't vanish) from
// Natural Earth's public-domain 10m admin-1 states/provinces layer.
const ADM1_SRC = path.join(__dirname, 'data', 'world-admin1-lookup.geojson');
const admin1Raw = JSON.parse(fs.readFileSync(ADM1_SRC, 'utf8'));
function ringContainsPoint(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function geometryContainsPoint(geometry, lon, lat) {
  const test = (rings) => ringContainsPoint(rings[0], lon, lat) && !rings.slice(1).some((hole) => ringContainsPoint(hole, lon, lat));
  if (geometry.type === 'Polygon') return test(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(test);
  return false;
}
function lonLatBbox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(visit);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach(visit));
  return [minX, minY, maxX, maxY];
}
// Bbox precomputed once per admin-1 feature (4596 of them) so each lookup
// is a cheap bbox reject followed by a point-in-polygon test only for the
// handful of candidates whose bbox actually contains the point.
const admin1Features = admin1Raw.features.map((f) => ({ props: f.properties, geometry: f.geometry, bbox: lonLatBbox(f.geometry) }));
function lookupAdmin1Name(lon, lat) {
  for (const f of admin1Features) {
    const [minX, minY, maxX, maxY] = f.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (geometryContainsPoint(f.geometry, lon, lat)) return f.props.name_ru || f.props.name_en || f.props.name || null;
  }
  return null;
}
function normalizeX(x) {
  const nx = x % CANVAS_W;
  return nx < 0 ? nx + CANVAS_W : nx;
}
// Undoes unwrapRingLons' antimeridian shift for a single part's centroid
// (which can land outside [0, CANVAS_W) if its own ring crossed 180°) so
// the inverse projection below gets a real longitude back.
function partLonLat(part) {
  const x = normalizeX(part.x);
  return { lon: x / SCALE - 180, lat: 90 - part.y / SCALE };
}
// Absolute km² floor for "this disconnected part is worth its own label"
// — deliberately NOT relative to the country's total area (a relative
// cutoff would miss Kaliningrad entirely: ~15,100 km² is under 0.1% of
// Russia's ~17M km², but it's still bigger than several whole countries).
// 500 km² sits comfortably below Chatham Islands (~966) and Kaliningrad
// (~15,100) while filtering out reef-sized islands and small-strait
// simplification noise (first pass at 250 still let through things like
// the Isle of Wight).
const EXCLAVE_AREA_KM2 = 500;
// A country only gets exclave labels at all if one part clearly IS its
// "main body" — otherwise this can't tell a genuine detached exclave
// (Kaliningrad, Cabinda, Zanzibar) from a natural archipelago nation
// where every island is just... part of the country (Indonesia,
// Philippines, Vanuatu — first pass produced 20+ labels for Indonesia
// alone, one per province-sized island, which is not what "USA - Alaska"
// style labeling means). 0.5 means the dominant part alone outweighs
// everything else combined.
const DOMINANT_SHARE_MIN = 0.5;
// Heavily fjorded/coastal countries (Norway, Greece, UK's Highlands) can
// still fragment into many simplification-artifact "parts" even after the
// share gate — capping keeps only the most significant genuine exclaves
// instead of every coastal sliver mapshaper happened to disconnect.
const MAX_EXCLAVES_PER_COUNTRY = 2;
// Base labelPoints (from computeLabelPoints, below) already places a point
// per antimeridian-split cluster, but with no distinguishing name — this
// pass tries to attach a real admin-1 name to any sufficiently large
// non-dominant part, either by renaming the nearest existing cluster point
// (the common case: an antimeridian-split part like Russia's Far East IS
// one of those clusters) or, if none is nearby, adding a brand-new label
// point for a genuine detached exclave (Kaliningrad, Hawaii-style cases
// for non-USA countries, French Guiana, etc.).
function attachExclaveSuffixes(entry, dominant, labelPoints) {
  const suffixes = labelPoints.map(() => null);
  const totalArea = entry.parts.reduce((sum, p) => sum + p.area, 0);
  if (dominant.area / totalArea < DOMINANT_SHARE_MIN) return suffixes; // no clear "main body" — natural archipelago, not an exclave situation
  const bestByName = new Map();
  for (const part of entry.parts) {
    if (part === dominant || part._absorbed) continue;
    const areaKm2 = part.area * KM_PER_UNIT * KM_PER_UNIT;
    if (areaKm2 < EXCLAVE_AREA_KM2) continue;
    const { lon, lat } = partLonLat(part);
    const name = lookupAdmin1Name(lon, lat);
    if (!name || name === entry.ru || ABSORBED_REGION_NAMES.has(name)) continue;
    const prev = bestByName.get(name);
    if (!prev || part.area > prev.area) bestByName.set(name, part);
  }
  // Ranked by DISTANCE from the dominant part, not area — area alone
  // buries genuinely remote exclaves (Kaliningrad ~23,000 km²) under
  // whichever nearby island happens to be bigger (Russia's Novaya
  // Zemlya/Sakhalin, both >100,000 km² but comparatively close to
  // mainland; New Zealand's own North Island crowding out the Chatham
  // Islands; Japan's Hokkaido crowding out Okinawa). Distance from the
  // country's own "main body" is a much better proxy for "this reads as
  // a detached exclave" than raw size — verified against Kaliningrad,
  // Chatham, and Okinawa, all of which rank #1 or #2 by distance despite
  // being smaller than their same-country competitors.
  const wrapDist = (p) => {
    let dx = Math.abs(normalizeX(p.x) - normalizeX(dominant.x));
    dx = Math.min(dx, CANVAS_W - dx);
    return Math.hypot(dx, p.y - dominant.y);
  };
  const topCandidates = [...bestByName.entries()].sort((a, b) => wrapDist(b[1]) - wrapDist(a[1])).slice(0, MAX_EXCLAVES_PER_COUNTRY);
  const MERGE_RADIUS = 40; // native units (~9° at this SCALE) — generous enough to catch a cluster's own part, tight enough not to bridge unrelated exclaves
  for (const [name, part] of topCandidates) {
    const px = normalizeX(part.x);
    const py = part.y;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < labelPoints.length; i++) {
      const d = Math.hypot(labelPoints[i][0] - px, labelPoints[i][1] - py);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestDist < MERGE_RADIUS && suffixes[bestIdx] == null) {
      suffixes[bestIdx] = name;
    } else {
      labelPoints.push([+px.toFixed(1), +py.toFixed(1)]);
      suffixes.push(name);
    }
  }
  return suffixes;
}

function defaultTarget(props) {
  const id = props.ISO_A3 && props.ISO_A3 !== '-99' ? props.ISO_A3.toLowerCase() : slugify(props.NAME_LONG || props.NAME);
  return { id, name: props.NAME_LONG || props.NAME, ru: props.NAME_RU || props.NAME };
}

// Every special case in the user's ruling, keyed by however that feature
// gets identified below (NAME for base-file features, BRK_NAME for the
// disputed-areas extras). Merges (Crimea/N. Cyprus) route to their
// absorbing country's own derived identity (must match exactly what that
// country's OWN feature derives to via defaultTarget, below — verified:
// Russia -> {id:'rus', ru:'Россия'}, Turkey -> {id:'tur', ru:'Турция'}).
// The three breakaway regions use BRK_NAME as their id/name source since
// their own NAME field is just their parent country's name.
const ENTITY_OVERRIDE = {
  Crimea: { id: 'rus', name: 'Russia', ru: 'Россия' },
  'N. Cyprus': { id: 'tur', name: 'Turkey', ru: 'Турция' },
  Abkhazia: { id: 'abkhazia', name: 'Abkhazia', ru: 'Абхазия' },
  'South Ossetia': { id: 'south_ossetia', name: 'South Ossetia', ru: 'Южная Осетия' },
  Transnistria: { id: 'transnistria', name: 'Transnistria', ru: 'Приднестровье' },
};
// Explicitly promoted from the base file's Disputed/Indeterminate bucket
// (everything else in that bucket — Antarctica, ice fields, buffer zones,
// military leases, disputed reefs — is left out entirely).
const PROMOTE_NAMES = new Set(['Kosovo', 'Palestine']);
// W. Sahara itself is excluded below (TYPE is 'Indeterminate', so it's not
// picked up by the Sovereign-country/Country filter anyway) — only its
// precomputed Moroccan-controlled clip (sahara, loaded above) contributes.

const included = land.features.filter((f) => {
  const t = f.properties.TYPE;
  // 'Sovereignty' is the same "fully sovereign state" bucket as 'Sovereign
  // country', just a different label Natural Earth uses for exactly two
  // countries (Cuba, Kazakhstan) — missing it silently dropped both real,
  // well-known countries from the map.
  return t === 'Sovereign country' || t === 'Country' || t === 'Sovereignty' || PROMOTE_NAMES.has(f.properties.NAME);
});

// Crimea/N. Cyprus/Western Sahara were deliberately merged into their
// absorbing country with the border "erased, painted the same as the rest"
// (the user's own words) — the whole point was to make them
// indistinguishable, not to relabel them "Russia - Crimea" the moment a
// generic exclave detector notices they're a separate ring. Parts from
// these merge keys are tagged so attachExclaveSuffixes can skip them.
const MERGE_ABSORBED_KEYS = new Set(['Crimea', 'N. Cyprus', 'W. Sahara (Morocco)']);
// Belt-and-suspenders: Russia's OWN base admin-0 feature (not just the
// dedicated "extra" Crimea feature) already carries a Crimea-shaped ring
// in this basemap — the _absorbed tag above only catches the extra file's
// copy, so without this, Crimea's OTHER ring slips through untagged and
// still resolves via admin-1 lookup to "Автономная Республика Крым",
// resurfacing exactly the label the merge was meant to erase. Filtering
// by the resolved admin-1 name catches either source.
const ABSORBED_REGION_NAMES = new Set(['Автономная Республика Крым', 'Севастополь', 'Северный Кипр', 'Западная Сахара']);

const merged = new Map(); // id -> { id, name, ru, dParts: [], bbox, nativeArea, rawPoints, parts }
function addFeature(f, key) {
  const target = ENTITY_OVERRIDE[key] || defaultTarget(f.properties);
  const d = geometryToPath(f.geometry);
  const bbox = geometryBbox(f.geometry);
  const area = geometryArea(f.geometry);
  if (!merged.has(target.id)) {
    merged.set(target.id, { id: target.id, name: target.name, ru: target.ru, dParts: [], bbox: [Infinity, Infinity, -Infinity, -Infinity], nativeArea: 0, rawPoints: [], parts: [] });
  }
  const entry = merged.get(target.id);
  entry.dParts.push(d);
  entry.nativeArea += area;
  entry.bbox[0] = Math.min(entry.bbox[0], bbox[0]);
  entry.bbox[1] = Math.min(entry.bbox[1], bbox[1]);
  entry.bbox[2] = Math.max(entry.bbox[2], bbox[2]);
  entry.bbox[3] = Math.max(entry.bbox[3], bbox[3]);
  entry.rawPoints.push(...collectRawPoints(f.geometry, 150));
  const parts = geometryParts(f.geometry); // per-sub-polygon {x,y,area} — see geometryParts
  if (MERGE_ABSORBED_KEYS.has(key)) parts.forEach((p) => { p._absorbed = true; });
  entry.parts.push(...parts);
}

for (const f of included) addFeature(f, f.properties.NAME);
for (const f of extra.features) addFeature(f, f.properties.BRK_NAME);
for (const f of sahara.features) addFeature(f, 'W. Sahara (Morocco)');
// The Moroccan Sahara clip has no ENTITY_OVERRIDE entry above (it's keyed
// by a synthetic string no real feature ever has) — route it into
// Morocco's own entry explicitly, same merge-by-id trick, without adding
// a fourth lookup key that could accidentally collide with a real NAME.
ENTITY_OVERRIDE['W. Sahara (Morocco)'] = { id: 'mar', name: 'Morocco', ru: 'Марокко' };

// The area-weighted AVERAGE across every part (initially used here) still
// has the exact same failure mode as a bbox midpoint for archipelago
// countries with several comparably-sized islands (Norway, Indonesia,
// Philippines, Japan all tested with their single label landing in open
// water between islands, same as USA's Hawaii did before this) — the
// "center of mass" of Java+Sumatra+Borneo+… combined is out in the Java
// Sea, on nobody's land. The single LARGEST part's own centroid is
// guaranteed to actually BE land, at the cost of not being perfectly
// centered among every island — the right tradeoff for a label whose
// only job is "point at this country", not model its full extent.
function dominantPartCentroid(parts) {
  return parts.reduce((a, b) => (b.area > a.area ? b : a));
}

const pieces = [...merged.values()].map((e) => {
  const centroid = dominantPartCentroid(e.parts);
  const labelPoints = computeLabelPoints(e.rawPoints, e.parts, centroid);
  const labelSuffixes = attachExclaveSuffixes(e, centroid, labelPoints);
  const piece = {
    id: e.id,
    name: e.name,
    ru: e.ru,
    cx: +centroid.x.toFixed(1),
    cy: +centroid.y.toFixed(1),
    bbox: e.bbox.map((n) => +n.toFixed(1)),
    area: Math.round(e.nativeArea * KM_PER_UNIT * KM_PER_UNIT),
    d: e.dParts.join(' '),
    // Usually just [[cx, cy]] — extra points for antimeridian-split
    // clusters (see computeLabelPoints) and/or notable named exclaves
    // (see attachExclaveSuffixes). overviewBoard.js already knows how to
    // render one label per entry here (built for the world level's seas,
    // works unchanged for any level's pieces).
    labelPoints,
    _rawPoints: e.rawPoints, // stripped before writing out — see below
    _parts: e.parts, // stripped before writing out — see the USA special-case below
  };
  if (labelSuffixes.some((s) => s)) piece.labelSuffixes = labelSuffixes;
  return piece;
});

// ---- neighbor adjacency: same sampled-point proximity test as
// scripts/build_usa_level.js, run against this level's own pieces.
// Calibrated empirically (not guessed) against known pairs: mapshaper
// preserves shared-border topology when simplifying a single imported
// layer, so a TRUE land border's closest points land at EXACTLY 0 native
// units (verified: France-Germany, USA-Canada) — while even the
// narrowest strait in the data (Öresund, Denmark-Sweden) sits at 0.233,
// and wider ones (Gibraltar 0.45, English Channel 1.1, Germany-Sweden via
// the Baltic 2.6) are further still. 3 (the first value tried, by analogy
// to build_usa_level.js's own "6 canvas px") was WAY too loose — it
// bridged every strait above and reported Germany/Sweden as neighbors.
// 0.05 sits comfortably below the tightest real strait (0.233) with
// margin for float noise, while still catching every true border at 0.
const NEIGHBOR_DIST = 0.05; // native units
// Cheap bbox-distance prefilter: 150 sampled points per ring (needed to
// reliably catch short shared borders — see collectRawPoints's comment)
// makes the full point-by-point check too expensive to run on every one
// of the ~209²/2 piece pairs, most of which aren't remotely close to each
// other. Skipping pairs whose bboxes are further apart than a generous
// margin cuts the expensive inner loop down to only the pairs that could
// plausibly be neighbors.
const BBOX_MARGIN = 2; // native units — generous vs. NEIGHBOR_DIST's 0.05
function bboxNear(a, b) {
  return a[0] - BBOX_MARGIN <= b[2] && b[0] - BBOX_MARGIN <= a[2] && a[1] - BBOX_MARGIN <= b[3] && b[1] - BBOX_MARGIN <= a[3];
}
const neighbors = {};
for (let i = 0; i < pieces.length; i++) {
  for (let j = i + 1; j < pieces.length; j++) {
    if (!bboxNear(pieces[i].bbox, pieces[j].bbox)) continue;
    let minD = Infinity;
    for (const [ax, ay] of pieces[i]._rawPoints) {
      for (const [bx, by] of pieces[j]._rawPoints) {
        const d = Math.hypot(ax - bx, ay - by);
        if (d < minD) minD = d;
        if (minD < NEIGHBOR_DIST) break;
      }
      if (minD < NEIGHBOR_DIST) break;
    }
    if (minD < NEIGHBOR_DIST) {
      (neighbors[pieces[i].id] ??= []).push(pieces[j].id);
      (neighbors[pieces[j].id] ??= []).push(pieces[i].id);
    }
  }
}
// USA's mainland/Alaska/Hawaii are three disconnected landmasses, but
// unlike Russia's antimeridian split, none of the generic label-placement
// logic above knows to treat them as separate — Alaska and Hawaii either
// got no label of their own or (worse, when the Aleutians' antimeridian
// crossing tripped computeLabelPoints' gap detection) an averaged
// centroid across mainland+Alaska+Hawaii that landed nowhere meaningful.
// This is a one-off, not a generic mechanism: classify each of the
// feature's own sub-polygons (already tracked per-piece as `_parts`) by
// simple lon/lat bounding boxes, area-weight each group's own centroid,
// and label the non-mainland ones "USA - Alaska"/"USA - Hawaii" instead
// of a second/third bare "США".
const USA_BOX = {
  // Native units at this build's SCALE=3.2 — thresholds picked with a
  // comfortable margin around each region's real lon/lat range (Alaska
  // roughly 51-72°N, so y < 90-51=39° * 3.2 stays well clear of the
  // mainland's northernmost points near 49°N/y≈131; Hawaii roughly
  // 18-23°N/154-161°W, x/y ranges picked the same way) — see the
  // project()/SCALE definitions above for the lon/lat <-> native-unit
  // conversion this mirrors.
  hawaii: (p) => p.y > 205 && p.y < 235 && p.x > 55 && p.x < 90,
  alaska: (p) => p.y < 128,
};
function applyUsaLabels(piece) {
  const groups = { mainland: [], alaska: [], hawaii: [] };
  for (const part of piece._parts) {
    const bucket = USA_BOX.hawaii(part) ? 'hawaii' : USA_BOX.alaska(part) ? 'alaska' : 'mainland';
    groups[bucket].push(part);
  }
  const labelPoints = [];
  const suffixes = [];
  for (const [bucket, suffix] of [['mainland', null], ['alaska', 'Аляска'], ['hawaii', 'Гавайи']]) {
    if (!groups[bucket].length) continue;
    // dominantPartCentroid, not a weighted average across every part in
    // the bucket — Hawaii is several separate islands of comparable size,
    // and a weighted-average centroid landed in open ocean between them
    // (same reasoning as the main cx/cy computation above).
    const c = dominantPartCentroid(groups[bucket]);
    labelPoints.push([+c.x.toFixed(1), +c.y.toFixed(1)]);
    suffixes.push(suffix);
  }
  piece.labelPoints = labelPoints;
  piece.labelSuffixes = suffixes; // parallel array — null entries render as the plain name
}
const usaPiece = pieces.find((p) => p.ru === 'США');
if (usaPiece) applyUsaLabels(usaPiece);

for (const p of pieces) {
  p.neighbors = neighbors[p.id] || [];
  delete p._rawPoints;
  delete p._parts;
}

const exclaveLines = [];
for (const p of pieces) {
  if (!p.labelSuffixes) continue;
  p.labelSuffixes.forEach((s, i) => { if (s) exclaveLines.push(`  ${p.ru} - ${s}`); });
}
console.error(`exclave labels found (${exclaveLines.length}):`);
console.error(exclaveLines.join('\n'));

console.error('countries:', pieces.length);
console.error('no-neighbor pieces (islands — fine, excluded from "Назови соседа" automatically):', pieces.filter((p) => !p.neighbors.length).map((p) => p.ru).join(', '));
// Looked up by .ru rather than a guessed id — several countries (France,
// Somaliland, N. Cyprus…) have ISO_A3 === '-99' in this dataset and fall
// back to slugify(NAME_LONG), so a hardcoded 'fra'-style guess isn't safe.
const byRu = (ru) => pieces.find((p) => p.ru === ru);
const hasNeighborRu = (aRu, bRu) => {
  const a = byRu(aRu), b = byRu(bRu);
  return !!(a && b && a.neighbors.includes(b.id));
};
console.error('sanity checks:');
console.error('  France neighbors Germany?', hasNeighborRu('Франция', 'Германия'));
console.error('  Germany neighbors Sweden (should be false — Baltic Sea)?', hasNeighborRu('Германия', 'Швеция'));
console.error('  Denmark neighbors Sweden (should be false — Öresund strait)?', hasNeighborRu('Дания', 'Швеция'));
console.error('  Georgia neighbors Russia?', hasNeighborRu('Грузия', 'Россия'));
console.error('  Abkhazia piece exists?', !!byRu('Абхазия'));
console.error('  Crimea is its own piece (should be false)?', !!pieces.find((p) => p.name === 'Crimea'));
console.error('  N. Cyprus is its own piece (should be false)?', !!pieces.find((p) => p.name === 'Northern Cyprus'));

let out = `// Auto-generated by scripts/build_countries_level.js from Natural Earth's\n`;
out += `// public-domain 10m admin-0 countries + disputed-areas layers. See the\n`;
out += `// build script's own comments for the territory ruling and projection\n`;
out += `// tradeoffs (kmPerUnit is an equator-based approximation).\n`;
out += `// Regenerate: node scripts/build_countries_level.js\n`;
out += `const pieces = ${JSON.stringify(pieces, null, 2)};\n\n`;
out += `export default {\n`;
out += `  id: 'countries',\n`;
out += `  title: 'Страны мира',\n`;
out += `  subtitle: '${pieces.length} стран',\n`;
out += `  canvas: { width: ${CANVAS_W}, height: ${CANVAS_H} },\n`;
out += `  kmPerUnit: ${KM_PER_UNIT},\n`;
out += `  pieces,\n`;
out += `  land: [],\n`;
out += `  cities: [],\n`;
out += `  places: [],\n`;
out += `};\n`;

const outPath = path.join(__dirname, '..', 'levels', 'countries.js');
fs.writeFileSync(outPath, out, 'utf8');
console.error('wrote', outPath, out.length, 'bytes');
