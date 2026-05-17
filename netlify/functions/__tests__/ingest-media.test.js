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

describe('ingest-media endpoint', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'test', MEDIA_IMPORT_PROVIDER: 'echo' };
  });

  afterAll(() => {
    process.env = originalEnv;
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
});
