/** @jest-environment jsdom */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadBrowserModule } = require('./utils');

function loadGeneratorModule(deps) {
  const absPath = path.resolve(__dirname, '../public/js/generator.js');
  const source = fs.readFileSync(absPath, 'utf8')
    .replace(/^import\s+[^;]+;\n/gm, '')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+var\s+/g, 'var ');

  const names = Object.keys(deps);
  const values = Object.values(deps);
  const factory = new Function(...names, `${source}\nreturn { wireGenerator, runParseFlow, disposeGenerator };\n//# sourceURL=${absPath}`);
  return factory(...values);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('generator media import overlap regression', () => {
  let ImportController;
  let wireGenerator;
  let sniffFileKind;
  let parseEditorInput;
  let announce;
  let fetchCalls;
  let fetchDeferredByName;
  let readers;
  let consoleDebugSpy;
  let validateMediaImportSize;
  let generateWithAI;
  let state;
  let beginQuiz;
  let syncSettingsFromUI;

  beforeAll(() => {
    ({ ImportController } = loadBrowserModule('public/js/import-controller.js', ['ImportController']));
  });

  beforeEach(() => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
    document.open();
    document.write(html);
    document.close();
    window.localStorage.clear();
    window.EZQ = {};
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    document.getElementById('regenHint').hidden = true;

    sniffFileKind = jest.fn().mockResolvedValue('pdf');
    parseEditorInput = jest.fn().mockImplementation((text) => ({
      questions: text ? [{ prompt: text }] : [],
      errors: [],
      error: null,
    }));
    generateWithAI = jest.fn().mockResolvedValue({
      title: 'Imported Source Quiz',
      lines: 'TF|Imported fact.|T',
    });
    state = { settings: { beta: true }, quiz: {}, media: {} };
    announce = jest.fn();
    validateMediaImportSize = jest.fn(() => ({ ok: true }));
    fetchCalls = [];
    fetchDeferredByName = new Map();
    readers = [];

    global.fetch = jest.fn().mockImplementation(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      const deferred = createDeferred();
      fetchCalls.push({ body, options, deferred });
      fetchDeferredByName.set(body.name, deferred);
      const payload = await deferred.promise;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          text: payload.text,
          metadata: {
            name: body.name,
            kind: body.kind,
            size: body.size,
            charCount: String(payload.text || '').length,
          },
        }),
      };
    });

    global.FileReader = class MockFileReader {
      constructor() {
        this.result = null;
        this.onload = null;
        this.onerror = null;
        readers.push(this);
      }

      readAsDataURL(file) {
        this.file = file;
      }

      readAsArrayBuffer(file) {
        this.file = file;
      }

      abort() {
        this.aborted = true;
      }
    };

    const deps = {
      S: state,
      $: (id) => document.getElementById(id),
      byQSA: (selector) => Array.from(document.querySelectorAll(selector)),
      mmSsToMs: () => 0,
      clampCount: (value, { fallback } = {}) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        return fallback ?? 10;
      },
      getMaxQuestions: () => 20,
      parseEditorInput,
      generateWithAI,
      ImportController,
      sniffFileKind,
      isSupportedImportKind: () => true,
      hasImportMetadataMismatch: () => false,
      validateMediaImportSize,
      attachDragDrop: () => ({ dispose() {} }),
      announce,
      buildGeneratorPayload: ({ topic, difficulty, count, sourceText, sourceName }) => {
        const payload = { topic, difficulty, count };
        if (sourceText) {
          payload.sourceText = sourceText;
          payload.sourceName = sourceName;
        }
        return payload;
      },
      showVeil: () => {},
      hideVeil: () => {},
      MESSAGES: ['hello'],
      applyTheme: () => {},
      saveSettingsToStorage: () => {},
      getShowQuizEditorPreference: () => false,
      STORAGE_KEYS: { defaults: 'defaults' },
      isBetaEnabled: () => true,
    };

    beginQuiz = jest.fn();
    syncSettingsFromUI = jest.fn();
    ({ wireGenerator } = loadGeneratorModule(deps));
    wireGenerator({ beginQuiz, syncSettingsFromUI });
  });

  afterEach(() => {
    consoleDebugSpy?.mockRestore();
    delete global.fetch;
    delete global.FileReader;
  });

  test('clears a stale import error before processing the next valid file', async () => {
    const importInput = document.getElementById('importFile');
    const hint = document.getElementById('regenHint');

    const invalidFile = new File(['bad'], 'bad.pdf', { type: 'application/pdf' });
    const validFile = new File(['good'], 'good.pdf', { type: 'application/pdf' });

    validateMediaImportSize
      .mockReturnValueOnce({ ok: false, error: 'File too large for direct upload. Maximum supported size is 4 MiB.' })
      .mockReturnValue({ ok: true });

    Object.defineProperty(importInput, 'files', {
      configurable: true,
      get: () => [invalidFile],
    });
    importInput.dispatchEvent(new Event('change'));
    await flush();

    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('File too large for direct upload. Maximum supported size is 4 MiB.');

    Object.defineProperty(importInput, 'files', {
      configurable: true,
      get: () => [validFile],
    });
    importInput.dispatchEvent(new Event('change'));
    await flush();

    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('Importing…');

    expect(readers).toHaveLength(1);
    readers[0].result = 'data:application/pdf;base64,Z29vZA==';
    readers[0].onload();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.name).toBe('good.pdf');

    fetchDeferredByName.get('good.pdf').resolve({ text: 'GOOD IMPORT TEXT' });
    await flush();
    await flush();
    await flush();

    expect(hint.textContent).toBe('Imported good.pdf. Create a quiz from it.');
    expect(document.getElementById('mediaSourceStatus').hidden).toBe(false);
    expect(document.getElementById('mediaSourceLabel').textContent).toContain('PDF ready: good.pdf');
    expect(state.media.sourceText).toBe('GOOD IMPORT TEXT');
    expect(parseEditorInput).not.toHaveBeenCalled();
    expect(validateMediaImportSize).toHaveBeenCalledTimes(2);
  });

  test('imports text files locally without calling media endpoint', async () => {
    const importInput = document.getElementById('importFile');
    const hint = document.getElementById('regenHint');
    const textFile = new File(['Photosynthesis\n\nPlants use light.'], 'notes.txt', { type: 'text/plain' });

    sniffFileKind.mockResolvedValueOnce('txt');
    Object.defineProperty(importInput, 'files', {
      configurable: true,
      get: () => [textFile],
    });
    importInput.dispatchEvent(new Event('change'));
    await flush();

    expect(readers).toHaveLength(1);
    readers[0].result = new TextEncoder().encode('Photosynthesis\n\nPlants use light.').buffer;
    readers[0].onload();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(0);
    expect(hint.textContent).toBe('Imported notes.txt. Create a quiz from it.');
    expect(state.media.sourceText).toBe('Photosynthesis\nPlants use light.');
    expect(document.getElementById('mediaSourceLabel').textContent).toContain('TXT ready: notes.txt');
  });

  test('reads only a bounded slice for large local text imports', async () => {
    const importInput = document.getElementById('importFile');
    const textFile = new File(['A'.repeat(200000)], 'large-notes.txt', { type: 'text/plain' });

    sniffFileKind.mockResolvedValueOnce('txt');
    Object.defineProperty(importInput, 'files', {
      configurable: true,
      get: () => [textFile],
    });
    importInput.dispatchEvent(new Event('change'));
    await flush();

    expect(readers).toHaveLength(1);
    expect(readers[0].file.size).toBe(128 * 1024);

    readers[0].result = new TextEncoder().encode('B'.repeat(50000)).buffer;
    readers[0].onload();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(0);
    expect(state.media.sourceText).toHaveLength(30000);
    expect(document.getElementById('mediaSourceLabel').textContent).toContain('30,000 chars extracted');
  });

  test('creates a topic quiz without auto-starting and sends the expected payload', async () => {
    document.getElementById('topicInput').value = 'ccna 2025';
    document.getElementById('countInput').value = '5';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(generateWithAI).toHaveBeenCalledWith('ccna 2025', 5, expect.objectContaining({
      difficulty: 'medium',
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
    expect(generateWithAI.mock.calls[0][2]).not.toHaveProperty('sourceText');
    expect(parseEditorInput).toHaveBeenCalledWith('TF|Imported fact.|T');
    expect(document.getElementById('status').textContent).toBe('Quiz ready: 1 question.');
    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('startToolbarBtn').disabled).toBe(false);
    expect(document.getElementById('startToolbarBtn').getAttribute('aria-disabled')).toBe('false');
    expect(document.getElementById('startToolbarBtn').classList.contains('start-primary')).toBe(true);
    expect(document.getElementById('generateBtn').classList.contains('primary')).toBe(false);
    expect(document.getElementById('generateBtn').classList.contains('btn-outline')).toBe(true);
    expect(document.getElementById('generateBtn').textContent).toBe('Create New Quiz');
    expect(beginQuiz).not.toHaveBeenCalled();
    expect(syncSettingsFromUI).not.toHaveBeenCalled();
  });

  test('uses plural ready grammar for generated quizzes', async () => {
    parseEditorInput.mockReturnValue({
      questions: Array.from({ length: 10 }, (_, index) => ({ prompt: `Question ${index + 1}` })),
      errors: [],
      error: null,
    });

    document.getElementById('topicInput').value = 'routing basics';
    document.getElementById('countInput').value = '10';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('status').textContent).toBe('Quiz ready: 10 questions.');
    expect(document.getElementById('startToolbarBtn').classList.contains('start-primary')).toBe(true);
  });

  test('keeps the newest overlapping import result and only re-enables controls after it finishes', async () => {
    const importInput = document.getElementById('importFile');
    const importBtn = document.getElementById('importBtn');
    const editor = document.getElementById('editor');
    const mirror = document.getElementById('mirror');
    const hint = document.getElementById('regenHint');

    const firstFile = new File(['first'], 'first.pdf', { type: 'application/pdf' });
    const secondFile = new File(['second'], 'second.pdf', { type: 'application/pdf' });

    Object.defineProperty(importInput, 'files', {
      configurable: true,
      get: () => [firstFile],
    });
    importInput.dispatchEvent(new Event('change'));
    await flush();

    expect(importBtn.getAttribute('disabled')).toBe('true');
    expect(hint.textContent).toBe('Importing…');
    expect(readers).toHaveLength(1);

    readers[0].result = 'data:application/pdf;base64,Zmlyc3Q=';
    readers[0].onload();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.name).toBe('first.pdf');

    Object.defineProperty(importInput, 'files', {
      configurable: true,
      get: () => [secondFile],
    });
    importInput.dispatchEvent(new Event('change'));
    await flush();

    expect(fetchCalls[0].options.signal.aborted).toBe(true);
    expect(importBtn.getAttribute('disabled')).toBe('true');
    expect(readers).toHaveLength(2);

    readers[1].result = 'data:application/pdf;base64,c2Vjb25k';
    readers[1].onload();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].body.name).toBe('second.pdf');

    fetchDeferredByName.get('second.pdf').resolve({ text: 'SECOND IMPORT TEXT' });
    await flush();
    await flush();
    await flush();

    expect(editor.value).toBe('');
    expect(mirror.value).toBe('');
    expect(hint.textContent).toBe('Imported second.pdf. Create a quiz from it.');
    expect(document.getElementById('mediaSourceLabel').textContent).toContain('PDF ready: second.pdf');
    expect(state.media.sourceText).toBe('SECOND IMPORT TEXT');
    expect(importBtn.hasAttribute('disabled')).toBe(false);

    fetchDeferredByName.get('first.pdf').resolve({ text: 'STALE FIRST IMPORT TEXT' });
    await flush();
    await flush();
    await flush();

    expect(editor.value).toBe('');
    expect(mirror.value).toBe('');
    expect(parseEditorInput).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith('Imported source ready. Create a quiz from it.', 'polite');

    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(generateWithAI).toHaveBeenCalledWith('second', 10, expect.objectContaining({
      sourceText: 'SECOND IMPORT TEXT',
      sourceName: 'second.pdf',
      difficulty: 'medium',
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
    expect(editor.value).toBe('TF|Imported fact.|T');
    expect(parseEditorInput).toHaveBeenCalledWith('TF|Imported fact.|T');
  });
});
