'use strict';

const BYTES_PER_MIB = 1024 * 1024;
const MAX_MEDIA_BYTES = 4 * BYTES_PER_MIB;
const MAX_BODY_BYTES = 6 * BYTES_PER_MIB;
const MAX_EXTRACTED_TEXT_CHARS = 60000;
const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite-preview-09-2025';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

const KIND_TO_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  csv: 'text/csv',
  json: 'application/json',
  rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const MIME_TO_KIND = new Map([
  ['application/pdf', 'pdf'],
  ['image/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/pjpeg', 'jpeg'],
  ['image/gif', 'gif'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
  ['text/x-markdown', 'md'],
  ['text/html', 'html'],
  ['application/xhtml+xml', 'html'],
  ['text/csv', 'csv'],
  ['application/csv', 'csv'],
  ['application/json', 'json'],
  ['text/json', 'json'],
  ['application/rtf', 'rtf'],
  ['text/rtf', 'rtf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
]);

const EXTENSION_TO_KIND = new Map([
  ['pdf', 'pdf'],
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['gif', 'gif'],
  ['txt', 'txt'],
  ['text', 'txt'],
  ['md', 'md'],
  ['markdown', 'md'],
  ['html', 'html'],
  ['htm', 'html'],
  ['csv', 'csv'],
  ['json', 'json'],
  ['rtf', 'rtf'],
  ['docx', 'docx'],
]);

const DETERMINISTIC_KINDS = new Set(['txt', 'md', 'html', 'csv', 'json', 'rtf', 'docx']);
const BINARY_AI_KINDS = new Set(['pdf', 'png', 'jpeg', 'gif']);

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function getOrigin(headers) {
  const h = headers || {};
  return h.origin || h.Origin || '';
}

function makeCorsHeaders(origin) {
  const H = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ezq-beta',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin) H['Access-Control-Allow-Origin'] = origin;
  return H;
}

function reply(statusCode, body, origin) {
  const headers = makeCorsHeaders(origin);
  return {
    statusCode,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIMIT = toPositiveInt(process.env.MEDIA_IMPORT_LIMIT, DEFAULT_LIMIT);
const WINDOW_MS = toPositiveInt(process.env.MEDIA_IMPORT_WINDOW_MS, DEFAULT_WINDOW_MS);
const RL = new Map();

function clientIp(event) {
  const h = event.headers || {};
  const forwarded = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  return String(forwarded.split(',')[0]?.trim() || h['x-real-ip'] || h['X-Real-IP'] || 'unknown').replace(/[^a-f0-9:.]/gi, '').slice(0, 45);
}

function rateLimited(event) {
  const ip = clientIp(event);
  const now = Date.now();
  const recent = (RL.get(ip) || []).filter((ts) => now - ts < WINDOW_MS);
  if (recent.length >= LIMIT) return true;
  recent.push(now);
  RL.set(ip, recent);
  return false;
}

function makeMediaError(message, code, status, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function sniffBufferKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return 'unknown';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return 'zip';
  return 'unknown';
}

function kindFromMime(type) {
  return MIME_TO_KIND.get(String(type || '').trim().toLowerCase()) || 'unknown';
}

function kindFromName(name) {
  const match = String(name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? (EXTENSION_TO_KIND.get(match[1]) || 'unknown') : 'unknown';
}

function hasTextSignature(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return false;
  if (
    buf.length >= 2
    && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
  ) {
    return true;
  }
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x08) suspicious++;
    else if (byte > 0x0d && byte < 0x20) suspicious++;
  }
  return suspicious / sample.length < 0.02;
}

function resolveDeclaredKind({ name, type, kind }) {
  const declaredKind = KIND_TO_MIME[kind] ? kind : 'unknown';
  const mimeKind = kindFromMime(type);
  const nameKind = kindFromName(name);
  return declaredKind !== 'unknown' ? declaredKind : (mimeKind !== 'unknown' ? mimeKind : nameKind);
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw makeMediaError('Invalid JSON payload', 'MEDIA_BAD_REQUEST', 400);
  }
  const name = String(payload.name || '').trim().slice(0, 240);
  const type = String(payload.type || '').trim().toLowerCase();
  const kind = String(payload.kind || '').trim().toLowerCase();
  const data = String(payload.data || '').trim();
  const size = Number(payload.size || 0);

  if (!data) throw makeMediaError('Missing media data', 'MEDIA_BAD_REQUEST', 400);
  if (!Number.isFinite(size) || size <= 0) throw makeMediaError('Invalid media size', 'MEDIA_BAD_REQUEST', 400);
  if (size > MAX_MEDIA_BYTES) {
    throw makeMediaError(`File too large for direct upload. Maximum supported size is 4 MiB.`, 'MEDIA_TOO_LARGE', 413, { maxBytes: MAX_MEDIA_BYTES, size });
  }

  let buffer;
  try {
    buffer = Buffer.from(data, 'base64');
  } catch {
    throw makeMediaError('Invalid base64 media data', 'MEDIA_BAD_REQUEST', 400);
  }
  if (!buffer.length) throw makeMediaError('Invalid base64 media data', 'MEDIA_BAD_REQUEST', 400);
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw makeMediaError(`Decoded file too large. Maximum supported size is 4 MiB.`, 'MEDIA_TOO_LARGE', 413, { maxBytes: MAX_MEDIA_BYTES, decodedBytes: buffer.length });
  }

  const sniffedKind = sniffBufferKind(buffer);
  const declaredKind = KIND_TO_MIME[kind] ? kind : 'unknown';
  const mimeKind = kindFromMime(type);
  const nameKind = kindFromName(name);
  const resolvedKind = sniffedKind === 'zip' && (declaredKind === 'docx' || mimeKind === 'docx' || nameKind === 'docx')
    ? 'docx'
    : (KIND_TO_MIME[sniffedKind] ? sniffedKind : resolveDeclaredKind({ name, type, kind }));
  if (!KIND_TO_MIME[resolvedKind]) {
    throw makeMediaError('Unsupported file. Choose a PDF, image, text, Markdown, HTML, CSV, JSON, RTF, or DOCX file.', 'MEDIA_UNSUPPORTED_TYPE', 415);
  }
  if (BINARY_AI_KINDS.has(resolvedKind) && sniffedKind !== resolvedKind) {
    throw makeMediaError('Unsupported file. Choose a real PDF or image.', 'MEDIA_UNSUPPORTED_TYPE', 415, { kind, type, sniffedKind });
  }
  if (DETERMINISTIC_KINDS.has(resolvedKind) && resolvedKind !== 'docx' && !hasTextSignature(buffer)) {
    throw makeMediaError('Unsupported file. That document does not look like readable text.', 'MEDIA_UNSUPPORTED_TYPE', 415);
  }
  if (
    BINARY_AI_KINDS.has(resolvedKind)
    && ((declaredKind !== 'unknown' && declaredKind !== resolvedKind) || (mimeKind !== 'unknown' && mimeKind !== resolvedKind) || (nameKind !== 'unknown' && nameKind !== resolvedKind))
  ) {
    throw makeMediaError('File type does not match its contents.', 'MEDIA_TYPE_MISMATCH', 400, { kind, type, sniffedKind });
  }

  return {
    name,
    type: type || KIND_TO_MIME[resolvedKind],
    kind: resolvedKind,
    size,
    data,
    buffer,
  };
}

function resolveProvider(env, kind) {
  const selected = String(env.MEDIA_IMPORT_PROVIDER || env.AI_PROVIDER || '').trim().toLowerCase();
  if (selected) return selected;
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.OPENAI_API_KEY && kind !== 'pdf') return 'openai';
  return '';
}

