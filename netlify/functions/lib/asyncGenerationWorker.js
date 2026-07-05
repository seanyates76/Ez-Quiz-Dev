'use strict';

const { handleGenerateQuiz } = require('../generate-quiz.js');
const { scrubStoredJobPayload, stoppedProgressMessage } = require('./asyncJobStore.js');
const {
  buildProfiledBatches,
  buildSectionBatchSourceText,
  createDefaultGenerationProfile,
  safeGenerationProfile,
} = require('./asyncGenerationPlanner.js');
const { parseLegacyQuestion } = require('./normalizer.js');

const FILL_PASS_MAX_ATTEMPTS = 6;
const FILL_PASS_BATCH_TARGET = 5;

function isStopStatus(status) {
  return /^(stopped|canceled)$/i.test(String(status || ''));
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

function collectUniqueQuizLines(rawLines, state, limit) {
  const raw = splitLines(rawLines);
  const accepted = [];
  const acceptedRecords = [];
  const localSeen = new Set(state.seenKeys);
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
    if (localSeen.has(key)) {
      rejectedReasons.push('duplicate_stem');
      continue;
    }
    if (accepted.length >= max) {
      continue;
    }
    localSeen.add(key);
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
  const questionType = normalizeQuestionType(batch && batch.questionType || (Array.isArray(batch && batch.types) && batch.types[0]));
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
    quizLane: batch.quizLane,
    contractFlavor: batch.contractFlavor,
    questionType,
    scenario: !!batch.scenario,
    curveball: !!batch.curveball,
    curveballCount: Number(batch.curveballCount || 0),
  };
  if (!payload.sourceText) delete payload.sourceText;
  if (!payload.sourceName) delete payload.sourceName;
  if (!payload.model) delete payload.model;
  if (!payload.quizLane) delete payload.quizLane;
  if (!payload.contractFlavor) delete payload.contractFlavor;
  if (!payload.questionType) delete payload.questionType;
  if (!payload.curveballCount) delete payload.curveballCount;
  const response = await handleGenerateQuiz({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(payload),
  }, { skipRateLimit: true, timeoutMode: 'async-worker', asyncWorker: true });
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

function rememberFillSource(state, batch, reason) {
  if (!state || !isSourceBackedBatch(batch)) return;
  if (!state.fillSources) state.fillSources = [];
  if (!state.fillSourceKeys) state.fillSourceKeys = new Set();
  const key = fillSourceKey(batch);
  if (!key || state.fillSourceKeys.has(key)) return;
  state.fillSourceKeys.add(key);
  state.fillSources.push({
    batch,
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
  const baseEntries = Array.isArray(sourceBatch && sourceBatch.plannedEntries) && sourceBatch.plannedEntries.length
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

async function appendSuccessfulLines(store, jobId, lines, body, message) {
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

async function recordBatchFailure(store, jobId, batch, err, completedCount, retry = false, details = {}) {
  const safe = safeError(err);
  const diagnostics = normalizeDiagnostics(details, completedCount);
  return store.updateJob(jobId, (job) => {
    if (isStopStatus(job.status)) return job;
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
    };
  });
}

async function markFinal(store, jobId) {
  return store.updateJob(jobId, (job) => {
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

async function processOneBatch(store, job, batch, state, options = {}) {
  const collectFillSource = options.collectFillSource !== false;
  const latest = await store.getJob(job.jobId);
  if (!latest || latest.status === 'expired') return { stopped: true };
  if (isStopStatus(latest.status)) {
    await markFinal(store, job.jobId);
    return { stopped: true };
  }

  const runningJob = await store.updateJob(job.jobId, (current) => (
    isStopStatus(current.status)
      ? current
      : {
          ...current,
          status: 'running',
          progressMessage: batch.fill
            ? `Filling remaining questions. ${current.completedCount || 0} of ${current.requestedCount} questions ready.`
            : `Generating batch ${batch.batchNo} of ${job.plannedBatches.length}. ${current.completedCount || 0} of ${current.requestedCount} questions ready.`,
        }
  ));
  if (!runningJob || isStopStatus(runningJob.status)) {
    await markFinal(store, job.jobId);
    return { stopped: true };
  }

  try {
    const remaining = Math.max(0, job.requestedCount - state.acceptedCount);
    const target = acceptedTargetForBatch(batch, remaining);
    const requestedCount = providerRequestedCountForBatch(batch, remaining);
    if (target <= 0 || requestedCount <= 0) return { stopped: false };
    const providerBatch = alignPlannedBatchForProvider(batch, requestedCount);
    const body = await runGenerateBatch(job, providerBatch, state);
    const collection = collectUniqueQuizLines(body.lines, state, target);
    const accepted = collection.accepted;
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
    if (accepted.length < target) {
      const err = new Error('A generation batch returned fewer usable questions than requested.');
      err.code = 'BATCH_SHORTFALL';
      if (collectFillSource) rememberFillSource(state, batch, 'underfilled');
      await recordBatchFailure(store, job.jobId, batch, err, accepted.length, !!batch.retry, {
        ...collection.diagnostics,
        requestedCount: target,
      });
    }
    const latestAfterBatch = await store.getJob(job.jobId);
    if (latestAfterBatch && isStopStatus(latestAfterBatch.status)) {
      await markFinal(store, job.jobId);
      return { stopped: true };
    }
    return { stopped: false };
  } catch (err) {
    const remaining = Math.max(0, job.requestedCount - state.acceptedCount);
    const target = acceptedTargetForBatch(batch, remaining);
    const requestedCount = providerRequestedCountForBatch(batch, remaining);
    if (collectFillSource) rememberFillSource(state, batch, 'failed');
    await recordBatchFailure(store, job.jobId, batch, err, 0, !!batch.retry, {
      requestedCount: target,
      rawLineCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      rejectedReasons: {},
    });
    const latestAfterError = await store.getJob(job.jobId);
    if (latestAfterError && isStopStatus(latestAfterError.status)) {
      await markFinal(store, job.jobId);
      return { stopped: true };
    }
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

async function runFillPass(store, job, state) {
  const sources = Array.isArray(state.fillSources) ? state.fillSources.filter(Boolean) : [];
  if (!sources.length) return { stopped: false };

  for (let attempt = 1; attempt <= FILL_PASS_MAX_ATTEMPTS; attempt += 1) {
    if (state.acceptedCount >= job.requestedCount) break;
    const latest = await store.getJob(job.jobId);
    if (!latest || latest.status === 'expired') return { stopped: true };
    if (isStopStatus(latest.status)) {
      await markFinal(store, job.jobId);
      return { stopped: true };
    }

    const missing = Math.max(0, job.requestedCount - state.acceptedCount);
    if (missing <= 0) break;
    const source = sources[(attempt - 1) % sources.length];
    const fillBatch = buildFillBatch(source, attempt, missing, state.generationProfile);
    const result = await processOneBatch(store, job, fillBatch, state, { collectFillSource: false });
    if (result.stopped) return result;
  }
  return { stopped: false };
}

async function processGenerationJob(jobId, options = {}) {
  const store = options.store;
  if (!store) throw new Error('processGenerationJob requires a job store');
  let job = await store.getJob(jobId);
  if (!job || job.status === 'expired') return job;
  if (isStopStatus(job.status)) return markFinal(store, job.jobId);
  if (!Array.isArray(job.plannedBatches) || !job.plannedBatches.length) {
    return store.updateJob(job.jobId, (current) => ({
      ...current,
      status: 'failed',
      progressMessage: 'Generation failed because no batches were planned.',
      errors: [{ code: 'NO_PLANNED_BATCHES', message: 'No generation batches were planned.' }],
    }));
  }

  job = await store.updateJob(job.jobId, (current) => (
    isStopStatus(current.status)
      ? current
      : {
          ...current,
          status: 'running',
          progressMessage: 'Generation started.',
        }
  ));
  if (!job || isStopStatus(job.status)) return markFinal(store, jobId);

  const sourceBacked = job.plannedBatches.some(isSourceBackedBatch);
  if (sourceBacked) {
    const generationProfile = safeGenerationProfile(job.generationProfile || createDefaultGenerationProfile({
      requestedCount: job.requestedCount,
      difficulty: job.options && job.options.difficulty,
      sourceBacked: true,
    }));
    const profiledBatches = buildProfiledBatches(job.plannedBatches, generationProfile, job.requestedCount);
    if (profiledBatches.length) {
      job = await store.updateJob(job.jobId, (current) => (
        isStopStatus(current.status)
          ? current
          : {
              ...current,
              generationProfile,
              plannedBatches: profiledBatches,
            }
      ));
      if (!job || isStopStatus(job.status)) return markFinal(store, jobId);
    }
  }

  const state = createCollectionState(job);
  state.acceptedCount = Array.isArray(job.questions) ? job.questions.length : Number(job.completedCount || 0);
  state.fillSources = [];
  state.fillSourceKeys = new Set();
  state.generationProfile = job.generationProfile ? safeGenerationProfile(job.generationProfile) : null;
  for (const batch of job.plannedBatches) {
    if (state.acceptedCount >= job.requestedCount) break;
    const result = await processOneBatch(store, job, batch, state);
    if (result.stopped) return store.getJob(job.jobId);
  }
  if (state.acceptedCount < job.requestedCount) {
    const fillResult = await runFillPass(store, job, state);
    if (fillResult.stopped) return store.getJob(job.jobId);
  }
  return markFinal(store, job.jobId);
}

module.exports = {
  collectUniqueQuizLines,
  processGenerationJob,
  retrySinglesForBatch,
  safeError,
};
