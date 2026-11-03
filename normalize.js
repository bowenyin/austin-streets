// Turns a street name (from OSM or typed by a player) into a matching key,
// e.g. "South Lamar Blvd" -> "LAMAR", "E 6th St" -> "6TH", "I-35" -> "35".

const DIRECTION_WORDS = {
  N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST', NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST',
};
const DIRECTIONS = new Set(Object.values(DIRECTION_WORDS));

// Street-type words, keyed by their USPS abbreviations.
const SUFFIX_WORDS = {
  ST: 'STREET', AVE: 'AVENUE', AV: 'AVENUE', BLVD: 'BOULEVARD', DR: 'DRIVE', RD: 'ROAD', LN: 'LANE',
  CT: 'COURT', CIR: 'CIRCLE', CV: 'COVE', TRL: 'TRAIL', PKWY: 'PARKWAY', EXPY: 'EXPRESSWAY',
  HWY: 'HIGHWAY', FWY: 'FREEWAY', WY: 'WAY', PL: 'PLACE', TER: 'TERRACE', LP: 'LOOP', BND: 'BEND',
  HOLW: 'HOLLOW', XING: 'CROSSING', PLZ: 'PLAZA', TRCE: 'TRACE', SQ: 'SQUARE', ALY: 'ALLEY',
};
const SUFFIXES = new Set([
  ...Object.values(SUFFIX_WORDS), 'PASS', 'PATH', 'RUN', 'WALK', 'ROW', 'CUTOFF', 'SKYWAY',
]);

// Abbreviations that can appear anywhere in a name.
const WORD_ABBREVIATIONS = { MT: 'MOUNT', FT: 'FORT', CRK: 'CREEK', SPGS: 'SPRINGS', HTS: 'HEIGHTS', MTN: 'MOUNTAIN' };

// Trailing words that describe a carriageway rather than a different street.
const CARRIAGEWAY_WORDS = new Set([
  'SERVICE', 'FRONTAGE', 'TOLL', 'ACCESS', 'NORTHBOUND', 'SOUTHBOUND', 'EASTBOUND', 'WESTBOUND',
]);

// Route designations stripped before a highway number: "US Highway 290" -> "290".
const HIGHWAY_PREFIX = new RegExp(
  '^(?:INTERSTATE HIGHWAY|INTERSTATE|IH|I|US HIGHWAY|US HWY|US|STATE HIGHWAY|STATE HWY|SH|TX|' +
  'RANCH TO MARKET ROAD|RANCH TO MARKET|RANCH ROAD|RM|RR|FARM TO MARKET ROAD|FARM TO MARKET|FM|' +
  'HIGHWAY|HWY|LOOP|SPUR)\\s+(\\d+[A-Z]?)$'
);

const ORDINAL_UNITS = {
  FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10,
  ELEVENTH: 11, TWELFTH: 12, TWELVETH: 12, THIRTEENTH: 13, FOURTEENTH: 14, FIFTEENTH: 15, SIXTEENTH: 16,
  SEVENTEENTH: 17, EIGHTEENTH: 18, NINETEENTH: 19, TWENTIETH: 20, THIRTIETH: 30, FORTIETH: 40, FIFTIETH: 50,
};
const TENS = { TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50 };

// Common local names, applied to the finished key.
const ALIASES = {
  MOPACEXPRESSWAY: 'MOPAC', LOOP1: 'MOPAC',
  MLK: 'MARTINLUTHERKING', MLKJR: 'MARTINLUTHERKING',
  '360': 'CAPITALOFTEXAS', CAPOFTEXAS: 'CAPITALOFTEXAS',
  CHAVEZ: 'CESARCHAVEZ',
  SOCO: 'CONGRESS', SOLA: 'LAMAR', MANCHACA: 'MENCHACA',
  IH35: '35', I35: '35',
};

// Route numbers that also name the local roads they run along; typing the number names all of them.
export const ROUTE_GROUPS = {
  '183': ['183', 'RESEARCH', 'EDBLUESTEIN', 'BERGSTROM', 'BASTROP'],
  '71': ['71', 'BENWHITE', 'BASTROP'],
};

