import { candidateKeys } from './normalize.js';

const STORAGE_KEY = 'austin-streets:named';
const AUSTIN_BOUNDS = [[-97.94, 30.098], [-97.56, 30.517]];
const SCALE = 1e5;

const $ = (id) => document.getElementById(id);
const els = {
  pct: $('pct'), totalMi: $('total-mi'), count: $('count'), miles: $('miles'),
  list: $('list'), empty: $('empty'), input: $('guess-input'), form: $('guess'),
  feedback: $('feedback'), tooltip: $('tooltip'), loading: $('loading'),
  labels: $('labels-toggle'), reset: $('reset'), panel: $('panel'), sheetToggle: $('sheet-toggle'),
};

const state = {
  streets: [],        // [{ k, d, m, coords }]
  byKey: new Map(),   // key -> index
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
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{ id: 'land', type: 'background', paint: { 'background-color': css('--bp-map-land') } }],
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
  const accent = css('--bp-accent');
  map.addSource('background', { type: 'geojson', data: background });
  map.addSource('streets', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: state.streets.map((_, i) => feature(i)) },
  });
  map.addSource('named', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({
    id: 'parks', type: 'fill', source: 'background', filter: ['==', ['get', 'kind'], 'park'],
    paint: { 'fill-color': css('--bp-map-park') },
  });
  map.addLayer({
    id: 'water', type: 'fill', source: 'background', filter: ['==', ['get', 'kind'], 'water'],
    paint: { 'fill-color': css('--bp-map-water') },
  });
  map.addLayer({
    id: 'boundary', type: 'line', source: 'background', filter: ['==', ['get', 'kind'], 'boundary'],
    paint: { 'line-color': '#3A4048', 'line-width': 1, 'line-dasharray': [3, 3] },
  });
  map.addLayer({
    id: 'streets', type: 'line', source: 'streets',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#3E454C', 'line-width': lineWidth(0.6, 1.4, 6) },
  });
  map.addLayer({
    id: 'named-hover', type: 'line', source: 'named',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': css('--bp-ink'),
      'line-width': lineWidth(3, 7, 24),
      'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
    },
  });
  map.addLayer({
    id: 'named', type: 'line', source: 'named',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': accent, 'line-width': lineWidth(0.8, 2.5, 12) },
  });
  map.addLayer({
    id: 'named-labels', type: 'symbol', source: 'named',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 11,
      'symbol-placement': 'line',
      'symbol-spacing': 320,
      'text-padding': 2,
    },
    paint: {
      'text-color': css('--bp-ink'),
      'text-halo-color': css('--bp-map-land'),
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

function submitGuess(text) {
  if (!text.trim()) return;
  const idx = candidateKeys(text).map((k) => state.byKey.get(k)).find((i) => i !== undefined);
  if (idx === undefined) {
    shake();
    flash('No Austin street by that name');
    return;
  }
  els.input.value = '';
  if (state.named.includes(idx)) {
    flash(`Already named ${state.streets[idx].d}`);
    setHover(idx);
    return;
  }
  state.named.push(idx);
  save();
  render();
  const done = state.named.length === state.streets.length;
  flash(done ? 'Every street in Austin, named.' : `${state.streets[idx].d}  +${fmtShare(share(idx))}`);
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

  els.labels.addEventListener('change', () => {
    map.setLayoutProperty('named-labels', 'visibility', els.labels.checked ? 'visible' : 'none');
  });

  els.reset.addEventListener('click', () => {
    if (!state.named.length || !confirm('Clear every street you have named?')) return;
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

// ---------- start ----------

async function start() {
  const [streetData, background] = await Promise.all([
    fetch('data/streets.json').then((r) => r.json()),
    fetch('data/background.json').then((r) => r.json()),
    new Promise((resolve) => (map.loaded() ? resolve() : map.once('load', resolve))),
  ]);

  state.total = streetData.total;
  state.streets = streetData.streets.map((s) => ({ k: s.k, d: s.d, m: s.m, coords: s.g.map(decodeLine) }));
  state.streets.forEach((s, i) => state.byKey.set(s.k, i));
  state.named = loadSaved();
  els.totalMi.textContent = Math.round(state.total).toLocaleString();

  map.resize();
  map.fitBounds(AUSTIN_BOUNDS, { padding: 24, animate: false });
  addLayers(background);
  bindMapHover();
  bindUI();
  render();

  els.loading.hidden = true;
  els.input.disabled = false;
  if (window.innerWidth > 720) els.input.focus();
}

start().catch((err) => {
  console.error(err);
  els.loading.textContent = 'The street data failed to load.';
});
