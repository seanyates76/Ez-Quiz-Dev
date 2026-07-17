'use strict';

const { configuredBearerMatches, handleCors, parseJsonBody, reply, unauthorized } = require('./lib/asyncHttp.js');
const {
  createGenerationJobStore,
  publicJobStatus,
  sanitizeJobId,
  workerTokenMatches,
} = require('./lib/asyncJobStore.js');
const { processGenerationJob } = require('./lib/asyncGenerationWorker.js');

exports.handler = async (event) => {
  const cors = handleCors(event, ['POST'], { requireAuth: false });
  if (cors.done) return cors.response;

  let payload;
  try {
    payload = parseJsonBody(event);
  } catch {
    return reply(400, { error: 'Invalid JSON' }, cors.origin);
  }

  const jobId = sanitizeJobId(payload && payload.jobId);
  if (!jobId) return reply(400, { error: 'Invalid jobId' }, cors.origin);

  const store = createGenerationJobStore({ event });
  // Blobs reads are eventually consistent in some function environments. The
  // browser receives the background-function 202 before this handler runs, so
  // retry a newly-created job here instead of silently abandoning it as missing.
  const before = await store.getJobWithRetry(jobId, { attempts: 6, delayMs: 250 });
  if (!before) return reply(404, { error: 'Job not found' }, cors.origin);
  if (!configuredBearerMatches(event) && !workerTokenMatches(before, payload && payload.workerToken)) {
    return unauthorized(cors.origin);
  }
  if (before.status === 'expired') return reply(410, publicJobStatus(before), cors.origin);

  const job = await processGenerationJob(jobId, { store });
  return reply(202, publicJobStatus(job || before), cors.origin);
};

exports.processGenerationJob = processGenerationJob;
