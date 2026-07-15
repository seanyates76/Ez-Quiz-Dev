'use strict';

const { handleCors, parseJsonBody, reply } = require('./lib/asyncHttp.js');
const {
  createGenerationJobStore,
  hashWorkerToken,
  makeWorkerToken,
  publicJobStatus,
} = require('./lib/asyncJobStore.js');
const { buildPlannedBatches } = require('./lib/asyncGenerationPlanner.js');
const { normalizeGenerationPayload } = require('./lib/generationRequest.js');
const { rateLimited, retryAfterSeconds } = require('./lib/generationRateLimit.js');

exports.handler = async (event) => {
  const cors = handleCors(event, ['POST']);
  if (cors.done) return cors.response;

  if (rateLimited(event)) {
    return reply(429, { error: 'Rate limited' }, cors.origin, {
      'Retry-After': String(retryAfterSeconds()),
    });
  }

  let payload;
  try {
    payload = parseJsonBody(event);
  } catch {
    return reply(400, { error: 'Invalid JSON' }, cors.origin);
  }

  let request;
  try {
    request = normalizeGenerationPayload(payload, {
      env: process.env,
      queryStringParameters: event.queryStringParameters,
      headers: event.headers,
    });
  } catch (err) {
    return reply(err && err.status || 400, err && err.body ? err.body : { error: 'Invalid request' }, cors.origin);
  }

  const plannedBatches = buildPlannedBatches(request);
  const store = createGenerationJobStore({ event });
  const workerToken = makeWorkerToken();
  const job = await store.createJob({
    topic: request.topic,
    requestedCount: request.count,
    sourceName: request.sourceName,
    options: {
      topic: request.topic,
      count: request.count,
      sourceText: request.sourceText,
      sourceName: request.sourceName,
      sourceReport: request.sourceReport,
      types: request.types,
      difficulty: request.difficulty,
      provider: request.provider,
      model: request.model,
      avoidStems: request.avoidStems,
    },
    plannedBatches,
    workerTokenHash: hashWorkerToken(workerToken),
  });

  return reply(202, {
    jobId: job.jobId,
    workerToken,
    status: 'queued',
    requestedCount: job.requestedCount,
    plannedBatchCount: plannedBatches.length,
    progressMessage: job.progressMessage,
    expiresAt: job.expiresAt,
  }, cors.origin);
};

exports._private = {
  publicJobStatus,
};
