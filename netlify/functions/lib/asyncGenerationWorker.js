'use strict';

const crypto = require('node:crypto');
const { handleGenerateQuiz } = require('../generate-quiz.js');
const { scrubStoredJobPayload, stoppedProgressMessage } = require('./asyncJobStore.js');
const {
  buildProfiledBatches,
  buildSectionBatchSourceText,
  createDefaultGenerationProfile,
  safeGenerationProfile,
} = require('./asyncGenerationPlanner.js');
const { parseLegacyQuestion } = require('./normalizer.js');
const { isSemanticDuplicateStem } = require('./semanticDuplicates.js');

const FILL_PASS_MAX_ATTEMPTS = 6;
const FILL_PASS_BATCH_TARGET = 5;
const WORKER_LEASE_MS = 2 * 60 * 1000;

function isStopStatus(status) {
  return /^(stopped|canceled)$/i.test(String(status || ''));
}

function isTerminalStatus(status) {
  return /^(complete|partial|failed|expired)$/i.test(String(status || ''));
}

function workerLeaseExpiresAt(now = Date.now()) {
  return new Date(now + WORKER_LEASE_MS).toISOString();
}

function hasActiveWorkerLease(job, now = Date.now()) {
  const expiresAt = Date.parse(job && job.workerLeaseExpiresAt || '');
  return !!String(job && job.workerLeaseId || '') && Number.isFinite(expiresAt) && expiresAt > now;
}

function ownsWorkerLease(job, workerId) {
  return !!workerId && String(job && job.workerLeaseId || '') === String(workerId);
}

async function claimGenerationJob(store, jobId, workerId) {
  const now = Date.now();
  return store.updateJob(jobId, (job) => {
    if (isTerminalStatus(job.status) || isStopStatus(job.status)) return job;
    if (job.status === 'running' && hasActiveWorkerLease(job, now) && !ownsWorkerLease(job, workerId)) return job;
    return {
      ...job,
      status: 'running',
      workerLeaseId: workerId,
      workerLeaseExpiresAt: workerLeaseExpiresAt(now),
      progressMessage: 'Generation started.',
    };
  });
}

async function updateOwnedJob(store, jobId, workerId, updater) {
  return store.updateJob(jobId, (job) => {
    if (isTerminalStatus(job.status) || isStopStatus(job.status) || !ownsWorkerLease(job, workerId)) return job;
    const updated = updater(job) || job;
    return {
      ...updated,
      workerLeaseId: workerId,
      workerLeaseExpiresAt: workerLeaseExpiresAt(),
    };
  });
}

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

