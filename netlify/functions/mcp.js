'use strict';

const { handleGenerateQuiz } = require('./generate-quiz.js');
const { handler: startGenerationJob } = require('./generate-quiz-start.js');
const { parseLegacyQuestion } = require('./lib/normalizer.js');
const { QUIZ_WIDGET_ALIASES, QUIZ_WIDGET_MIME_TYPE, QUIZ_WIDGET_URI, quizWidgetHtml } = require('./lib/mcpQuizWidget.js');

const SERVER_INFO = { name: 'ez-quiz', version: '1.0.0' };
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const VALID_TYPES = new Set(['MC', 'TF', 'YN', 'MT']);

const generateInputSchema = {
  type: 'object',
  properties: {
    topic: { type: 'string', minLength: 1, maxLength: 240, description: 'The subject or title for the quiz.' },
    source_text: { type: 'string', maxLength: 30000, description: 'Optional user-provided notes or extracted attachment text to ground every question.' },
    source_name: { type: 'string', maxLength: 160, description: 'Optional name of the source supplied by the user.' },
    count: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Number of questions.' },
    types: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: ['MC', 'TF', 'YN', 'MT'] }, description: 'Allowed question formats: multiple choice, true/false, yes/no, and matching.' },
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], default: 'medium' },
  },
  required: ['topic'],
  additionalProperties: false,
};

const generationStartSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['loading'] },
    topic: { type: 'string' },
    count: { type: 'integer' },
    difficulty: { type: 'string' },
  },
  required: ['status', 'topic', 'count', 'difficulty'],
  additionalProperties: false,
};

const quizOutputSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    lines: { type: 'string' },
    questions: { type: 'array', items: { type: 'object' } },
    questionCount: { type: 'integer' },
    aiGenerated: { type: 'boolean' },
  },
  required: ['title', 'topic', 'lines', 'questions', 'questionCount', 'aiGenerated'],
  additionalProperties: false,
};

const tools = [
  {
    name: 'generate_quiz',
    title: 'Generate an EZ Quiz',
    description: 'Create and display an interactive quiz from a topic or user-provided source text. Use source_text when the user supplies notes or file contents.',
    inputSchema: generateInputSchema,
    outputSchema: generationStartSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    _meta: {
      ui: { resourceUri: QUIZ_WIDGET_URI },
      'openai/outputTemplate': QUIZ_WIDGET_URI,
      'openai/toolInvocation/invoking': 'Building your quiz…',
      'openai/toolInvocation/invoked': 'Quiz generation started.',
    },
  },
  {
    name: 'build_quiz',
    title: 'Build the current EZ Quiz',
    description: 'Completes quiz generation requested by the EZ Quiz interface. This tool is available only to the app UI.',
    inputSchema: generateInputSchema,
    outputSchema: quizOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    _meta: {
      ui: { visibility: ['app'] },
      'openai/visibility': 'private',
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Writing questions…',
      'openai/toolInvocation/invoked': 'Quiz ready.',
    },
  },
  {
    name: 'render_quiz',
    title: 'Open an EZ Quiz',
    description: 'Validate and display existing EZ Quiz lines as an interactive quiz. Use this when the user pastes lines beginning with MC|, TF|, YN|, or MT|. This tool does not generate or change questions.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 160, default: 'EZ Quiz' },
        topic: { type: 'string', maxLength: 240, default: '' },
        lines: { type: 'string', minLength: 1, maxLength: 60000, description: 'Newline-separated EZ Quiz lines.' },
      },
      required: ['lines'],
      additionalProperties: false,
    },
    outputSchema: quizOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: {
      ui: { resourceUri: QUIZ_WIDGET_URI },
      'openai/outputTemplate': QUIZ_WIDGET_URI,
      'openai/toolInvocation/invoking': 'Opening your quiz…',
      'openai/toolInvocation/invoked': 'Quiz ready.',
    },
  },
];

function headerValue(headers, name) {
  if (!headers) return '';
  return String(headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '');
}

function validOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function requestOrigin(event) {
  const rawUrlOrigin = validOrigin(event && (event.rawUrl || event.rawURL));
  if (rawUrlOrigin) return rawUrlOrigin;
  const host = headerValue(event && event.headers, 'x-forwarded-host')
    || headerValue(event && event.headers, 'host');
  if (host) {
    const protocol = headerValue(event && event.headers, 'x-forwarded-proto') || 'https';
    const headerOrigin = validOrigin(`${protocol}://${host}`);
    if (headerOrigin) return headerOrigin;
  }
  for (const candidate of [
    process.env.EZQ_PLUGIN_API_ORIGIN,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    process.env.URL,
  ]) {
    const origin = validOrigin(candidate);
    if (origin) return origin;
  }
  return 'https://ez-quiz.app';
}

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
}

function corsHeaders(event) {
  const origin = headerValue(event && event.headers, 'origin');
  const allowed = allowedOrigins();
  const originAllowed = !origin || allowed.length === 0 || allowed.includes(origin);
  if (!originAllowed) return null;
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Mcp-Protocol-Version',
    'Cache-Control': 'no-store',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function response(statusCode, body, headers = {}) {
  const hasBody = body !== '' && body != null;
  return {
    statusCode,
    headers: {
      ...headers,
      ...(hasBody ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    },
    body: hasBody ? JSON.stringify(body) : '',
  };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id == null ? null : id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function safeString(value, maxLength, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return (text || fallback).slice(0, maxLength);
}

function validateGenerateArgs(raw) {
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (String(args.topic == null ? '' : args.topic).trim().length > 240) throw new Error('topic must be 240 characters or fewer');
  const topic = safeString(args.topic, 240);
  if (!topic) throw new Error('topic is required');
  const countValue = args.count == null ? 10 : Number(args.count);
  if (!Number.isInteger(countValue) || countValue < 1 || countValue > 20) throw new Error('count must be an integer between 1 and 20');
  const difficulty = safeString(args.difficulty, 20, 'medium').toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(difficulty)) throw new Error('difficulty must be easy, medium, or hard');
  let types;
  if (args.types !== undefined) {
    if (!Array.isArray(args.types) || args.types.length < 1 || args.types.length > 4) throw new Error('types must contain 1 to 4 values');
    types = [...new Set(args.types.map((value) => safeString(value, 2).toUpperCase()))];
    if (!types.length || types.some((value) => !VALID_TYPES.has(value))) throw new Error('types may contain only MC, TF, YN, or MT');
  }
  if (String(args.source_text == null ? '' : args.source_text).length > 30000) throw new Error('source_text must be 30,000 characters or fewer');
  const sourceText = safeString(args.source_text, 30000);
  return {
    topic,
    count: countValue,
    difficulty,
    ...(types ? { types } : {}),
    ...(sourceText ? { sourceText, sourceName: safeString(args.source_name, 160, 'ChatGPT source') } : {}),
  };
}

function parseQuizLines(lines, { title = 'EZ Quiz', topic = '', aiGenerated = false } = {}) {
  const normalizedLines = String(lines || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!normalizedLines.length) throw new Error('lines is required');
  if (normalizedLines.length > 50) throw new Error('A quiz may contain at most 50 lines');
  const questions = normalizedLines.map((line, index) => {
    const question = parseLegacyQuestion(line);
    if (!question) throw new Error(`Line ${index + 1} is not a valid MC, TF, YN, or MT quiz line`);
    return question;
  });
  return {
    title: safeString(title, 160, 'EZ Quiz'),
    topic: safeString(topic, 240),
    lines: normalizedLines.join('\n'),
    questions,
    questionCount: questions.length,
    aiGenerated: !!aiGenerated,
  };
}

function quizToolResult(quiz, message) {
  return {
    structuredContent: quiz,
    content: [{ type: 'text', text: message }],
    _meta: { aiGenerated: quiz.aiGenerated },
  };
}

function internalGenerationEvent(event, payload) {
  const headers = {};
  for (const name of ['x-forwarded-for', 'client-ip', 'x-nf-client-connection-ip']) {
    const value = headerValue(event && event.headers, name);
    if (value) headers[name] = value;
  }
  return {
    ...(event || {}),
    httpMethod: 'POST',
    headers,
    body: JSON.stringify({ ...payload, format: 'legacy-lines' }),
    queryStringParameters: {},
  };
}

function missingBlobContext(error) {
  return /not been configured to use Netlify Blobs|supply.+siteID.+token/i.test(String(error && error.message || error || ''));
}

async function startGenerationOverHttp(event, payload) {
  const origin = requestOrigin(event);
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.GENERATE_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GENERATE_BEARER_TOKEN}`;
  }
  const res = await fetch(`${origin}/.netlify/functions/generate-quiz-start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, format: 'legacy-lines' }),
  });
  return {
    statusCode: res.status,
    body: await res.text(),
  };
}

