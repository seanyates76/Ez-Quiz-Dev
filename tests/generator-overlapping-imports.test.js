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

function delay(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function flushUntil(predicate, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return true;
    await flush();
  }
  return !!predicate();
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
  let startAsyncGeneration;
  let triggerAsyncGeneration;
  let getAsyncGenerationStatus;
  let stopAsyncGeneration;
  let shouldUseAsyncGeneration;
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
    startAsyncGeneration = jest.fn().mockResolvedValue({
      jobId: 'qj_abcdefghijklmnopqrstuvwxyz123456',
      workerToken: 'worker_capability_abcdefghijklmnopqrstuvwxyz',
      status: 'queued',
    });
    triggerAsyncGeneration = jest.fn().mockResolvedValue({ sent: true, mode: 'fetch' });
    getAsyncGenerationStatus = jest.fn().mockResolvedValue({
      status: 'complete',
      completedCount: 1,
      requestedCount: 1,
      questions: ['TF|Imported fact.|T'],
      title: 'Imported Source Quiz',
    });
    stopAsyncGeneration = jest.fn().mockResolvedValue({ status: 'stopped', stopped: true });
    shouldUseAsyncGeneration = jest.fn((count, opts = {}) => {
      const sourceText = String(opts.sourceText || '');
      const report = opts.sourceReport || {};
      const sectionCount = Number(report.sectionCount || (Array.isArray(report.sections) ? report.sections.length : 0) || 0);
      return !!sourceText && (sourceText.length >= 20000 || sectionCount >= 50 || (Number(count) >= 30 && sourceText.length >= 10000));
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
      ASYNC_GENERATION_POLL_MS: 1,
      generateWithAI,
      getAsyncGenerationStatus,
      shouldUseAsyncGeneration,
      startAsyncGeneration,
      stopAsyncGeneration,
      triggerAsyncGeneration,
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
      buildGeneratorPayload: ({ topic, difficulty, count, sourceText, sourceName, sourceReport }) => {
        const payload = { topic, difficulty, count };
        if (sourceText) {
          payload.sourceText = sourceText;
          payload.sourceName = sourceName;
          if (sourceReport) payload.sourceReport = sourceReport;
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

  function makeSourceReport({ charCount = 800, sectionCount = 1, quizWorthyCount = 1 } = {}) {
    const perSection = Math.max(1, Math.floor(charCount / Math.max(1, sectionCount)));
    const sections = Array.from({ length: sectionCount }, (_, index) => {
      const quizWorthy = index < quizWorthyCount;
      return {
        id: `section-${String(index + 1).padStart(3, '0')}`,
        heading: `Section ${index + 1}`,
        text: 'source '.repeat(Math.max(1, Math.ceil(perSection / 7))).slice(0, perSection),
        charCount: perSection,
        score: quizWorthy ? 70 : 20,
        flags: quizWorthy ? [] : ['weak'],
      };
    });
    return {
      version: 1,
      sourceCharCount: charCount,
      sectionCount,
      quizWorthyCount,
      weakCount: Math.max(0, sectionCount - quizWorthyCount),
      largestSectionId: sections[0]?.id || '',
      largestSectionHeading: sections[0]?.heading || '',
      largestSectionCharCount: sections[0]?.charCount || 0,
      detectedSignals: quizWorthyCount > 1 ? ['definitions', 'lists'] : ['definitions'],
      flags: ['heading-based'],
      sections,
    };
  }

  function setMediaSource({
    text = 'Short source notes about one narrow idea.',
    name = 'narrow-notes.txt',
    kind = 'txt',
    charCount = text.length,
    report = makeSourceReport({ charCount, sectionCount: 1, quizWorthyCount: 1 }),
  } = {}) {
    state.media = {
      sourceText: text,
      sourceName: name,
      sourceKind: kind,
      sourceCharCount: charCount,
      sourceReport: report,
    };
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
    expect(document.getElementById('mediaSourceLabel').textContent).toBe('good.pdf');
    expect(document.getElementById('mediaSourceLabel').getAttribute('aria-label')).toContain('chars extracted');
    expect(document.getElementById('clearMediaSourceBtn').textContent.trim()).toBe('Remove');
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
    expect(document.getElementById('mediaSourceLabel').textContent).toBe('notes.txt');
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

  test('manually edited topic after import is respected for generation', async () => {
    const topicInput = document.getElementById('topicInput');
    await importLocalTextFile('04-Switching_CAM_ARP_STP.md', 'Switching notes');

    topicInput.value = 'My custom switching review';
    topicInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('countInput').value = '5';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(generateWithAI).toHaveBeenCalledWith('My custom switching review', 5, expect.objectContaining({
      sourceName: '04-Switching_CAM_ARP_STP.md',
      sourceText: 'Switching notes',
    }));
    expect(window.EZQ.ui.topicSourceDerived).toBe(false);
  });

  test('importing source after a topic-only quiz replaces the next payload topic', async () => {
    document.getElementById('topicInput').value = 'panic! at the disco';
    document.getElementById('countInput').value = '5';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    generateWithAI.mockClear();
    await importLocalTextFile('21-Switch_Interface_Config.md', 'interface config notes');

    expect(document.getElementById('topicInput').value).toBe('Switch Interface Config');
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(generateWithAI).toHaveBeenCalledWith('Switch Interface Config', 5, expect.objectContaining({
      sourceName: '21-Switch_Interface_Config.md',
      sourceText: 'interface config notes',
    }));
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
    expect(document.getElementById('mediaSourceLabel').textContent).toBe('large-notes.txt');
    expect(document.getElementById('mediaSourceLabel').getAttribute('aria-label')).toContain('60,000 chars extracted');
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

  test('does not show the redundant idle status headline on the main screen', () => {
    const status = document.getElementById('status');
    const hint = document.getElementById('regenHint');

    expect(status.dataset.buildState).toBe('idle');
    expect(status.textContent).toBe('');
    expect(status.textContent).not.toContain('Add a topic or study material, then create a quiz.');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('Enter a topic, choose length and difficulty, then create a quiz.');
  });

  test('high-count source-backed narrow source shows warning before generation', async () => {
    setMediaSource({
      text: 'VLAN trunking notes for one small idea.',
      charCount: 700,
      report: makeSourceReport({ charCount: 700, sectionCount: 1, quizWorthyCount: 1 }),
    });

    document.getElementById('topicInput').value = 'switching';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const modal = document.getElementById('narrowSourceModal');
    expect(modal.classList.contains('is-open')).toBe(true);
    expect(modal.getAttribute('aria-hidden')).toBe('false');
    expect(document.getElementById('narrowSourceMessage').textContent)
      .toBe('This source looks narrow for a 50-question quiz. EZ Quiz can still try, but some questions may feel repetitive. For more variety, add more study material or choose fewer questions.');
    expect(generateWithAI).not.toHaveBeenCalled();
    expect(document.getElementById('generationStatusCard').hidden).toBe(true);
  });

  test('Generate anyway starts generation for a narrow source', async () => {
    setMediaSource({
      text: 'Subnet mask notes focused on one narrow scenario.',
      charCount: 800,
      report: makeSourceReport({ charCount: 800, sectionCount: 1, quizWorthyCount: 1 }),
    });

    document.getElementById('topicInput').value = 'subnetting';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    document.getElementById('narrowSourceConfirm').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('narrowSourceModal').classList.contains('is-open')).toBe(false);
    expect(generateWithAI).toHaveBeenCalledWith('subnetting', 50, expect.objectContaining({
      difficulty: 'medium',
      sourceText: 'Subnet mask notes focused on one narrow scenario.',
      sourceName: 'narrow-notes.txt',
      sourceReport: expect.objectContaining({ quizWorthyCount: 1 }),
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
    expect(parseEditorInput).toHaveBeenCalledWith('TF|Imported fact.|T');
  });

  test('Cancel closes narrow source warning without starting generation', async () => {
    setMediaSource({
      text: 'One-page source notes.',
      charCount: 500,
      report: makeSourceReport({ charCount: 500, sectionCount: 1, quizWorthyCount: 1 }),
    });

    document.getElementById('topicInput').value = 'switching';
    document.getElementById('countInput').value = '30';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    document.getElementById('narrowSourceCancel').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const modal = document.getElementById('narrowSourceModal');
    expect(modal.classList.contains('is-open')).toBe(false);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(generateWithAI).not.toHaveBeenCalled();
    expect(document.getElementById('generationStatusCard').hidden).toBe(true);
    expect(document.getElementById('startBtn').disabled).toBe(true);
  });

  test('topic-only 50-question generation does not show narrow source warning', async () => {
    document.getElementById('topicInput').value = 'ccna practice';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('narrowSourceModal').classList.contains('is-open')).toBe(false);
    expect(generateWithAI).toHaveBeenCalledWith('ccna practice', 50, expect.objectContaining({
      difficulty: 'medium',
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
  });

  test('broader high-count source-backed generation does not show narrow source warning', async () => {
    setMediaSource({
      text: 'Broad networking source notes.',
      charCount: 6500,
      report: makeSourceReport({ charCount: 6500, sectionCount: 6, quizWorthyCount: 5 }),
    });

    document.getElementById('topicInput').value = 'networking';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('narrowSourceModal').classList.contains('is-open')).toBe(false);
    expect(generateWithAI).toHaveBeenCalledWith('networking', 50, expect.objectContaining({
      sourceText: 'Broad networking source notes.',
      sourceReport: expect.objectContaining({ quizWorthyCount: 5 }),
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
  });

  test('dense single-section high-count source does not warn only because it has one section', async () => {
    setMediaSource({
      text: 'Dense subnetting source notes.',
      charCount: 5200,
      report: makeSourceReport({ charCount: 5200, sectionCount: 1, quizWorthyCount: 1 }),
    });

    document.getElementById('topicInput').value = 'subnetting';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('narrowSourceModal').classList.contains('is-open')).toBe(false);
    expect(generateWithAI).toHaveBeenCalledWith('subnetting', 50, expect.objectContaining({
      sourceText: 'Dense subnetting source notes.',
      sourceReport: expect.objectContaining({ sectionCount: 1, quizWorthyCount: 1 }),
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
  });

  test('changing source or count requires narrow source confirmation again', async () => {
    setMediaSource({
      text: 'First narrow source.',
      name: 'first-source.txt',
      charCount: 700,
      report: makeSourceReport({ charCount: 700, sectionCount: 1, quizWorthyCount: 1 }),
    });

    document.getElementById('topicInput').value = 'first topic';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    document.getElementById('narrowSourceConfirm').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();
    expect(generateWithAI).toHaveBeenCalledTimes(1);

    generateWithAI.mockClear();
    setMediaSource({
      text: 'Second narrow source.',
      name: 'second-source.txt',
      charCount: 650,
      report: makeSourceReport({ charCount: 650, sectionCount: 1, quizWorthyCount: 1 }),
    });
    document.getElementById('topicInput').value = 'second topic';
    document.getElementById('countInput').value = '30';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    expect(document.getElementById('narrowSourceModal').classList.contains('is-open')).toBe(true);
    expect(document.getElementById('narrowSourceMessage').textContent).toContain('30-question quiz');
    expect(generateWithAI).not.toHaveBeenCalled();
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
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('1 of 5 questions ready.');
    expect(document.getElementById('status').hidden).toBe(true);
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
    const readyLines = generatedTfLines(10);
    const validationStatuses = [];
    parseEditorInput.mockImplementation((text) => {
      validationStatuses.push({
        title: document.getElementById('generationStatusTitle').textContent,
        detail: document.getElementById('generationStatusMessage').textContent,
        count: document.getElementById('generationStatusSecondary').textContent,
      });
      return {
        questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
        errors: [],
        error: null,
      };
    });
    generateWithAI.mockReturnValueOnce(deferred.promise);

    document.getElementById('topicInput').value = 'routing basics';
    document.getElementById('countInput').value = '10';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const card = document.getElementById('generationStatusCard');
    expect(card.hidden).toBe(false);
    expect(card.dataset.generationState).toBe('generating');
    expect(card.classList.contains('is-animating')).toBe(true);
    expect(card.classList.contains('is-complete')).toBe(false);
    expect(card.classList.contains('is-success-pulsing')).toBe(false);
    expect(card.getAttribute('aria-busy')).toBe('true');
    const planningTitle = document.getElementById('generationStatusTitle').textContent;
    const planningDetail = document.getElementById('generationStatusMessage').textContent;
    expect(planningTitle).toBe('Building your quiz...');
    expect(planningDetail).toBe('Planning the quiz.');
    expect(planningTitle).not.toBe(planningDetail);
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('0 of 10 questions ready.');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuenow')).toBe('0');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuemax')).toBe('10');
    expect(document.getElementById('cancelGenerationBtn').hidden).toBe(false);
    expect(document.getElementById('startBtn').disabled).toBe(true);

    deferred.resolve({
      title: 'Routing Basics',
      lines: readyLines,
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
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('10 of 10 questions ready.');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuenow')).toBe('10');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuemax')).toBe('10');
    expect(document.getElementById('generationStatusMeta').hidden).toBe(true);
    expect(document.getElementById('cancelGenerationBtn').hidden).toBe(true);
    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('status').hidden).toBe(true);
    expect(validationStatuses[0]).toEqual({
      title: 'Building your quiz...',
      detail: 'Checking answer choices.',
      count: '0 of 10 questions ready.',
    });
    expect(validationStatuses[0].title).not.toBe(validationStatuses[0].detail);
  });

  test('progress bar resets when current inputs change after generation', async () => {
    parseEditorInput.mockImplementation((text) => ({
      questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
      errors: [],
      error: null,
    }));
    generateWithAI.mockResolvedValueOnce({
      title: 'Routing Basics',
      lines: generatedTfLines(10),
    });
    document.getElementById('topicInput').value = 'routing basics';
    document.getElementById('countInput').value = '10';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    const card = document.getElementById('generationStatusCard');
    expect(card.dataset.generationState).toBe('success');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuenow')).toBe('10');

    document.getElementById('topicInput').value = 'switching basics';
    document.getElementById('topicInput').dispatchEvent(new Event('input', { bubbles: true }));

    expect(card.hidden).toBe(true);
    expect(card.dataset.generationState).toBe('idle');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuenow')).toBe('0');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuemax')).toBe('10');
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

    expect(document.getElementById('generationStatusTitle').textContent).toBe('Building your quiz...');
    expect(document.getElementById('generationStatusMessage').textContent).toBe('Planning the quiz.');
    expect(document.getElementById('generationStatusTitle').textContent)
      .not.toBe(document.getElementById('generationStatusMessage').textContent);
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('0 of 20 questions ready.');
    expect(document.getElementById('generationStatusCard').hidden).toBe(false);
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('generating');
    expect(document.getElementById('status').dataset.buildState).toBe('creating');
    expect(document.getElementById('status').textContent).toBe('');
    expect(document.getElementById('status').textContent).not.toBe('Creating quiz from study material...');

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
      warning: '49 of 50 questions ready.',
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
    expect(document.getElementById('status').hidden).toBe(true);
    expect(document.getElementById('status').dataset.buildState).toBe('ready');
    const card = document.getElementById('generationStatusCard');
    expect(card.dataset.generationState).toBe('partial');
    expect(card.classList.contains('is-complete')).toBe(false);
    expect(card.classList.contains('is-animating')).toBe(false);
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Quiz partially ready.');
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('49 of 50 questions ready.');
    expect(document.getElementById('generationStatusMeta').hidden).toBe(true);
    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('startToolbarBtn').getAttribute('aria-disabled')).toBe('false');
  });

  test('topic-only underfill is shown as an explicit partial state', async () => {
    const partialLines = generatedTfLines(5);
    parseEditorInput.mockImplementation((text) => ({
      questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
      errors: [],
      error: null,
    }));
    generateWithAI.mockResolvedValueOnce({
      title: 'Underfilled Topic Quiz',
      lines: partialLines,
      partial: true,
      completedCount: 5,
      requestedCount: 10,
      warning: '5 of 10 questions ready.',
    });

    document.getElementById('topicInput').value = 'routing basics';
    document.getElementById('countInput').value = '10';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    const card = document.getElementById('generationStatusCard');
    expect(card.dataset.generationState).toBe('partial');
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Quiz partially ready.');
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('5 of 10 questions ready.');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuenow')).toBe('5');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuemax')).toBe('10');
    expect(document.getElementById('startBtn').disabled).toBe(false);
  });

  test('large source async generation starts a job, polls progress, and parses the completed quiz', async () => {
    const complete = createDeferred();
    const lines = generatedTfLines(50);
    setMediaSource({
      text: 'A'.repeat(25000),
      name: 'ccna-notes.md',
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 60, quizWorthyCount: 55 }),
    });
    parseEditorInput.mockImplementation((text) => ({
      questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
      errors: [],
      error: null,
    }));
    getAsyncGenerationStatus
      .mockResolvedValueOnce({
        status: 'running',
        completedCount: 3,
        requestedCount: 50,
        progressMessage: '3 of 50 questions ready.',
      })
      .mockReturnValueOnce(complete.promise);

    document.getElementById('topicInput').value = 'ccna async';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await delay();
    await flush();

    expect(startAsyncGeneration).toHaveBeenCalledWith('ccna async', 50, expect.objectContaining({
      sourceText: 'A'.repeat(25000),
      sourceName: 'ccna-notes.md',
      sourceReport: expect.objectContaining({ sectionCount: 60 }),
      types: ['MC', 'TF', 'YN', 'MT'],
    }));
    expect(triggerAsyncGeneration).toHaveBeenCalledWith(
      'qj_abcdefghijklmnopqrstuvwxyz123456',
      'worker_capability_abcdefghijklmnopqrstuvwxyz'
    );
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Building your quiz...');
    expect(document.getElementById('generationStatusMessage').textContent).toBe('Generating focused study questions.');
    expect(document.getElementById('generationStatusTitle').textContent)
      .not.toBe(document.getElementById('generationStatusMessage').textContent);
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('3 of 50 questions ready.');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuenow')).toBe('3');
    expect(document.getElementById('generationStatusScan').getAttribute('aria-valuemax')).toBe('50');

    complete.resolve({
      status: 'complete',
      completedCount: 50,
      requestedCount: 50,
      questions: lines.split('\n'),
      title: 'CCNA Async Quiz',
      progressMessage: '50 of 50 questions ready.',
    });
    await flush();
    await flush();

    expect(generateWithAI).not.toHaveBeenCalled();
    expect(parseEditorInput).toHaveBeenCalledWith(lines);
    expect(state.quiz.questions).toHaveLength(50);
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('success');
    expect(document.getElementById('startBtn').disabled).toBe(false);
  });

  test('async partial result enables Start with usable questions', async () => {
    const lines = generatedTfLines(12);
    setMediaSource({
      text: 'B'.repeat(25000),
      name: 'partial-notes.md',
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 55, quizWorthyCount: 50 }),
    });
    parseEditorInput.mockImplementation((text) => ({
      questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
      errors: [],
      error: null,
    }));
    getAsyncGenerationStatus.mockResolvedValueOnce({
      status: 'partial',
      completedCount: 12,
      requestedCount: 50,
      questions: lines.split('\n'),
      progressMessage: '12 of 50 questions ready.',
    });

    document.getElementById('topicInput').value = 'partial async';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(parseEditorInput).toHaveBeenCalledWith(lines);
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('partial');
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Quiz partially ready.');
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('12 of 50 questions ready.');
    expect(document.getElementById('startBtn').disabled).toBe(false);
  });

  test('async zero-question failure keeps Start disabled', async () => {
    setMediaSource({
      text: 'C'.repeat(25000),
      name: 'empty-notes.md',
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 55, quizWorthyCount: 50 }),
    });
    getAsyncGenerationStatus.mockResolvedValueOnce({
      status: 'failed',
      completedCount: 0,
      requestedCount: 50,
      progressMessage: 'Generation failed before any usable questions were created.',
      errors: [{ message: 'No usable quiz questions were generated.' }],
    });

    document.getElementById('topicInput').value = 'empty async';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();

    expect(parseEditorInput).not.toHaveBeenCalled();
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('error');
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Generation failed.');
    expect(document.getElementById('generationStatusMessage').textContent).toBe('No usable quiz questions were returned.');
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('0 of 50 questions ready.');
    expect(document.getElementById('generationStatusSecondary').hidden).toBe(false);
    expect(document.getElementById('startBtn').disabled).toBe(true);
  });

  test.each([
    ['complete', 'success', 'Quiz ready.', 50],
    ['partial', 'partial', 'Quiz partially ready.', 12],
    ['failed', 'error', 'Generation failed.', 0],
    ['stopped', 'stopped', 'Generation stopped.', 0],
    ['canceled', 'stopped', 'Generation stopped.', 0],
    ['expired', 'error', 'Generation failed.', 0],
  ])('async polling stops on %s status', async (terminalStatus, expectedCardState, expectedTitle, expectedReady) => {
    const lines = terminalStatus === 'partial'
      ? generatedTfLines(12)
      : generatedTfLines(50);
    setMediaSource({
      text: 'S'.repeat(25000),
      name: `${terminalStatus}-notes.md`,
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 55, quizWorthyCount: 50 }),
    });
    parseEditorInput.mockImplementation((text) => ({
      questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
      errors: [],
      error: null,
    }));
    getAsyncGenerationStatus.mockResolvedValueOnce({
      status: terminalStatus,
      completedCount: terminalStatus === 'partial' ? 12 : (terminalStatus === 'complete' ? 50 : 0),
      requestedCount: 50,
      questions: terminalStatus === 'complete' || terminalStatus === 'partial' ? lines.split('\n') : [],
      progressMessage: terminalStatus === 'complete'
        ? '50 of 50 questions ready.'
        : terminalStatus === 'partial'
          ? '12 of 50 questions ready.'
          : '',
    });

    document.getElementById('topicInput').value = `${terminalStatus} async`;
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    await flush();
    await delay(5);

    expect(getAsyncGenerationStatus).toHaveBeenCalledTimes(1);
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe(expectedCardState);
    expect(document.getElementById('generationStatusTitle').textContent).toBe(expectedTitle);
    expect(document.getElementById('generationStatusTitle').textContent)
      .not.toBe(document.getElementById('generationStatusMessage').textContent);
    expect(document.getElementById('generationStatusSecondary').textContent)
      .toBe(`${expectedReady} of 50 questions ready.`);
    expect(document.getElementById('generationStatusSecondary').hidden).toBe(false);
  });

  test('async Stop requests stopped status without enabling Start when no questions are ready', async () => {
    const firstStatus = createDeferred();
    setMediaSource({
      text: 'D'.repeat(25000),
      name: 'stop-notes.md',
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 55, quizWorthyCount: 50 }),
    });
    getAsyncGenerationStatus
      .mockReturnValueOnce(firstStatus.promise)
      .mockResolvedValueOnce({
        status: 'stopped',
        stopped: true,
        completedCount: 0,
        requestedCount: 50,
        questions: [],
        progressMessage: 'Generation stopped before any questions were ready.',
      });

    document.getElementById('topicInput').value = 'stop async';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flushUntil(() => triggerAsyncGeneration.mock.calls.length > 0);

    expect(document.getElementById('cancelGenerationBtn').textContent).toBe('Stop generation');
    document.getElementById('cancelGenerationBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    expect(stopAsyncGeneration).toHaveBeenCalledWith('qj_abcdefghijklmnopqrstuvwxyz123456');

    firstStatus.resolve({
      status: 'running',
      completedCount: 0,
      requestedCount: 50,
      progressMessage: '0 of 50 questions ready.',
    });
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('stopped');
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Generation stopped.');
    expect(document.getElementById('generationStatusMessage').textContent).toBe('Generation stopped before any questions were ready.');
    expect(document.getElementById('startBtn').disabled).toBe(true);
    expect(state.media.sourceText).toBe('D'.repeat(25000));
  });

  test('clearing an active async generation stops the backend job before abandoning the UI session', async () => {
    const firstStatus = createDeferred();
    setMediaSource({
      text: 'X'.repeat(25000),
      name: 'abandoned-notes.md',
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 55, quizWorthyCount: 50 }),
    });
    getAsyncGenerationStatus.mockReturnValueOnce(firstStatus.promise);

    document.getElementById('topicInput').value = 'abandoned async';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flushUntil(() => triggerAsyncGeneration.mock.calls.length > 0);

    document.getElementById('clearBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    expect(stopAsyncGeneration).toHaveBeenCalledTimes(1);
    expect(stopAsyncGeneration).toHaveBeenCalledWith('qj_abcdefghijklmnopqrstuvwxyz123456');
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('idle');
    expect(document.getElementById('editor').value).toBe('');

    firstStatus.resolve({
      status: 'running',
      completedCount: 1,
      requestedCount: 50,
      progressMessage: '1 of 50 questions ready.',
    });
    await flush();
    await flush();

    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('idle');
  });

  test('async Stop keeps returned questions and enables Start', async () => {
    const firstStatus = createDeferred();
    const lines = generatedTfLines(5);
    setMediaSource({
      text: 'K'.repeat(25000),
      name: 'keep-notes.md',
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 55, quizWorthyCount: 50 }),
    });
    parseEditorInput.mockImplementation((text) => ({
      questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
      errors: [],
      error: null,
    }));
    getAsyncGenerationStatus
      .mockReturnValueOnce(firstStatus.promise)
      .mockResolvedValueOnce({
        status: 'stopped',
        stopped: true,
        completedCount: 5,
        requestedCount: 50,
        questions: lines.split('\n'),
        progressMessage: 'Generation stopped. 5 of 50 questions ready.',
      });

    document.getElementById('topicInput').value = 'keep async';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flushUntil(() => triggerAsyncGeneration.mock.calls.length > 0);

    document.getElementById('cancelGenerationBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();
    expect(stopAsyncGeneration).toHaveBeenCalledWith('qj_abcdefghijklmnopqrstuvwxyz123456');

    firstStatus.resolve({
      status: 'running',
      completedCount: 0,
      requestedCount: 50,
      progressMessage: '0 of 50 questions ready.',
    });
    await flush();
    await flush();
    await flush();

    expect(parseEditorInput).toHaveBeenCalledWith(lines);
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('stopped');
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Generation stopped.');
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('5 of 50 questions ready.');
    expect(document.getElementById('startBtn').disabled).toBe(false);
    expect(document.getElementById('editor').value).toBe(lines);
    expect(state.media.sourceText).toBe('K'.repeat(25000));
  });

  test('async polling errors are retried a bounded number of times', async () => {
    setMediaSource({
      text: 'E'.repeat(25000),
      name: 'polling-notes.md',
      charCount: 25000,
      report: makeSourceReport({ charCount: 25000, sectionCount: 55, quizWorthyCount: 50 }),
    });
    getAsyncGenerationStatus.mockRejectedValue(new Error('network down'));

    document.getElementById('topicInput').value = 'polling async';
    document.getElementById('countInput').value = '50';
    document.getElementById('generateBtn').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await delay(20);
    await flush();

    expect(getAsyncGenerationStatus).toHaveBeenCalledTimes(4);
    expect(parseEditorInput).not.toHaveBeenCalled();
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('error');
    expect(document.getElementById('generationStatusMessage').textContent).toContain('Lost contact with generation status');
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
      parseEditorInput.mockImplementation((text) => ({
        questions: String(text || '').split('\n').filter(Boolean).map((line) => ({ prompt: line })),
        errors: [],
        error: null,
      }));
      generateWithAI.mockResolvedValueOnce({
        title: 'Routing Basics',
        lines: generatedTfLines(10),
      });
      document.getElementById('topicInput').value = 'routing basics';
      document.getElementById('countInput').value = '10';
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

  test('Stop aborts active local generation and leaves Start Quiz disabled without an existing quiz', async () => {
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
    expect(card.dataset.generationState).toBe('stopped');
    expect(card.classList.contains('is-animating')).toBe(false);
    expect(card.classList.contains('is-complete')).toBe(false);
    expect(card.classList.contains('is-success-pulsing')).toBe(false);
    expect(document.getElementById('generationStatusTitle').textContent).toBe('Generation stopped.');
    expect(document.getElementById('generationStatusMessage').textContent).toBe('Your topic is still here.');
    expect(document.getElementById('status').hidden).toBe(true);
    expect(document.getElementById('generateBtn').disabled).toBe(false);
    expect(document.getElementById('startBtn').disabled).toBe(true);
    expect(document.getElementById('startToolbarBtn').getAttribute('aria-disabled')).toBe('true');
    expect(parseEditorInput).not.toHaveBeenCalled();
  });

  test('late response after Stop cannot overwrite the editor or unlock Start Quiz', async () => {
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

    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('stopped');
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

    document.getElementById('countInput').value = '1';
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
    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('partial');
    expect(document.getElementById('editor').value).toBe('TF|Second fact.|T');
    expect(document.getElementById('mirror').value).toBe('TF|Second fact.|T');
    expect(parseEditorInput).toHaveBeenCalledWith('TF|Second fact.|T');
    expect(parseEditorInput).not.toHaveBeenCalledWith('TF|First stale fact.|T');
  });

  test('stopping a replacement generation keeps an existing valid quiz startable', async () => {
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

    expect(document.getElementById('generationStatusCard').dataset.generationState).toBe('stopped');
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
    expect(document.getElementById('status').hidden).toBe(true);
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

    expect(document.getElementById('generationStatusTitle').textContent).toBe('Quiz ready.');
    expect(document.getElementById('generationStatusSecondary').textContent).toBe('10 of 10 questions ready.');
    expect(document.getElementById('status').hidden).toBe(true);
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
    expect(document.getElementById('mediaSourceLabel').textContent).toBe('second.pdf');
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
