'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeGenerationProfile } = require('./asyncGenerationPlanner.js');

const STORE_NAME = 'async-generation-jobs';
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const EXPIRED_MESSAGE = 'This generation job expired. Start a new quiz.';
const VALID_STATUSES = new Set(['queued', 'running', 'partial', 'complete', 'failed', 'stopped', 'canceled', 'expired']);
const JOB_UPDATE_LOCKS = new Map();
const WORKER_TOKEN_BYTES = 24;

function nowMs() {
  return Date.now();
}

function iso(ms = nowMs()) {
  return new Date(ms).toISOString();
}

function ttlMs(env = process.env) {
  const parsed = parseInt(env.ASYNC_GENERATION_JOB_TTL_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_MS;
  return Math.max(5 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, parsed));
}

function makeJobId() {
  return `qj_${crypto.randomBytes(24).toString('base64url')}`;
}

function makeWorkerToken() {
  return crypto.randomBytes(WORKER_TOKEN_BYTES).toString('base64url');
}

function hashWorkerToken(raw) {
  const token = String(raw || '').trim();
  if (!/^[A-Za-z0-9_-]{24,96}$/.test(token)) return '';
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function workerTokenMatches(job, raw) {
  const expected = String(job && job.workerTokenHash || '');
  const actual = hashWorkerToken(raw);
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length
    && crypto.timingSafeEqual(expectedBytes, actualBytes);
}

function sanitizeJobId(raw) {
  const value = String(raw || '').trim();
  return /^qj_[A-Za-z0-9_-]{24,96}$/.test(value) ? value : '';
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function jobExpired(job, atMs = nowMs()) {
  const expiresAt = Date.parse(job && job.expiresAt || '');
  return Number.isFinite(expiresAt) && expiresAt <= atMs;
}

function expiredJob(jobId, job) {
  return {
    jobId,
    createdAt: job && job.createdAt || iso(),
    updatedAt: iso(),
    expiresAt: job && job.expiresAt || iso(),
    status: 'expired',
    topic: job && job.topic || '',
    requestedCount: Number(job && job.requestedCount || 0),
    completedCount: 0,
    sourceName: job && job.sourceName || '',
    questions: [],
    failedBatches: [],
    errors: [{ message: EXPIRED_MESSAGE }],
    progressMessage: EXPIRED_MESSAGE,
    stopped: false,
    generationProfile: null,
    workerTokenHash: job && job.workerTokenHash || '',
    options: {},
    plannedBatches: [],
  };
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return VALID_STATUSES.has(value) ? value : 'queued';
}

function createJobRecord(input = {}, env = process.env) {
  const now = nowMs();
  const jobId = sanitizeJobId(input.jobId) || makeJobId();
  const requestedCount = Math.max(1, Math.min(100, parseInt(input.requestedCount || input.count || 10, 10) || 10));
  return {
    jobId,
    createdAt: iso(now),
    updatedAt: iso(now),
    expiresAt: iso(now + ttlMs(env)),
    status: normalizeStatus(input.status || 'queued'),
    topic: String(input.topic || 'General knowledge').trim() || 'General knowledge',
    requestedCount,
    completedCount: 0,
    sourceName: String(input.sourceName || '').trim().slice(0, 160),
    questions: [],
    failedBatches: [],
    errors: [],
    progressMessage: 'Generation job queued.',
    stopped: false,
    generationProfile: input.generationProfile ? safeGenerationProfile(input.generationProfile) : null,
    workerTokenHash: /^[A-Za-z0-9_-]{43}$/.test(String(input.workerTokenHash || ''))
      ? String(input.workerTokenHash)
      : '',
    options: clone(input.options || {}),
    plannedBatches: clone(input.plannedBatches || []),
  };
}

function stoppedProgressMessage(completed, requested) {
  const ready = Number(completed || 0);
  const target = Number(requested || 0);
  if (ready > 0 && target > ready) return `Generation stopped. ${ready} of ${target} questions ready.`;
  if (ready > 0) return `Generation stopped. ${ready} ${ready === 1 ? 'question' : 'questions'} ready.`;
  return 'Generation stopped before any questions were ready.';
}

function safeBatchFailure(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const rejectedReasons = entry.rejectedReasons && typeof entry.rejectedReasons === 'object'
    ? Object.fromEntries(Object.entries(entry.rejectedReasons)
      .map(([key, value]) => [String(key).slice(0, 80), Number(value || 0)])
      .filter(([key, value]) => key && value > 0))
    : {};
  return {
    batchId: String(entry.batchId || '').slice(0, 80),
    batchNo: Number(entry.batchNo || 0),
    quizLane: String(entry.quizLane || '').slice(0, 40),
    contractFlavor: String(entry.contractFlavor || '').slice(0, 80),
    questionType: String(entry.questionType || '').slice(0, 12),
    scenario: !!entry.scenario,
    curveball: !!entry.curveball,
    requestedCount: Number(entry.requestedCount || 0),
    rawLineCount: Number(entry.rawLineCount || 0),
    acceptedCount: Number(entry.acceptedCount || 0),
    rejectedCount: Number(entry.rejectedCount || 0),
    rejectedReasons,
    completedCount: Number(entry.completedCount || 0),
    retry: !!entry.retry,
    fill: !!entry.fill,
    kind: String(entry.kind || '').slice(0, 60),
    message: String(entry.message || 'A generation batch failed.').slice(0, 220),
  };
}

function safeError(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { message: entry.slice(0, 220) };
  if (typeof entry === 'object') {
    return {
      code: entry.code ? String(entry.code).slice(0, 80) : undefined,
      message: String(entry.message || 'Generation failed.').slice(0, 220),
    };
  }
  return { message: 'Generation failed.' };
}

function publicJobStatus(job) {
  const safeQuestions = Array.isArray(job && job.questions)
    ? job.questions.map((line) => String(line || '').trim()).filter(Boolean)
    : [];
  const status = normalizeStatus(job && job.status);
  const body = {
    jobId: job && job.jobId || '',
    createdAt: job && job.createdAt || '',
    updatedAt: job && job.updatedAt || '',
    expiresAt: job && job.expiresAt || '',
    status,
    topic: job && job.topic || '',
    requestedCount: Number(job && job.requestedCount || 0),
    completedCount: Number(job && job.completedCount || safeQuestions.length || 0),
    sourceName: job && job.sourceName || '',
    title: job && job.title || '',
    stopped: status === 'stopped' || !!(job && job.stopped),
    progressMessage: job && job.progressMessage || '',
    generationProfile: job && job.generationProfile ? safeGenerationProfile(job.generationProfile) : null,
    failedBatches: (Array.isArray(job && job.failedBatches) ? job.failedBatches : [])
      .map(safeBatchFailure)
      .filter(Boolean),
    errors: (Array.isArray(job && job.errors) ? job.errors : [])
      .map(safeError)
      .filter(Boolean),
  };
  if (safeQuestions.length) {
    body.questions = safeQuestions;
    body.lines = safeQuestions.join('\n');
  }
  return body;
}

function scrubStoredJobPayload(job) {
  const options = job && job.options && typeof job.options === 'object' ? job.options : {};
  const { sourceText, sourceReport, avoidStems, ...safeOptions } = options;
  const {
    workerLeaseId,
    workerLeaseExpiresAt,
    ...safeJob
  } = job || {};
  return {
    ...safeJob,
    options: safeOptions,
    plannedBatches: [],
  };
}

class FileJobAdapter {
  constructor(options = {}) {
    const env = options.env || process.env;
    const defaultDir = env.NETLIFY_DEV || env.CONTEXT === 'dev'
      ? path.join(process.cwd(), '.netlify', 'async-generation-jobs')
      : path.join(os.tmpdir(), 'ez-quiz-async-generation-jobs');
    this.dir = options.dir || env.ASYNC_GENERATION_JOB_DIR || defaultDir;
  }

  filePath(jobId) {
    const safe = sanitizeJobId(jobId);
    if (!safe) throw new Error('Invalid jobId');
    return path.join(this.dir, `${safe}.json`);
  }

  async get(jobId) {
    try {
      const raw = await fs.readFile(this.filePath(jobId), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async set(jobId, job) {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.filePath(jobId);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(job, null, 2), 'utf8');
    await fs.rename(temp, target);
  }

  async delete(jobId) {
    try {
      await fs.unlink(this.filePath(jobId));
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
  }
}

class NetlifyBlobsJobAdapter {
  constructor(options = {}) {
    const blobs = require('@netlify/blobs');
    if (options.event && options.event.blobs && typeof blobs.connectLambda === 'function') {
      blobs.connectLambda(options.event);
    }
    this.store = blobs.getStore(STORE_NAME);
    this.recentReads = new Map();
    this.recentVersions = new Map();
    this.recentWrites = new Map();
  }

  newerRecord(remote, cached) {
    if (!cached) return remote;
    if (!remote) return cached;
    const remoteUpdated = Date.parse(remote.job && remote.job.updatedAt || '');
    const cachedUpdated = Date.parse(cached.job && cached.job.updatedAt || '');
    return Number.isFinite(cachedUpdated) && (!Number.isFinite(remoteUpdated) || cachedUpdated >= remoteUpdated)
      ? cached
      : remote;
  }

  async get(jobId) {
    const safe = sanitizeJobId(jobId);
    if (!safe) return null;
    const job = await this.store.get(safe, { type: 'json' });
    if (job) this.recentReads.set(safe, { job });
    const visible = job ? { job } : this.recentReads.get(safe);
    const record = this.newerRecord(visible, this.recentWrites.get(safe));
    return record && record.job || null;
  }

  async getVersioned(jobId) {
    const safe = sanitizeJobId(jobId);
    if (!safe) return null;
    const result = await this.store.getWithMetadata(safe, { type: 'json' });
    const remote = result ? { job: result.data, version: result.etag } : null;
    const visible = this.newerRecord(remote, this.recentVersions.get(safe));
    if (visible) {
      this.recentReads.set(safe, { job: visible.job });
      this.recentVersions.set(safe, visible);
    }
    return this.newerRecord(visible, this.recentWrites.get(safe));
  }

  async set(jobId, job) {
    const safe = sanitizeJobId(jobId);
    if (!safe) throw new Error('Invalid jobId');
    const result = await this.store.setJSON(safe, job, {
      metadata: {
        expiresAt: job && job.expiresAt || '',
        status: job && job.status || '',
      },
    });
    this.recentReads.set(safe, { job });
    if (result && result.etag) {
      this.recentVersions.set(safe, { job, version: result.etag });
      this.recentWrites.set(safe, { job, version: result.etag });
    }
  }

  async setIfVersion(jobId, job, version) {
    const safe = sanitizeJobId(jobId);
    if (!safe || !version) return false;
    const result = await this.store.setJSON(safe, job, {
      onlyIfMatch: version,
      metadata: {
        expiresAt: job && job.expiresAt || '',
        status: job && job.status || '',
      },
    });
    const modified = !!(result && result.modified);
    if (modified) this.recentReads.set(safe, { job });
    if (modified && result.etag) {
      this.recentVersions.set(safe, { job, version: result.etag });
      this.recentWrites.set(safe, { job, version: result.etag });
    }
    if (!modified) {
      this.recentVersions.delete(safe);
      this.recentWrites.delete(safe);
    }
    return modified;
  }

  async delete(jobId) {
    const safe = sanitizeJobId(jobId);
    if (!safe) return;
    this.recentReads.delete(safe);
    this.recentVersions.delete(safe);
    this.recentWrites.delete(safe);
    await this.store.delete(safe);
  }
}

function useFileAdapter(env = process.env) {
  const forced = String(env.ASYNC_GENERATION_STORE || '').trim().toLowerCase();
  if (forced === 'file') return true;
  if (forced === 'blobs') return false;
  if (env.NODE_ENV === 'test') return true;
  if (env.NETLIFY_DEV || env.CONTEXT === 'dev') return true;
  return env.NETLIFY !== 'true';
}

class GenerationJobStore {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.adapter = options.adapter || (useFileAdapter(this.env)
      ? new FileJobAdapter(options)
      : new NetlifyBlobsJobAdapter(options));
  }

  async withUpdateLock(jobId, callback) {
    const previous = JOB_UPDATE_LOCKS.get(jobId) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    JOB_UPDATE_LOCKS.set(jobId, queued);
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (JOB_UPDATE_LOCKS.get(jobId) === queued) JOB_UPDATE_LOCKS.delete(jobId);
    }
  }

  prepareSavedJob(job, safeJobId) {
    return {
      ...clone(job),
      jobId: safeJobId,
      status: normalizeStatus(job.status),
      updatedAt: iso(),
    };
  }

  async createJob(input) {
    const job = createJobRecord(input, this.env);
    await this.adapter.set(job.jobId, job);
    return job;
  }

  async getJob(jobId) {
    const safe = sanitizeJobId(jobId);
    if (!safe) return null;
    const job = await this.adapter.get(safe);
    if (!job) return null;
    if (jobExpired(job)) {
      await this.adapter.delete(safe);
      return expiredJob(safe, job);
    }
    return job;
  }

  async getJobWithRetry(jobId, options = {}) {
    const safe = sanitizeJobId(jobId);
    if (!safe) return null;
    const parsedAttempts = Number(options.attempts);
    const parsedDelayMs = Number(options.delayMs);
    const attempts = Number.isFinite(parsedAttempts) ? Math.max(1, Math.floor(parsedAttempts)) : 1;
    const delayMs = Number.isFinite(parsedDelayMs) ? Math.max(0, parsedDelayMs) : 0;
    const supportsVersionedRead = typeof this.adapter.getVersioned === 'function';
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const versioned = supportsVersionedRead ? await this.adapter.getVersioned(safe) : null;
      const job = supportsVersionedRead
        ? versioned && versioned.job
        : await this.adapter.get(safe);
      if (job) {
        if (jobExpired(job)) {
          await this.adapter.delete(safe);
          return expiredJob(safe, job);
        }
        return job;
      }
      if (attempt < attempts - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
    return null;
  }

  async saveJob(job) {
    const safe = sanitizeJobId(job && job.jobId);
    if (!safe) throw new Error('Invalid jobId');
    const next = this.prepareSavedJob(job, safe);
    await this.adapter.set(safe, next);
    return next;
  }

  async updateJob(jobId, updater) {
    const safe = sanitizeJobId(jobId);
    if (!safe) return null;
    return this.withUpdateLock(safe, async () => {
      const supportsConditionalWrite = typeof this.adapter.getVersioned === 'function'
        && typeof this.adapter.setIfVersion === 'function';
      const attempts = supportsConditionalWrite ? 8 : 1;
      let sawCurrent = false;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const versioned = supportsConditionalWrite ? await this.adapter.getVersioned(safe) : null;
        if (supportsConditionalWrite && !versioned) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        const current = supportsConditionalWrite
          ? versioned && versioned.job
          : await this.getJob(safe);
        if (!current) return null;
        sawCurrent = true;
        if (jobExpired(current)) {
          await this.adapter.delete(safe);
          return expiredJob(safe, current);
        }
        if (current.status === 'expired') return current;
        const draft = clone(current);
        const updated = await updater(draft);
        if (updated === null) return null;
        const next = this.prepareSavedJob(updated || draft, safe);
        if (!supportsConditionalWrite) {
          await this.adapter.set(safe, next);
          return next;
        }
        if (await this.adapter.setIfVersion(safe, next, versioned.version)) return next;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
      if (!sawCurrent) return null;
      const err = new Error('Generation job changed too many times; retry the request.');
      err.code = 'JOB_UPDATE_CONFLICT';
      throw err;
    });
  }

  async cancelJob(jobId) {
    return this.stopJob(jobId);
  }

  async stopJob(jobId) {
    return this.updateJob(jobId, (job) => {
      const completed = Array.isArray(job.questions) ? job.questions.length : Number(job.completedCount || 0);
      return {
        ...scrubStoredJobPayload(job),
        status: 'stopped',
        stopped: true,
        stoppedAt: iso(),
        completedCount: completed,
        progressMessage: stoppedProgressMessage(completed, job.requestedCount),
      };
    });
  }
}

function createGenerationJobStore(options = {}) {
  return new GenerationJobStore(options);
}

module.exports = {
  DEFAULT_TTL_MS,
  EXPIRED_MESSAGE,
  FileJobAdapter,
  GenerationJobStore,
  NetlifyBlobsJobAdapter,
  STORE_NAME,
  createGenerationJobStore,
  createJobRecord,
  expiredJob,
  hashWorkerToken,
  jobExpired,
  makeWorkerToken,
  publicJobStatus,
  sanitizeJobId,
  scrubStoredJobPayload,
  stoppedProgressMessage,
  ttlMs,
  workerTokenMatches,
};
