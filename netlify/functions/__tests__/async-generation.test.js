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

function sectionEntry(n, type = 'TF', label = 'source') {
  return {
    count: 1,
    plannedType: type,
    types: [type],
    sourceName: 'worker.md',
    headingPath: `${label} > Section ${n}`,
    sectionHeading: `Section ${n}`,
    sectionText: `Section ${n} has enough source detail for a fill-safe planned question about networking concepts, commands, and troubleshooting.`,
    sourceText: `Section content:\nSection ${n} has enough source detail for a fill-safe planned question about networking concepts, commands, and troubleshooting.`,
  };
}

function plannedSourceText(entries) {
  return entries.map((entry, index) => [
    `Planned question ${index + 1} type: ${entry.plannedType || (entry.types && entry.types[0]) || 'TF'}`,
    `Heading path: ${entry.headingPath || entry.sectionHeading || `Section ${index + 1}`}`,
    'Section excerpt:',
    entry.sectionText || entry.sourceText || `Section ${index + 1} source detail.`,
  ].join('\n')).join('\n---\n');
}

function plannedSectionBatch(batchNo, count, types = ['TF']) {
  const plannedEntries = Array.from({ length: count }, (_, index) => sectionEntry(
    `${batchNo}-${index + 1}`,
    types[index % types.length],
    `batch-${batchNo}`
  ));
  return {
    batchId: `batch-${batchNo}`,
    batchNo,
    kind: 'section',
    count,
    sourceText: plannedSourceText(plannedEntries),
    types: plannedEntries.map((entry) => entry.plannedType),
    plannedEntries,
  };
}

function requestBodies(mockFn) {
  return mockFn.mock.calls.map((call) => JSON.parse(call[0].body));
}

function laneContracts(mockFn) {
  return mockFn.mock.calls.map((call) => call[1] && call[1].laneContract);
}

