'use strict';

const { handleGenerateQuiz } = require('../generate-quiz.js');
const { scrubStoredJobPayload } = require('./asyncJobStore.js');
const { parseLegacyQuestion } = require('./normalizer.js');

function splitLines(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanStem(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function normalizedStem(raw) {
  return cleanStem(raw)
    .replace(/\s+([?!.,:;])/g, '$1')
    .toLowerCase();
}

function questionStemFromLine(line) {
  const parsed = parseLegacyQuestion(line);
  if (!parsed) return '';
  const parts = String(line || '').split('|');
  return cleanStem(parts.length > 1 ? parts[1] : '');
}

function createCollectionState(job) {
  const seenKeys = new Set();
  const avoidStems = [];
  const seed = Array.isArray(job && job.options && job.options.avoidStems) ? job.options.avoidStems : [];
  for (const stem of seed) {
    const cleaned = cleanStem(stem);
    const key = normalizedStem(cleaned);
    if (!cleaned || !key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    avoidStems.push(cleaned);
  }
  for (const line of Array.isArray(job && job.questions) ? job.questions : []) {
    const stem = questionStemFromLine(line);
    const key = normalizedStem(stem);
    if (!stem || !key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    avoidStems.push(stem);
  }
  return { seenKeys, avoidStems };
}

function collectUniqueQuizLines(rawLines, state, limit) {
  const accepted = [];
  for (const line of splitLines(rawLines)) {
    if (!parseLegacyQuestion(line)) continue;
    const stem = questionStemFromLine(line);
    const key = normalizedStem(stem);
    if (!stem || !key || state.seenKeys.has(key)) continue;
    state.seenKeys.add(key);
    state.avoidStems.push(stem);
    accepted.push(line);
    if (accepted.length >= limit) break;
  }
  return accepted;
}

function safeError(err) {
  const status = Number(err && err.status || 0);
  const code = err && err.code ? String(err.code) : '';
  const msg = String(err && err.message || err || 'Generation failed');
  if (status === 504 || code === 'PROVIDER_TIMEOUT' || /timeout/i.test(msg)) {
    return { code: 'PROVIDER_TIMEOUT', message: 'A provider request timed out.' };
  }
  if (status === 429 || /quota|rate limit|429/i.test(msg)) {
    return { code: 'RATE_LIMITED', message: 'A provider rate limit interrupted one batch.' };
  }
  if (/canceled|cancelled/i.test(msg)) {
    return { code: 'CANCELED', message: 'Generation canceled.' };
  }
  return { code: code || 'BATCH_FAILED', message: 'A generation batch failed.' };
}

function errorFromGenerateResponse(response) {
  let body = {};
  try { body = response && response.body ? JSON.parse(response.body) : {}; } catch {}
  const err = new Error(String(body.details || body.error || `Generation failed with status ${response.statusCode}`));
  err.status = response && response.statusCode;
  err.code = body.code;
  return err;
}

async function runGenerateBatch(job, batch, state) {
  const options = job.options || {};
  const payload = {
    topic: job.topic,
    count: batch.count,
    types: Array.isArray(batch.types) && batch.types.length ? batch.types : options.types,
    difficulty: options.difficulty,
    provider: options.provider,
    model: options.model,
    sourceName: options.sourceName,
    sourceText: batch.sourceText || '',
    avoidStems: state.avoidStems.slice(-60),
    format: 'legacy-lines',
  };
  if (!payload.sourceText) delete payload.sourceText;
  if (!payload.sourceName) delete payload.sourceName;
  if (!payload.model) delete payload.model;
  const response = await handleGenerateQuiz({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(payload),
  }, { skipRateLimit: true });
  if (!response || response.statusCode < 200 || response.statusCode >= 300) {
    throw errorFromGenerateResponse(response || { statusCode: 500, body: '{}' });
  }
  return response.body ? JSON.parse(response.body) : {};
}

function retrySinglesForBatch(batch) {
  const plannedEntries = Array.isArray(batch && batch.plannedEntries) ? batch.plannedEntries : [];
  if (plannedEntries.length) {
    return plannedEntries.map((entry, index) => ({
      batchId: `${batch.batchId || 'batch'}-retry-${index + 1}`,
      batchNo: batch.batchNo,
      kind: `${batch.kind || 'batch'}-retry`,
      count: 1,
      retry: true,
      sourceText: String(entry && entry.sourceText || batch.sourceText || '').trim(),
      types: Array.isArray(entry && entry.types) && entry.types.length ? entry.types : (entry && entry.plannedType ? [entry.plannedType] : batch.types),
      plannedEntries: [entry],
    }));
  }
  const count = Math.max(1, parseInt(batch && batch.count || 1, 10) || 1);
  if (count <= 1) return [];
  return Array.from({ length: count }, (_, index) => ({
    batchId: `${batch.batchId || 'batch'}-retry-${index + 1}`,
    batchNo: batch.batchNo,
    kind: `${batch.kind || 'batch'}-retry`,
    count: 1,
    retry: true,
    sourceText: String(batch && batch.sourceText || '').trim(),
    types: Array.isArray(batch && batch.types) && batch.types.length
      ? [batch.types[index % batch.types.length]]
      : batch && batch.types,
  }));
}

async function appendSuccessfulLines(store, jobId, lines, body, message) {
  return store.updateJob(jobId, (job) => {
    if (job.status === 'canceled') return job;
    const existing = Array.isArray(job.questions) ? job.questions : [];
    const nextQuestions = existing.concat(lines).slice(0, job.requestedCount);
    return {
      ...job,
      status: 'running',
      title: job.title || body.title || '',
      provider: job.provider || body.provider || '',
      model: job.model || body.model || '',
      questions: nextQuestions,
      completedCount: nextQuestions.length,
      progressMessage: message || `${nextQuestions.length} of ${job.requestedCount} questions ready.`,
    };
  });
}

async function recordBatchFailure(store, jobId, batch, err, completedCount, retry = false) {
  const safe = safeError(err);
  return store.updateJob(jobId, (job) => {
    if (job.status === 'canceled') return job;
    return {
      ...job,
      failedBatches: [
        ...(Array.isArray(job.failedBatches) ? job.failedBatches : []),
        {
          batchId: batch && batch.batchId || '',
          batchNo: Number(batch && batch.batchNo || 0),
          requestedCount: Number(batch && batch.count || 0),
          completedCount: Number(completedCount || 0),
          retry,
          message: safe.message,
        },
      ],
      errors: [
        ...(Array.isArray(job.errors) ? job.errors : []),
        safe,
      ].slice(-10),
      progressMessage: retry ? 'Retrying a failed batch as single-question requests.' : 'One batch failed; continuing with the remaining batches.',
    };
  });
}

async function markFinal(store, jobId) {
  return store.updateJob(jobId, (job) => {
    const completed = Array.isArray(job.questions) ? job.questions.length : Number(job.completedCount || 0);
    if (job.status === 'canceled') {
      return {
        ...scrubStoredJobPayload(job),
        completedCount: completed,
        progressMessage: 'Generation canceled.',
      };
    }
    if (completed >= Number(job.requestedCount || 0)) {
      return {
        ...scrubStoredJobPayload(job),
        status: 'complete',
        completedCount: completed,
        questions: job.questions.slice(0, job.requestedCount),
        progressMessage: `Quiz ready with ${job.requestedCount} of ${job.requestedCount} questions.`,
      };
    }
    if (completed > 0) {
      return {
        ...scrubStoredJobPayload(job),
        status: 'partial',
        completedCount: completed,
        progressMessage: `Quiz ready with ${completed} of ${job.requestedCount} questions.`,
      };
    }
    return {
      ...scrubStoredJobPayload(job),
      status: 'failed',
      completedCount: 0,
      progressMessage: 'Generation failed before any usable questions were created.',
      errors: [
        ...(Array.isArray(job.errors) ? job.errors : []),
        { code: 'ZERO_USABLE_QUESTIONS', message: 'No usable quiz questions were generated.' },
      ].slice(-10),
    };
  });
}

async function processOneBatch(store, job, batch, state) {
  const latest = await store.getJob(job.jobId);
  if (!latest || latest.status === 'expired') return { stopped: true };
  if (latest.status === 'canceled') {
    await markFinal(store, job.jobId);
    return { stopped: true };
  }

  await store.updateJob(job.jobId, (current) => ({
    ...current,
    status: 'running',
    progressMessage: `Generating batch ${batch.batchNo} of ${job.plannedBatches.length}. ${current.completedCount || 0} of ${current.requestedCount} questions ready.`,
  }));

  try {
    const body = await runGenerateBatch(job, batch, state);
    const remaining = Math.max(0, job.requestedCount - state.acceptedCount);
    const accepted = collectUniqueQuizLines(body.lines, state, remaining);
    state.acceptedCount += accepted.length;
    if (accepted.length) {
      await appendSuccessfulLines(
        store,
        job.jobId,
        accepted,
        body,
        `${state.acceptedCount} of ${job.requestedCount} questions ready.`
      );
    }
    if (accepted.length < Number(batch.count || 0)) {
      const err = new Error('A generation batch returned fewer usable questions than requested.');
      err.code = 'BATCH_SHORTFALL';
      await recordBatchFailure(store, job.jobId, batch, err, accepted.length, !!batch.retry);
    }
    return { stopped: false };
  } catch (err) {
    await recordBatchFailure(store, job.jobId, batch, err, 0, !!batch.retry);
    if (!batch.retry) {
      const retries = retrySinglesForBatch(batch);
      for (const single of retries) {
        const retryResult = await processOneBatch(store, job, single, state);
        if (retryResult.stopped || state.acceptedCount >= job.requestedCount) return retryResult;
      }
    }
    return { stopped: false };
  }
}

async function processGenerationJob(jobId, options = {}) {
  const store = options.store;
  if (!store) throw new Error('processGenerationJob requires a job store');
  let job = await store.getJob(jobId);
  if (!job || job.status === 'expired') return job;
  if (job.status === 'canceled') return markFinal(store, job.jobId);
  if (!Array.isArray(job.plannedBatches) || !job.plannedBatches.length) {
    return store.updateJob(job.jobId, (current) => ({
      ...current,
      status: 'failed',
      progressMessage: 'Generation failed because no batches were planned.',
      errors: [{ code: 'NO_PLANNED_BATCHES', message: 'No generation batches were planned.' }],
    }));
  }

  job = await store.updateJob(job.jobId, (current) => ({
    ...current,
    status: 'running',
    progressMessage: 'Generation started.',
  }));

  const state = createCollectionState(job);
  state.acceptedCount = Number(job.completedCount || 0);
  for (const batch of job.plannedBatches) {
    if (state.acceptedCount >= job.requestedCount) break;
    const result = await processOneBatch(store, job, batch, state);
    if (result.stopped) return store.getJob(job.jobId);
  }
  return markFinal(store, job.jobId);
}

module.exports = {
  collectUniqueQuizLines,
  processGenerationJob,
  retrySinglesForBatch,
  safeError,
};
