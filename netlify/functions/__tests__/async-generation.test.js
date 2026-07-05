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

function okLines(lines, title = 'Async Quiz') {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, lines: Array.isArray(lines) ? lines.join('\n') : lines, provider: 'mock', model: 'mock' }),
  };
}

function timeoutResponse() {
  return {
    statusCode: 504,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'Generation timed out',
      details: 'Gemini provider timed out after 22000ms',
      code: 'PROVIDER_TIMEOUT',
    }),
  };
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

    for (const state of ['queued', 'running', 'partial', 'complete', 'failed']) {
      await store.updateJob(job.jobId, (current) => ({
        ...current,
        status: state,
        questions: state === 'queued' || state === 'running' || state === 'failed' ? [] : [tfLine(1)],
        completedCount: state === 'partial' || state === 'complete' ? 1 : 0,
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

  test('one failed batch is recorded and does not stop later batches', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(timeoutResponse())
      .mockResolvedValueOnce(okLines(tfLine(2)));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 1, sourceText: 'source 1', types: ['TF'] },
      { batchId: 'batch-2', batchNo: 2, count: 1, sourceText: 'source 2', types: ['TF'] },
    ]);

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('partial');
    expect(done.completedCount).toBe(1);
    expect(done.questions).toEqual([tfLine(2)]);
    expect(done.failedBatches).toHaveLength(1);
    expect(done.failedBatches[0]).toMatchObject({
      batchId: 'batch-1',
      message: 'A provider request timed out.',
    });
  });

  test('failed multi-question batch retries as single-question calls and keeps successful retries', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(timeoutResponse())
      .mockResolvedValueOnce(okLines(tfLine(1)))
      .mockResolvedValueOnce(timeoutResponse())
      .mockResolvedValueOnce(okLines(tfLine(3)));
    const job = await createWorkerJob([
      {
        batchId: 'batch-1',
        batchNo: 1,
        count: 2,
        sourceText: 'source 1',
        types: ['TF', 'TF'],
        plannedEntries: [
          { sourceText: 'single source 1', types: ['TF'] },
          { sourceText: 'single source 2', types: ['TF'] },
        ],
      },
      { batchId: 'batch-2', batchNo: 2, count: 1, sourceText: 'source 3', types: ['TF'] },
    ], { requestedCount: 3 });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('partial');
    expect(done.questions).toEqual([tfLine(1), tfLine(3)]);
    expect(done.failedBatches.some((batch) => batch.retry)).toBe(true);
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(4);
  });

  test('zero usable questions returns failed', async () => {
    handleGenerateQuiz.mockResolvedValueOnce(okLines('not a quiz line'));
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 1, sourceText: 'source 1', types: ['TF'] },
    ]);

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('failed');
    expect(done.completedCount).toBe(0);
    expect(done.errors.some((err) => err.code === 'ZERO_USABLE_QUESTIONS')).toBe(true);
  });

  test('canceled job stops before future batches where possible', async () => {
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 1, sourceText: 'source 1', types: ['TF'] },
      { batchId: 'batch-2', batchNo: 2, count: 1, sourceText: 'source 2', types: ['TF'] },
    ]);
    await store.cancelJob(job.jobId);

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('canceled');
    expect(handleGenerateQuiz).not.toHaveBeenCalled();
  });
});