function plannedMarkerCount(sourceText) {
  return (String(sourceText || '').match(/Planned question \d+/g) || []).length;
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
    expect(body.workerToken).toMatch(/^[A-Za-z0-9_-]{24,96}$/);
    expect(body.status).toBe('queued');
    expect(body.plannedBatchCount).toBeGreaterThan(1);

    const statusRes = await status({
      httpMethod: 'GET',
      headers: { Authorization: `Bearer ${body.workerToken}` },
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

  test('start endpoint rate-limits job creation per client IP', async () => {
    process.env.GENERATE_LIMIT = '1';
    process.env.GENERATE_WINDOW_MS = '60000';
    jest.resetModules();
    const { clearRateLimit } = require('../lib/generationRateLimit.js');
    const { handler: start } = require('../generate-quiz-start.js');
    clearRateLimit();
    const request = { topic: 'Rate limited', count: 5, provider: 'echo' };
    const headers = { 'x-forwarded-for': '192.0.2.10' };

    const first = await start(event(request, { headers }));
    const second = await start(event(request, { headers }));
    const otherClient = await start(event(request, { headers: { 'x-forwarded-for': '192.0.2.11' } }));

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    expect(json(second)).toEqual({ error: 'Rate limited' });
    expect(second.headers['Retry-After']).toBe('60');
    expect(otherClient.statusCode).toBe(202);
  });

  test('bearer-protected worker accepts only its per-job browser capability', async () => {
    process.env.GENERATE_BEARER_TOKEN = 'test-worker-secret';
    jest.resetModules();
    const { handler: start } = require('../generate-quiz-start.js');
    const { handler: worker } = require('../generate-quiz-worker-background.js');
    const startRes = await start(event({
      topic: 'Protected async worker',
      count: 1,
      provider: 'echo',
      types: ['TF'],
    }, {
      headers: { Authorization: 'Bearer test-worker-secret' },
    }));
    const started = json(startRes);

    expect(startRes.statusCode).toBe(202);
    expect(started.workerToken).toMatch(/^[A-Za-z0-9_-]{24,96}$/);

    const missingToken = await worker(event({ jobId: started.jobId }));
    const wrongToken = await worker(event({
      jobId: started.jobId,
      workerToken: 'wrong_worker_capability_token_12345',
    }));
    const { createGenerationJobStore } = require('../lib/asyncJobStore.js');
    const store = createGenerationJobStore({ env: process.env });
    const stillQueued = await store.getJob(started.jobId);
    const accepted = await worker(event({
      jobId: started.jobId,
      workerToken: started.workerToken,
    }));
    const acceptedBody = json(accepted);
    const stored = await store.getJob(started.jobId);

    expect(missingToken.statusCode).toBe(401);
    expect(wrongToken.statusCode).toBe(401);
    expect(stillQueued.status).toBe('queued');
    expect(stillQueued.workerTokenHash).toBeTruthy();
    expect(stillQueued.workerTokenHash).not.toBe(started.workerToken);
    expect(accepted.statusCode).toBe(202);
    expect(acceptedBody.status).toBe('complete');
    expect(acceptedBody.completedCount).toBe(1);
    expect(JSON.stringify(acceptedBody)).not.toContain(started.workerToken);
    expect(acceptedBody).not.toHaveProperty('workerTokenHash');
    expect(stored.workerTokenHash).toBe(stillQueued.workerTokenHash);
  });

  test('bearer-protected deployments require shared auth to start and job auth afterward', async () => {
    process.env.GENERATE_BEARER_TOKEN = 'test-browser-flow-secret';
    jest.resetModules();
    const { handler: start } = require('../generate-quiz-start.js');
    const { handler: status } = require('../generate-quiz-status.js');
    const { handler: stop } = require('../generate-quiz-stop.js');

    const request = {
      topic: 'Protected browser flow',
      count: 1,
      provider: 'echo',
      types: ['TF'],
    };
    const deniedStart = await start(event(request));
    const startRes = await start(event(request, {
      headers: { Authorization: 'Bearer test-browser-flow-secret' },
    }));
    const started = json(startRes);
    const deniedStatus = await status({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { jobId: started.jobId },
    });
    const authHeaders = { Authorization: `Bearer ${started.workerToken}` };
    const statusRes = await status({
      httpMethod: 'GET',
      headers: authHeaders,
      queryStringParameters: { jobId: started.jobId },
    });
    const deniedStop = await stop(event({ jobId: started.jobId }));
    const stopRes = await stop(event({ jobId: started.jobId }, { headers: authHeaders }));
    const terminalStatus = await status({
      httpMethod: 'GET',
      headers: authHeaders,
      queryStringParameters: { jobId: started.jobId },
    });

    expect(deniedStart.statusCode).toBe(401);
    expect(startRes.statusCode).toBe(202);
    expect(started.jobId).toMatch(/^qj_[A-Za-z0-9_-]+$/);
    expect(deniedStatus.statusCode).toBe(401);
    expect(statusRes.statusCode).toBe(200);
    expect(json(statusRes)).toMatchObject({ jobId: started.jobId, status: 'queued' });
    expect(deniedStop.statusCode).toBe(401);
    expect(stopRes.statusCode).toBe(200);
    expect(json(stopRes)).toMatchObject({ jobId: started.jobId, status: 'stopped', stopped: true });
    expect(terminalStatus.statusCode).toBe(200);
    expect(json(terminalStatus)).toMatchObject({ jobId: started.jobId, status: 'stopped', stopped: true });
  });

  test('topic-only async jobs preserve explicitly selected question types', async () => {
    const { createGenerationJobStore } = require('../lib/asyncJobStore.js');
    const { buildPlannedBatches } = require('../lib/asyncGenerationPlanner.js');
    const { processGenerationJob } = require('../lib/asyncGenerationWorker.js');
    const store = createGenerationJobStore({ env: process.env });
    const plannedBatches = buildPlannedBatches({
      topic: 'Ports',
      count: 5,
      types: ['YN'],
      difficulty: 'medium',
      sourceText: '',
    });
    const job = await store.createJob({
      topic: 'Ports',
      requestedCount: 5,
      options: { topic: 'Ports', count: 5, types: ['YN'], provider: 'echo' },
      plannedBatches,
    });

    const done = await processGenerationJob(job.jobId, { store, workerId: 'topic-type-test' });

    expect(done.status).toBe('complete');
    expect(done.questions).toHaveLength(5);
    expect(done.questions.every((line) => line.startsWith('YN|'))).toBe(true);
  });

  test('status endpoint returns safe queued, running, partial, complete, and failed states', async () => {
    const { createGenerationJobStore, hashWorkerToken } = require('../lib/asyncJobStore.js');
    const { createDefaultGenerationProfile } = require('../lib/asyncGenerationPlanner.js');
    const { handler: status } = require('../generate-quiz-status.js');
    const store = createGenerationJobStore({ env: process.env });
    const workerToken = 'status_capability_abcdefghijklmnopqrstuvwxyz';
    const job = await store.createJob({
      topic: 'States',
      requestedCount: 2,
      sourceName: 'states.md',
      options: { sourceText: 'secret source text' },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 1 }],
      workerTokenHash: hashWorkerToken(workerToken),
    });

    for (const state of ['queued', 'running', 'partial', 'complete', 'failed', 'stopped']) {
      await store.updateJob(job.jobId, (current) => ({
        ...current,
        status: state,
        stopped: state === 'stopped',
        questions: state === 'queued' || state === 'running' || state === 'failed' ? [] : [tfLine(1)],
        completedCount: state === 'partial' || state === 'complete' || state === 'stopped' ? 1 : 0,
        errors: state === 'failed' ? [{ message: 'No usable quiz questions were generated.' }] : [],
        generationProfile: createDefaultGenerationProfile({ requestedCount: 2, difficulty: 'hard', sourceBacked: true }),
      }));
      const res = await status({
        httpMethod: 'GET',
        headers: { Authorization: `Bearer ${workerToken}` },
        queryStringParameters: { jobId: job.jobId },
      });
      const body = json(res);
      expect(res.statusCode).toBe(200);
      expect(body.status).toBe(state);
      expect(body.stopped).toBe(state === 'stopped');
      expect(body.generationProfile).toMatchObject({
        quizLane: 'EXACT_STUDY',
        scenarioRatio: 0.35,
        curveballCount: 0,
      });
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

  test('Netlify Blobs adapter uses compatible reads and ETag-conditional updates', async () => {
    const queuedJob = {
      jobId: 'qj_abcdefghijklmnopqrstuvwxyz',
      status: 'queued',
      updatedAt: '2026-07-17T00:00:00.000Z',
    };
    const blobStore = {
      get: jest.fn()
        .mockResolvedValueOnce(queuedJob)
        .mockResolvedValue(null),
      getWithMetadata: jest.fn(async () => ({
        data: queuedJob,
        etag: 'etag-1',
        metadata: {},
      })),
      setJSON: jest.fn(async () => ({ modified: true, etag: 'etag-2' })),
      delete: jest.fn(),
    };
    jest.doMock('@netlify/blobs', () => ({
      connectLambda: jest.fn(),
      getStore: jest.fn(() => blobStore),
    }));

    try {
      const { NetlifyBlobsJobAdapter } = require('../lib/asyncJobStore.js');
      const adapter = new NetlifyBlobsJobAdapter();
      await adapter.get('qj_abcdefghijklmnopqrstuvwxyz');
      const versioned = await adapter.getVersioned('qj_abcdefghijklmnopqrstuvwxyz');
      const repeatedRead = await adapter.get('qj_abcdefghijklmnopqrstuvwxyz');
      const runningJob = {
        ...queuedJob,
        status: 'running',
        updatedAt: '2026-07-17T00:00:01.000Z',
      };
      const modified = await adapter.setIfVersion(
        'qj_abcdefghijklmnopqrstuvwxyz',
        { ...runningJob, expiresAt: 'later' },
        versioned.version
      );
      const readAfterWrite = await adapter.get('qj_abcdefghijklmnopqrstuvwxyz');
      const versionedAfterWrite = await adapter.getVersioned('qj_abcdefghijklmnopqrstuvwxyz');

      expect(versioned).toMatchObject({ version: 'etag-1', job: { status: 'queued' } });
      expect(repeatedRead).toMatchObject({ status: 'queued' });
      expect(blobStore.get).toHaveBeenCalledWith('qj_abcdefghijklmnopqrstuvwxyz', { type: 'json' });
      expect(blobStore.getWithMetadata).toHaveBeenCalledWith('qj_abcdefghijklmnopqrstuvwxyz', { type: 'json' });
      expect(blobStore.setJSON).toHaveBeenCalledWith(
        'qj_abcdefghijklmnopqrstuvwxyz',
        expect.objectContaining({ status: 'running' }),
        expect.objectContaining({ onlyIfMatch: 'etag-1' })
      );
      expect(modified).toBe(true);
      expect(readAfterWrite).toMatchObject({ status: 'running' });
      expect(versionedAfterWrite).toMatchObject({ version: 'etag-2', job: { status: 'running' } });
    } finally {
      jest.dontMock('@netlify/blobs');
    }
  });

  test('job reads retry while a newly-created Blob is not yet visible', async () => {
    const queuedJob = {
      jobId: 'qj_eventualvisibility1234567890',
      status: 'queued',
      requestedCount: 1,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    const adapter = {
      get: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(queuedJob),
    };
    const { GenerationJobStore } = require('../lib/asyncJobStore.js');
    const store = new GenerationJobStore({ env: process.env, adapter });

    const loaded = await store.getJobWithRetry(queuedJob.jobId, { attempts: 3, delayMs: 0 });

    expect(loaded).toEqual(queuedJob);
    expect(adapter.get).toHaveBeenCalledTimes(3);
  });

  test('a successful versioned retry remains usable when the next Blob read is stale', async () => {
    const queuedJob = {
      jobId: 'qj_versionedvisibility123456789',
      status: 'queued',
      requestedCount: 1,
      updatedAt: '2026-07-17T00:00:00.000Z',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    const blobStore = {
      get: jest.fn(),
      getWithMetadata: jest.fn()
        .mockResolvedValueOnce({ data: queuedJob, etag: 'etag-1', metadata: {} })
        .mockResolvedValueOnce({
          data: { ...queuedJob, updatedAt: '2026-07-16T23:59:59.000Z' },
          etag: 'etag-stale',
          metadata: {},
        }),
      setJSON: jest.fn(async () => ({ modified: true, etag: 'etag-2' })),
      delete: jest.fn(),
    };
    jest.doMock('@netlify/blobs', () => ({
      connectLambda: jest.fn(),
      getStore: jest.fn(() => blobStore),
    }));

    try {
      const { GenerationJobStore, NetlifyBlobsJobAdapter } = require('../lib/asyncJobStore.js');
      const adapter = new NetlifyBlobsJobAdapter();
      const store = new GenerationJobStore({ env: process.env, adapter });
      const loaded = await store.getJobWithRetry(queuedJob.jobId, { attempts: 3, delayMs: 0 });
      const updated = await store.updateJob(queuedJob.jobId, (job) => ({ ...job, status: 'running' }));

      expect(loaded).toEqual(queuedJob);
      expect(updated).toMatchObject({ status: 'running' });
      expect(blobStore.getWithMetadata).toHaveBeenCalledTimes(2);
      expect(blobStore.setJSON).toHaveBeenCalledWith(
        queuedJob.jobId,
        expect.objectContaining({ status: 'running' }),
        expect.objectContaining({ onlyIfMatch: 'etag-1' })
      );
    } finally {
      jest.dontMock('@netlify/blobs');
    }
  });

  test('invalid retry options safely fall back to one immediate attempt', async () => {
    const adapter = { get: jest.fn().mockResolvedValue(null) };
    const { GenerationJobStore } = require('../lib/asyncJobStore.js');
    const store = new GenerationJobStore({ env: process.env, adapter });

    const loaded = await store.getJobWithRetry('qj_invalidretryoptions123456789', {
      attempts: 'not-a-number',
      delayMs: 'also-not-a-number',
    });

    expect(loaded).toBeNull();
    expect(adapter.get).toHaveBeenCalledTimes(1);
  });

  test('versioned retry reads preserve expiry cleanup and response state', async () => {
    const expired = {
      jobId: 'qj_expiredversionedretry123456',
      status: 'queued',
      options: { sourceText: 'private material' },
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const adapter = {
      getVersioned: jest.fn().mockResolvedValue({ job: expired, version: 'etag-expired' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const { GenerationJobStore } = require('../lib/asyncJobStore.js');
    const store = new GenerationJobStore({ env: process.env, adapter });

    const loaded = await store.getJobWithRetry(expired.jobId, { attempts: 3, delayMs: 0 });

    expect(loaded).toMatchObject({ status: 'expired', jobId: expired.jobId });
    expect(JSON.stringify(loaded)).not.toContain('private material');
    expect(adapter.delete).toHaveBeenCalledWith(expired.jobId);
  });

  test('conditional updates retry while Blob metadata is not yet visible', async () => {
    const queuedJob = {
      jobId: 'qj_eventualmetadata123456789012',
      status: 'queued',
      requestedCount: 1,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    const adapter = {
      getVersioned: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ job: queuedJob, version: 'etag-1' }),
      setIfVersion: jest.fn().mockResolvedValue(true),
    };
    const { GenerationJobStore } = require('../lib/asyncJobStore.js');
    const store = new GenerationJobStore({ env: process.env, adapter });

    const updated = await store.updateJob(queuedJob.jobId, (job) => ({ ...job, status: 'running' }));

    expect(updated).toMatchObject({ status: 'running' });
    expect(adapter.getVersioned).toHaveBeenCalledTimes(3);
    expect(adapter.setIfVersion).toHaveBeenCalledTimes(1);
  });

  test('expired jobs are scrubbed and reported safely', async () => {
    const { createGenerationJobStore, hashWorkerToken } = require('../lib/asyncJobStore.js');
    const { handler: status } = require('../generate-quiz-status.js');
    const store = createGenerationJobStore({ env: process.env });
    const workerToken = 'expired_capability_abcdefghijklmnopqrstuvwxyz';
    const job = await store.createJob({
      topic: 'Expired',
      requestedCount: 1,
      options: { sourceText: 'private source text' },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 1 }],
      workerTokenHash: hashWorkerToken(workerToken),
    });
    await store.saveJob({ ...job, expiresAt: new Date(Date.now() - 1000).toISOString() });

    const res = await status({
      httpMethod: 'GET',
      headers: { Authorization: `Bearer ${workerToken}` },
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

  test('default source-backed hard profile uses exact study lane without matching', () => {
    const { createDefaultGenerationProfile } = require('../lib/asyncGenerationPlanner.js');

    const profile = createDefaultGenerationProfile({ requestedCount: 50, difficulty: 'hard', sourceBacked: true });

    expect(profile).toMatchObject({
      quizLane: 'EXACT_STUDY',
      batchSize: 3,
      allowedTypes: ['MC', 'YN', 'TF'],
      avoidTypes: ['MT'],
      allowMatching: false,
      scenarioRatio: 0.35,
      scenarioBudget: 18,
      curveballCount: 0,
    });
    expect(profile.contractFlavors).toEqual(expect.arrayContaining([
      'calculation',
      'config_behavior',
      'protocol_mechanics',
      'verification',
      'troubleshooting',
    ]));
  });

  test('source-backed profiles honor explicitly selected question types', () => {
    const {
      buildProfiledBatches,
      createDefaultGenerationProfile,
    } = require('../lib/asyncGenerationPlanner.js');
    const trueFalseProfile = createDefaultGenerationProfile({
      requestedCount: 4,
      difficulty: 'hard',
      sourceBacked: true,
      types: ['TF'],
    });
    const trueFalseBatches = buildProfiledBatches(
      [plannedSectionBatch(1, 4, ['MC', 'YN', 'TF', 'MT'])],
      trueFalseProfile,
      4
    );
    const matchingProfile = createDefaultGenerationProfile({
      requestedCount: 2,
      difficulty: 'easy',
      sourceBacked: true,
      types: ['MT'],
    });

    expect(trueFalseProfile.allowedTypes).toEqual(['TF']);
    expect(trueFalseBatches.flatMap((batch) => batch.plannedEntries).every((entry) => entry.questionType === 'TF')).toBe(true);
    expect(matchingProfile).toMatchObject({
      allowedTypes: ['MT'],
      allowMatching: true,
    });
  });

  test('expert profile uses scenario ratio 0.6 and assigns exactly one curveball', () => {
    const {
      buildProfiledBatches,
      createDefaultGenerationProfile,
    } = require('../lib/asyncGenerationPlanner.js');
    const profile = createDefaultGenerationProfile({ requestedCount: 10, difficulty: 'expert', sourceBacked: true });
    const batches = buildProfiledBatches([plannedSectionBatch(1, 10, ['MC', 'TF', 'YN', 'MT'])], profile, 10);
    const entries = batches.flatMap((batch) => batch.plannedEntries || []);

    expect(profile.scenarioRatio).toBe(0.6);
    expect(profile.scenarioBudget).toBe(6);
    expect(profile.curveballCount).toBe(1);
    expect(new Set(batches.map((batch) => batch.quizLane))).toEqual(new Set(['EXACT_STUDY']));
    expect(entries.filter((entry) => entry.scenario)).toHaveLength(6);
    expect(entries.filter((entry) => entry.curveball)).toHaveLength(1);
    expect(batches.reduce((sum, batch) => sum + Number(batch.curveballCount || 0), 0)).toBe(1);
    expect(entries.some((entry) => entry.questionType === 'MT')).toBe(false);
  });

  test('stop endpoint marks jobs stopped and keeps existing questions', async () => {
    const { createGenerationJobStore, hashWorkerToken } = require('../lib/asyncJobStore.js');
    const { handler: stop } = require('../generate-quiz-stop.js');
    const { handler: cancelAlias } = require('../generate-quiz-cancel.js');
    const store = createGenerationJobStore({ env: process.env });
    const workerToken = 'stop_capability_abcdefghijklmnopqrstuvwxyz';
    const job = await store.createJob({
      topic: 'Stop',
      requestedCount: 5,
      options: { sourceText: 'private source text' },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 5 }],
      workerTokenHash: hashWorkerToken(workerToken),
    });
    await store.updateJob(job.jobId, (current) => ({
      ...current,
      status: 'running',
      questions: [tfLine(1), tfLine(2)],
      completedCount: 2,
    }));

    const res = await stop(event({ jobId: job.jobId }, {
      headers: { Authorization: `Bearer ${workerToken}` },
    }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('stopped');
    expect(body.stopped).toBe(true);
    expect(body.completedCount).toBe(2);
    expect(body.questions).toEqual([tfLine(1), tfLine(2)]);
    expect(body.progressMessage).toBe('Generation stopped. 2 of 5 questions ready.');
    expect(JSON.stringify(body)).not.toContain('private source text');

    const aliasRes = await cancelAlias(event({ jobId: job.jobId }, {
      headers: { Authorization: `Bearer ${workerToken}` },
    }));
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

  test('generate-quiz ignores public lane metadata and accepts trusted worker contracts', async () => {
    jest.resetModules();
    process.env = { ...process.env, AI_PROVIDER: 'mock' };
    const generateLines = jest.fn(async () => ({
      title: 'Lane Quiz',
      lines: tfLine(1),
      provider: 'mock',
      model: 'mock',
    }));
    jest.doMock('../lib/providers.js', () => ({
      providerTimeoutMs: jest.fn(() => 22000),
      asyncProviderTimeoutMs: jest.fn(() => 90000),
      generateLines,
      generateInBatches: jest.fn(),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));

    try {
      const { handleGenerateQuiz } = require('../generate-quiz.js');
      const publicRes = await handleGenerateQuiz(event({
        topic: 'Lane',
        count: 1,
        provider: 'mock',
        sourceText: 'Source excerpt.',
        types: ['YN'],
        quizLane: 'EXACT_STUDY',
        contractFlavor: 'config_behavior',
        questionType: 'YN',
        scenario: true,
        curveball: false,
      }));

      const internalRes = await handleGenerateQuiz(event({
        topic: 'Lane',
        count: 1,
        provider: 'mock',
        sourceText: 'Source excerpt.',
        types: ['YN'],
      }), {
        asyncWorker: true,
        skipRateLimit: true,
        trustedInternalRequest: true,
        laneContract: {
          quizLane: 'EXACT_STUDY',
          contractFlavor: 'config_behavior',
          questionType: 'YN',
          scenario: true,
          curveball: false,
        },
      });

      expect(publicRes.statusCode).toBe(200);
      expect(internalRes.statusCode).toBe(200);
      expect(generateLines).toHaveBeenCalledTimes(2);
      expect(generateLines.mock.calls[0][0].laneContract).toBeNull();
      expect(generateLines.mock.calls[1][0].laneContract).toMatchObject({
        quizLane: 'EXACT_STUDY',
        contractFlavor: 'config_behavior',
        questionType: 'YN',
        scenario: true,
        curveball: false,
      });
    } finally {
      jest.dontMock('../lib/providers.js');
    }
  });

  test('trusted worker generation succeeds when public generation requires bearer auth', async () => {
    process.env.GENERATE_BEARER_TOKEN = 'test-worker-secret';
    process.env.AI_PROVIDER = 'echo';
    jest.resetModules();
    const { handler: publicGenerate } = require('../generate-quiz.js');
    const unauthorized = await publicGenerate(event({ topic: 'Protected', count: 1, provider: 'echo' }));
    expect(unauthorized.statusCode).toBe(401);

    const { GenerationJobStore } = require('../lib/asyncJobStore.js');
    const { processGenerationJob: processProtectedJob } = require('../lib/asyncGenerationWorker.js');
    const protectedAdapter = new MemoryAdapter();
    const protectedStore = new GenerationJobStore({ adapter: protectedAdapter, env: process.env });
    const job = await protectedStore.createJob({
      topic: 'Protected worker',
      requestedCount: 1,
      options: { provider: 'echo', difficulty: 'easy', types: ['TF'] },
      plannedBatches: [{ batchId: 'batch-1', batchNo: 1, count: 1, types: ['TF'] }],
    });

    const done = await processProtectedJob(job.jobId, { store: protectedStore });

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(1);
    expect(done.questions).toHaveLength(1);
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
    const defaultOptions = {
      provider: 'mock',
      difficulty: 'hard',
      types: ['TF'],
      sourceName: 'worker.md',
      sourceText: 'private worker source',
    };
    const { options: overrideOptions, ...jobOverrides } = overrides;
    return store.createJob({
      topic: 'Worker',
      requestedCount: overrides.requestedCount || plannedBatches.reduce((sum, batch) => sum + Number(batch.count || 0), 0),
      sourceName: 'worker.md',
      options: { ...defaultOptions, ...(overrideOptions || {}) },
      plannedBatches,
      ...jobOverrides,
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

  test.each(['complete', 'partial', 'failed'])(
    'rerunning a %s job returns the terminal record unchanged',
    async (status) => {
      const requestedCount = status === 'complete' ? 1 : 2;
      const questions = status === 'failed' ? [] : [tfLine(1)];
      const job = await createWorkerJob([
        { batchId: 'batch-1', batchNo: 1, count: requestedCount, types: ['TF'] },
      ], { requestedCount });
      const { scrubStoredJobPayload } = require('../lib/asyncJobStore.js');
      await store.updateJob(job.jobId, (current) => ({
        ...scrubStoredJobPayload(current),
        status,
        questions,
        completedCount: questions.length,
        errors: status === 'failed' ? [{ code: 'TEST_FAILURE', message: 'Original failure.' }] : [],
        progressMessage: `${questions.length} of ${requestedCount} questions ready.`,
      }));
      const before = await store.getJob(job.jobId);
      const saveCount = adapter.saves.length;

      const done = await processGenerationJob(job.jobId, { store });

      expect(done).toEqual(before);
      expect(adapter.saves).toHaveLength(saveCount);
      expect(handleGenerateQuiz).not.toHaveBeenCalled();
    }
  );

  test('a second worker invocation no-ops while the active lease is held', async () => {
    const pending = createDeferred();
    handleGenerateQuiz.mockReturnValueOnce(pending.promise);
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 1, types: ['TF'] },
    ], { requestedCount: 1, options: { difficulty: 'easy', types: ['TF'] } });

    const firstRun = processGenerationJob(job.jobId, { store, workerId: 'worker-one' });
    for (let index = 0; index < 8 && handleGenerateQuiz.mock.calls.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);

    const secondRun = await processGenerationJob(job.jobId, { store, workerId: 'worker-two' });
    expect(secondRun.status).toBe('running');
    expect(secondRun.workerLeaseId).toBe('worker-one');
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);

    pending.resolve(okLines(tfLine(1)));
    const done = await firstRun;
    const saved = await store.getJob(job.jobId);

    expect(done.status).toBe('complete');
    expect(saved.questions).toEqual([tfLine(1)]);
    expect(saved.completedCount).toBe(1);
    expect(saved).not.toHaveProperty('workerLeaseId');
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);
  });

  test('profiled hard source-backed batches use one lane and aligned planned entries', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines([tfLine(1), tfLine(2)]))
      .mockResolvedValueOnce(okLines(tfLine(3)))
      .mockResolvedValueOnce(okLines([tfLine(4), tfLine(5)]));
    const job = await createWorkerJob([
      plannedSectionBatch(1, 5, ['MC', 'TF', 'YN', 'MC', 'MT']),
    ], { requestedCount: 5 });

    const done = await processGenerationJob(job.jobId, { store });
    const bodies = requestBodies(handleGenerateQuiz);
    const contracts = laneContracts(handleGenerateQuiz);

    expect(done.status).toBe('complete');
    expect(done.questions).toEqual([1, 2, 3, 4, 5].map(tfLine));
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(3);
    expect(handleGenerateQuiz.mock.calls[0][1]).toMatchObject({
      skipRateLimit: true,
      timeoutMode: 'async-worker',
      asyncWorker: true,
      trustedInternalRequest: true,
    });
    expect(bodies.map((body) => body.count)).toEqual([2, 1, 2]);
    expect(bodies.every((body) => !Object.hasOwn(body, 'quizLane'))).toBe(true);
    expect(new Set(contracts.map((contract) => contract.quizLane))).toEqual(new Set(['EXACT_STUDY']));
    expect(contracts.map((contract) => contract.scenario)).toEqual([true, false, false]);
    expect(contracts.every((contract) => typeof contract.curveball === 'boolean')).toBe(true);
    expect(contracts.every((contract) => contract.questionType === 'TF')).toBe(true);
    expect(bodies.every((body) => body.types.every((type) => type === 'TF'))).toBe(true);
    expect(bodies.every((body) => body.count === plannedMarkerCount(body.sourceText))).toBe(true);
    expect(bodies.every((body) => !body.types.includes('MT'))).toBe(true);
    expect(done.generationProfile).toMatchObject({
      quizLane: 'EXACT_STUDY',
      scenarioRatio: 0.35,
      curveballCount: 0,
    });
  });

  test('main source-backed batch ignores extra returned lines without requesting extras', async () => {
    const lines = [1, 2, 3, 4, 5, 6, 7, 8].map(tfLine);
    handleGenerateQuiz.mockResolvedValueOnce(okLines(lines));
    const job = await createWorkerJob([
      plannedSectionBatch(1, 3, ['TF']),
    ], { requestedCount: 3, options: { difficulty: 'easy' } });

    const done = await processGenerationJob(job.jobId, { store });
    const bodies = requestBodies(handleGenerateQuiz);

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(3);
    expect(done.questions).toEqual(lines.slice(0, 3));
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);
    expect(bodies[0].count).toBe(3);
    expect(plannedMarkerCount(bodies[0].sourceText)).toBe(3);
  });

  test('expert lane sends one curveball contract and keeps scenario tags within budget', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines([tfLine(1), tfLine(2), tfLine(3)]))
      .mockResolvedValueOnce(okLines([tfLine(4), tfLine(5), tfLine(6)]))
      .mockResolvedValueOnce(okLines([tfLine(7), tfLine(8), tfLine(9)]))
      .mockResolvedValueOnce(okLines(tfLine(10)));
    const job = await createWorkerJob([
      plannedSectionBatch(1, 10, ['MC', 'TF', 'YN', 'MT']),
    ], { requestedCount: 10, options: { difficulty: 'expert' } });

    const done = await processGenerationJob(job.jobId, { store });
    const bodies = requestBodies(handleGenerateQuiz);
    const contracts = laneContracts(handleGenerateQuiz);

    expect(done.status).toBe('complete');
    expect(done.generationProfile).toMatchObject({
      quizLane: 'EXACT_STUDY',
      scenarioRatio: 0.6,
      curveballCount: 1,
    });
    expect(new Set(contracts.map((contract) => contract.quizLane))).toEqual(new Set(['EXACT_STUDY']));
    expect(contracts.filter((contract) => contract.curveball)).toHaveLength(1);
    expect(contracts.reduce((sum, contract) => sum + Number(contract.curveballCount || 0), 0)).toBe(1);
    expect(contracts.filter((contract) => contract.scenario).reduce((sum, contract, index) => sum + bodies[index].count, 0)).toBeLessThanOrEqual(6);
    expect(contracts.every((contract) => contract.questionType === 'TF')).toBe(true);
    expect(bodies.every((body) => body.count === plannedMarkerCount(body.sourceText))).toBe(true);
    expect(bodies.every((body) => !body.types.includes('MT'))).toBe(true);
  });

  test('malformed MT mapping is rejected before counting and valid MT is accepted', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines([malformedMtLine(1), mtLine(2)]))
      .mockResolvedValueOnce(okLines([tfLine(3)]));
    const job = await createWorkerJob([
      plannedSectionBatch(1, 2, ['MC']),
    ], { requestedCount: 2, options: { difficulty: 'easy' } });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(done.questions.length);
    expect(done.questions).toEqual([mtLine(2), tfLine(3)]);
    expect(done.questions).not.toContain(malformedMtLine(1));
    expect(done.failedBatches[0]).toMatchObject({
      batchId: 'profile-batch-1',
      requestedCount: 2,
      rawLineCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      rejectedReasons: { invalid_mt_mapping: 1 },
    });
  });

  test('obvious semantic duplicate stems are rejected before counting', async () => {
    const original = 'TF|How does distribution layer integrate access switches with the campus core during design?|T';
    const duplicate = 'YN|Why does distribution layer integrate access switches with the campus core during design?|Y';
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines([original, duplicate]))
      .mockResolvedValueOnce(okLines(tfLine(3)));
    const job = await createWorkerJob([
      plannedSectionBatch(1, 2, ['TF']),
    ], { requestedCount: 2, options: { difficulty: 'easy' } });

    const done = await processGenerationJob(job.jobId, { store });

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(done.questions.length);
    expect(done.questions).toEqual([original, tfLine(3)]);
    expect(done.questions).not.toContain(duplicate);
    expect(done.failedBatches[0]).toMatchObject({
      batchId: 'profile-batch-1',
      requestedCount: 2,
      rawLineCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      rejectedReasons: { duplicate_stem: 1 },
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
      batchId: 'profile-batch-1',
      message: 'A provider request timed out.',
      requestedCount: 1,
    });
    const bodies = requestBodies(handleGenerateQuiz);
    expect(bodies[1].sourceText).toContain('source 2');
    expect(plannedMarkerCount(bodies[1].sourceText)).toBe(1);
    expect(bodies[2].sourceText).toContain('Planned question 1');
    expect(bodies[2].sourceText).toContain('source 1');
  });

  test('fill batch target five has matching planned fill context and stops at requested count', async () => {
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines([tfLine(1), tfLine(2)]))
      .mockResolvedValueOnce(okLines(tfLine(3)))
      .mockResolvedValueOnce(okLines('not a quiz line'))
      .mockResolvedValueOnce(okLines('not a quiz line'))
      .mockResolvedValueOnce(okLines([tfLine(4), tfLine(5), tfLine(6), tfLine(7), tfLine(8)]))
      .mockResolvedValueOnce(okLines([tfLine(9), tfLine(10), tfLine(11)]));
    const job = await createWorkerJob([
      plannedSectionBatch(1, 5, ['TF']),
      plannedSectionBatch(2, 5, ['TF']),
    ], { requestedCount: 10, options: { difficulty: 'easy' } });

    const done = await processGenerationJob(job.jobId, { store });
    const bodies = requestBodies(handleGenerateQuiz);
    const contracts = laneContracts(handleGenerateQuiz);

    expect(done.status).toBe('complete');
    expect(done.completedCount).toBe(10);
    expect(done.questions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(tfLine));
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(6);
    expect(bodies.map((body) => body.count)).toEqual([3, 3, 3, 1, 5, 2]);
    for (const [index, body] of bodies.entries()) {
      const plannedCount = plannedMarkerCount(body.sourceText);
      expect(plannedCount).toBeGreaterThan(0);
      expect(body.count).toBe(plannedCount);
      expect(contracts[index].quizLane).toBe('EXACT_STUDY');
    }
    expect(bodies[4].sourceText).toContain('batch-1 > Section 1-3');
    expect(bodies[5].sourceText).toContain('batch-1 > Section 1-5');
    expect(done.questions).not.toContain(tfLine(11));
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
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(8);
    expect(done.failedBatches).toHaveLength(8);
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
    expect(done.completedCount).toBe(3);
    expect(done.questions).toEqual(lines.slice(0, 3));
    expect(done.progressMessage).toBe('Generation stopped. 3 of 10 questions ready.');
    expect(handleGenerateQuiz).toHaveBeenCalledTimes(1);
  });

  test('stop during fill preserves generated questions and ends the job', async () => {
    const pendingFill = createDeferred();
    handleGenerateQuiz
      .mockResolvedValueOnce(okLines(tfLine(1)))
      .mockReturnValueOnce(pendingFill.promise);
    const job = await createWorkerJob([
      { batchId: 'batch-1', batchNo: 1, count: 3, sourceText: 'source 1', types: ['TF'] },
    ], { requestedCount: 3, options: { difficulty: 'easy' } });

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
