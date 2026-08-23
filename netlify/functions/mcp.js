'use strict';

const { handleGenerateQuiz } = require('./generate-quiz.js');
const {
  normalizeOpenQuizArgs,
  openQuizInputSchema,
  quizOutputSchema,
} = require('./lib/mcpQuizContract.js');
const {
  QUIZ_WIDGET_ALIASES,
  QUIZ_WIDGET_MIME_TYPE,
  QUIZ_WIDGET_URI,
  quizWidgetHtml,
} = require('./lib/mcpQuizWidget.js');
const { parseLegacyQuestion } = require('./lib/normalizer.js');

const SERVER_INFO = { name: 'ez-quiz', version: '2.0.0' };
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const LEGACY_TYPES = new Set(['MC', 'TF', 'YN', 'MT']);

const tools = [{
  name: 'open_quiz',
  title: 'Open an EZ Quiz',
  description: [
    'Open a complete, interactive EZ Quiz that you have already written for the user.',
    'Use this whenever the user asks to create, make, give, start, or take a quiz.',
    'Before calling it, write and fact-check the entire question set from the conversation and any source material the user supplied.',
    'Do not call it with placeholders, generation status, raw source text, or incomplete questions.',
    'Prefer 5 to 10 questions unless the user requests another count, and keep every question self-contained.',
  ].join(' '),
  inputSchema: openQuizInputSchema,
  outputSchema: quizOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
  _meta: {
    ui: { resourceUri: QUIZ_WIDGET_URI },
    'openai/outputTemplate': QUIZ_WIDGET_URI,
    'openai/toolInvocation/invoking': 'Opening your quiz…',
    'openai/toolInvocation/invoked': 'Quiz ready.',
  },
}];

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

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
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
  return {
    jsonrpc: '2.0',
    id: id == null ? null : id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function safeString(value, maxLength, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return (text || fallback).slice(0, maxLength);
}

function openQuiz(args) {
  try {
    const quiz = normalizeOpenQuizArgs(args);
    return {
      structuredContent: quiz,
      content: [{
        type: 'text',
        text: `Opened a ${quiz.questionCount}-question interactive EZ Quiz about ${quiz.topic}.`,
      }],
      _meta: { quizId: quiz.quizId },
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `I could not open that quiz: ${safeString(error && error.message, 300, 'the quiz data is invalid')}.`,
      }],
    };
  }
}

function validateLegacyGenerateArgs(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const topic = safeString(raw.topic, 240);
  if (!topic) throw new Error('topic is required');
  const count = raw.count == null ? 10 : Number(raw.count);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('count must be an integer between 1 and 20');
  }
  const difficulty = safeString(raw.difficulty, 20, 'medium').toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error('difficulty must be easy, medium, or hard');
  }
  let types;
  if (raw.types !== undefined) {
    if (!Array.isArray(raw.types) || raw.types.length < 1 || raw.types.length > 4) {
      throw new Error('types must contain 1 to 4 values');
    }
    types = [...new Set(raw.types.map((type) => safeString(type, 2).toUpperCase()))];
    if (types.some((type) => !LEGACY_TYPES.has(type))) {
      throw new Error('types may contain only MC, TF, YN, or MT');
    }
  }
  const sourceValue = String(raw.source_text == null ? '' : raw.source_text);
  if (sourceValue.length > 30000) throw new Error('source_text must be 30,000 characters or fewer');
  const sourceText = sourceValue.trim();
  return {
    topic,
    count,
    difficulty,
    ...(types ? { types } : {}),
    ...(sourceText
      ? { sourceText, sourceName: safeString(raw.source_name, 160, 'ChatGPT source') }
      : {}),
  };
}

function parseLegacyQuiz(lines, { title = 'EZ Quiz', topic = '', aiGenerated = false } = {}) {
  const normalizedLines = String(lines || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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

function legacyQuizResult(quiz, message) {
  return {
    structuredContent: quiz,
    content: [{ type: 'text', text: message }],
    _meta: { compatibilityTool: true },
  };
}

async function generateLegacyQuiz(args, event) {
  let payload;
  try {
    payload = validateLegacyGenerateArgs(args);
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
    const quiz = parseLegacyQuiz(body.lines, {
      title: body.title || payload.topic,
      topic: payload.topic,
      aiGenerated: true,
    });
    return legacyQuizResult(quiz, `Created an interactive ${quiz.questionCount}-question quiz.`);
  } catch {
    return { isError: true, content: [{ type: 'text', text: 'EZ Quiz generated a response, but it did not contain a usable quiz.' }] };
  }
}

function renderLegacyQuiz(args) {
  try {
    const raw = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    if (String(raw.lines == null ? '' : raw.lines).length > 60000) {
      throw new Error('lines must be 60,000 characters or fewer');
    }
    const quiz = parseLegacyQuiz(raw.lines, {
      title: raw.title,
      topic: raw.topic,
      aiGenerated: false,
    });
    return legacyQuizResult(quiz, `Opened ${quiz.questionCount} questions in the interactive EZ Quiz player.`);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `I could not open that quiz: ${error.message}.` }] };
  }
}

