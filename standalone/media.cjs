'use strict';
const { inflateRawSync } = require('node:zlib');
const { normalizePayload } = require('../netlify/functions/ingest-media.js')._internals;
const MAX_XML = 8 * 1024 * 1024;

// Read one bounded ZIP entry, never extract archive paths or resolve XML entities.
function docxText(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This DOCX archive is incomplete.');
  let offset = buffer.readUInt32LE(end + 16);
  const entries = buffer.readUInt16LE(end + 10);
  if (entries > 4096) throw new Error('This DOCX archive has too many entries.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    if (next > end) break;
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === 'word/document.xml') {
      const method = buffer.readUInt16LE(offset + 10);
      const flags = buffer.readUInt16LE(offset + 8);
      const size = buffer.readUInt32LE(offset + 20);
      const expandedSize = buffer.readUInt32LE(offset + 24);
      const local = buffer.readUInt32LE(offset + 42);
      if ((flags & 1) || expandedSize > MAX_XML || local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) break;
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      if (start + size > offset || ![0, 8].includes(method)) break;
      const compressed = buffer.subarray(start, start + size);
      const xml = method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_XML }) : compressed;
      if (xml.length > MAX_XML) break;
      return xml.toString('utf8').replace(/<w:(?:p|br|tab)\b[^>]*>/g, '\n');
    }
    offset = next;
  }
  throw new Error('Cannot read this DOCX. Save it as plain text and import that file.');
}
function decodeEntities(value) {
  return value.replace(/&(?:lt|gt|quot|apos|nbsp|amp);|&#(?:x[0-9a-f]+|[0-9]+);/gi, entity => {
    const named = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&amp;': '&' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = entity.slice(2, 3).toLowerCase() === 'x';
    const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  });
}
function extractLocal(file) {
  if (['pdf', 'png', 'jpeg', 'gif'].includes(file.kind)) return null;
  let text = file.kind === 'docx' ? docxText(file.buffer) : file.buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (['docx', 'html'].includes(file.kind)) {
    text = decodeEntities(text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' '));
  } else if (file.kind === 'rtf') {
    text = text.replace(/\\par[d]?\b/g, '\n').replace(/\\'[0-9a-f]{2}/gi, ' ').replace(/\\[a-z]+-?\d* ?/gi, ' ').replace(/[{}]/g, ' ');
  }
  return text.replace(/\r\n?/g, '\n').trim();
}
module.exports = { normalizePayload, extractLocal, docxText };
