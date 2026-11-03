import { matchKey, ROUTE_GROUPS } from './normalize.js';
import { encodeProgress, decodeProgress } from './progress-code.js';

const STORAGE_KEY = 'austin-streets:named';
const AUSTIN_BOUNDS = [[-97.94, 30.098], [-97.56, 30.517]];
// Panning stops a margin beyond the city limits; zoom stops at roughly a single block.
const MAX_BOUNDS = [[-98.2, 29.92], [-97.3, 30.7]];
const MIN_ZOOM = 8.5;
const MAX_ZOOM = 17;
// The starting view zooms this far past fitting the whole city, centered on central Austin.
const START_ZOOM_IN = 0.6;
const START_CENTER = [-97.745, 30.29];
const SCALE = 1e5;

const $ = (id) => document.getElementById(id);
const els = {
  pct: $('pct'), totalMi: $('total-mi'), count: $('count'), miles: $('miles'),
  list: $('list'), empty: $('empty'), input: $('guess-input'), form: $('guess'),
  feedback: $('feedback'), tooltip: $('tooltip'), loading: $('loading'),
  reset: $('reset'), panel: $('panel'), sheetToggle: $('sheet-toggle'),
  transfer: $('transfer'), dialog: $('transfer-dialog'), copyLink: $('copy-link'), copyCode: $('copy-code'),
  restoreInput: $('restore-input'), restore: $('restore'), transferStatus: $('transfer-status'),
  resetDialog: $('reset-dialog'),
};

const state = {
  streets: [],        // [{ k, d, m, coords }]
  byKey: new Map(),   // key -> index
  exact: {},          // full street name -> its key, where it collides with another street's key
  total: 0,
  named: [],          // indexes in the order they were named
  sort: 'found',
  hoverId: null,
};

// ---------- data ----------

function decodeLine(deltas) {
  const out = [];
  let x = 0, y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i]; y += deltas[i + 1];
    out.push([x / SCALE, y / SCALE]);
  }
  return out;
}

const feature = (i) => ({
  type: 'Feature',
  id: i,
  properties: { name: state.streets[i].d },
  geometry: { type: 'MultiLineString', coordinates: state.streets[i].coords },
});

const share = (i) => (state.streets[i].m / state.total) * 100;
const fmtShare = (p) => (p >= 0.01 ? p.toFixed(2) : '<0.01') + '%';

function loadSaved() {
  try {
    const keys = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return keys.map((k) => state.byKey.get(k)).filter((i) => i !== undefined);
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.named.map((i) => state.streets[i].k)));
  } catch { /* storage unavailable: progress lasts for this visit only */ }
}

// ---------- map ----------

const lineWidth = (z5, z13, z18) => ['interpolate', ['exponential', 1.5], ['zoom'], 5, z5, 13, z13, 18, z18];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const map = new maplibregl.Map({
  container: 'map',
  bounds: AUSTIN_BOUNDS,
  fitBoundsOptions: { padding: 24 },
  maxBounds: MAX_BOUNDS,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  style: {
    version: 8,
    glyphs: location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + 'fonts/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{ id: 'land', type: 'background', paint: { 'background-color': css('--base') } }],
  },
});
map.touchZoomRotate.disableRotation();
window.game = { map, state };
map.addControl(new maplibregl.AttributionControl({
  compact: true,
  customAttribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
}), 'bottom-left');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

function addLayers(background) {
  const accent = css('--secondary');
  map.addSource('background', { type: 'geojson', data: background });
  map.addSource('streets', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: state.streets.map((_, i) => feature(i)) },
  });
  map.addSource('named', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0.2 });

  map.addLayer({
    id: 'parks', type: 'fill', source: 'background', filter: ['==', ['get', 'kind'], 'park'],
    paint: { 'fill-color': css('--park') },
  });
  map.addLayer({
    id: 'water', type: 'fill', source: 'background', filter: ['==', ['get', 'kind'], 'water'],
    paint: { 'fill-color': css('--water') },
  });
  map.addLayer({
    id: 'boundary', type: 'line', source: 'background', filter: ['==', ['get', 'kind'], 'boundary'],
    paint: { 'line-color': css('--boundary'), 'line-width': 1, 'line-dasharray': [3, 3] },
  });
  map.addLayer({
    id: 'streets', type: 'line', source: 'streets',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': css('--street'), 'line-width': lineWidth(0.6, 1.4, 6) },
  });
  map.addLayer({
    id: 'named', type: 'line', source: 'named',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': accent, 'line-width': lineWidth(1, 3, 14) },
  });
  map.addLayer({
    id: 'named-hover', type: 'line', source: 'named',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': css('--highlight'),
      'line-width': lineWidth(2, 5, 18),
      'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
    },
  });
  map.addLayer({
    id: 'named-labels', type: 'symbol', source: 'named', minzoom: 12,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Inter Medium'],
      'text-size': 13,
      'symbol-placement': 'line',
      'symbol-spacing': 180,
      'text-padding': 1,
      'text-max-angle': 60,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': css('--base'),
      'text-halo-width': 1.5,
    },
  });
}