function truthy(value) {
  return /^(1|true|yes)$/i.test(String(value || '').trim());
}

function echoAllowed(env) {
  return env.NODE_ENV === 'test' || truthy(env.ALLOW_ECHO_MEDIA_IMPORT);
}

function cleanExtractedText(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function assertText(text) {
  const cleaned = cleanExtractedText(text);
  if (!cleaned || /^NO_TEXT_FOUND$/i.test(cleaned)) {
    throw makeMediaError('No readable text found in that file.', 'MEDIA_NO_TEXT', 422);
  }
  return cleaned;
}

function decodeTextBuffer(buf) {
  if (!Buffer.isBuffer(buf)) return '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(Math.max(0, buf.length - 2));
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8');
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/gi, '&');
}

function stripHtml(text) {
  return decodeEntities(String(text || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\s*\/\s*script\b[^>]*>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\s*\/\s*style\b[^>]*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|section|article|li|ul|ol|h[1-6]|tr|table|br)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function stripRtf(text) {
  return String(text || '')
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/[{}]/g, ' ');
}

const MAX_DOCX_XML_BYTES = 8 * 1024 * 1024;
function readDocxXmlStream(stream, zipfile) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    function finishError(error) {
      if (settled) return;
      settled = true;
      try { stream.destroy(); } catch {}
      try { zipfile.close(); } catch {}
      reject(error);
    }

    stream.on('data', (chunk) => {
      total += chunk.length;

      if (total > MAX_DOCX_XML_BYTES) {
        finishError(makeMediaError(
          'Unsupported file. That DOCX document is too large to process.',
          'MEDIA_FILE_TOO_LARGE',
          413
        ));
        return;
      }

      chunks.push(chunk);
    });

    stream.on('error', finishError);

    stream.on('end', () => {
      if (settled) return;
      settled = true;
      try { zipfile.close(); } catch {}
      resolve(Buffer.concat(chunks, total).toString('utf8'));
    });
  });
}

