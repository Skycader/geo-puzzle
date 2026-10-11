// Builds levels/worldCurrents.js: major ocean currents as REAL paths, not hand
// drawn. For each current, averages several 5-day slices of NOAA/ERD's OSCAR
// surface-velocity analysis (1/3 degree, served by NOAA CoastWatch ERDDAP,
// "free to use and redistribute"), then follows the mean flow from a hand-picked
// seed point (a streamline), smooths and resamples it, and projects it with the
// same equirectangular formula as scripts/build_world_seas.js.
// The ERDDAP copy only covers 2011-12 .. 2014-09, plenty for a mean field.
//
// Seeds, names and warm/cold are hand-curated (see CURRENTS); the geometry is
// data. Adding a current = adding an entry (its own `box` to fetch).
// Regenerate: node scripts/build_world_currents.js   (needs network)
const fs = require('fs');
const path = require('path');

const SCALE = 3.2; // must match build_world_seas.js (1152 / 360)
const KM_PER_DEG = 111;
const project = (lat, lon) => [(lon + 180) * SCALE, (90 - lat) * SCALE];

// box: [latMin, latMax, lonMin, lonMax] in degrees (lon -180..180); seed: [lat, lon];
// cutAtEastmost: keep the line only up to its easternmost point — past it a 1-degree
// mean field just recirculates (the Gulf Stream hands over to the North Atlantic
// Current there), which would draw a misleading U-turn.
const CURRENTS = [
  {
    id: 'gulf_stream', name: 'Gulf Stream', ru: 'Гольфстрим', temp: 'warm',
    box: [0, 60, -100, 0], seed: [31, -79], cutAtEastmost: true,
  },
];

const BASE = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar.csv';
const UA = { 'User-Agent': 'geo-puzzle-dev/1.0 (personal learning project)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OSCAR longitudes run 20..420 east.
const toOscarLon = (lon) => (lon < 20 ? lon + 360 : lon);

async function fetchField(box) {
  const [latA, latB, lonA, lonB] = box;
  const q = (v) => `${v}%5B(2012-01-01):12:(2013-12-31)%5D%5B(15.0)%5D%5B(${latA}):3:(${latB})%5D%5B(${toOscarLon(lonA)}):3:(${toOscarLon(lonB)})%5D`;
  const url = `${BASE}?${q('u')},${q('v')}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return (await r.text()).trim().split('\n').slice(2);
    await sleep(3000 * (i + 1));
  }
  throw new Error('OSCAR request failed');
}

function meanField(lines) {
  const su = new Map(), sv = new Map(), n = new Map();
  for (const l of lines) {
    const [, , lat, lon, u, v] = l.split(',');
    if (u === 'NaN' || v === 'NaN') continue;
    const k = `${(+lat).toFixed(1)}|${(+lon).toFixed(1)}`;
    su.set(k, (su.get(k) || 0) + +u);
    sv.set(k, (sv.get(k) || 0) + +v);
    n.set(k, (n.get(k) || 0) + 1);
  }
  const cell = (lat, lon) => {
    const k = `${lat.toFixed(1)}|${lon.toFixed(1)}`;
    const c = n.get(k);
    return c ? [su.get(k) / c, sv.get(k) / c] : null;
  };
  // Bilinear on the 1-degree grid; null if any corner is land / missing.
  return (lat, lon) => {
    const la = Math.floor(lat), lo = Math.floor(lon);
    const c00 = cell(la, lo), c01 = cell(la, lo + 1), c10 = cell(la + 1, lo), c11 = cell(la + 1, lo + 1);
    if (!c00 || !c01 || !c10 || !c11) return null;
    const fy = lat - la, fx = lon - lo;
    const lerp = (a, b, t) => a + (b - a) * t;
    return [0, 1].map((i) => lerp(lerp(c00[i], c01[i], fx), lerp(c10[i], c11[i], fx), fy));
  };
}

function trace(vel, cur) {
  let lat = cur.seed[0], lon = toOscarLon(cur.seed[1]);
  const pts = [[lat, lon]];
  for (let i = 0; i < 8000; i++) {
    const v = vel(lat, lon);
    if (!v) break;
    const sp = Math.hypot(v[0], v[1]);
    if (sp < 0.05) break;
    const step = 0.1;
    lon += ((v[0] / sp) * step) / Math.cos((lat * Math.PI) / 180);
    lat += (v[1] / sp) * step;
    pts.push([lat, lon]);
  }
  let res = pts.map(([la, lo]) => [la, lo > 180 ? lo - 360 : lo]);
  if (cur.cutAtEastmost) {
    let best = 0;
    res.forEach((p, i) => { if (p[1] > res[best][1]) best = i; });
    res = res.slice(0, best + 1);
  }
  return res;
}

// Resample every ~0.5 degree of path length, then smooth (moving average,
// endpoints pinned) so the wiggles of a 1-degree mean field don't show.
function resample(pts, stepDeg) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= stepDeg) { out.push(pts[i]); acc = 0; }
  }
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}
function smooth(pts, passes) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    p = p.map((pt, i) => {
      if (i === 0 || i === p.length - 1) return pt;
      return [(p[i - 1][0] + pt[0] * 2 + p[i + 1][0]) / 4, (p[i - 1][1] + pt[1] * 2 + p[i + 1][1]) / 4];
    });
  }
  return p;
}

(async () => {
  const out = [];
  for (const cur of CURRENTS) {
    console.error('fetching', cur.id, '...');
    const vel = meanField(await fetchField(cur.box));
    const raw = trace(vel, cur);
    const pts = smooth(resample(raw, 0.7), 10);
    const xy = pts.map(([la, lo]) => project(la, lo));
    const lengthKm = Math.round(pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], (p[1] - pts[i - 1][1]) * Math.cos((p[0] * Math.PI) / 180)) * KM_PER_DEG : 0), 0));
    const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
    out.push({
      id: cur.id, name: cur.name, ru: cur.ru, temp: cur.temp, lengthKm,
      cx: +((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(1), cy: +((Math.min(...ys) + Math.max(...ys)) / 2).toFixed(1),
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(1)),
      d: xy.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(2)},${y.toFixed(2)}`).join(' '),
      pts: xy.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), // the arrow's line; its head is built at render time
      mid: { x: +xy[Math.floor(xy.length / 2)][0].toFixed(2), y: +xy[Math.floor(xy.length / 2)][1].toFixed(2) }, // label anchor, on the line
    });
    console.error(cur.id, 'points', pts.length, 'length km', lengthKm, 'from', pts[0].map((v) => v.toFixed(1)).join(','), 'to', pts[pts.length - 1].map((v) => v.toFixed(1)).join(','));
  }
  let src = '// Auto-generated by scripts/build_world_currents.js — real paths traced through\n';
  src += "// NOAA/ERD's OSCAR mean surface-current field (see that script). `d` is the line in\n";
  src += '// world.js canvas units; `pts` is the same line as points (the arrow head is built from it at render time).\n';
  src += '// Regenerate: node scripts/build_world_currents.js\nexport default ' + JSON.stringify(out, null, 2) + ';\n';
  fs.writeFileSync(path.join(__dirname, '..', 'levels', 'worldCurrents.js'), src);
  console.error('wrote levels/worldCurrents.js');
})();