function refreshNamedSource() {
  map.getSource('named')?.setData({ type: 'FeatureCollection', features: state.named.map(feature) });
}

function setHover(id) {
  if (state.hoverId === id) return;
  if (state.hoverId !== null) map.setFeatureState({ source: 'named', id: state.hoverId }, { hover: false });
  if (id !== null) map.setFeatureState({ source: 'named', id }, { hover: true });
  state.hoverId = id;
  for (const li of els.list.children) li.classList.toggle('hover', Number(li.dataset.id) === id);
}

function fitStreet(i) {
  const b = new maplibregl.LngLatBounds();
  for (const line of state.streets[i].coords) for (const p of line) b.extend(p);
  const small = window.innerWidth <= 720;
  map.fitBounds(b, {
    padding: small ? { top: 60, bottom: 180, left: 40, right: 40 } : 80,
    maxZoom: 16,
    duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800,
  });
}

function bindMapHover() {
  let frame = 0;
  map.on('mousemove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const { x, y } = e.point;
      const hit = map.queryRenderedFeatures([[x - 5, y - 5], [x + 5, y + 5]], { layers: ['named'] })[0];
      if (!hit) {
        setHover(null);
        els.tooltip.hidden = true;
        map.getCanvas().style.cursor = '';
        return;
      }
      const id = hit.id;
      setHover(id);
      map.getCanvas().style.cursor = 'pointer';
      const rect = map.getContainer().getBoundingClientRect();
      els.tooltip.innerHTML = '';
      els.tooltip.append(state.streets[id].d);
      const s = document.createElement('span');
      s.className = 'share';
      s.textContent = '+' + fmtShare(share(id));
      els.tooltip.append(s);
      els.tooltip.style.left = rect.left + x + 'px';
      els.tooltip.style.top = rect.top + y + 'px';
      els.tooltip.hidden = false;
    });
  });
  map.on('mouseout', () => {
    setHover(null);
    els.tooltip.hidden = true;
  });
}

// ---------- panel ----------

function renderScore() {
  const miles = state.named.reduce((sum, i) => sum + state.streets[i].m, 0);
  const pct = state.total ? Math.min(100, (miles / state.total) * 100) : 0;
  els.pct.textContent = pct >= 100 ? '100' : pct.toFixed(2);
  els.count.textContent = state.named.length.toLocaleString();
  els.miles.textContent = miles.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function renderList() {
  const order = state.named.slice();
  if (state.sort === 'found') order.reverse();
  else if (state.sort === 'alpha') order.sort((a, b) => state.streets[a].d.localeCompare(state.streets[b].d));
  else order.sort((a, b) => state.streets[b].m - state.streets[a].m);

  const latest = state.named[state.named.length - 1];
  const frag = document.createDocumentFragment();
  for (const i of order) {
    const li = document.createElement('li');
    li.dataset.id = i;
    if (i === latest) li.classList.add('latest');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = state.streets[i].d;
    const pct = document.createElement('span');
    pct.className = 'share';
    pct.textContent = fmtShare(share(i));
    li.append(name, pct);
    frag.append(li);
  }
  els.list.replaceChildren(frag);
  els.empty.hidden = state.named.length > 0;
}

function render() {
  renderScore();
  renderList();
  refreshNamedSource();
}

let feedbackTimer = 0;
function flash(message) {
  els.feedback.textContent = message;
  els.feedback.classList.add('show');
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => els.feedback.classList.remove('show'), 2200);
}

function shake() {
  els.form.classList.remove('shake');
  void els.form.offsetWidth;
  els.form.classList.add('shake');
}

// ---------- guessing ----------

// Streets a guess names: a route group's roads, or the first matching street.
function matchGuess(text) {
  const key = matchKey(text, (k) => state.byKey.has(k), state.exact);
  if (key === null) return { route: null, matches: [] };
  if (ROUTE_GROUPS[key]) {
    return { route: key, matches: ROUTE_GROUPS[key].map((k) => state.byKey.get(k)).filter((i) => i !== undefined) };
  }
  return { route: null, matches: [state.byKey.get(key)] };
}

function submitGuess(text) {
  if (!text.trim()) return;
  const { route, matches } = matchGuess(text);
  if (!matches.length) {
    shake();
    flash('No Austin street by that name');
    return;
  }
  els.input.value = '';
  const fresh = matches.filter((i) => !state.named.includes(i));
  if (!fresh.length) {
    flash(`Already named ${route ? 'every road along ' + route : state.streets[matches[0]].d}`);
    setHover(matches[0]);
    return;
  }
  state.named.push(...fresh);
  save();
  render();
  const gained = fmtShare(fresh.reduce((sum, i) => sum + share(i), 0));
  const label = fresh.length === 1 ? state.streets[fresh[0]].d : `${fresh.length} roads along ${route}`;
  const done = state.named.length === state.streets.length;
  flash(done ? 'Every street in Austin, named.' : `${label}  +${gained}`);
}

