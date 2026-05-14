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

  test('requires beta access', async () => {
    const { handler } = require('../ingest-media.js');
    const buf = Buffer.from('%PDF-1.5\nhello');
    const res = await handler(event(mediaPayload(buf), { headers: {} }));

    expect(res.statusCode).toBe(403);
    expect(json(res)).toMatchObject({ code: 'MEDIA_BETA_REQUIRED' });
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
});
