'use strict';

function event(body, overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'x-ezq-beta': '1' },
    body: JSON.stringify(body || {}),
    ...overrides,
  };
}

function json(res) {
  return res.body ? JSON.parse(res.body) : null;
}

function mediaPayload(buffer, overrides = {}) {
  return {
    name: 'worksheet.pdf',
    type: 'application/pdf',
    kind: 'pdf',
    size: buffer.length,
    data: buffer.toString('base64'),
    ...overrides,
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZipBuffer(fileName, content) {
  const name = Buffer.from(fileName);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  const end = Buffer.alloc(22);
  const crc = crc32(data);

  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);

  const centralOffset = local.length + data.length;
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([local, data, central, end]);
}

function minimalDocxBuffer(textEntries) {
  const paragraphs = textEntries.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  return storedZipBuffer('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    paragraphs,
    '</w:body>',
    '</w:document>',
  ].join(''));
}

describe('ingest-media endpoint', () => {
  const originalEnv = process.env;
  const originalSetImmediate = global.setImmediate;

  beforeAll(() => {
    if (typeof global.setImmediate !== 'function') {
      global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
    }
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'test', MEDIA_IMPORT_PROVIDER: 'echo' };
  });

  afterAll(() => {
    process.env = originalEnv;
    if (typeof originalSetImmediate === 'function') {
      global.setImmediate = originalSetImmediate;
    } else {
      delete global.setImmediate;
    }
  });

  test('accepts public media import requests without beta access', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('%PDF-1.5\nhello');
    const res = await handler(event(mediaPayload(buf), { headers: {} }));

    expect(res.statusCode).toBe(200);
    expect(json(res).text).toContain('Imported PDF text from worksheet.pdf');
  });

  test('extracts text through echo provider in tests', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('%PDF-1.5\nhello');
    const res = await handler(event(mediaPayload(buf)));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.text).toContain('Imported PDF text from worksheet.pdf');
    expect(body.metadata).toMatchObject({
      name: 'worksheet.pdf',
      type: 'application/pdf',
      kind: 'pdf',
      provider: 'echo',
      model: 'echo',
    });
  });

  test('reports clearly when PDF import has no configured provider', async () => {
    process.env.MEDIA_IMPORT_PROVIDER = '';
    process.env.AI_PROVIDER = '';
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('%PDF-1.5\nhello');
    const res = await handler(event(mediaPayload(buf)));
    const body = json(res);

    expect(res.statusCode).toBe(503);
    expect(body).toMatchObject({
      code: 'MEDIA_PROVIDER_NOT_CONFIGURED',
      error: 'PDF import needs a configured Gemini media extraction provider.',
    });
  });

  test('rejects oversized files before extraction', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('%PDF-1.5\nhello');
    const res = await handler(event(mediaPayload(buf, { size: 5 * 1024 * 1024 + 1 })));

    expect(res.statusCode).toBe(413);
    expect(json(res)).toMatchObject({ code: 'MEDIA_TOO_LARGE' });
  });

  test('rejects file type metadata mismatch', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('%PDF-1.5\nhello');
    const res = await handler(event(mediaPayload(buf, { type: 'image/png', kind: 'png' })));

    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ code: 'MEDIA_TYPE_MISMATCH' });
  });

  test('rejects unsupported bytes', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('plain text is not an accepted media file');
    const res = await handler(event(mediaPayload(buf, { type: 'application/pdf', kind: 'pdf' })));

    expect(res.statusCode).toBe(415);
    expect(json(res)).toMatchObject({ code: 'MEDIA_UNSUPPORTED_TYPE' });
  });

  test('reports legacy Word .doc files as unsupported', async () => {
    const { handler } = require('../ingest-media.js');
    const compoundDocHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const res = await handler(event(mediaPayload(compoundDocHeader, {
      name: 'legacy.doc',
      type: 'application/msword',
      kind: 'doc',
    })));
    const body = json(res);

    expect(res.statusCode).toBe(415);
    expect(body).toMatchObject({
      code: 'MEDIA_UNSUPPORTED_TYPE',
      error: 'Unsupported file. Choose a PDF, image, text, Markdown, HTML, CSV, JSON, RTF, or DOCX file.',
    });
  });

  test('extracts plain text deterministically without provider usage', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('Heading\n\n First   fact.\nSecond fact.');
    const res = await handler(event(mediaPayload(buf, {
      name: 'notes.txt',
      type: 'text/plain',
      kind: 'txt',
    })));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.text).toBe('Heading\nFirst fact.\nSecond fact.');
    expect(body.metadata).toMatchObject({
      kind: 'txt',
      provider: 'deterministic',
      model: 'txt',
    });
  });

  test('caps deterministic source extraction at 60,000 characters', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('A'.repeat(60010));
    const res = await handler(event(mediaPayload(buf, {
      name: 'long-notes.md',
      type: 'text/markdown',
      kind: 'md',
    })));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.text).toHaveLength(60000);
    expect(body.metadata).toMatchObject({
      kind: 'md',
      provider: 'deterministic',
      model: 'md',
      charCount: 60000,
    });
  });

  test('accepts UTF-16 BOM text for deterministic extraction', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Heading\n\n First   fact.\nSecond fact.', 'utf16le'),
    ]);
    const res = await handler(event(mediaPayload(buf, {
      name: 'notes.txt',
      type: 'text/plain',
      kind: 'txt',
    })));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.text).toBe('Heading\nFirst fact.\nSecond fact.');
    expect(body.metadata).toMatchObject({
      kind: 'txt',
      provider: 'deterministic',
      model: 'txt',
    });
  });

  test('extracts html deterministically as readable text', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('<h1>Cell Biology</h1><p>Mitochondria make ATP &amp; support cells.</p>');
    const res = await handler(event(mediaPayload(buf, {
      name: 'notes.html',
      type: 'text/html',
      kind: 'html',
    })));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.text).toContain('Cell Biology');
    expect(body.text).toContain('Mitochondria make ATP & support cells.');
    expect(body.metadata.provider).toBe('deterministic');
  });

  test('extracts DOCX text deterministically without provider usage', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = minimalDocxBuffer(['Routing basics', 'OSPF chooses paths']);
    const res = await handler(event(mediaPayload(buf, {
      name: 'routing-notes.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'docx',
    })));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.text).toContain('Routing basics');
    expect(body.text).toContain('OSPF chooses paths');
    expect(body.metadata).toMatchObject({
      kind: 'docx',
      provider: 'deterministic',
      model: 'docx',
      charCount: body.text.length,
    });
  });
});
