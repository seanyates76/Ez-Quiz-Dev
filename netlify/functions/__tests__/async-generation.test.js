'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function event(body, overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(body || {}),
    ...overrides,
  };
}

function json(res) {
  return res.body ? JSON.parse(res.body) : null;
}

function tfLine(n) {
  return `TF|Async fact ${n}.|T`;
}

function mtLine(n) {
  return `MT|Async match ${n}.|1) Left ${n}A;2) Left ${n}B;3) Left ${n}C|A) Right ${n}A;B) Right ${n}B;C) Right ${n}C|1-A,2-B,3-C`;
}

function malformedMtLine(n) {
  return `MT|Broken match ${n}.|1) Left ${n}A;2) Left ${n}B;3) Left ${n}C|A) Right ${n}A;B) Right ${n}B;C) Right ${n}C|1-B,2-A,3`;
}

function okLines(lines, title = 'Async Quiz') {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, lines: Array.isArray(lines) ? lines.join('\n') : lines, provider: 'mock', model: 'mock' }),
  };
}

function timeoutResponse(timeoutMs = 90000) {
  return {
    statusCode: 504,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'Generation timed out',
      details: `Gemini provider timed out after ${timeoutMs}ms`,
      code: 'PROVIDER_TIMEOUT',
    }),
  };
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

class MemoryAdapter {
  constructor() {
    this.jobs = new Map();
    this.saves = [];
  }

  async get(jobId) {
    const job = this.jobs.get(jobId);
    return job ? JSON.parse(JSON.stringify(job)) : null;
  }

  async set(jobId, job) {
    const copy = JSON.parse(JSON.stringify(job));
    this.jobs.set(jobId, copy);
    this.saves.push({ status: copy.status, completedCount: copy.completedCount, progressMessage: copy.progressMessage });
  }

  async delete(jobId) {
    this.jobs.delete(jobId);
  }
}