function unzipEntry(buffer, wantedPath) {
  return new Promise((resolve, reject) => {
    const yauzl = require('yauzl');
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr) return reject(openErr);
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== wantedPath) {
          zipfile.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_DOCX_XML_BYTES) {
          try { zipfile.close(); } catch {}
          reject(makeMediaError(
            'Unsupported file. That DOCX document is too large to process.',
            'MEDIA_FILE_TOO_LARGE',
            413
          ));
          return;
        }
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          readDocxXmlStream(stream, zipfile).then(resolve, reject);
        });
      });
      zipfile.on('end', () => resolve(''));
      zipfile.on('error', reject);
    });
  });
}

function stripDocxXml(xml) {
  return decodeEntities(String(xml || '')
    .replace(/<w:(p|br|tab)[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, ' '));
}

async function extractDeterministicText(file) {
  let raw = '';
  if (file.kind === 'docx') {
    const xml = await unzipEntry(file.buffer, 'word/document.xml');
    raw = stripDocxXml(xml);
  } else if (file.kind === 'html') {
    raw = stripHtml(decodeTextBuffer(file.buffer));
  } else if (file.kind === 'rtf') {
    raw = stripRtf(decodeTextBuffer(file.buffer));
  } else {
    raw = decodeTextBuffer(file.buffer);
  }
  return { text: assertText(raw), provider: 'deterministic', model: file.kind };
}

async function extractWithGemini(file, env) {
  if (!env.GEMINI_API_KEY) throw makeMediaError('Media import provider is not configured', 'MEDIA_PROVIDER_NOT_CONFIGURED', 503);
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const model = env.MEDIA_GEMINI_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const m = genAI.getGenerativeModel({ model });
  const prompt = [
    'Extract readable study source text from this file for quiz generation.',
    'Return plain text only.',
    'Preserve headings, lists, definitions, terms, and facts.',
    'Omit decorative text, page furniture, and repeated headers when possible.',
    'If no readable text is present, return exactly NO_TEXT_FOUND.',
  ].join('\n');
  const result = await m.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: file.type, data: file.data } },
      ],
    }],
    generationConfig: { temperature: 0.1, topK: 16, topP: 0.8, maxOutputTokens: 4096 },
  });
  return { text: assertText(result?.response?.text?.() || ''), provider: 'gemini', model };
}