function questionStemFromParsed(parsed, line) {
  if (parsed && parsed.prompt) return cleanStem(parsed.prompt);
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

function rejectionReasonForLine(line) {
  const type = String(line || '').split('|')[0].trim().toUpperCase();
  if (type === 'MT') return 'invalid_mt_mapping';
  if (type === 'MC') return 'invalid_mc_answer';
  if (type === 'TF') return 'invalid_true_false';
  if (type === 'YN') return 'invalid_yes_no';
  return 'invalid_format';
}

function summarizeRejections(reasons) {
  return (Array.isArray(reasons) ? reasons : []).reduce((acc, reason) => {
    const key = String(reason || 'invalid_format').trim() || 'invalid_format';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function hasSourceFraming(stem) {
  const text = String(stem || '');
  return /\b(?:according to|based (?:solely )?on)\s+(?:the\s+)?(?:provided\s+)?(?:[\w-]+\s+){0,3}(?:notes?|source material|study material|documentation|document|text|excerpts?|handout|reading|lesson)\b/i.test(text)
    || /\b(?:the\s+)?(?:[\w-]+\s+){0,2}notes?\s+(?:state|states|say|says|indicate|indicates)\b/i.test(text);
}

function collectUniqueQuizLines(rawLines, state, limit, options = {}) {
  const raw = splitLines(rawLines);
  const accepted = [];
  const acceptedRecords = [];
  const localSeen = new Set(state.seenKeys);
  const localStems = Array.isArray(state.avoidStems) ? state.avoidStems.slice() : [];
  const rejectedReasons = [];
  const max = Math.max(0, parseInt(limit, 10) || 0);

  for (const line of raw) {
    const parsed = parseLegacyQuestion(line);
    if (!parsed) {
      rejectedReasons.push(rejectionReasonForLine(line));
      continue;
    }
    const stem = questionStemFromParsed(parsed, line);
    const key = normalizedStem(stem);
    if (!stem || !key) {
      rejectedReasons.push('missing_stem');
      continue;
    }
    if (options.sourceBacked && hasSourceFraming(stem)) {
      rejectedReasons.push('source_framing');
      continue;
    }
    if (localSeen.has(key)) {
      rejectedReasons.push('duplicate_stem');
      continue;
    }
    if (isSemanticDuplicateStem(stem, localStems)) {
      rejectedReasons.push('duplicate_stem');
      continue;
    }
    if (accepted.length >= max) {
      continue;
    }
    localSeen.add(key);
    localStems.push(stem);
    acceptedRecords.push({ key, stem });
    accepted.push(line);
  }

  for (const record of acceptedRecords) {
    state.seenKeys.add(record.key);
    state.avoidStems.push(record.stem);
  }

  return {
    accepted,
    diagnostics: {
      rawLineCount: raw.length,
      acceptedCount: accepted.length,
      rejectedCount: rejectedReasons.length,
      rejectedReasons: summarizeRejections(rejectedReasons),
    },
  };
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
  if (/canceled|cancelled|stopped/i.test(msg)) {
    return { code: 'STOPPED', message: 'Generation stopped.' };
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
  const requestedCount = Math.max(1, parseInt(batch && batch.count || 1, 10) || 1);
  const questionType = batch && batch.questionType
    ? normalizeQuestionType(batch.questionType, '')
    : '';
  const payload = {
    topic: job.topic,
    count: requestedCount,
    types: questionType ? Array.from({ length: requestedCount }, () => questionType) : (Array.isArray(batch.types) && batch.types.length ? batch.types : options.types),
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
  const laneContract = batch && batch.quizLane && questionType ? {
    quizLane: batch.quizLane,
    contractFlavor: batch.contractFlavor,
    questionType,
    scenario: !!batch.scenario,
    curveball: !!batch.curveball,
    curveballCount: Number(batch.curveballCount || 0),
  } : null;
  const response = await handleGenerateQuiz({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(payload),
  }, {
    skipRateLimit: true,
    timeoutMode: 'async-worker',
    asyncWorker: true,
    trustedInternalRequest: true,
    laneContract,
  });
  if (!response || response.statusCode < 200 || response.statusCode >= 300) {
    throw errorFromGenerateResponse(response || { statusCode: 500, body: '{}' });
  }
  return response.body ? JSON.parse(response.body) : {};
}

function positiveBatchCount(value, fallback = 1) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function plannedEntryCount(batch) {
  return Array.isArray(batch && batch.plannedEntries)
    ? batch.plannedEntries.filter(Boolean).length
    : 0;
}

function isSourceBackedBatch(batch) {
  return !!String(batch && batch.sourceText || '').trim();
}

function acceptedTargetForBatch(batch, remaining) {
  const planned = plannedEntryCount(batch);
  const requested = planned > 0
    ? Math.min(positiveBatchCount(batch && batch.count, planned), planned)
    : positiveBatchCount(batch && batch.count, 1);
  const left = Math.max(0, parseInt(remaining, 10) || 0);
  return Math.max(0, Math.min(requested, left));
}

function providerRequestedCountForBatch(batch, remaining) {
  const target = acceptedTargetForBatch(batch, remaining);
  return target > 0 ? target : 0;
}

function fillSourceKey(batch) {
  const id = String(batch && batch.batchId || '').trim();
  if (id) return id;
  return `${String(batch && batch.kind || 'batch')}::${String(batch && batch.sourceText || '').slice(0, 200)}`;
}

function rememberFillSource(state, batch, reason, details = {}) {
  if (!state || !isSourceBackedBatch(batch)) return;
  if (!state.fillSources) state.fillSources = [];
  if (!state.fillSourceKeys) state.fillSourceKeys = new Set();
  const key = fillSourceKey(batch);
  if (!key || state.fillSourceKeys.has(key)) return;
  const plannedEntries = Array.isArray(batch && batch.plannedEntries) ? batch.plannedEntries.filter(Boolean) : [];
  const acceptedCount = Math.max(0, parseInt(details.acceptedCount || 0, 10) || 0);
  const preferredEntries = plannedEntries.slice(Math.min(acceptedCount, plannedEntries.length));
  state.fillSourceKeys.add(key);
  state.fillSources.push({
    batch: preferredEntries.length ? { ...batch, fillPreferredEntries: preferredEntries } : batch,
    reason: String(reason || 'shortfall'),
  });
}

function normalizeQuestionType(raw, fallback = 'TF') {
  const type = String(raw || '').trim().toUpperCase();
  return /^(MC|TF|YN|MT)$/.test(type) ? type : fallback;
}

function fillTypeForIndex(sourceBatch, sourceEntry, index) {
  const batchTypes = Array.isArray(sourceBatch && sourceBatch.types) ? sourceBatch.types : [];
  if (batchTypes.length) return normalizeQuestionType(batchTypes[index % batchTypes.length]);
  const entryTypes = Array.isArray(sourceEntry && sourceEntry.types) ? sourceEntry.types : [];
  if (entryTypes.length) return normalizeQuestionType(entryTypes[0]);
  return normalizeQuestionType(sourceEntry && sourceEntry.plannedType);
}

function sourceTextForFillEntry(sourceBatch, sourceEntry) {
  return String(
    sourceEntry && (sourceEntry.sectionText || sourceEntry.sourceText)
      || sourceBatch && sourceBatch.sourceText
      || ''
  ).trim();
}

function createFillPlannedEntries(sourceBatch, target, profile) {
  const requested = Math.max(1, Math.min(FILL_PASS_BATCH_TARGET, positiveBatchCount(target, 1)));
  const safeProfile = profile ? safeGenerationProfile(profile) : null;
  const preferredEntries = Array.isArray(sourceBatch && sourceBatch.fillPreferredEntries)
    ? sourceBatch.fillPreferredEntries.filter(Boolean)
    : [];
  const baseEntries = preferredEntries.length
    ? preferredEntries
    : Array.isArray(sourceBatch && sourceBatch.plannedEntries) && sourceBatch.plannedEntries.length
      ? sourceBatch.plannedEntries.filter(Boolean)
    : [{
        sourceText: String(sourceBatch && sourceBatch.sourceText || '').trim(),
        sectionText: String(sourceBatch && sourceBatch.sourceText || '').trim(),
        headingPath: sourceBatch && sourceBatch.kind ? `${sourceBatch.kind} fill` : 'Fill source',
      }];
  if (!baseEntries.length) return [];

  return Array.from({ length: requested }, (_, index) => {
    const sourceEntry = baseEntries[index % baseEntries.length] || {};
    const profileTypes = safeProfile && Array.isArray(safeProfile.allowedTypes) && safeProfile.allowedTypes.length
      ? safeProfile.allowedTypes
      : null;
    const plannedType = profileTypes
      ? normalizeQuestionType(sourceBatch && sourceBatch.questionType || profileTypes[index % profileTypes.length])
      : fillTypeForIndex(sourceBatch, sourceEntry, index);
    const text = sourceTextForFillEntry(sourceBatch, sourceEntry);
    const contractFlavor = sourceBatch && sourceBatch.contractFlavor
      || (safeProfile && safeProfile.contractFlavors[index % safeProfile.contractFlavors.length])
      || '';
    return {
      ...sourceEntry,
      count: 1,
      plannedType,
      types: [plannedType],
      quizLane: sourceBatch && sourceBatch.quizLane || (safeProfile && safeProfile.quizLane) || '',
      contractFlavor,
      questionType: plannedType,
      scenario: false,
      curveball: false,
      curveballCount: 0,
      sourceName: sourceEntry.sourceName || sourceBatch && sourceBatch.sourceName || '',
      headingPath: sourceEntry.headingPath || sourceEntry.sectionHeading || `Fill ${index + 1}`,
      sectionHeading: sourceEntry.sectionHeading || sourceEntry.headingPath || `Fill ${index + 1}`,
      sectionText: text,
      sourceText: sourceEntry.sourceText || text,
      fill: true,
    };
  });
}

function alignPlannedBatchForProvider(batch, requestedCount) {
  const requested = Math.max(1, positiveBatchCount(requestedCount, 1));
  const plannedEntries = Array.isArray(batch && batch.plannedEntries)
    ? batch.plannedEntries.filter(Boolean).slice(0, requested)
    : [];
  if (!plannedEntries.length) return { ...batch, count: requested };
  return {
    ...batch,
    count: plannedEntries.length,
    sourceText: buildSectionBatchSourceText(plannedEntries) || String(batch && batch.sourceText || '').trim(),
    types: plannedEntries.map((entry) => normalizeQuestionType(entry && (entry.plannedType || (entry.types && entry.types[0])))),
    plannedEntries,
    curveballCount: plannedEntries.reduce((sum, entry) => sum + (entry && entry.curveball ? 1 : 0), 0),
    curveball: plannedEntries.some((entry) => entry && entry.curveball),
  };
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

async function appendSuccessfulLines(store, jobId, lines, body, message, workerId) {
  return store.updateJob(jobId, (job) => {
    const existing = Array.isArray(job.questions) ? job.questions : [];
    const nextQuestions = existing.concat(lines).slice(0, job.requestedCount);
    if (isStopStatus(job.status)) {
      return {
        ...job,
        status: 'stopped',
        stopped: true,
        title: job.title || body.title || '',
        provider: job.provider || body.provider || '',
        model: job.model || body.model || '',
        questions: nextQuestions,
        completedCount: nextQuestions.length,
        progressMessage: stoppedProgressMessage(nextQuestions.length, job.requestedCount),
      };
    }
    if (!ownsWorkerLease(job, workerId) || isTerminalStatus(job.status)) return job;
    return {
      ...job,
      status: 'running',
      title: job.title || body.title || '',
      provider: job.provider || body.provider || '',
      model: job.model || body.model || '',
      questions: nextQuestions,
      completedCount: nextQuestions.length,
      progressMessage: message || `${nextQuestions.length} of ${job.requestedCount} questions ready.`,
      workerLeaseExpiresAt: workerLeaseExpiresAt(),
    };
  });
}

function normalizeDiagnostics(details = {}, fallbackAccepted = 0) {
  const rejectedReasons = details && details.rejectedReasons && typeof details.rejectedReasons === 'object'
    ? details.rejectedReasons
    : {};
  return {
    rawLineCount: Number(details && details.rawLineCount || 0),
    acceptedCount: Number(details && details.acceptedCount != null ? details.acceptedCount : fallbackAccepted),
    rejectedCount: Number(details && details.rejectedCount || 0),
    rejectedReasons,
  };
}

async function recordBatchFailure(store, jobId, batch, err, completedCount, retry = false, details = {}, workerId) {
  const safe = safeError(err);
  const diagnostics = normalizeDiagnostics(details, completedCount);
  return store.updateJob(jobId, (job) => {
    if (isStopStatus(job.status) || isTerminalStatus(job.status) || !ownsWorkerLease(job, workerId)) return job;
    return {
      ...job,
      failedBatches: [
        ...(Array.isArray(job.failedBatches) ? job.failedBatches : []),
        {
          batchId: batch && batch.batchId || '',
          batchNo: Number(batch && batch.batchNo || 0),
          quizLane: batch && batch.quizLane || '',
          contractFlavor: batch && batch.contractFlavor || '',
          questionType: batch && batch.questionType || '',
          scenario: !!(batch && batch.scenario),
          curveball: !!(batch && batch.curveball),
          requestedCount: Number(details && details.requestedCount != null ? details.requestedCount : batch && batch.count || 0),
          rawLineCount: diagnostics.rawLineCount,
          acceptedCount: diagnostics.acceptedCount,
          rejectedCount: diagnostics.rejectedCount,
          rejectedReasons: diagnostics.rejectedReasons,
          completedCount: Number(completedCount || 0),
          retry,
          fill: !!(batch && batch.fill),
          kind: String(batch && batch.kind || '').slice(0, 60),
          message: safe.message,
        },
      ],
      errors: [
        ...(Array.isArray(job.errors) ? job.errors : []),
        safe,
      ].slice(-10),
      progressMessage: retry ? 'Retrying a failed batch as single-question requests.' : 'One batch failed; continuing with the remaining batches.',
      workerLeaseExpiresAt: workerLeaseExpiresAt(),
    };
  });
}

async function markFinal(store, jobId, workerId) {
  return store.updateJob(jobId, (job) => {
    if (isTerminalStatus(job.status)) return job;
    const completed = Array.isArray(job.questions) ? job.questions.length : Number(job.completedCount || 0);
    if (isStopStatus(job.status)) {
      return {
        ...scrubStoredJobPayload(job),
        status: 'stopped',
        stopped: true,
        completedCount: completed,
        progressMessage: stoppedProgressMessage(completed, job.requestedCount),
      };
    }
    if (workerId && !ownsWorkerLease(job, workerId)) return job;
    if (completed >= Number(job.requestedCount || 0)) {
      return {
        ...scrubStoredJobPayload(job),
        status: 'complete',
        completedCount: completed,
        questions: job.questions.slice(0, job.requestedCount),
        progressMessage: `${job.requestedCount} of ${job.requestedCount} questions ready.`,
      };
    }
    if (completed > 0) {
      return {
        ...scrubStoredJobPayload(job),
        status: 'partial',
        completedCount: completed,
        progressMessage: `${completed} of ${job.requestedCount} questions ready.`,
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

async function processOneBatch(store, job, batch, state, options = {}) {
  const collectFillSource = options.collectFillSource !== false;
  const workerId = options.workerId;
  const latest = await store.getJob(job.jobId);
  if (!latest || latest.status === 'expired') return { stopped: true };
  if (isStopStatus(latest.status)) {
    await markFinal(store, job.jobId, workerId);
    return { stopped: true };
  }
  if (isTerminalStatus(latest.status) || !ownsWorkerLease(latest, workerId)) return { stopped: true, leaseLost: true };

  const runningJob = await updateOwnedJob(store, job.jobId, workerId, (current) => ({
    ...current,
    status: 'running',
    progressMessage: batch.fill
      ? `Filling remaining questions. ${current.completedCount || 0} of ${current.requestedCount} questions ready.`
      : `Generating batch ${batch.batchNo} of ${job.plannedBatches.length}. ${current.completedCount || 0} of ${current.requestedCount} questions ready.`,
  }));
  if (!runningJob || isStopStatus(runningJob.status)) {
    await markFinal(store, job.jobId, workerId);
    return { stopped: true };
  }
  if (!ownsWorkerLease(runningJob, workerId)) return { stopped: true, leaseLost: true };

  try {
    const remaining = Math.max(0, job.requestedCount - state.acceptedCount);
    const target = acceptedTargetForBatch(batch, remaining);
    const requestedCount = providerRequestedCountForBatch(batch, remaining);
    if (target <= 0 || requestedCount <= 0) return { stopped: false };
    const providerBatch = alignPlannedBatchForProvider(batch, requestedCount);
    const body = await runGenerateBatch(job, providerBatch, state);
    const collection = collectUniqueQuizLines(body.lines, state, target, {
      sourceBacked: !!providerBatch.sourceText,
    });
    const accepted = collection.accepted;
    state.acceptedCount += accepted.length;
    if (accepted.length) {
      const saved = await appendSuccessfulLines(
        store,
        job.jobId,
        accepted,
        body,
        `${state.acceptedCount} of ${job.requestedCount} questions ready.`,
        workerId
      );
      if (saved && !isStopStatus(saved.status) && !ownsWorkerLease(saved, workerId)) {
        return { stopped: true, leaseLost: true };
      }
    }
    if (accepted.length < target) {
      const err = new Error('A generation batch returned fewer usable questions than requested.');
      err.code = 'BATCH_SHORTFALL';
      if (collectFillSource) rememberFillSource(state, batch, 'underfilled', { acceptedCount: accepted.length });
      await recordBatchFailure(store, job.jobId, batch, err, accepted.length, !!batch.retry, {
        ...collection.diagnostics,
        requestedCount: target,
      }, workerId);
    }
    const latestAfterBatch = await store.getJob(job.jobId);
    if (latestAfterBatch && isStopStatus(latestAfterBatch.status)) {
      await markFinal(store, job.jobId, workerId);
      return { stopped: true };
    }
    if (latestAfterBatch && !ownsWorkerLease(latestAfterBatch, workerId)) return { stopped: true, leaseLost: true };
    return { stopped: false };
  } catch (err) {
    const remaining = Math.max(0, job.requestedCount - state.acceptedCount);
    const target = acceptedTargetForBatch(batch, remaining);
    const requestedCount = providerRequestedCountForBatch(batch, remaining);
    if (collectFillSource) rememberFillSource(state, batch, 'failed', { acceptedCount: 0 });
    await recordBatchFailure(store, job.jobId, batch, err, 0, !!batch.retry, {
      requestedCount: target,
      rawLineCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      rejectedReasons: {},
    }, workerId);
    const latestAfterError = await store.getJob(job.jobId);
    if (latestAfterError && isStopStatus(latestAfterError.status)) {
      await markFinal(store, job.jobId, workerId);
      return { stopped: true };
    }
    if (latestAfterError && !ownsWorkerLease(latestAfterError, workerId)) return { stopped: true, leaseLost: true };
    return { stopped: false };
  }
}

function buildFillBatch(sourceEntry, attemptNo, missingCount, profile) {
  const sourceBatch = sourceEntry && sourceEntry.batch ? sourceEntry.batch : sourceEntry;
  const target = Math.max(1, Math.min(FILL_PASS_BATCH_TARGET, parseInt(missingCount, 10) || 1));
  const safeProfile = profile ? safeGenerationProfile(profile) : null;
  const plannedEntries = createFillPlannedEntries(sourceBatch, target, safeProfile);
  const plannedCount = plannedEntries.length || target;
  const sourceText = plannedEntries.length
    ? buildSectionBatchSourceText(plannedEntries)
    : String(sourceBatch && sourceBatch.sourceText || '').trim();
  const firstEntry = plannedEntries[0] || {};
  return {
    ...sourceBatch,
    batchId: `${sourceBatch && sourceBatch.batchId || 'batch'}-fill-${attemptNo}`,
    batchNo: Number(sourceBatch && sourceBatch.batchNo || attemptNo),
    kind: `${String(sourceBatch && sourceBatch.kind || 'batch')}-fill`,
    count: plannedCount,
    sourceText,
    types: plannedEntries.length
      ? plannedEntries.map((entry) => normalizeQuestionType(entry && entry.plannedType))
      : sourceBatch && sourceBatch.types,
    plannedEntries: plannedEntries.length ? plannedEntries : undefined,
    quizLane: sourceBatch && sourceBatch.quizLane || firstEntry.quizLane || (safeProfile && safeProfile.quizLane) || '',
    contractFlavor: firstEntry.contractFlavor || sourceBatch && sourceBatch.contractFlavor || '',
    questionType: firstEntry.questionType || (plannedEntries.length ? normalizeQuestionType(plannedEntries[0].plannedType) : sourceBatch && sourceBatch.questionType),
    scenario: !!firstEntry.scenario,
    curveball: false,
    curveballCount: 0,
    fill: true,
    retry: false,
  };
}

async function runFillPass(store, job, state, workerId) {
  const sources = Array.isArray(state.fillSources) ? state.fillSources.filter(Boolean) : [];
  if (!sources.length) return { stopped: false };

  for (let attempt = 1; attempt <= FILL_PASS_MAX_ATTEMPTS; attempt += 1) {
    if (state.acceptedCount >= job.requestedCount) break;
    const latest = await store.getJob(job.jobId);
    if (!latest || latest.status === 'expired') return { stopped: true };
    if (isStopStatus(latest.status)) {
      await markFinal(store, job.jobId, workerId);
      return { stopped: true };
    }
    if (isTerminalStatus(latest.status) || !ownsWorkerLease(latest, workerId)) return { stopped: true, leaseLost: true };

    const missing = Math.max(0, job.requestedCount - state.acceptedCount);
    if (missing <= 0) break;
    const source = sources[(attempt - 1) % sources.length];
    const fillBatch = buildFillBatch(source, attempt, missing, state.generationProfile);
    const result = await processOneBatch(store, job, fillBatch, state, { collectFillSource: false, workerId });
    if (result.stopped) return result;
  }
  return { stopped: false };
}

async function processGenerationJob(jobId, options = {}) {
  const store = options.store;
  if (!store) throw new Error('processGenerationJob requires a job store');
  let job = await store.getJob(jobId);
  if (!job || job.status === 'expired') return job;
  if (isTerminalStatus(job.status)) return job;
  if (isStopStatus(job.status)) return markFinal(store, job.jobId);
  if (!Array.isArray(job.plannedBatches) || !job.plannedBatches.length) {
    return store.updateJob(job.jobId, (current) => ({
      ...current,
      status: 'failed',
      progressMessage: 'Generation failed because no batches were planned.',
      errors: [{ code: 'NO_PLANNED_BATCHES', message: 'No generation batches were planned.' }],
    }));
  }

  const workerId = String(options.workerId || crypto.randomUUID());
  job = await claimGenerationJob(store, job.jobId, workerId);
  if (!job || isTerminalStatus(job.status)) return job;
  if (isStopStatus(job.status)) return markFinal(store, jobId, workerId);
  if (!ownsWorkerLease(job, workerId)) return job;

  const sourceBacked = job.plannedBatches.some(isSourceBackedBatch);
  if (sourceBacked) {
    const generationProfile = safeGenerationProfile(job.generationProfile || createDefaultGenerationProfile({
      requestedCount: job.requestedCount,
      difficulty: job.options && job.options.difficulty,
      types: job.options && job.options.types,
      sourceBacked: true,
    }));
    const profiledBatches = buildProfiledBatches(job.plannedBatches, generationProfile, job.requestedCount);
    if (profiledBatches.length) {
      job = await updateOwnedJob(store, job.jobId, workerId, (current) => ({
        ...current,
        generationProfile,
        plannedBatches: profiledBatches,
      }));
      if (!job || isStopStatus(job.status)) return markFinal(store, jobId, workerId);
      if (isTerminalStatus(job.status) || !ownsWorkerLease(job, workerId)) return job;
    }
  }

  const state = createCollectionState(job);
  state.acceptedCount = Array.isArray(job.questions) ? job.questions.length : Number(job.completedCount || 0);
  state.fillSources = [];
  state.fillSourceKeys = new Set();
  state.generationProfile = job.generationProfile ? safeGenerationProfile(job.generationProfile) : null;
  for (const batch of job.plannedBatches) {
    if (state.acceptedCount >= job.requestedCount) break;
    const result = await processOneBatch(store, job, batch, state, { workerId });
    if (result.stopped) return store.getJob(job.jobId);
  }
  if (state.acceptedCount < job.requestedCount) {
    const fillResult = await runFillPass(store, job, state, workerId);
    if (fillResult.stopped) return store.getJob(job.jobId);
  }
  return markFinal(store, job.jobId, workerId);
}

module.exports = {
  WORKER_LEASE_MS,
  claimGenerationJob,
  collectUniqueQuizLines,
  hasActiveWorkerLease,
  isSemanticDuplicateStem,
  isTerminalStatus,
  ownsWorkerLease,
  processGenerationJob,
  retrySinglesForBatch,
  safeError,
};
