// Filters OurAirports' public-domain data down to the major US airports used
// by the "Аэропорты" overview tab + their real runways (endpoints, length,
// width) -> scripts/data/airport-runways.generated.json (small, committed).
// The raw CSVs are ~16 MB, so they're NOT kept; to regenerate, download them
// into scripts/data first, run this, then delete them:
//   curl -sL -o scripts/data/_airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   curl -sL -o scripts/data/_runways.csv  https://davidmegginson.github.io/ourairports-data/runways.csv
//   node scripts/extract_airport_runways.js
// Then: node scripts/build_usa_airports.js (and build_airports_info.js for
// the wiki blurbs).
const fs = require('fs'); const path = require('path');
const D = path.join(__dirname, 'data');
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows; }
const toObjs = (rows) => { const h = rows[0]; return rows.slice(1).filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const IATA = 'ATL LAX ORD DFW DEN JFK SFO SEA LAS MCO EWR CLT PHX MIA IAH BOS MSP FLL DTW PHL LGA BWI SLC SAN DCA IAD TPA BNA AUS MDW HNL DAL PDX STL RDU MCI SMF SJC OAK MSY SAT CLE PIT CVG CMH IND MKE ANC OGG ABQ KOA ITO LIH MKK LNY JHM HNM LUP BHM HSV FAI JNU KTN BET OME ADQ TUS LIT XNA ONT SNA BUR FAT PSP COS ASE BDL ILG JAX RSW DJT SRQ PNS EYW TLH SAV BOI DSM CID ICT SDF LEX BTR SHV PWM BGR GRR JAN SGF BIL BZN MSO GTF HLN OMA RNO MHT BUF ROC SYR ALB AVL FAR BIS GFK MOT DAY OKC TUL EUG MDT PVD CHS GSP MYR FSD RAP MEM TYS HOU ELP LBB AMA CRP MAF BTV RIC ORF GEG CRW MSN GRB JAC CPR'.split(' ');
const airports = toObjs(parseCSV(fs.readFileSync(path.join(D, '_airports.csv'), 'utf8')));
const runways = toObjs(parseCSV(fs.readFileSync(path.join(D, '_runways.csv'), 'utf8')));
const out = {}; const problems = [];
for (const code of IATA) {
  const cands = airports.filter(a => a.iata_code === code && a.iso_country === 'US' && a.type !== 'closed');
  const a = cands.find(c => c.type === 'large_airport') || cands[0];
  if (!a) { problems.push(code + ': no airport'); continue; }
  const rws = runways.filter(r => r.airport_ref === a.id && r.closed !== '1').map(r => ({
    leIdent: r.le_ident, heIdent: r.he_ident, len: +r.length_ft, width: +r.width_ft,
    le: r.le_latitude_deg && r.le_longitude_deg ? [+r.le_latitude_deg, +r.le_longitude_deg] : null,
    he: r.he_latitude_deg && r.he_longitude_deg ? [+r.he_latitude_deg, +r.he_longitude_deg] : null,
    leHdg: r.le_heading_degT ? +r.le_heading_degT : null,
  }));
  const noCoords = rws.filter(r => !r.le || !r.he).length;
  // Runways without both endpoints (planned/under construction, water lanes) can't be drawn.
  rws.splice(0, rws.length, ...rws.filter(r => r.le && r.he));
  if (noCoords) problems.push(`${code}: ${noCoords}/${rws.length} runways lack endpoint coords`);
  out[code] = { id: a.id, ident: a.ident, name: a.name, city: a.municipality, region: a.iso_region, lat: +a.latitude_deg, lon: +a.longitude_deg, wiki: a.wikipedia_link, runways: rws };
}
console.log('airports', Object.keys(out).length, 'runways', Object.values(out).reduce((s, a) => s + a.runways.length, 0));
console.log(problems.join('\n') || 'no problems');
fs.writeFileSync(path.join(D, 'airport-runways.generated.json'), JSON.stringify(out));