async function extractWithOpenAI(file, env) {
  if (file.kind === 'pdf') throw makeMediaError('PDF import requires Gemini media extraction in this build.', 'MEDIA_PROVIDER_UNSUPPORTED_TYPE', 422);
  if (!env.OPENAI_API_KEY) throw makeMediaError('Media import provider is not configured', 'MEDIA_PROVIDER_NOT_CONFIGURED', 503);
  const model = env.MEDIA_OPENAI_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract readable study source text from this image for quiz generation. Return plain text only. If no readable text is present, return exactly NO_TEXT_FOUND.' },
          { type: 'image_url', image_url: { url: `data:${file.type};base64,${file.data}` } },
        ],
      }],
      temperature: 0.1,
      max_tokens: 3000,
    }),
  });
  if (!resp.ok) {
    let detail = await resp.text().catch(() => String(resp.status));
    try { detail = JSON.parse(detail); } catch {}
    throw makeMediaError(`OpenAI HTTP ${resp.status}`, 'MEDIA_PROVIDER_HTTP_ERROR', resp.status, detail);
  }
  const data = await resp.json();
  return { text: assertText(data?.choices?.[0]?.message?.content || ''), provider: 'openai', model };
}

async function extractText(file, env) {
  if (DETERMINISTIC_KINDS.has(file.kind)) return extractDeterministicText(file);
  const provider = resolveProvider(env, file.kind);
  if (!provider) throw makeMediaError('Media import provider is not configured', 'MEDIA_PROVIDER_NOT_CONFIGURED', 503);
  if (provider === 'gemini') return extractWithGemini(file, env);
  if (provider === 'openai') return extractWithOpenAI(file, env);
  if (provider === 'echo') {
    if (!echoAllowed(env)) throw makeMediaError('Echo media import is disabled', 'MEDIA_ECHO_DISABLED', 403);
    return {
      text: `Imported ${file.kind.toUpperCase()} text from ${file.name || 'media file'}.\nUse this extracted text to draft quiz questions.`,
      provider: 'echo',
      model: 'echo',
    };
  }
  throw makeMediaError(`Unsupported media import provider: ${provider}`, 'MEDIA_PROVIDER_UNSUPPORTED', 400);
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(makeMediaError('Media extraction timed out', 'MEDIA_TIMEOUT', 504)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  const allowedOrigins = parseAllowedOrigins();
  const origin = getOrigin(event.headers);
  const originAllowed = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);

  if (event.httpMethod === 'OPTIONS') {
    if (!originAllowed) return reply(403, { error: 'Forbidden origin' }, '');
    return reply(204, '', origin || (allowedOrigins.length === 0 ? '*' : ''));
  }

  if (!originAllowed) return reply(403, { error: 'Forbidden origin' }, '');
  const responseOrigin = origin || (allowedOrigins.length === 0 ? '*' : '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' }, responseOrigin);
  if (rateLimited(event)) return reply(429, { error: 'Rate limit exceeded', code: 'MEDIA_RATE_LIMITED' }, responseOrigin);
  if (Buffer.byteLength(String(event.body || ''), 'utf8') > MAX_BODY_BYTES) {
    return reply(413, { error: `Request body too large (max ${MAX_BODY_BYTES} bytes)`, code: 'MEDIA_BODY_TOO_LARGE' }, responseOrigin);
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch {
    return reply(400, { error: 'Invalid JSON', code: 'MEDIA_BAD_REQUEST' }, responseOrigin);
  }

  try {
    const file = normalizePayload(payload);
    const timeoutMs = Math.max(8000, Math.min(30000, parseInt(process.env.MEDIA_IMPORT_TIMEOUT_MS || '20000', 10)));
    const extracted = await withTimeout(extractText(file, process.env), timeoutMs);
    return reply(200, {
      text: extracted.text,
      metadata: {
        name: file.name,
        type: file.type,
        kind: file.kind,
        size: file.size,
        provider: extracted.provider,
        model: extracted.model,
        charCount: extracted.text.length,
      },
    }, responseOrigin);
  } catch (err) {
    console.error('Media import error:', err && { message: err.message, code: err.code, status: err.status });
    const status = err && err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    const body = {
      error: status >= 500 ? (err.code === 'MEDIA_PROVIDER_NOT_CONFIGURED' ? err.message : 'Media import failed') : String(err && err.message || 'Media import failed'),
      code: err && err.code ? err.code : 'MEDIA_IMPORT_FAILED',
    };
    if (err && err.details !== undefined && status < 500) body.details = err.details;
    return reply(status, body, responseOrigin);
  }
};

module.exports._internals = {
  normalizePayload,
  sniffBufferKind,
  cleanExtractedText,
};