async function callTool(name, args, event) {
  if (name === 'open_quiz') return openQuiz(args);
  // ChatGPT may retain an older tool snapshot after a connection is updated.
  // These aliases remain dispatch-only; tools/list advertises only open_quiz.
  if (name === 'generate_quiz') return generateLegacyQuiz(args, event);
  if (name === 'render_quiz') return renderLegacyQuiz(args);
  return {
    isError: true,
    content: [{ type: 'text', text: `Unknown tool: ${safeString(name, 80, '(missing)')}.` }],
  };
}

function widgetResource(uri = QUIZ_WIDGET_URI) {
  const widgetOrigin = validOrigin(process.env.EZQ_PLUGIN_WIDGET_ORIGIN) || 'https://ez-quiz.app';
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
          csp: { connectDomains: [], resourceDomains: [] },
        },
        'openai/widgetDescription': 'The EZ Quiz runner presents one question at a time, preserves answers, calculates the final score once, reviews results, and supports focused retakes.',
        'openai/widgetPrefersBorder': true,
        'openai/widgetDomain': widgetOrigin,
        'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
      },
    }],
  };
}

async function dispatch(message, event) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message && message.id, -32600, 'Invalid Request');
  }
  const id = message.id;
  if (message.method.startsWith('notifications/')) return null;
  if (message.method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: safeString(message.params && message.params.protocolVersion, 40, DEFAULT_PROTOCOL_VERSION),
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions: [
        'When the user asks for an EZ Quiz, write and fact-check the complete quiz yourself, then call open_quiz exactly once with structured questions.',
        'Use the conversation and user-supplied sources as the knowledge context.',
        'Do not ask EZ Quiz to generate questions, do not send raw source material to the tool, and do not create loading or placeholder quiz calls.',
        'The EZ Quiz component owns question navigation, scoring, results review, and retakes.',
      ].join(' '),
    });
  }
  if (message.method === 'ping') return rpcResult(id, {});
  if (message.method === 'tools/list') return rpcResult(id, { tools });
  if (message.method === 'tools/call') {
    const params = message.params || {};
    return rpcResult(id, await callTool(params.name, params.arguments || {}, event));
  }
  if (message.method === 'resources/list') {
    return rpcResult(id, {
      resources: QUIZ_WIDGET_ALIASES.map((uri) => ({
        uri,
        name: 'EZ Quiz interactive player',
        mimeType: QUIZ_WIDGET_MIME_TYPE,
      })),
    });
  }
  if (message.method === 'resources/read') {
    const uri = message.params && message.params.uri;
    if (!QUIZ_WIDGET_ALIASES.includes(uri)) return rpcError(id, -32002, 'Resource not found');
    return rpcResult(id, widgetResource(uri));
  }
  return rpcError(id, -32601, 'Method not found');
}

exports.handler = async (event) => {
  const cors = corsHeaders(event);
  if (!cors) return response(403, { error: 'Forbidden origin' });
  if (event.httpMethod === 'OPTIONS') return response(204, '', cors);
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' }, { ...cors, Allow: 'POST, OPTIONS' });
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '');
  } catch {
    return response(400, rpcError(null, -32700, 'Parse error'), cors);
  }
  if (Array.isArray(payload)) {
    if (!payload.length) return response(400, rpcError(null, -32600, 'Invalid Request'), cors);
    const results = (await Promise.all(payload.map((message) => dispatch(message, event)))).filter(Boolean);
    return results.length
      ? response(200, results, { ...cors, 'Mcp-Protocol-Version': DEFAULT_PROTOCOL_VERSION })
      : response(202, '', cors);
  }
  const result = await dispatch(payload, event);
  return result
    ? response(200, result, { ...cors, 'Mcp-Protocol-Version': DEFAULT_PROTOCOL_VERSION })
    : response(202, '', cors);
};

exports._private = {
  callTool,
  dispatch,
  generateLegacyQuiz,
  openQuiz,
  parseLegacyQuiz,
  renderLegacyQuiz,
  tools,
  widgetResource,
};
