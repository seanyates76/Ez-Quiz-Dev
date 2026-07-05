'use strict';

const { handleCors, reply } = require('./lib/asyncHttp.js');
const { createGenerationJobStore, publicJobStatus, sanitizeJobId } = require('./lib/asyncJobStore.js');

exports.handler = async (event) => {
  const cors = handleCors(event, ['GET']);
  if (cors.done) return cors.response;

  const jobId = sanitizeJobId(event && event.queryStringParameters && event.queryStringParameters.jobId);
  if (!jobId) return reply(400, { error: 'Invalid jobId' }, cors.origin);

  const store = createGenerationJobStore({ event });
  const job = await store.getJob(jobId);
  if (!job) return reply(404, { error: 'Job not found' }, cors.origin);
  const statusCode = job.status === 'expired' ? 410 : 200;
  return reply(statusCode, publicJobStatus(job), cors.origin);
};
