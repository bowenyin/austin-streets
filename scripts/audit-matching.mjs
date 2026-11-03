// Audits name matching: types natural variants of every OSM street name and checks each lands on that street.
// Some failures are expected: a variant can be the exact name of a different street ("Breezy Pass" for
// Breezy Pass Cove), or drop a direction that is part of the name ("Loop Boulevard" for North Loop Boulevard).
// Usage: node scripts/audit-matching.mjs   (SHOW=n lists more failures per kind, SHOW_MERGED=n more merged keys)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = await import(path.join(root, 'normalize.js'));
const { ROUTE_GROUPS } = norm;
const displayName = norm.displayName;

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/streets.json')));
const byKey = new Map(data.streets.map((s) => [s.k, s]));
const allRaw = JSON.parse(fs.readFileSync(path.join(root, 'raw/streets.json'))).elements;
const raw = allRaw
  .filter((e) => e.bounds.minlat > 29.9 && e.bounds.minlat < 30.7 && e.bounds.minlon > -98.2 && e.bounds.minlon < -97.3);
const keyOf = norm.createStreetKey(raw.map((e) => e.tags.name));
const names = [...new Set(raw.map((e) => e.tags.name))].filter((n) => byKey.has(keyOf(n)));

const DIRS = { North: 'N', South: 'S', East: 'E', West: 'W', Northeast: 'NE', Northwest: 'NW', Southeast: 'SE', Southwest: 'SW' };
const ABBR = {
  Street: 'St', Avenue: 'Ave', Boulevard: 'Blvd', Drive: 'Dr', Road: 'Rd', Lane: 'Ln', Court: 'Ct', Circle: 'Cir',
  Cove: 'Cv', Trail: 'Trl', Parkway: 'Pkwy', Place: 'Pl', Terrace: 'Ter', Highway: 'Hwy', Expressway: 'Expy',
  Crossing: 'Xing', Hollow: 'Holw', Bend: 'Bnd', Trace: 'Trce', Square: 'Sq', Plaza: 'Plz', Loop: 'Lp', Way: 'Wy',
};
const SUFFIX_WORDS = new Set(Object.keys(ABBR).concat(['Pass', 'Path', 'Run', 'Walk', 'Row', 'Cutoff', 'Skyway', 'Freeway', 'Alley']));

function resolve(input) {
  const k = norm.matchKey(input, (x) => byKey.has(x), data.exact);
  if (k === null) return null;
  return ROUTE_GROUPS[k] ? { group: ROUTE_GROUPS[k] } : { key: k };
}

function variants(name) {
  const w = name.split(/\s+/);
  const out = { 'as-is': name, lower: name.toLowerCase() };
  const last = w[w.length - 1];
  if (ABBR[last]) out['abbr-suffix'] = [...w.slice(0, -1), ABBR[last]].join(' ');
  if (DIRS[w[0]] && w.length > 1) out['abbr-dir'] = [DIRS[w[0]], ...w.slice(1)].join(' ');
  if (SUFFIX_WORDS.has(last) && w.length > 1) out['no-suffix'] = w.slice(0, -1).join(' ');
  if (DIRS[w[0]] && w.length > 2) {
    out['no-dir'] = w.slice(1).join(' ');
    if (SUFFIX_WORDS.has(last) && w.length > 3) out['no-dir-no-suffix'] = w.slice(1, -1).join(' ');
  }
  return out;
}

const fails = {};
let tested = 0;
for (const name of names) {
  const want = keyOf(name);
  for (const [kind, v] of Object.entries(variants(name))) {
    tested++;
    const got = resolve(v);
    const ok = got && (got.key === want || got.group?.includes(want));
    if (ok) continue;
    const label = !got ? 'NO MATCH' : got.key ? `-> ${byKey.get(got.key).d}` : '-> route group';
    (fails[kind] ||= []).push(`${v}  [${name}]  ${label}`);
  }
}

console.log(`names tested: ${names.length}, variants: ${tested}`);
for (const [kind, list] of Object.entries(fails)) {
  console.log(`\n## ${kind}: ${list.length} failures`);
  for (const line of list.slice(0, Number(process.env.SHOW || 25))) console.log('  ' + line);
}

// Keys that merge streets with different display names.
const groups = new Map();
for (const e of raw) {
  const k = keyOf(e.tags.name);
  if (!byKey.has(k)) continue;
  const d = displayName(e.tags.name).toLowerCase();
  if (!groups.has(k)) groups.set(k, new Map());
  groups.get(k).set(d, (groups.get(k).get(d) || 0) + 1);
}
const merged = [...groups].filter(([, m]) => m.size > 1).sort((a, b) => b[1].size - a[1].size);
console.log(`\n## keys merging different names: ${merged.length}`);
for (const [k, m] of merged.slice(0, Number(process.env.SHOW_MERGED || 40))) {
  console.log(`  ${k}: ${[...m].map(([d, c]) => `${d} (${c})`).join(' | ')}`);
}