function ordinal(n) {
  const rem100 = n % 100;
  return n + (rem100 >= 11 && rem100 <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH'));
}

// Uppercases, strips punctuation, and expands abbreviations and number words into a token list.
function cleanTokens(name) {
  const s = name.toUpperCase()
    .replace(/\s*(½|1\/2)/g, 'HALF ')
    .replace(/['’.]/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim();
  let t = s.split(/\s+/).filter(Boolean);
  if (!t.length) return t;

  const isRoadWord = (w) => w === 'ROAD' || w === 'RD';
  while (t.length > 1 && (CARRIAGEWAY_WORDS.has(t[t.length - 1]) ||
    (isRoadWord(t[t.length - 1]) && CARRIAGEWAY_WORDS.has(t[t.length - 2])))) t.pop();

  // Direction letters expand unless they are initials next to another letter ("E M Franklin").
  const isLetter = (w) => w?.length === 1;
  t = t.map((w, i) => WORD_ABBREVIATIONS[w] ||
    (DIRECTION_WORDS[w] && !(isLetter(w) && (isLetter(t[i - 1]) || isLetter(t[i + 1]))) ? DIRECTION_WORDS[w] : w));
  if (t[0] === 'ST' && t.length > 1) t[0] = 'SAINT';
  if ((t[0] === 'AVE' || t[0] === 'AV') && t.length > 1) t[0] = 'AVENUE';
  const last = t.length - 1;
  if (SUFFIX_WORDS[t[last]] && !(last === 0 && t[0] === 'ST')) t[last] = SUFFIX_WORDS[t[last]];

  // Number words: "Sixth" -> 6TH, "Twenty Sixth" -> 26TH.
  for (let i = 0; i < t.length; i++) {
    if (TENS[t[i]] && ORDINAL_UNITS[t[i + 1]] < 10) t.splice(i, 2, ordinal(TENS[t[i]] + ORDINAL_UNITS[t[i + 1]]));
    else if (ORDINAL_UNITS[t[i]]) t[i] = ordinal(ORDINAL_UNITS[t[i]]);
  }
  return t;
}

const isRoute = (t) => HIGHWAY_PREFIX.test(t.join(' '));

// A leading direction is a prefix ("South Lamar") unless a street-type word follows it ("West Avenue",
// "North Loop Blvd"); before a route number it is always a prefix ("West Highway 71").
function hasLeadingDirection(t) {
  if (t.length < 2 || !DIRECTIONS.has(t[0])) return false;
  return !SUFFIXES.has(t[1]) || isRoute(t.slice(1));
}

// A trailing direction is a suffix ("Ranch Road 620 North") unless only a street-type word precedes it ("Avenue N").
function hasTrailingDirection(t) {
  if (t.length < 2 || !DIRECTIONS.has(t[t.length - 1])) return false;
  return !(t.length === 2 && (SUFFIXES.has(t[0]) || t[0] === 'AVENUE'));
}

function finishKey(t) {
  const s = t.join(' ');
  const full = s.replace(/ /g, '');
  if (ALIASES[full]) return ALIASES[full];
  const hwy = s.match(HIGHWAY_PREFIX);
  const key = hwy ? hwy[1] : full;
  return ALIASES[key] || key;
}

// Name tokens with direction prefixes/suffixes removed. keepSuffix keeps the street-type word ("Cat Hollow"
// stays CAT HOLLOW, not CAT); keepTrailingDirection keeps a final direction ("Collinwood West");
// keepLeadingDirection keeps a first one ("West Gate Blvd" -> WEST GATE).
function nameTokens(name, { keepSuffix = false, keepTrailingDirection = false, keepLeadingDirection = false } = {}) {
  const t = cleanTokens(name);
  if (!keepTrailingDirection && hasTrailingDirection(t)) t.pop();
  if (!keepLeadingDirection && hasLeadingDirection(t)) t.shift();
  if (!keepSuffix && t.length > 1 && SUFFIXES.has(t[t.length - 1]) && !isRoute(t)) t.pop();
  if (t.length > 1 && (t[t.length - 1] === 'JR' || t[t.length - 1] === 'JUNIOR')) t.pop();
  return t;
}

// The matching key.
export function normalize(name, options) {
  return name ? finishKey(nameTokens(name, options)) : '';
}

// A full name in canonical form, spaces kept: "W Oak Blvd" and "West Oak Boulevard" match, "Oaklane" does not.
export function canonicalName(name) {
  return name ? cleanTokens(name).join(' ') : '';
}

// The street-type word a name ends with ("Gate Way" -> WAY), else ''.
export function streetType(name) {
  const t = cleanTokens(name);
  if (hasTrailingDirection(t)) t.pop();
  return t.length > 1 && SUFFIXES.has(t[t.length - 1]) ? t[t.length - 1] : '';
}

// The leading direction word of a name if it is a prefix, else ''.
export function leadingDirection(name) {
  const t = cleanTokens(name);
  return hasLeadingDirection(t) ? t[0] : '';
}

// Builds the key function for a whole set of street names. A leading direction is usually an address prefix
// ("South Lamar"), but it is part of the name when the only other street with that base name has a different
// street type ("West Gate Blvd" vs "Gate Way").
export function createStreetKey(names) {
  const bases = new Map();
  for (const name of names) {
    const base = normalize(name);
    if (!bases.has(base)) bases.set(base, { directions: new Set(), directedTypes: new Set(), bareTypes: new Set() });
    const info = bases.get(base);
    const dir = leadingDirection(name);
    if (dir) {
      info.directions.add(dir);
      info.directedTypes.add(streetType(name));
    } else {
      info.bareTypes.add(streetType(name));
    }
  }
  const partOfName = new Set();
  for (const [base, info] of bases) {
    const overlap = [...info.directedTypes].some((type) => info.bareTypes.has(type));
    if (!/^\d/.test(base) && info.directions.size === 1 && info.bareTypes.size > 0 && !overlap) partOfName.add(base);
  }
  return (name) => {
    const base = normalize(name);
    return partOfName.has(base) && leadingDirection(name) ? normalize(name, { keepLeadingDirection: true }) : base;
  };
}

// The trailing direction word of a name if it is a suffix ("Meadows Drive North"), else ''.
export function trailingDirection(name) {
  const t = cleanTokens(name);
  return hasTrailingDirection(t) ? t[t.length - 1] : '';
}

// Human-readable name: drops carriageway words, the directional prefix unless keepDirection, and the
// directional suffix with dropTrailingDirection.
export function displayName(name, { keepDirection = false, dropTrailingDirection = false } = {}) {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && (CARRIAGEWAY_WORDS.has(words[words.length - 1].toUpperCase()) ||
    (/^(road|rd)$/i.test(words[words.length - 1]) && CARRIAGEWAY_WORDS.has(words[words.length - 2].toUpperCase())))) {
    words.pop();
  }
  if (dropTrailingDirection && trailingDirection(words.join(' '))) words.pop();
  if (!keepDirection && leadingDirection(words.join(' '))) words.shift();
  return words.join(' ');
}

// Keys to try for a typed guess, most specific first.
export function candidateKeys(input) {
  const key = normalize(input);
  if (!key) return [];
  const keys = [
    normalize(input, { keepSuffix: true, keepTrailingDirection: true, keepLeadingDirection: true }),
    normalize(input, { keepSuffix: true, keepTrailingDirection: true }),
    normalize(input, { keepLeadingDirection: true }),
    normalize(input, { keepSuffix: true }),
    normalize(input, { keepTrailingDirection: true }),
    key,
  ];

  // A leading letter read as a direction even beside an initial: "E O Dell" -> East O Dell.
  const first = input.trim().split(/\s+/)[0]?.toUpperCase();
  if (DIRECTION_WORDS[first]) keys.push(normalize(DIRECTION_WORDS[first] + input.trim().slice(first.length)));

  // Bare numbers as ordinals: "6" -> 6TH.
  if (/^\d+$/.test(key)) keys.push(ordinal(Number(key)));

  // A direction glued to the name: "Westgate" -> West Gate.
  const glued = [...DIRECTIONS].sort((a, b) => b.length - a.length).find((d) => key.startsWith(d) && key.length > d.length);
  if (glued) keys.push(normalize(`${glued} ${input.trim().slice(glued.length)}`));

  return [...new Set(keys)];
}

// The key a typed guess names: a route group, or the first candidate that is a street. `exact` maps a
// canonical full name to its own key where it collides with a longer street's key ("Breezy Pass" vs
// "Breezy Pass Cove").
export function matchKey(input, hasKey, exact = {}) {
  const own = exact[canonicalName(input)];
  if (own && hasKey(own)) return own;
  return candidateKeys(input).find((key) => ROUTE_GROUPS[key] || hasKey(key)) ?? null;
}
