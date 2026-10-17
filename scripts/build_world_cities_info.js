// Generates levels/world/cities-info.json (info-popup blurbs for the world-map cities, same
// shape as levels/usa/cities-info.json): for each city take its Wikidata id (from
// scripts/data/world-cities-source.json), look up its Russian (else English) Wikipedia article
// in ONE batched Wikidata call per 50 cities, then fetch that article's REST summary.
// Needs network. Resumable: cities already in the output are skipped, so after a Wikipedia
// rate-limit failure just run it again. Optionally pass city ids to (re)fetch only those:
//   node scripts/build_world_cities_info.js moscow paris
// Run scripts/build_world_cities.js first (it defines the ids).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

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
const clip = (s, n = 700) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const i = cut.lastIndexOf('. ');
  return (i > 200 ? cut.slice(0, i + 1) : cut).trim();
};
const thumb = (u) => (u ? u.replace('https://thumb.wikimedia.org/', 'https://upload.wikimedia.org/').split('?')[0] : null);

(async () => {
  const outPath = path.join(__dirname, '..', 'levels', 'world', 'cities-info.json');
  const only = process.argv.slice(2);
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'world-cities-source.json'), 'utf8'));
  const { default: cities } = await import(pathToFileURL(path.join(__dirname, '..', 'levels', 'worldCities.js')));
  const qidByName = new Map(source.map((c) => [c.name, c.wikidata]));
  const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  const todo = cities.filter((c) => (only.length ? only.includes(c.id) : !out[c.id]?.extract));

  // 1) Wikidata ids -> wiki titles (batches of 50)
  const titles = new Map(); // qid -> { ru, en }
  const qids = [...new Set(todo.map((c) => qidByName.get(c.name)).filter(Boolean))];
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}&props=sitelinks&sitefilter=ruwiki|enwiki&format=json`);
    for (const [q, e] of Object.entries(j?.entities || {})) titles.set(q, { ru: e.sitelinks?.ruwiki?.title, en: e.sitelinks?.enwiki?.title });
    await sleep(500);
  }

  // 2) summaries
  const noArticle = [];
  for (const c of todo) {
    try {
      const t = titles.get(qidByName.get(c.name));
      let s = null, lang = 'ru';
      if (t?.ru) s = await getJson(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.ru.replace(/ /g, '_'))}`);
      if ((!s || !s.extract) && t?.en) {
        s = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.en.replace(/ /g, '_'))}`);
        lang = 'en';
      }
      if (!s || !s.extract) { noArticle.push(c.id); continue; }
      out[c.id] = { extract: clip(s.extract), image: thumb(s.thumbnail?.source) || thumb(s.originalimage?.source), wikiUrl: s.content_urls.desktop.page, lang };
      process.stderr.write(`${c.id}:${lang} `);
      await sleep(400);
    } catch (e) {
      console.error('FAILED', c.id, e.message);
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.error(`\nwrote ${Object.keys(out).length} of ${cities.length}; no article: ${noArticle.join(' ') || '-'}`);
})();
