/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"http://127.0.0.1:8787/"}
 */
'use strict';
const { readFile, loadDocument, loadBrowserModule } = require('./utils');
let api, state;
beforeEach(async () => {
  localStorage.clear();
  const doc = await loadDocument('public/index.html');
  document.body.innerHTML = doc.body.innerHTML;
  document.documentElement.dataset.edition = 'standalone';
  state = {};
  const source = readFile('public/js/standalone.js').replace(/^import[^\n]+\n/, '').replace(/export /g, '');
  api = new Function('S', source + '\nreturn { wireStandalone, forgetKey, localRequest };')(state);
  api.wireStandalone();
});
afterEach(() => { delete global.fetch; delete window.__EZQ__; delete document.documentElement.dataset.edition; });
const el = id => document.getElementById(id);
test('keys are saved by default and forget prevents further provider requests', async () => {
  global.fetch = jest.fn();
  el('aiKey').value = 'test-key-not-a-real-secret';
  el('aiSave').click();
  expect(localStorage.getItem('ezq.ai.key')).toBe('test-key-not-a-real-secret');
  expect(el('aiConnectionStatus').textContent).toContain('key ready');
  expect(localStorage.getItem('ezq.ai.config')).not.toContain('test-key');
  expect(Object.values(sessionStorage).join(' ')).not.toContain('test-key-not-a-real-secret');
  el('aiForget').click();
  expect(localStorage.getItem('ezq.ai.key')).toBeNull();
  expect(el('aiKey').value).toBe('');
  expect(el('aiConnectionStatus').textContent).toContain('Set up AI');
  await expect(api.localRequest('/api/generate', { topic: 'test' })).rejects.toThrow('Add your API key');
  expect(fetch).not.toHaveBeenCalled();
});
test('startup restores the saved key', () => {
  localStorage.setItem('ezq.ai.key', 'old-preview-key');
  api.wireStandalone();
  expect(localStorage.getItem('ezq.ai.key')).toBe('old-preview-key');
  expect(el('aiKey').value).toBe('old-preview-key');
  expect(el('aiConnectionStatus').textContent).toContain('key ready');
});
test('changing provider forgets the previous provider key', () => {
  el('aiKey').value = 'test-key';
  el('aiSave').click();
  el('aiProvider').value = 'openai';
  el('aiProvider').dispatchEvent(new Event('change'));
  expect(el('aiKey').value).toBe('');
  expect(localStorage.getItem('ezq.ai.key')).toBeNull();
  expect(el('aiModel').value).toBe('gpt-4.1-mini');
});
test('saving configuration never initiates a network request', () => {
  global.fetch = jest.fn();
  el('aiKey').value = 'test-key';
  el('aiSave').click();
  expect(fetch).not.toHaveBeenCalled();
});
test('a missing key fails before making a request', async () => {
  global.fetch = jest.fn();
  await expect(api.localRequest('/api/generate', { topic: 'test' })).rejects.toThrow('Add your API key');
  expect(fetch).not.toHaveBeenCalled();
});
test('standalone bypasses hosted async generation and transport fallback', async () => {
  const { shouldUseAsyncGeneration, generateWithAI } = loadBrowserModule('public/js/api.js', ['shouldUseAsyncGeneration', 'generateWithAI']);
  const request = jest.fn(async () => ({ lines: 'TF|A valid question.|T', title: 'Local' }));
  window.__EZQ__ = { standalone: { request } };
  global.fetch = jest.fn();
  expect(shouldUseAsyncGeneration(50, { sourceText: 'A'.repeat(30000) })).toBe(false);
  const out = await generateWithAI('Test', 1);
  expect(out.title).toBe('Local');
  expect(request).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
test('cancelled batching preserves accepted questions and does not start another batch', async () => {
  const { generateWithAI } = loadBrowserModule('public/js/api.js', ['generateWithAI']);
  const progress = jest.fn();
  const request = jest.fn()
    .mockResolvedValueOnce({ lines: 'TF|Routers forward packets.|T\nTF|Oceans contain saltwater.|T\nTF|Plants need energy.|T\nTF|Saturn has rings.|T\nTF|Gold is a metal.|T' })
    .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
  window.__EZQ__ = { standalone: { request } };
  const out = await generateWithAI('General knowledge', 10, { onProgress: progress });
  expect(out.partial).toBe(true);
  expect(out.completedCount).toBe(5);
  expect(request).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenCalledWith(5);
});

test('single-visit mode removes a saved key and does not restore it', () => {
  el('aiKey').value = 'test-key';
  el('aiSave').click();
  el('aiRemember').checked = false;
  el('aiSave').click();
  expect(localStorage.getItem('ezq.ai.key')).toBeNull();
  expect(el('aiConnectionStatus').textContent).toContain('key ready');
  expect(el('aiSettingsStatus').textContent).toBe('Key ready for this visit.');
  api.wireStandalone();
  expect(el('aiKey').value).toBe('');
});
test('unavailable storage reports single-visit use rather than claiming a save', () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
  el('aiKey').value = 'test-key';
  el('aiSave').click();
  expect(el('aiSettingsStatus').textContent).toContain('storage is unavailable');
  expect(el('aiConnectionStatus').textContent).toContain('key ready');
  storage.mockRestore();
});
