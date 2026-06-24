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

function generatedTfLines(count) {
  return Array.from({ length: count }, (_, index) => `TF|Generated fact ${index + 1}.|T`).join('\n');
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
  let analyzeSourceText;
  let formatSourceSectionSummary;
  let summarizeSourceReport;
  let state;
  let beginQuiz;
  let syncSettingsFromUI;

  beforeAll(() => {
    ({ ImportController } = loadBrowserModule('public/js/import-controller.js', ['ImportController']));
    ({ analyzeSourceText, formatSourceSectionSummary, summarizeSourceReport } = loadBrowserModule('public/js/source-sections.js', [
      'analyzeSourceText',
      'formatSourceSectionSummary',
      'summarizeSourceReport',
    ]));
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
      getMaxQuestions: () => 50,
      parseEditorInput,
      generateWithAI,
      ImportController,
      sniffFileKind,
      isSupportedImportKind: () => true,
      hasImportMetadataMismatch: () => false,
      validateMediaImportSize,
      attachDragDrop: () => ({ dispose() {} }),
      announce,
      analyzeSourceText,
      formatSourceSectionSummary,
      summarizeSourceReport,
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

  async function importLocalTextFile(name, text = 'Imported source text') {
    const importInput = document.getElementById('importFile');
    const readerIndex = readers.length;
    const textFile = new File([text], name, { type: 'text/plain' });

    sniffFileKind.mockResolvedValueOnce('txt');
    Object.defineProperty(importInput, 'files', {
      configurable: true,
      get: () => [textFile],
    });
    importInput.dispatchEvent(new Event('change'));
    await flush();

    expect(readers).toHaveLength(readerIndex + 1);
    readers[readerIndex].result = new TextEncoder().encode(text).buffer;
    readers[readerIndex].onload();
    await flush();
    await flush();

    return textFile;
  }

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
    expect(state.media.sourceReport.sectionCount).toBe(1);
    expect(document.getElementById('mediaSourceStatus').dataset.sectionCount).toBe('1');
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
    expect(state.media.sourceReport.sectionCount).toBe(1);
    expect(document.getElementById('mediaSourceLabel').textContent).toContain('TXT ready: notes.txt');
  });

  test('empty topic plus successful file import sets cleaned source-derived topic', async () => {
    await importLocalTextFile('04-Switching_CAM_ARP_STP.md', 'Switching notes');

    expect(document.getElementById('topicInput').value).toBe('Switching CAM ARP STP');
    expect(window.EZQ.ui.topicSourceDerived).toBe(true);
    expect(window.EZQ.ui.topicSourceTopic).toBe('Switching CAM ARP STP');
  });

  test('source-derived topic plus successful second file import replaces topic', async () => {
    await importLocalTextFile('04-Switching_CAM_ARP_STP.md', 'Switching notes');
    await importLocalTextFile('The GSP System.pdf', 'GSP notes');

    expect(document.getElementById('topicInput').value).toBe('The GSP System');
    expect(window.EZQ.ui.topicSourceDerived).toBe(true);
  });

  test('manually edited topic plus successful file import preserves manual topic', async () => {
    const topicInput = document.getElementById('topicInput');
    await importLocalTextFile('04-Switching_CAM_ARP_STP.md', 'Switching notes');

    topicInput.value = 'My custom switching review';
    topicInput.dispatchEvent(new Event('input', { bubbles: true }));
    await importLocalTextFile('The GSP System.pdf', 'GSP notes');

    expect(topicInput.value).toBe('My custom switching review');
    expect(window.EZQ.ui.topicSourceDerived).toBe(false);
  });

  test('clearing a source-derived topic allows the next import to auto-fill again', async () => {
    const topicInput = document.getElementById('topicInput');
    await importLocalTextFile('04-Switching_CAM_ARP_STP.md', 'Switching notes');

    topicInput.value = '';
    topicInput.dispatchEvent(new Event('input', { bubbles: true }));
    await importLocalTextFile('ccna_notes.txt', 'CCNA notes');

    expect(topicInput.value).toBe('ccna notes');
    expect(window.EZQ.ui.topicSourceDerived).toBe(true);
  });

  test('source name cleanup removes extension and separators', async () => {
    await importLocalTextFile('ccna_notes.txt', 'CCNA notes');

    expect(document.getElementById('topicInput').value).toBe('ccna notes');
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

    readers[0].result = new TextEncoder().encode('B'.repeat(70000)).buffer;
    readers[0].onload();
    await flush();
    await flush();

    expect(fetchCalls).toHaveLength(0);
    expect(state.media.sourceText).toHaveLength(60000);
    expect(document.getElementById('mediaSourceLabel').textContent).toContain('60,000 chars extracted');
  });

  test('makes 50-question generation selectable and requestable', async () => {
    const countInput = document.getElementById('countInput');
    expect(Array.from(countInput.options).map((option) => option.value)).toContain('50');

    document.getElementById('topicInput').value = 'ccna 2025';
    countInput.value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(generateWithAI).toHaveBeenCalledWith('ccna 2025', 50, expect.objectContaining({
      difficulty: 'medium',
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
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

  test('shows the generation card while active and keeps it ready after success', async () => {
    const deferred = createDeferred();
    generateWithAI.mockReturnValueOnce(deferred.promise);

    document.getElementById('topicInput').value = 'routing basics';
    document.getElementById('countInput').value = '5';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const card = document.getElementById('generationStatusCard');
    expect(card.hidden).toBe(false);
    expect(card.dataset.generationState).toBe('generating');
    expect(card.classList.contains('is-animating')).toBe(true);
    expect(card.classList.contains('is-complete')).toBe(false);
    expect(card.classList.contains('is-success-pulsing')).toBe(false);
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Building your quiz…');
    expect(document.getElementById('cancelGenerationBtn').hidden).toBe(false);
    expect(document.getElementById('startBtn').disabled).toBe(true);

    deferred.resolve({
      title: 'Routing Basics',
      lines: 'TF|Routing moves packets between networks.|T',
    });
    await flush();
    await flush();
    await flush();
    await flush();

    expect(card.hidden).toBe(false);
    expect(card.dataset.generationState).toBe('success');
    expect(card.classList.contains('is-animating')).toBe(false);
    expect(card.classList.contains('is-complete')).toBe(true);
    expect(card.classList.contains('is-success-pulsing')).toBe(true);
    expect(card.getAttribute('aria-busy')).toBe('false');
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Quiz ready.');
    expect(document.getElementById('generationStatusMeta').textContent).toBe('1 question');
    expect(document.getElementById('cancelGenerationBtn').hidden).toBe(true);
    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('status').textContent).toBe('Quiz ready: 1 question.');
  });

  test('topic-only generation status avoids study-material and source wording', async () => {
    const deferred = createDeferred();
    generateWithAI.mockReturnValueOnce(deferred.promise);

    document.getElementById('topicInput').value = 'routing basics';
    document.getElementById('countInput').value = '20';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const message = document.getElementById('generationStatusMessage').textContent;
    expect(message).toBe('Planning the quiz.');
    expect(message).not.toMatch(/study material|source|sections/i);

    deferred.resolve({
      title: 'Routing Basics',
      lines: 'TF|Routing moves packets between networks.|T',
    });
    await flush();
    await flush();
    await flush();
  });

  test('source-backed generation status may use study-material wording', async () => {
    const deferred = createDeferred();
    generateWithAI.mockReturnValueOnce(deferred.promise);
    state.media = {
      sourceText: 'Important source notes about VLANs and trunks.',
      sourceName: 'notes.txt',
      sourceKind: 'txt',
      sourceCharCount: 44,
      sourceReport: null,
    };

    document.getElementById('topicInput').value = 'switching';
    document.getElementById('countInput').value = '20';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    expect(document.getElementById('generationStatusMessage').textContent)
      .toMatch(/study material/i);

    deferred.resolve({
      title: 'Switching',
      lines: 'TF|Switches forward frames.|T',
    });
    await flush();
    await flush();
  });

  test('partial batched output parses normally and shows the actual ready count', async () => {
    const partialLines = generatedTfLines(49);
    parseEditorInput.mockImplementation((text) => ({
      questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
      errors: [],
      error: null,
    }));
    generateWithAI.mockResolvedValueOnce({
      title: 'Partial Quiz',
      lines: partialLines,
      partial: true,
      completedCount: 49,
      requestedCount: 50,
      warning: 'Quiz ready with 49 of 50 questions.',
    });

    document.getElementById('topicInput').value = 'routing basics';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(parseEditorInput).toHaveBeenCalledWith(partialLines);
    expect(state.quiz.questions).toHaveLength(49);
    expect(state.quiz.originalQuestions).toHaveLength(49);
    expect(state.quiz.answers).toHaveLength(49);
    expect(document.getElementById('status').textContent).toBe('Quiz ready: 49 questions.');
    expect(document.getElementById('status').dataset.buildState).toBe('ready');
    const card = document.getElementById('generationStatusCard');
    expect(card.dataset.generationState).toBe('success');
    expect(card.classList.contains('is-complete')).toBe(true);
    expect(card.classList.contains('is-animating')).toBe(false);
    expect(document.getElementById('generationStatusMessage').textContent).toBe('Quiz ready with 49 of 50 questions.');
    expect(document.getElementById('generationStatusMeta').textContent).toBe('49 questions');
    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('startToolbarBtn').getAttribute('aria-disabled')).toBe('false');
  });

  test('reduced motion skips the success pulse class while keeping completed state', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));

    try {
      document.getElementById('topicInput').value = 'routing basics';
      document.getElementById('countInput').value = '5';
      document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();

      const card = document.getElementById('generationStatusCard');
      expect(card.dataset.generationState).toBe('success');
      expect(card.classList.contains('is-complete')).toBe(true);
      expect(card.classList.contains('is-success-pulsing')).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test('cancel aborts active generation and leaves Start Quiz disabled without an existing quiz', async () => {
    let capturedSignal;
    generateWithAI.mockImplementationOnce((_topic, _count, opts = {}) => {
      capturedSignal = opts.signal;
      return new Promise((_resolve, reject) => {
        capturedSignal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });

    document.getElementById('topicInput').value = 'ospf';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    document.getElementById('cancelGenerationBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();

    expect(capturedSignal.aborted).toBe(true);
    const card = document.getElementById('generationStatusCard');
    expect(card.dataset.generationState).toBe('canceled');
    expect(card.classList.contains('is-animating')).toBe(false);
    expect(card.classList.contains('is-complete')).toBe(false);
    expect(card.classList.contains('is-success-pulsing')).toBe(false);
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Generation canceled.');
    expect(document.getElementById('generationStatusMessage').textContent).toBe('Your topic is still here.');
    expect(document.getElementById('status').textContent).toBe('Generation canceled.');
    expect(document.getElementById('generateBtn').disabled).toBe(false);
    expect(document.getElementById('startBtn').disabled).toBe(true);
    expect(document.getElementById('startToolbarBtn').getAttribute('aria-disabled')).toBe('true');
    expect(parseEditorInput).not.toHaveBeenCalled();
  });

  test('late response after cancel cannot overwrite the editor or unlock Start Quiz', async () => {
    const deferred = createDeferred();
    generateWithAI.mockReturnValueOnce(deferred.promise);

    document.getElementById('topicInput').value = 'stp';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    document.getElementById('cancelGenerationBtn').dispatchEvent(new Event('click', { bubbles: true }));
    deferred.resolve({
      title: 'Stale Quiz',
      lines: 'TF|Stale generated line.|T',
    });
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('canceled');
    expect(document.getElementById('editor').value).toBe('');
    expect(document.getElementById('mirror').value).toBe('');
    expect(document.getElementById('startBtn').disabled).toBe(true);
    expect(parseEditorInput).not.toHaveBeenCalled();
  });

  test('a superseded generation response cannot overwrite the newer quiz', async () => {
    const first = createDeferred();
    const second = createDeferred();
    generateWithAI
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    document.getElementById('topicInput').value = 'first';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    document.getElementById('topicInput').value = 'second';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    second.resolve({
      title: 'Second Quiz',
      lines: 'TF|Second fact.|T',
    });
    await flush();
    await flush();
    await flush();

    first.resolve({
      title: 'First Quiz',
      lines: 'TF|First stale fact.|T',
    });
    await flush();
    await flush();
    await flush();

    expect(generateWithAI).toHaveBeenCalledTimes(2);
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('success');
    expect(document.getElementById('editor').value).toBe('TF|Second fact.|T');
    expect(document.getElementById('mirror').value).toBe('TF|Second fact.|T');
    expect(parseEditorInput).toHaveBeenCalledWith('TF|Second fact.|T');
    expect(parseEditorInput).not.toHaveBeenCalledWith('TF|First stale fact.|T');
  });

  test('canceling a replacement generation keeps an existing valid quiz startable', async () => {
    document.getElementById('topicInput').value = 'ready quiz';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('editor').value).toBe('TF|Imported fact.|T');

    const deferred = createDeferred();
    generateWithAI.mockReturnValueOnce(deferred.promise);
    document.getElementById('topicInput').value = 'replacement';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    document.getElementById('cancelGenerationBtn').dispatchEvent(new Event('click', { bubbles: true }));
    deferred.resolve({
      title: 'Replacement',
      lines: 'TF|Replacement stale fact.|T',
    });
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('canceled');
    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('startToolbarBtn').getAttribute('aria-disabled')).toBe('false');
    expect(document.getElementById('editor').value).toBe('TF|Imported fact.|T');
  });

  test('does not unlock Start Quiz when generation fails before valid lines return', async () => {
    generateWithAI.mockRejectedValueOnce(new Error('Generation returned 0 of 5 usable questions after 3 batches.'));

    document.getElementById('topicInput').value = 'ccna retry';
    document.getElementById('countInput').value = '5';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(parseEditorInput).not.toHaveBeenCalled();
    const card = document.getElementById('generationStatusCard');
    expect(card.dataset.generationState).toBe('error');
    expect(card.classList.contains('is-animating')).toBe(false);
    expect(card.classList.contains('is-complete')).toBe(false);
    expect(card.classList.contains('is-success-pulsing')).toBe(false);
    expect(document.getElementById('status').textContent).toContain('Could not create a valid quiz: Generation returned 0 of 5 usable questions');
    expect(document.getElementById('startBtn').disabled).toBe(true);
    expect(document.getElementById('startToolbarBtn').getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById('startToolbarBtn').dataset.startDisabled).toBe('true');
    expect(beginQuiz).not.toHaveBeenCalled();
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
