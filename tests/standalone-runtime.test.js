/** @jest-environment node */
'use strict';
const { createLocalServer, handleApi, credentials } = require('../standalone/server.cjs');
const { docxText } = require('../standalone/media.cjs');
const http = require('node:http');
const { deflateRawSync } = require('node:zlib');

const connection = { provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'fake-key-for-tests-only' };
const response = text => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const context = fetchImpl => ({ fetchImpl, signal: new AbortController().signal });
function zipDocument(xml) {
  const name = Buffer.from('word/document.xml');
  const content = deflateRawSync(Buffer.from(xml));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(content.length, 18); local.writeUInt32LE(Buffer.byteLength(xml), 22); local.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8, 10);
  directory.writeUInt32LE(content.length, 20); directory.writeUInt32LE(Buffer.byteLength(xml), 24); directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + name.length, 12); end.writeUInt32LE(local.length + name.length + content.length, 16);
  return Buffer.concat([local, name, content, directory, name, end]);
}
describe('standalone provider boundary', () => {
  test('uses the selected key in a header, reuses difficulty guidance, and normalizes output', async () => {
    const calls = [];
    const out = await handleApi('/api/generate', { connection, topic: 'Networking', count: 1, difficulty: 'hard', types: ['TF'] }, context(async (url, options) => { calls.push({ url, options }); return response('TITLE: Networking\nTF|Routers forward packets.|T'); }));
    expect(out.lines).toBe('TF|Routers forward packets.|T');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(calls[0].options.headers['x-goog-api-key']).toBe(connection.apiKey);
    expect(calls[0].options.body).toContain('Difficulty target: Hard');
    expect(calls[0].options.body).not.toContain(connection.apiKey);
    expect(calls[0].options.redirect).toBe('error');
  });
  test('OpenAI receives the key only in Authorization and store=false', async () => {
    let captured;
    const out = await handleApi('/api/generate', { connection: { ...connection, provider: 'openai', model: 'gpt-4.1-mini' }, topic: 'Science', count: 1 }, context(async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'TF|Water is a compound.|T' } }] }) }; }));
    expect(out.lines).toContain('TF|');
    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(captured.options.headers.Authorization).toBe('Bearer ' + connection.apiKey);
    expect(JSON.parse(captured.options.body).store).toBe(false);
  });
  test('does not echo provider error messages or use another provider', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('Secret: ' + connection.apiKey); });
    await expect(handleApi('/api/generate', { connection, topic: 'Networking', count: 1 }, context(fetchImpl))).rejects.toThrow('Could not reach');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(handleApi('/api/models', { connection }, context(async () => ({ ok: false, status: 401, body: { cancel: async () => {} } })))).rejects.toThrow('provider rejected');
  });
  test('rejects endpoint injection and oversized generation batches before network access', async () => {
    expect(() => credentials({ ...connection, model: '../../other?key=x' })).toThrow('model ID');
    expect(() => credentials({ ...connection, provider: 'custom' })).toThrow('Choose Gemini');
    const fetchImpl = jest.fn();
    await expect(handleApi('/api/generate', { connection, topic: 'x', count: 50 }, context(fetchImpl))).rejects.toThrow('1 and 5');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test('explains only the chosen question', async () => {
    let prompt;
    const result = await handleApi('/api/explain', { connection, lines: ['TF|Private unrelated question.|F', 'TF|Switches learn MAC addresses.|T'], index: 1 }, context(async (_, opts) => {
      prompt = opts.body;
      return response('{"items":[{"q":1,"explanation":"Answer: True.\\nWhy it fits: Switches learn source MAC addresses."}]}');
    }));
    expect(result.explanations[1].explanation).toContain('Answer: True.');
    expect(prompt).not.toContain('Private unrelated');
  });
  test('matching explanations preserve the pairs', async () => {
    let prompt;
    await handleApi('/api/explain', { connection, lines: ['MT|Match.|1) A;2) B|A) One;B) Two|1-A,2-B'], index: 0 }, context(async (_, opts) => { prompt = opts.body; return response('{"items":[{"q":1,"explanation":"Answer: 1-A, 2-B.\\nWhy it fits: Matching pairs."}]}'); }));
    expect(prompt).toContain('1-A, 2-B');
  });
  test('DOCX extraction works without any provider or key', async () => {
    const file = zipDocument('<w:document><w:p><w:t>Switches &amp; routers</w:t></w:p></w:document>');
    const fetchImpl = jest.fn();
    const result = await handleApi('/api/import', { name: 'notes.docx', kind: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: file.length, data: file.toString('base64') }, context(fetchImpl));
    expect(result.text).toContain('Switches & routers');
    expect(result.metadata.provider).toBe('local');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test('rejects malformed archives and bounds decompression', () => {
    expect(() => docxText(Buffer.from('not a zip'))).toThrow();
    const oversized = zipDocument('x'.repeat(8 * 1024 * 1024 + 1));
    expect(() => docxText(oversized)).toThrow();
  });
});
describe('standalone HTTP boundary', () => {
  let server, origin, token, fetchImpl;
  beforeAll(async () => {
    fetchImpl = jest.fn(async () => response('TF|A test question.|T'));
    server = createLocalServer({ fetchImpl });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + server.address().port;
    token = (await (await fetch(origin + '/api/session')).json()).token;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  test('serves a protected app shell without npm runtime packages', async () => {
    const res = await fetch(origin);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(await res.text()).toContain('data-edition="standalone"');
  });
  test.each(['/api/session', '/api/generate'])('blocks foreign origins on %s', async route => {
    const res = await fetch(origin + route, { headers: { Origin: 'https://foreign.example' } });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
  test('rejects a rebinding Host header', async () => {
    const code = await new Promise((resolve, reject) => {
      http.get(origin + '/api/session', { headers: { Host: 'foreign.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    expect(code).toBe(403);
  });
  test('rejects missing session token and missing origin', async () => {
    const a = await fetch(origin + '/api/generate', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    const b = await fetch(origin + '/api/generate', { method: 'POST', headers: { 'X-EZQ-Token': token, 'Content-Type': 'application/json' }, body: '{}' });
    expect(a.status).toBe(403); expect(b.status).toBe(403);
  });
  test('accepts a same-origin authenticated request', async () => {
    const res = await fetch(origin + '/api/generate', { method: 'POST', headers: { Origin: origin, 'X-EZQ-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ connection, topic: 'Testing', count: 1 }) });
    expect(res.status).toBe(200); expect((await res.json()).lines).toBe('TF|A test question.|T');
  });
  test.each(['/.env', '/standalone/server.cjs', '/package.json', '/%2e%2e%2fpackage.json'])('does not expose %s', async route => {
    expect((await fetch(origin + route)).status).toBe(404);
  });
});