function bindUI() {
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitGuess(els.input.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
    if (document.activeElement !== els.input && !els.input.disabled) els.input.focus();
  });

  for (const btn of document.querySelectorAll('.segmented button')) {
    btn.addEventListener('click', () => {
      state.sort = btn.dataset.sort;
      for (const b of document.querySelectorAll('.segmented button')) b.setAttribute('aria-selected', b === btn);
      renderList();
    });
  }

  els.list.addEventListener('mouseover', (e) => {
    const li = e.target.closest('li');
    setHover(li ? Number(li.dataset.id) : null);
  });
  els.list.addEventListener('mouseleave', () => setHover(null));
  els.list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    fitStreet(Number(li.dataset.id));
    els.panel.classList.remove('open');
    els.sheetToggle.setAttribute('aria-expanded', 'false');
  });

  els.reset.addEventListener('click', () => {
    if (!state.named.length) return;
    els.resetDialog.returnValue = '';
    els.resetDialog.showModal();
  });
  els.resetDialog.addEventListener('close', () => {
    if (els.resetDialog.returnValue !== 'reset') return;
    state.named = [];
    save();
    setHover(null);
    render();
  });

  els.sheetToggle.addEventListener('click', () => {
    const open = els.panel.classList.toggle('open');
    els.sheetToggle.setAttribute('aria-expanded', String(open));
  });
}

// ---------- transfer ----------

const namedKeys = () => state.named.map((i) => state.streets[i].k);

// Adds streets from a list of keys to the current progress. Returns how many were new.
function mergeKeys(keys) {
  const before = state.named.length;
  for (const k of keys) {
    const i = state.byKey.get(k);
    if (i !== undefined && !state.named.includes(i)) state.named.push(i);
  }
  const added = state.named.length - before;
  if (added) {
    save();
    render();
  }
  return added;
}

const plural = (n) => `${n.toLocaleString()} ${n === 1 ? 'street' : 'streets'}`;

async function shareLink() {
  const url = new URL(location.href);
  url.hash = 'p=' + (await encodeProgress(namedKeys()));
  return url.toString();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function bindTransfer() {
  const status = (msg) => { els.transferStatus.textContent = msg; };

  els.transfer.addEventListener('click', () => {
    status('');
    els.restoreInput.value = '';
    els.dialog.showModal();
  });

  const copy = async (asLink) => {
    if (!state.named.length) return status('Name a street first.');
    const text = asLink ? await shareLink() : await encodeProgress(namedKeys());
    if (await copyText(text)) {
      status(`Copied ${asLink ? 'a link' : 'a code'} for ${plural(state.named.length)}.`);
    } else {
      els.restoreInput.value = text;
      els.restoreInput.select();
      status('Copying was blocked. The text is selected below; copy it manually.');
    }
  };
  els.copyLink.addEventListener('click', () => copy(true));
  els.copyCode.addEventListener('click', () => copy(false));

  els.restore.addEventListener('click', async () => {
    const keys = await decodeProgress(els.restoreInput.value);
    if (!keys) return status("That isn't a valid link or code.");
    const added = mergeKeys(keys);
    status(added ? `Added ${plural(added)}.` : 'No new streets in that code.');
    if (added) els.restoreInput.value = '';
  });
}

// Restores progress from a share link (#p=...) and then removes the code from the address bar.
async function restoreFromHash() {
  if (!location.hash.startsWith('#p=')) return;
  const keys = await decodeProgress(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!keys) return flash("That progress link isn't valid");
  const fresh = keys.filter((k) => {
    const i = state.byKey.get(k);
    return i !== undefined && !state.named.includes(i);
  });
  if (!fresh.length) return flash('No new streets in that link');
  if (!confirm(`Add ${plural(fresh.length)} from this link to your progress?`)) return;
  flash(`Added ${plural(mergeKeys(fresh))}`);
}

// ---------- start ----------

async function start() {
  const [streetData, background] = await Promise.all([
    fetch('data/streets.json').then((r) => r.json()),
    fetch('data/background.json').then((r) => r.json()),
    new Promise((resolve) => (map.loaded() ? resolve() : map.once('load', resolve))),
  ]);

  state.total = streetData.total;
  state.exact = streetData.exact || {};
  state.streets = streetData.streets.map((s) => ({ k: s.k, d: s.d, m: s.m, coords: s.g.map(decodeLine) }));
  state.streets.forEach((s, i) => state.byKey.set(s.k, i));
  state.named = loadSaved();
  els.totalMi.textContent = Math.round(state.total).toLocaleString();

  map.resize();
  map.fitBounds(AUSTIN_BOUNDS, { padding: 24, animate: false });
  map.jumpTo({ center: START_CENTER, zoom: map.getZoom() + START_ZOOM_IN });
  addLayers(background);
  bindMapHover();
  bindUI();
  bindTransfer();
  render();
  await restoreFromHash();

  els.loading.hidden = true;
  els.input.disabled = false;
  if (window.innerWidth > 720) els.input.focus();
}

start().catch((err) => {
  console.error(err);
  els.loading.textContent = 'The street data failed to load.';
});
