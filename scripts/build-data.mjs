// Builds data/streets.json and data/background.json from the Overpass dumps in raw/.
// Run scripts/fetch-osm.sh first, then: node scripts/build-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, displayName } from '../normalize.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRaw = (name) => JSON.parse(fs.readFileSync(path.join(root, 'raw', name + '.json'), 'utf8')).elements;
const AUSTIN_RELATION_ID = 113314;
const SCALE = 1e5;

// ---------- geometry helpers ----------

const toXY = (geom) => geom.map((p) => [p.lon, p.lat]);

function haversineMiles([lon1, lat1], [lon2, lat2]) {
  const r = 3958.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

const lineMiles = (line) => line.slice(1).reduce((sum, p, i) => sum + haversineMiles(line[i], p), 0);

// Douglas-Peucker simplification with tolerance in degrees.
function simplify(points, tol) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Joins open way segments into closed rings by matching endpoints.
function assembleRings(segments) {
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const pending = segments.map((s) => s.slice());
  const rings = [];
  while (pending.length) {
    let ring = pending.pop();
    let grew = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grew) {
      grew = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < pending.length; i++) {
        const seg = pending[i];
        if (key(seg[0]) === end) ring = ring.concat(seg.slice(1));
        else if (key(seg[seg.length - 1]) === end) ring = ring.concat(seg.slice().reverse().slice(1));
        else continue;
        pending.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function ringAreaM2(ring) {
  const lat0 = ring[0][1] * Math.PI / 180;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * kx * ring[i + 1][1] * ky - ring[i + 1][0] * kx * ring[i][1] * ky;
  }
  return Math.abs(a / 2);
}

// Even-odd point-in-polygon over many rings, with edges bucketed by latitude band.
function makeContains(rings) {
  const BAND = 0.002;
  const bands = new Map();
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const lo = Math.floor(Math.min(a[1], b[1]) / BAND), hi = Math.floor(Math.max(a[1], b[1]) / BAND);
      for (let k = lo; k <= hi; k++) {
        if (!bands.has(k)) bands.set(k, []);
        bands.get(k).push(a[0], a[1], b[0], b[1]);
      }
    }
  }
  return ([x, y]) => {
    const edges = bands.get(Math.floor(y / BAND));
    if (!edges) return false;
    let inside = false;
    for (let i = 0; i < edges.length; i += 4) {
      const x1 = edges[i], y1 = edges[i + 1], x2 = edges[i + 2], y2 = edges[i + 3];
      if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  };
}

// Splits a line into the runs of consecutive vertices that fall inside the boundary.
function clipLine(line, contains) {
  const runs = [];
  let run = [];
  for (const p of line) {
    if (contains(p)) run.push(p);
    else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

const round = (line, digits) => line.map(([x, y]) => [+x.toFixed(digits), +y.toFixed(digits)]);

// Delta-encodes a line as a flat array of integers at 1e-5 degree precision.
function encodeLine(line) {
  const out = [];
  let px = 0, py = 0;
  for (const [x, y] of line) {
    const ix = Math.round(x * SCALE), iy = Math.round(y * SCALE);
    if (out.length && ix === px && iy === py) continue;
    out.push(ix - px, iy - py);
    px = ix; py = iy;
  }
  return out;
}

function polygonsFromElements(elements, minArea, tol) {
  const polys = [];
  for (const el of elements) {
    let outers = [], inners = [];
    if (el.type === 'way' && el.geometry) {
      outers = assembleRings([toXY(el.geometry)]);
    } else if (el.type === 'relation') {
      const ways = el.members.filter((m) => m.type === 'way' && m.geometry);
      outers = assembleRings(ways.filter((m) => m.role !== 'inner').map((m) => toXY(m.geometry)));
      inners = assembleRings(ways.filter((m) => m.role === 'inner').map((m) => toXY(m.geometry)));
    }
    for (const outer of outers) {
      if (ringAreaM2(outer) < minArea) continue;
      const contains = makeContains([outer]);
      const holes = inners.filter((r) => contains(r[0]) && ringAreaM2(r) >= minArea);
      polys.push([outer, ...holes].map((r) => round(simplify(r, tol), 5)).filter((r) => r.length >= 4));
    }
  }
  return polys;
}

// ---------- boundary ----------

const waterEls = readRaw('water');
const cityRel = waterEls.find((e) => e.type === 'relation' && e.id === AUSTIN_RELATION_ID);
const cityRings = assembleRings(
  cityRel.members.filter((m) => m.type === 'way' && m.geometry).map((m) => toXY(m.geometry))
);
const inAustin = makeContains(cityRings);
console.log(`boundary: ${cityRings.length} rings`);

// ---------- streets ----------

const groups = new Map();
for (const way of readRaw('streets')) {
  const name = way.tags.name;
  const key = normalize(name);
  if (!key) continue;
  const highway = way.tags.highway;
  // Divided highways are mapped as two one-way carriageways; count each at half length.
  const factor = (highway === 'motorway' || highway === 'trunk') && way.tags.oneway === 'yes' ? 0.5 : 1;
  for (const run of clipLine(toXY(way.geometry), inAustin)) {
    const miles = lineMiles(run) * factor;
    if (!groups.has(key)) groups.set(key, { lines: [], miles: 0, displays: new Map() });
    const g = groups.get(key);
    g.lines.push(run);
    g.miles += miles;
    const d = displayName(name);
    g.displays.set(d, (g.displays.get(d) || 0) + miles);
  }
}

let total = 0;
const streets = [];
for (const [key, g] of groups) {
  if (g.miles < 0.005) continue;
  total += g.miles;
  const display = [...g.displays.entries()].sort((a, b) => b[1] - a[1])[0][0];
  streets.push({
    k: key,
    d: display,
    m: +g.miles.toFixed(4),
    g: g.lines.map((l) => encodeLine(simplify(l, 0.00004))).filter((l) => l.length >= 4),
  });
}
streets.sort((a, b) => b.m - a.m);
fs.writeFileSync(path.join(root, 'data', 'streets.json'), JSON.stringify({ total: +total.toFixed(3), streets }));
console.log(`streets: ${streets.length} names, ${total.toFixed(1)} miles`);
console.log('top:', streets.slice(0, 15).map((s) => `${s.d} (${s.k}) ${s.m.toFixed(1)}mi`).join(', '));

// ---------- background ----------

const features = [];
for (const poly of polygonsFromElements(waterEls.filter((e) => e.id !== AUSTIN_RELATION_ID), 15000, 0.00008)) {
  features.push({ type: 'Feature', properties: { kind: 'water' }, geometry: { type: 'Polygon', coordinates: poly } });
}
for (const poly of polygonsFromElements(readRaw('parks'), 20000, 0.0001)) {
  features.push({ type: 'Feature', properties: { kind: 'park' }, geometry: { type: 'Polygon', coordinates: poly } });
}
features.push({
  type: 'Feature',
  properties: { kind: 'boundary' },
  geometry: { type: 'MultiLineString', coordinates: cityRings.map((r) => round(simplify(r, 0.0001), 5)) },
});
fs.writeFileSync(path.join(root, 'data', 'background.json'), JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`background: ${features.length} features`);