async function startGeneration(event, payload) {
  // Each Netlify Function receives its own Blobs runtime binding. Calling the
  // start handler as a plain function from MCP bypasses that binding, so route
  // through the deployed endpoint in Netlify and retain the direct path for
  // tests and local development.
  if (process.env.NETLIFY === 'true') return startGenerationOverHttp(event, payload);
  try {
    return await startGenerationJob(internalGenerationEvent(event, payload));
  } catch (error) {
    if (!missingBlobContext(error)) throw error;
    return startGenerationOverHttp(event, payload);
  }
}

async function startQuiz(args, event) {
  try {
    const payload = validateGenerateArgs(args);
    const started = await startGeneration(event, payload);
    let job;
    try { job = JSON.parse(started.body || '{}'); } catch { job = {}; }
    if (started.statusCode !== 202 || !job.jobId || !job.workerToken) {
      const message = started.statusCode === 429
        ? 'EZ Quiz is receiving a lot of requests. Please wait a moment and try again.'
        : safeString(job.error, 220, 'EZ Quiz could not start the generation job.');
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
    const origin = requestOrigin(event);
    return {
      structuredContent: { status: 'loading', topic: payload.topic, count: payload.count, difficulty: payload.difficulty },
      content: [{ type: 'text', text: `Started building an interactive ${payload.count}-question quiz about ${payload.topic}.` }],
      _meta: {
        generateRequest: {
          topic: payload.topic,
          count: payload.count,
          difficulty: payload.difficulty,
          ...(payload.types ? { types: payload.types } : {}),
        },
        generation: {
          jobId: job.jobId,
          workerToken: job.workerToken,
          requestedCount: job.requestedCount || payload.count,
          progressMessage: job.progressMessage || 'Generation job queued.',
          workerUrl: `${origin}/.netlify/functions/generate-quiz-worker-background`,
          statusUrl: `${origin}/.netlify/functions/generate-quiz-status`,
          stopUrl: `${origin}/.netlify/functions/generate-quiz-stop`,
        },
      },
    };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `I could not build that quiz: ${error.message}.` }] };
  }
}

async function buildQuiz(args, event) {
  let payload;
  try {
    payload = validateGenerateArgs(args);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `I could not build that quiz: ${error.message}.` }] };
  }
  const forwardedHeaders = {};
  for (const name of ['x-forwarded-for', 'client-ip', 'x-nf-client-connection-ip']) {
    const value = headerValue(event && event.headers, name);
    if (value) forwardedHeaders[name] = value;
  }
  const generated = await handleGenerateQuiz({
    httpMethod: 'POST',
    headers: forwardedHeaders,
    body: JSON.stringify({ ...payload, format: 'legacy-lines' }),
    queryStringParameters: {},
  }, { trustedInternalRequest: true });
  let body;
  try { body = JSON.parse(generated.body || '{}'); } catch { body = {}; }
  if (generated.statusCode !== 200 || !body.lines) {
    const retry = generated.statusCode === 429 ? ' Please wait a moment and try again.' : '';
    return { isError: true, content: [{ type: 'text', text: `EZ Quiz could not generate the quiz.${retry}` }] };
  }
  try {
    const quiz = parseQuizLines(body.lines, { title: body.title || payload.topic, topic: payload.topic, aiGenerated: true });
    return quizToolResult(quiz, `Created an interactive ${quiz.questionCount}-question quiz. The questions were generated by AI; verify important facts against the source.`);
  } catch {
    return { isError: true, content: [{ type: 'text', text: 'EZ Quiz generated a response, but it did not contain a usable quiz.' }] };
  }
}

function renderQuiz(args) {
  try {
    const raw = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    if (String(raw.lines == null ? '' : raw.lines).length > 60000) throw new Error('lines must be 60,000 characters or fewer');
    const quiz = parseQuizLines(safeString(raw.lines, 60000), { title: raw.title, topic: raw.topic, aiGenerated: false });
    return quizToolResult(quiz, `Opened ${quiz.questionCount} questions in the interactive EZ Quiz player.`);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `I could not open that quiz: ${error.message}.` }] };
  }
}

