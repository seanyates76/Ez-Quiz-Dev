'use strict';

const { handleCors, parseJsonBody, reply } = require('./lib/asyncHttp.js');
const { createGenerationJobStore, publicJobStatus, sanitizeJobId } = require('./lib/asyncJobStore.js');

exports.handler = async (event) => {
  const cors = handleCors(event, ['POST']);
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
  const job = await store.cancelJob(jobId);
  if (!job) return reply(404, { error: 'Job not found' }, cors.origin);
  const statusCode = job.status === 'expired' ? 410 : 200;
  return reply(statusCode, publicJobStatus(job), cors.origin);
};
