// Packs a list of street keys into a short URL-safe code and back.
// Format: "1" + base64url(deflate-raw(keys joined by ",")). The leading digit is the format version.

const VERSION = '1';

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeProgress(keys) {
  const raw = new TextEncoder().encode(keys.join(','));
  return VERSION + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
}

// Accepts a bare code or a full share link. Returns the keys, or null if the input isn't a valid code.
export async function decodeProgress(input) {
  const text = input.trim();
  const match = text.match(/[#&]p=([A-Za-z0-9_-]+)/);
  const code = match ? match[1] : text;
  if (!code.startsWith(VERSION) || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const raw = await pipe(fromBase64Url(code.slice(VERSION.length)), new DecompressionStream('deflate-raw'));
    const str = new TextDecoder().decode(raw);
    return str ? str.split(',') : [];
  } catch {
    return null;
  }
}