describe('async generation endpoints and job store', () => {
  const originalEnv = process.env;
  let tempDir;

  beforeEach(async () => {
    jest.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ezq-async-generation-'));
    process.env = {
      ...originalEnv,
      AI_PROVIDER: 'echo',
      ASYNC_GENERATION_STORE: 'file',
      ASYNC_GENERATION_JOB_DIR: tempDir,
      NODE_ENV: 'test',
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
    jest.resetModules();
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('start endpoint returns a jobId quickly and creates a queued record', async () => {
    const { handler: start } = require('../generate-quiz-start.js');
    const { handler: status } = require('../generate-quiz-status.js');
    const started = Date.now();
    const res = await start(event({
      topic: 'CCNA Notes',
      count: 50,
      provider: 'echo',
      sourceName: 'ccna.md',
      sourceText: 'A'.repeat(25000),
    }));
    const body = json(res);

    expect(Date.now() - started).toBeLessThan(200);
    expect(res.statusCode).toBe(202);
    expect(body.jobId).toMatch(/^qj_[A-Za-z0-9_-]{24,96}$/);
    expect(body.status).toBe('queued');
    expect(body.plannedBatchCount).toBeGreaterThan(1);

    const statusRes = await status({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { jobId: body.jobId },
    });
    const statusBody = json(statusRes);
    expect(statusRes.statusCode).toBe(200);
    expect(statusBody).toMatchObject({
      jobId: body.jobId,
      status: 'queued',
      requestedCount: 50,
      completedCount: 0,
      sourceName: 'ccna.md',
    });
    expect(statusBody).not.toHaveProperty('options');
    expect(statusBody).not.toHaveProperty('plannedBatches');
  });

  test('status endpoint returns safe queued, running, partial, complete, and failed states', async () => {
    const { createGenerationJobStore } = require('../lib/asyncJobStore.js');
    const { handler: status } = require('../generate-quiz-status.js');
    const store = createGenerationJobStore({ env: process.env });
    const job = await store.createJob({
      topic: 'States',
      requestedCount: 2,
      sourceName: 'states.md',
      options: { sourceText: 'secret source text' },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 1 }],
    });

    for (const state of ['queued', 'running', 'partial', 'complete', 'failed', 'stopped']) {
      await store.updateJob(job.jobId, (current) => ({
        ...current,
        status: state,
        stopped: state === 'stopped',
        questions: state === 'queued' || state === 'running' || state === 'failed' ? [] : [tfLine(1)],
        completedCount: state === 'partial' || state === 'complete' || state === 'stopped' ? 1 : 0,
        errors: state === 'failed' ? [{ message: 'No usable quiz questions were generated.' }] : [],
      }));
      const res = await status({
        httpMethod: 'GET',
        headers: {},
        queryStringParameters: { jobId: job.jobId },
      });
      const body = json(res);
      expect(res.statusCode).toBe(200);
      expect(body.status).toBe(state);
      expect(body.stopped).toBe(state === 'stopped');
      expect(JSON.stringify(body)).not.toContain('secret source text');
    }
  });

  test('local file adapter creates and reads jobs reliably', async () => {
    const { createGenerationJobStore } = require('../lib/asyncJobStore.js');
    const store = createGenerationJobStore({ env: process.env });
    const created = await store.createJob({
      topic: 'Adapter',
      requestedCount: 1,
      options: { provider: 'echo' },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 1 }],
    });
    const loaded = await store.getJob(created.jobId);
    expect(loaded).toMatchObject({
      jobId: created.jobId,
      status: 'queued',
      topic: 'Adapter',
      requestedCount: 1,
    });
  });

  test('expired jobs are scrubbed and reported safely', async () => {
    const { createGenerationJobStore } = require('../lib/asyncJobStore.js');
    const { handler: status } = require('../generate-quiz-status.js');
    const store = createGenerationJobStore({ env: process.env });
    const job = await store.createJob({
      topic: 'Expired',
      requestedCount: 1,
      options: { sourceText: 'private source text' },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 1 }],
    });
    await store.saveJob({ ...job, expiresAt: new Date(Date.now() - 1000).toISOString() });

    const res = await status({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { jobId: job.jobId },
    });
    const body = json(res);

    expect(res.statusCode).toBe(410);
    expect(body.status).toBe('expired');
    expect(JSON.stringify(body)).not.toContain('private source text');
  });

  test('async source-backed planner uses five-question section batches', () => {
    const {
      SECTION_AWARE_BATCH_SIZE,
      SECTION_BATCH_SOURCE_TEXT_MAX_CHARS,
      buildPlannedBatches,
    } = require('../lib/asyncGenerationPlanner.js');
    const sourceReport = {
      sectionCount: 50,
      quizWorthyCount: 50,
      sections: Array.from({ length: 50 }, (_, index) => ({
        id: `section-${index + 1}`,
        heading: `Topic ${index + 1}`,
        headingPath: ['CCNA', `Topic ${index + 1}`],
        text: [
          `Topic ${index + 1} explains a useful CCNA concept with definitions.`,
          `Term ${index + 1}: definition ${index + 1}.`,
          'The section includes comparisons and troubleshooting cues.',
        ].join('\n'),
        charCount: 220,
        lineCount: 3,
        bulletCount: 3,
        listCount: 1,
        definitionSignal: true,
        termSignal: true,
        score: 100 - index,
        reasons: ['definitions', 'terms', 'comparison'],
        flags: [],
      })),
    };

    const batches = buildPlannedBatches({
      topic: 'CCNA Notes',
      count: 50,
      sourceName: 'CCNA_Notes.md',
      sourceText: 'A'.repeat(60000),
      sourceReport,
      types: ['MC', 'TF', 'YN', 'MT'],
    });
    const flatTypes = batches.flatMap((batch) => batch.types || []);

    expect(SECTION_AWARE_BATCH_SIZE).toBe(5);
    expect(batches).toHaveLength(10);
    expect(batches.every((batch) => batch.kind === 'section')).toBe(true);
    expect(batches.map((batch) => batch.count)).toEqual(Array(10).fill(5));
    expect(batches.every((batch) => batch.sourceText.length <= SECTION_BATCH_SOURCE_TEXT_MAX_CHARS)).toBe(true);
    expect(flatTypes.filter((type) => type === 'MC')).toHaveLength(13);
    expect(flatTypes.filter((type) => type === 'TF')).toHaveLength(13);
    expect(flatTypes.filter((type) => type === 'YN')).toHaveLength(12);
    expect(flatTypes.filter((type) => type === 'MT')).toHaveLength(12);
  });

  test('stop endpoint marks jobs stopped and keeps existing questions', async () => {
    const { createGenerationJobStore } = require('../lib/asyncJobStore.js');
    const { handler: stop } = require('../generate-quiz-stop.js');
    const { handler: cancelAlias } = require('../generate-quiz-cancel.js');
    const store = createGenerationJobStore({ env: process.env });
    const job = await store.createJob({
      topic: 'Stop',
      requestedCount: 5,
      options: { sourceText: 'private source text' },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 5 }],
    });
    await store.updateJob(job.jobId, (current) => ({
      ...current,
      status: 'running',
      questions: [tfLine(1), tfLine(2)],
      completedCount: 2,
    }));

    const res = await stop(event({ jobId: job.jobId }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('stopped');
    expect(body.stopped).toBe(true);
    expect(body.completedCount).toBe(2);
    expect(body.questions).toEqual([tfLine(1), tfLine(2)]);
    expect(body.progressMessage).toBe('Generation stopped. 2 of 5 questions ready.');
    expect(JSON.stringify(body)).not.toContain('private source text');

    const aliasRes = await cancelAlias(event({ jobId: job.jobId }));
    const aliasBody = json(aliasRes);
    expect(aliasRes.statusCode).toBe(200);
    expect(aliasBody.status).toBe('stopped');
    expect(aliasBody.stopped).toBe(true);
  });

  test('sync generation uses short timeout while async worker mode accepts slower provider success', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    process.env = { ...process.env, AI_PROVIDER: 'mock' };
    const generateLines = jest.fn(async () => new Promise((resolve) => {
      setTimeout(() => resolve({
        title: 'Slow Quiz',
        lines: tfLine(1),
        provider: 'mock',
        model: 'mock',
      }), 26000);
    }));
    jest.doMock('../lib/providers.js', () => ({
      providerTimeoutMs: jest.fn(() => 22000),
      asyncProviderTimeoutMs: jest.fn(() => 90000),
      generateLines,
      generateInBatches: jest.fn(),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handleGenerateQuiz } = require('../generate-quiz.js');

    try {
      const syncPending = handleGenerateQuiz(event({ topic: 'Slow', count: 1, provider: 'mock' }));
      await Promise.resolve();
      expect(generateLines.mock.calls[0][0].providerTimeoutMs).toBe(22000);
      jest.advanceTimersByTime(25000);
      const syncRes = await syncPending;
      expect(syncRes.statusCode).toBe(504);

      generateLines.mockClear();
      const asyncPending = handleGenerateQuiz(event({ topic: 'Slow', count: 1, provider: 'mock' }), { asyncWorker: true });
      await Promise.resolve();
      expect(generateLines.mock.calls[0][0].providerTimeoutMs).toBe(90000);
      jest.advanceTimersByTime(26000);
      const asyncRes = await asyncPending;
      expect(asyncRes.statusCode).toBe(200);
      expect(json(asyncRes).lines).toBe(tfLine(1));
    } finally {
      jest.dontMock('../lib/providers.js');
      jest.useRealTimers();
    }
  });
});

