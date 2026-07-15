'use strict';

const { authorize, handleCors, parseJsonBody, reply, unauthorized } = require('./lib/asyncHttp.js');
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
  const before = await store.getJob(jobId);
  if (!before) return reply(404, { error: 'Job not found' }, cors.origin);
  if (!authorize(event) && !workerTokenMatches(before, payload && payload.workerToken)) {
    return unauthorized(cors.origin);
  }
  if (before.status === 'expired') return reply(410, publicJobStatus(before), cors.origin);

  const job = await processGenerationJob(jobId, { store });
  return reply(202, publicJobStatus(job || before), cors.origin);
};

exports.processGenerationJob = processGenerationJob;
