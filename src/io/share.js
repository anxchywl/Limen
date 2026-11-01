// Share link encoder and decoder:
// Compresses JSON via native CompressionStream('deflate-raw'),
// encodes to base64url, and manages location.hash = '#s=...'.
// Warns if the link exceeds 8 KB.

import {toJSON, fromJSON} from './serialize.js';

export const MAX_SHARE_LINK_CHARS = 8192; // 8 KB

export async function compressText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function decompressText(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

export async function encodeShare(doc) {
  const json = toJSON(doc, 0); // Compact JSON
  return await compressText(json);
}

export async function decodeShare(b64url) {
  try {
    const json = await decompressText(b64url);
    return fromJSON(json);
  } catch (err) {
    return {ok: false, error: `Decompression failed: ${err.message}`};
  }
}

export async function buildShareUrl(doc, baseUrl = (typeof window !== 'undefined' ? window.location.href : 'http://localhost:5180/')) {
  const data = await encodeShare(doc);
  const cleanBase = baseUrl.split('#')[0];
  const url = `${cleanBase}#s=${data}`;
  const isLarge = data.length > MAX_SHARE_LINK_CHARS;
  return {
    url,
    dataLength: data.length,
    warning: isLarge ? 'Share link exceeds 8 KB limit; save as file instead' : null,
  };
}

export async function copyShareLink(doc) {
  const {url, warning, dataLength} = await buildShareUrl(doc);
  let copied = false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (_) {}
  }
  return {url, copied, warning, dataLength};
}
