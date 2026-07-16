'use strict';

const { authorize, bearerToken, handleCors, reply, unauthorized } = require('./lib/asyncHttp.js');
const {
  createGenerationJobStore,
  publicJobStatus,
  sanitizeJobId,
  workerTokenMatches,
} = require('./lib/asyncJobStore.js');

exports.handler = async (event) => {
  // The browser uses the per-job capability; the shared server bearer remains
  // valid for trusted callers and is never exposed to client code.
  const cors = handleCors(event, ['GET'], { requireAuth: false });
  if (cors.done) return cors.response;

  const jobId = sanitizeJobId(event && event.queryStringParameters && event.queryStringParameters.jobId);
  if (!jobId) return reply(400, { error: 'Invalid jobId' }, cors.origin);

  const store = createGenerationJobStore({ event });
  const job = await store.getJob(jobId);
  if (!job) return reply(404, { error: 'Job not found' }, cors.origin);
  if (!authorize(event) && !workerTokenMatches(job, bearerToken(event))) {
    return unauthorized(cors.origin);
  }
  const statusCode = job.status === 'expired' ? 410 : 200;
  return reply(statusCode, publicJobStatus(job), cors.origin);
};
