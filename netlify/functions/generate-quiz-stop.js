'use strict';

const { bearerToken, configuredBearerMatches, handleCors, parseJsonBody, reply, unauthorized } = require('./lib/asyncHttp.js');
const {
  createGenerationJobStore,
  publicJobStatus,
  sanitizeJobId,
  workerTokenMatches,
} = require('./lib/asyncJobStore.js');

exports.handler = async (event) => {
  // The browser uses the per-job capability; the shared server bearer remains
  // valid for trusted callers and is never exposed to client code.
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
  if (!configuredBearerMatches(event) && !workerTokenMatches(before, bearerToken(event))) {
    return unauthorized(cors.origin);
  }
  const job = await store.stopJob(jobId);
  if (!job) return reply(404, { error: 'Job not found' }, cors.origin);
  const statusCode = job.status === 'expired' ? 410 : 200;
  return reply(statusCode, publicJobStatus(job), cors.origin);
};
