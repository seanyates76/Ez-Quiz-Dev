'use strict';

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

const SERVER_INFO = { name: 'ez-quiz', version: '2.0.0' };
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

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

function callTool(name, args) {
  if (name === 'open_quiz') return openQuiz(args);
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

async function dispatch(message) {
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
    return rpcResult(id, callTool(params.name, params.arguments || {}));
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
    const results = (await Promise.all(payload.map((message) => dispatch(message)))).filter(Boolean);
    return results.length
      ? response(200, results, { ...cors, 'Mcp-Protocol-Version': DEFAULT_PROTOCOL_VERSION })
      : response(202, '', cors);
  }
  const result = await dispatch(payload);
  return result
    ? response(200, result, { ...cors, 'Mcp-Protocol-Version': DEFAULT_PROTOCOL_VERSION })
    : response(202, '', cors);
};

exports._private = {
  callTool,
  dispatch,
  openQuiz,
  tools,
  widgetResource,
};