async function callTool(name, args, event) {
  if (name === 'generate_quiz') return startQuiz(args, event);
  if (name === 'build_quiz') return buildQuiz(args, event);
  if (name === 'render_quiz') return renderQuiz(args);
  return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${safeString(name, 80, '(missing)')}.` }] };
}

function widgetResource(uri = QUIZ_WIDGET_URI, event) {
  const widgetOrigin = validOrigin(process.env.EZQ_PLUGIN_WIDGET_ORIGIN) || 'https://ez-quiz.app';
  const apiOrigin = requestOrigin(event);
  const connectDomains = [...new Set([apiOrigin, widgetOrigin].map(validOrigin).filter(Boolean))];
  const resourceDomains = [...new Set([widgetOrigin].map(validOrigin).filter(Boolean))];
  return {
    contents: [{
      uri,
      name: 'EZ Quiz interactive player',
      mimeType: QUIZ_WIDGET_MIME_TYPE,
      text: quizWidgetHtml(),
      _meta: {
        ui: {
          prefersBorder: true,
          domain: widgetOrigin,
          csp: { connectDomains, resourceDomains },
        },
        'openai/widgetDescription': 'An accessible interactive quiz player that presents one question at a time, checks answers, tracks score, and shows results.',
        'openai/widgetPrefersBorder': true,
        'openai/widgetDomain': widgetOrigin,
        'openai/widgetCSP': { connect_domains: connectDomains, resource_domains: resourceDomains },
      },
    }],
  };
}

async function dispatch(message, event) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message && message.id, -32600, 'Invalid Request');
  const id = message.id;
  if (message.method.startsWith('notifications/')) return null;
  if (message.method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: safeString(message.params && message.params.protocolVersion, 40, DEFAULT_PROTOCOL_VERSION),
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: 'EZ Quiz creates interactive quizzes from a topic or user-provided source text and opens valid EZ Quiz lines. Keep source text limited to material the user intentionally supplied.',
    });
  }
  if (message.method === 'ping') return rpcResult(id, {});
  if (message.method === 'tools/list') return rpcResult(id, { tools });
  if (message.method === 'tools/call') {
    const params = message.params || {};
    return rpcResult(id, await callTool(params.name, params.arguments || {}, event));
  }
  if (message.method === 'resources/list') {
    return rpcResult(id, { resources: QUIZ_WIDGET_ALIASES.map((uri) => ({ uri, name: 'EZ Quiz interactive player', mimeType: QUIZ_WIDGET_MIME_TYPE })) });
  }
  if (message.method === 'resources/read') {
    const uri = message.params && message.params.uri;
    if (!QUIZ_WIDGET_ALIASES.includes(uri)) return rpcError(id, -32002, 'Resource not found');
    return rpcResult(id, widgetResource(uri, event));
  }
  return rpcError(id, -32601, 'Method not found');
}

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  if (!cors) return response(403, { error: 'Forbidden origin' });
  if (event.httpMethod === 'OPTIONS') return response(204, '', cors);
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' }, { ...cors, Allow: 'POST, OPTIONS' });
  let payload;
  try { payload = JSON.parse(event.body || ''); } catch { return response(400, rpcError(null, -32700, 'Parse error'), cors); }
  if (Array.isArray(payload)) {
    if (!payload.length) return response(400, rpcError(null, -32600, 'Invalid Request'), cors);
    const results = (await Promise.all(payload.map((message) => dispatch(message, event)))).filter(Boolean);
    return results.length ? response(200, results, { ...cors, 'Mcp-Protocol-Version': DEFAULT_PROTOCOL_VERSION }) : response(202, '', cors);
  }
  const result = await dispatch(payload, event);
  return result ? response(200, result, { ...cors, 'Mcp-Protocol-Version': DEFAULT_PROTOCOL_VERSION }) : response(202, '', cors);
};

exports._private = {
  callTool,
  dispatch,
  missingBlobContext,
  parseQuizLines,
  requestOrigin,
  startGeneration,
  startGenerationOverHttp,
  tools,
  widgetResource,
};
