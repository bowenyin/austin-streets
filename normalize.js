// Turns a street name (from OSM or typed by a player) into a matching key,
// e.g. "South Lamar Blvd" -> "LAMAR", "E 6th St" -> "6TH", "I-35" -> "35".

const DIRECTIONS = new Set([
  'NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTHEAST', 'NORTHWEST', 'SOUTHEAST', 'SOUTHWEST',
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
]);

const DIRECTION_WORDS = {
  N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST', NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST',
};

const SUFFIXES = new Set([
  'STREET', 'ST', 'AVENUE', 'AVE', 'AV', 'BOULEVARD', 'BLVD', 'DRIVE', 'DR', 'ROAD', 'RD',
  'LANE', 'LN', 'COURT', 'CT', 'CIRCLE', 'CIR', 'COVE', 'CV', 'TRAIL', 'TRL', 'PARKWAY', 'PKWY',
  'EXPRESSWAY', 'EXPY', 'HIGHWAY', 'HWY', 'FREEWAY', 'FWY', 'WAY', 'WY', 'PLACE', 'PL',
  'TERRACE', 'TER', 'LOOP', 'LP', 'PASS', 'PATH', 'BEND', 'BND', 'HOLLOW', 'HOLW', 'CROSSING',
  'XING', 'RUN', 'PLAZA', 'PLZ', 'WALK', 'TRACE', 'TRCE', 'SQUARE', 'SQ', 'ROW', 'CUTOFF',
  'SKYWAY', 'ALLEY', 'ALY',
]);

// Trailing phrases that describe a carriageway rather than a different street.
const TRAILING_PHRASES = [
  'SERVICE ROAD', 'SERVICE RD', 'FRONTAGE ROAD', 'FRONTAGE RD', 'TOLL ROAD', 'TOLL RD',
  'NORTHBOUND', 'SOUTHBOUND', 'EASTBOUND', 'WESTBOUND', 'ACCESS ROAD',
];

// Route designations stripped before a highway number: "US Highway 290" -> "290".
const HIGHWAY_PREFIX = new RegExp(
  '^(?:INTERSTATE HIGHWAY|INTERSTATE|IH|I|US HIGHWAY|US HWY|US|STATE HIGHWAY|STATE HWY|SH|TX|' +
  'RANCH TO MARKET ROAD|RANCH TO MARKET|RANCH ROAD|RM|RR|FARM TO MARKET ROAD|FARM TO MARKET|FM|' +
  'HIGHWAY|HWY|LOOP|SPUR)\\s+(\\d+[A-Z]?)$'
);

const ORDINAL_WORDS = {
  FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH', SIXTH: '6TH',
  SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH', ELEVENTH: '11TH',
  TWELFTH: '12TH', TWELVETH: '12TH', THIRTEENTH: '13TH', FOURTEENTH: '14TH',
  FIFTEENTH: '15TH', SIXTEENTH: '16TH', SEVENTEENTH: '17TH', EIGHTEENTH: '18TH',
  NINETEENTH: '19TH', TWENTIETH: '20TH',
};

// Common local names, applied to the finished key.
const ALIASES = {
  MOPACEXPY: 'MOPAC', LOOP1: 'MOPAC',
  MLK: 'MARTINLUTHERKING', MLKJR: 'MARTINLUTHERKING',
  '360': 'CAPITALOFTEXAS', CAPOFTEXAS: 'CAPITALOFTEXAS',
  CHAVEZ: 'CESARCHAVEZ',
  SOCO: 'CONGRESS', SOLA: 'LAMAR', MANCHACA: 'MENCHACA',
  IH35: '35', I35: '35',
};

function tokens(str) {
  return str.split(' ').filter(Boolean);
}

// A leading direction is part of the name when a street-type word follows it ("West Avenue", "North Loop Blvd").
const isLeadingDirection = (t) =>
  t.length > 1 && DIRECTIONS.has(t[0].toUpperCase()) && !SUFFIXES.has(t[1].toUpperCase());

export function normalize(name) {
  if (!name) return '';
  let s = name.toUpperCase()
    .replace(/\s*(½|1\/2)/g, 'HALF ')
    .replace(/['’.]/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const phrase of TRAILING_PHRASES) {
    if (s.endsWith(' ' + phrase)) s = s.slice(0, -phrase.length - 1);
  }

  let t = tokens(s);
  if (DIRECTION_WORDS[t[0]]) t[0] = DIRECTION_WORDS[t[0]];
  if (t.length > 1 && DIRECTIONS.has(t[t.length - 1])) t.pop();
  if (isLeadingDirection(t)) t.shift();
  if (t.length > 1 && SUFFIXES.has(t[t.length - 1])) t.pop();
  if (t.length > 1 && (t[t.length - 1] === 'JR' || t[t.length - 1] === 'JUNIOR')) t.pop();
  if (t[0] === 'ST' && t.length > 1) t[0] = 'SAINT';
  if ((t[0] === 'AVE' || t[0] === 'AV') && t.length > 1) t[0] = 'AVENUE';
  if (t.length === 1 && ORDINAL_WORDS[t[0]]) t[0] = ORDINAL_WORDS[t[0]];

  s = t.join(' ');
  const full = s.replace(/ /g, '');
  if (ALIASES[full]) return ALIASES[full];
  const hwy = s.match(HIGHWAY_PREFIX);
  const key = hwy ? hwy[1] : full;
  return ALIASES[key] || key;
}

// Human-readable name for a street: drops the directional prefix and carriageway phrases.
export function displayName(name) {
  let s = name.trim();
  for (const phrase of TRAILING_PHRASES) {
    const re = new RegExp('\\s+' + phrase.replace(/ /g, '\\s+') + '$', 'i');
    s = s.replace(re, '');
  }
  const t = tokens(s);
  if (isLeadingDirection(t)) t.shift();
  return t.join(' ');
}

// Keys to try for a typed guess, in order: the key itself, then bare numbers as ordinals ("6" -> "6TH").
export function candidateKeys(input) {
  const key = normalize(input);
  if (!key) return [];
  const keys = [key];
  // "North Loop" may be the whole name (North Loop Blvd) or a street named North; try the whole name first.
  const words = tokens(input.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' '));
  if (words.length === 2 && DIRECTIONS.has(words[0]) && SUFFIXES.has(words[1])) {
    keys.unshift((DIRECTION_WORDS[words[0]] || words[0]) + words[1]);
    keys.push(normalize(words[1]));
  }
  if (/^\d+$/.test(key)) {
    const n = Number(key);
    const rem100 = n % 100;
    const suffix = rem100 >= 11 && rem100 <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH');
    keys.push(key + suffix);
  }
  return keys;
}
