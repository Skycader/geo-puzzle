// One-off generator for levels/usa/airports-info.json (the info-popup
// blurbs, same shape as places-info.json): for each airport in
// scripts/data/airport-runways.generated.json take its English Wikipedia
// article, follow the langlink to the Russian one, and keep that summary;
// fall back to the English summary (noted in `lang`) when no Russian article
// exists. Run: node scripts/build_airports_info.js
const fs = require('fs'); const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'airport-runways.generated.json'), 'utf8'));
const UA = { 'User-Agent': 'geo-puzzle-dev/1.0 (personal learning project)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await sleep(3000 * (i + 1)); // 429/5xx: back off
  }
  throw new Error('request failed: ' + url);
}
const clip = (s, n = 700) => { if (s.length <= n) return s; const cut = s.slice(0, n); const i = cut.lastIndexOf('. '); return (i > 200 ? cut.slice(0, i + 1) : cut).trim(); };
const thumb = (u) => (u ? u.replace('https://thumb.wikimedia.org/', 'https://upload.wikimedia.org/').split('?')[0] : null);
(async () => {
  const only = process.argv.slice(2).map((x) => x.toUpperCase());
  const outPath = path.join(__dirname, '..', 'levels', 'usa', 'airports-info.json');
  // Resumable: Wikipedia rate-limits bursts, so keep what's already fetched in Russian.
  const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {}; const fallback = [];
  for (const [iata, a] of Object.entries(data)) {
    if (out[iata.toLowerCase()]?.lang === 'ru') continue;
    if (only.length && !only.includes(iata)) continue; // optional: node scripts/build_airports_info.js OME DJT

    try {
    const enTitle = decodeURIComponent((a.wiki || '').replace('https://en.wikipedia.org/wiki/', ''));
    const ll = await getJson(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(enTitle)}&prop=langlinks&lllang=ru&format=json&redirects=1`);
    const page = ll && Object.values(ll.query.pages)[0];
    const ruTitle = page?.langlinks?.[0]?.['*'];
    let s = ruTitle ? await getJson(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(ruTitle.replace(/ /g, '_'))}`) : null;
    let lang = 'ru';
    if (!s || !s.extract) { s = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(enTitle)}`); lang = 'en'; fallback.push(iata); }
    if (!s || !s.extract) { console.error('NO SUMMARY', iata); continue; }
    out[iata.toLowerCase()] = { extract: clip(s.extract), image: thumb(s.thumbnail?.source) || thumb(s.originalimage?.source), wikiUrl: s.content_urls.desktop.page, lang };
    process.stderr.write(`${iata}:${lang} `);
    await sleep(1000);
    } catch (e) { console.error('FAILED', iata, e.message); }
  }
  console.error('\nEnglish-only:', fallback.join(' ') || '-');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
})();