describe('async generation worker', () => {
  const originalEnv = process.env;
  let adapter;
  let store;
  let handleGenerateQuiz;
  let processGenerationJob;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'test', AI_PROVIDER: 'mock' };
    adapter = new MemoryAdapter();
    handleGenerateQuiz = jest.fn();
    jest.doMock('../generate-quiz.js', () => ({ handleGenerateQuiz }));
    const { GenerationJobStore } = require('../lib/asyncJobStore.js');
    ({ processGenerationJob } = require('../lib/asyncGenerationWorker.js'));
    store = new GenerationJobStore({ adapter, env: process.env });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.dontMock('../generate-quiz.js');
  });

  async function createWorkerJob(plannedBatches, overrides = {}) {
    return store.createJob({
      topic: 'Worker',
      requestedCount: overrides.requestedCount || plannedBatches.reduce((sum, batch) => sum + Number(batch.count || 0), 0),
      sourceName: 'worker.md',
      options: {
        provider: 'mock',
        difficulty: 'hard',
        types: ['TF'],
        sourceName: 'worker.md',
        sourceText: 'private worker source',
      },
      plannedBatches,
      ...overrides,
    });
  }

  test('worker saves completed questions after each successful batch', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines(tfLine(1)))
      .mockResolvedValueOnce(okLines(tfLine(2)));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 1, sourceText: 'source 1', types: ['TF'] },
      { batchId: 'batch-2', batchNo: 2, count: 1, sourceText: 'source 2', types: ['TF'] },
    ]);

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.questions).toEqual([tfLine(1), tfLine(2)]);
    expect(adapter.saves.some((save) => save.completedCount === 1)).toBe(true);
    expect(adapter.saves.some((save) => save.completedCount === 2)).toBe(true);
  });

  test('worker uses async timeout mode and keeps a five-question batch intact', async () => {
    const lines = [1, 2, 3, 4, 5].map(tfLine);
    handleGenerateQuiz.mockResolvedValueOnce(okLines(lines));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 5, sourceText: 'source 1', types: ['MC', 'TF', 'YN', 'MC', 'MT'] },
    ], { requestedCount: 5 });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.questions).toEqual(lines);
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);
    expect(handleGenerateQuiz.mock.calls[0][1]).toMatchObject({
      skipRateLimit: true,
      timeoutMode: 'async-worker',
      asyncWorker: true,
    });
    expect(JSON.parse(handleGenerateQuiz.mock.calls[0][0].body)).toMatchObject({ count: 8 });
  });

  test('oversampled response saves five valid questions from more than five candidates', async () => {
    const lines = [1, 2, 3, 4, 5, 6, 7, 8].map(tfLine);
    handleGenerateQuiz.mockResolvedValueOnce(okLines(lines));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 5, sourceText: 'source 1', types: ['TF'] },
    ], { requestedCount: 5 });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(5);
    expect(done.questions).toEqual(lines.slice(0, 5));
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);
    expect(JSON.parse(handleGenerateQuiz.mock.calls[0][0].body).count).toBe(8);
  });

  test('malformed MT mapping is rejected before counting and valid MT is accepted', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines([malformedMtLine(1), mtLine(2)]))
      .mockResolvedValueOnce(okLines([tfLine(3)]));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 2, sourceText: 'source 1', types: ['MT', 'MT'] },
    ], { requestedCount: 2 });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(done.questions.length);
    expect(done.questions).toEqual([mtLine(2), tfLine(3)]);
    expect(done.questions).not.toContain(malformedMtLine(1));
    expect(done.failedBatches[0]).toMatchObject({
      batchId: 'batch-1',
      requestedCount: 2,
      candidateCount: 2,
      rawLineCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      rejectedReasons: { invalid_mt_mapping: 1 },
    });
  });

  test('one failed batch is recorded and fill pass runs after later planned batches', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(timeoutResponse())
      .mockResolvedValueOnce(okLines(tfLine(2)))
      .mockResolvedValueOnce(okLines(tfLine(1)));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 1, sourceText: 'source 1', types: ['TF'] },
      { batchId: 'batch-2', batchNo: 2, count: 1, sourceText: 'source 2', types: ['TF'] },
    ]);

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(2);
    expect(done.questions).toEqual([tfLine(2), tfLine(1)]);
    expect(done.failedBatches).toHaveLength(1);
    expect(done.failedBatches[0]).toMatchObject({
      batchId: 'batch-1',
      message: 'A provider request timed out.',
      candidateCount: 4,
    });
    expect(JSON.parse(handleGenerateQuiz.mock.calls[1][0].body).sourceText).toBe('source 2');
    expect(JSON.parse(handleGenerateQuiz.mock.calls[2][0].body).sourceText).toBe('source 1');
  });

  test('fill pass saves only the missing count and stops when requested count is reached', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines(tfLine(1)))
      .mockResolvedValueOnce(okLines([tfLine(2), tfLine(3)]))
      .mockResolvedValueOnce(okLines([tfLine(4), tfLine(5), tfLine(6)]));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 2, sourceText: 'source 1', types: ['TF'] },
      { batchId: 'batch-2', batchNo: 2, count: 2, sourceText: 'source 2', types: ['TF'] },
    ], { requestedCount: 4 });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(4);
    expect(done.questions).toEqual([tfLine(1), tfLine(2), tfLine(3), tfLine(4)]);
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(3);
    expect(JSON.parse(handleGenerateQuiz.mock.calls[2][0].body).count).toBe(4);
    expect(done.questions).not.toContain(tfLine(5));
    expect(done.questions).not.toContain(tfLine(6));
  });

  test('zero usable questions returns failed', async () => {
    handleGenerateQuiz.mockResolvedValue(okLines('not a quiz line'));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 2, sourceText: 'source 1', types: ['TF'] },
    ], { requestedCount: 2 });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('failed');
    expect(done.completedCount).toBe(0);
    expect(done.errors.some((err) => err.code === 'ZERO_USABLE_QUESTIONS')).toBe(true);
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(7);
    expect(done.failedBatches).toHaveLength(7);
  });

  test('stopped job stops before future batches where possible', async () => {
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 1, sourceText: 'source 1', types: ['TF'] },
      { batchId: 'batch-2', batchNo: 2, count: 1, sourceText: 'source 2', types: ['TF'] },
    ]);
    await store.stopJob(job.jobId);

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('stopped');
    expect(done.stopped).toBe(true);
    expect(handleGenerateQuiz).not.toHaveBeenCalled();
  });

  test('worker saves an in-flight batch result after stop and does not start later batches', async () => {
    const pending = createDeferred();
    const lines = [1, 2, 3, 4, 5].map(tfLine);
    handleGenerateQuiz.mockReturnValueOnce(pending.promise);
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 5, sourceText: 'source 1', types: ['TF'] },
      { batchId: 'batch-2', batchNo: 2, count: 5, sourceText: 'source 2', types: ['TF'] },
    ], { requestedCount: 10 });

    const running = processGenerationJob(job.jobId, { store });
    for (let i = 0; i < 8 && handleGenerateQuiz.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);

    await store.stopJob(job.jobId);
    pending.resolve(okLines(lines));
    const done = await running;

    expect(done.status).toBe('stopped');
    expect(done.stopped).toBe(true);
    expect(done.completedCount).toBe(5);
    expect(done.questions).toEqual(lines);
    expect(done.progressMessage).toBe('Generation stopped. 5 of 10 questions ready.');
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);
  });

  test('stop during fill preserves generated questions and ends the job', async () => {
    const pendingFill = createDeferred();
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines(tfLine(1)))
      .mockReturnValueOnce(pendingFill.promise);
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 3, sourceText: 'source 1', types: ['TF'] },
    ], { requestedCount: 3 });

    const running = processGenerationJob(job.jobId, { store });
    for (let i = 0; i < 12 && handleGenerateQuiz.mock.calls.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(2);

    await store.stopJob(job.jobId);
    pendingFill.resolve(okLines([tfLine(2), tfLine(3)]));
    const done = await running;

    expect(done.status).toBe('stopped');
    expect(done.stopped).toBe(true);
    expect(done.completedCount).toBe(3);
    expect(done.questions).toEqual([tfLine(1), tfLine(2), tfLine(3)]);
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(2);
  });
});
