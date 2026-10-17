// Generates levels/world/zones-info.json: info-popup blurbs for the map-only zones of the
// countries level (`land` in levels/countries.js; see ZONE_IDS in build_countries_level.js),
// same shape as levels/usa/contextland-info.json. Opened from the right-click menu
// ("Что здесь?"). Needs network. Add a zone: put its id and Russian Wikipedia title in ZONES.
//   node scripts/build_zones_info.js
const fs = require('fs');
const path = require('path');

// id -> Russian Wikipedia article title, or { title, image } to use a local picture (a path
// under assets/) instead of the article's thumbnail.
const ZONES = {
  // assets/western_sahara_landscape.jpg: "Western sahara landscape.jpg" by bob rayner (CC BY 2.0),
  // Wikimedia Commons — a landscape instead of the article's map thumbnail.
  esh: { title: 'Западная Сахара', image: 'assets/western_sahara_landscape.jpg' },
  esh_east: 'Свободная зона (Западная Сахара)',
};

const UA = { 'User-Agent': 'geo-puzzle-dev/1.0 (personal learning project)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r.json();
    await sleep(3000 * (i + 1)); // 429/5xx: back off
  }
  throw new Error('request failed: ' + url);
}
const clip = (s, n = 600) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const i = cut.lastIndexOf('. ');
  return (i > 200 ? cut.slice(0, i + 1) : cut).trim();
};
const thumb = (u) => (u ? u.replace('https://thumb.wikimedia.org/', 'https://upload.wikimedia.org/').split('?')[0] : null);

(async () => {
  const outPath = path.join(__dirname, '..', 'levels', 'world', 'zones-info.json');
  const out = {};
  for (const [id, zone] of Object.entries(ZONES)) {
    const { title, image } = typeof zone === 'string' ? { title: zone } : zone;
    // Plain-text lead section (the REST summary of a short article is a single sentence)
    // plus the REST summary for the thumbnail and canonical URL.
    const q = await getJson(
      `https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
    );
    // Drop the parenthetical foreign-language names (Arabic/Berber/Spanish, one nesting level).
    const extract = Object.values(q.query.pages)[0]
      .extract.replace(/\s*\((?:[^()]|\([^()]*\))*(?:араб\.|бербер\.|исп\.)(?:[^()]|\([^()]*\))*\)/g, '')
      .replace(/\s*\n+\s*/g, ' ')
      .trim();
    const s = await getJson(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    out[id] = { extract: clip(extract), image: image || thumb(s.thumbnail?.source) || thumb(s.originalimage?.source), wikiUrl: s.content_urls.desktop.page };
    console.error(id, '-', out[id].extract.length, 'chars');
    await sleep(400);
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.error('wrote', outPath);
})();
