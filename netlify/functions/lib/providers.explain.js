'use strict';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite-preview-09-2025';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function makeExplainError(message, code, status, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeExplanationText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[–—]/g, ', ')
    .split('\n')
    .map((line) => line.trim().replace(/^[-*•]\s*/, '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1'))
    .filter(Boolean)
    .join('\n');
}

function formatChoice(options, idx) {
  const letter = String.fromCharCode(65 + idx);
  const text = options && options[idx] ? String(options[idx]).trim() : '';
  return text ? `${letter}) ${text}` : letter;
}

function formatAttemptedAnswer(q, answer) {
  if (!q) return 'No answer selected';
  if (q.type === 'MC') {
    const picked = Array.isArray(answer) ? answer : [];
    if (!picked.length) return 'No answer selected';
    return picked.map((idx) => formatChoice(q.options, idx)).join('; ');
  }
  if (q.type === 'TF') return typeof answer === 'boolean' ? (answer ? 'True' : 'False') : 'No answer selected';
  if (q.type === 'YN') return typeof answer === 'boolean' ? (answer ? 'Yes' : 'No') : 'No answer selected';
  if (q.type === 'MT') {
    const picked = Array.isArray(answer) ? answer : [];
    if (!picked.length) return 'No answer selected';
    return picked.map((ri, li) => Number.isInteger(ri) && ri >= 0 ? `${li + 1}-${String.fromCharCode(65 + ri)}` : `${li + 1}-?`).join('; ');
  }
  return 'No answer selected';
}

function buildExplanationPrompt(questions, attemptedAnswers = []) {
  const prompt = [
    'You write short, accurate quiz answer explanations for study review.',
    'Return minified JSON only.',
    'Schema: {"items":[{"q":1,"explanation":"..."},{"q":2,"explanation":"..."}]}',
    'Rules:',
    '- Each explanation must be 2 or 3 short lines separated by \\n and under 320 characters total.',
    '- Keep each line to one short sentence when possible.',
    '- Line 1 must start with "Answer:".',
    '- Line 2 must start with "Why it fits:".',
    '- Mention the correct answer explicitly and keep the wording direct.',
    '- Use plain ASCII punctuation only. Do not use markdown, bullets, code fences, or em dashes.',
    '',
    'Questions:'
  ];

  questions.forEach((q, index) => {
    const qNum = index + 1;
    prompt.push(`Q${qNum}: ${q.text}`);
    prompt.push(`Learner answer: ${formatAttemptedAnswer(q, attemptedAnswers[index])}`);
    if (q.type === 'MC') {
      prompt.push(`Options: ${q.options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('; ')}`);
      const correctLetters = q.correct.map((i) => String.fromCharCode(65 + i)).join(', ');
      const correctText = q.correct.map((i) => formatChoice(q.options, i)).join('; ');
      prompt.push(`Correct answer(s): ${correctLetters}`);
      prompt.push(`Correct option text: ${correctText}`);
    } else if (q.type === 'TF') {
      prompt.push(`Correct answer: ${q.correct ? 'True' : 'False'}`);
    } else if (q.type === 'YN') {
      prompt.push(`Correct answer: ${q.correct ? 'Yes' : 'No'}`);
    } else if (q.type === 'MT') {
      prompt.push(`Left items: ${q.left.map((item, i) => `${i + 1}) ${item}`).join('; ')}`);
      prompt.push(`Right items: ${q.right.map((item, i) => `${String.fromCharCode(65 + i)}) ${item}`).join('; ')}`);
      prompt.push(`Correct matches: ${q.pairs.map(([li, ri]) => `${li + 1}-${String.fromCharCode(65 + ri)}`).join(', ')}`);
    }
    prompt.push('');
  });
  return prompt.join('\n');
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const withoutFences = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (withoutFences.startsWith('[') && withoutFences.endsWith(']')) return withoutFences;
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start >= 0 && end > start) return withoutFences.slice(start, end + 1);
  return withoutFences;
}

function parseJsonExplanationOutput(text, originalIndices) {
  const jsonText = extractJsonObject(text);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    parsed = JSON.parse(jsonText.replace(/\n/g, '\\n'));
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  const explanations = {};
  items.forEach((item) => {
    const qNum = parseInt(String(item?.q ?? item?.index ?? ''), 10);
    const explanation = normalizeExplanationText(item?.explanation || '');
    if (!Number.isFinite(qNum) || qNum < 1 || qNum > originalIndices.length || !explanation) return;
    explanations[originalIndices[qNum - 1]] = { explanation };
  });
  return explanations;
}

function parseLineBasedExplanationOutput(text, originalIndices) {
  const explanations = {};
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  let currentQ = 0;
  let buffer = [];
  function flushCurrent() {
    if (!currentQ || currentQ < 1 || currentQ > originalIndices.length) return;
    const explanation = normalizeExplanationText(buffer.join('\n'));
    if (explanation) explanations[originalIndices[currentQ - 1]] = { explanation };
  }
  for (const line of lines) {
    const match = line.match(/^Q(\d+):\s*(.*)$/i);
    if (match) {
      flushCurrent();
      currentQ = parseInt(match[1], 10);
      buffer = match[2] ? [match[2].trim()] : [];
    } else if (currentQ) {
      buffer.push(line);
    }
  }
  flushCurrent();
  return explanations;
}

function parseExplanationOutput(text, originalIndices) {
  try {
    return parseJsonExplanationOutput(text, originalIndices);
  } catch {
    return parseLineBasedExplanationOutput(text, originalIndices);
  }
}

async function defaultGeminiCall({ apiKey, model, prompt }) {
  if (!apiKey) throw makeExplainError('Explanation provider is not configured', 'EXPLAIN_PROVIDER_NOT_CONFIGURED', 503);
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const result = await m.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, topK: 32, topP: 0.9, maxOutputTokens: 1536 },
  });
  return (result?.response?.text?.() || '').trim();
}

async function defaultOpenaiCall({ apiKey, model, prompt }) {
  if (!apiKey) throw makeExplainError('Explanation provider is not configured', 'EXPLAIN_PROVIDER_NOT_CONFIGURED', 503);
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You write concise quiz explanations and follow JSON output requirements exactly.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });
  if (!resp.ok) {
    let detail = await resp.text().catch(() => String(resp.status));
    try { detail = JSON.parse(detail); } catch {}
    throw makeExplainError(`OpenAI HTTP ${resp.status}`, 'EXPLAIN_PROVIDER_HTTP_ERROR', resp.status, detail);
  }
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

function truthy(value) {
  return /^(1|true|yes)$/i.test(String(value || '').trim());
}

function echoAllowed(env = {}) {
  return truthy(env.ALLOW_ECHO_EXPLANATIONS) || env.NODE_ENV === 'test';
}

function resolveExplainProvider(provider, env = {}) {
  const selected = String(provider || env.EXPLAIN_PROVIDER || env.AI_PROVIDER || '').trim().toLowerCase();
  if (selected) return selected;
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.OPENAI_API_KEY) return 'openai';
  return '';
}

function echoExplain(questions, originalIndices) {
  const explanations = {};
  questions.forEach((q, index) => {
    explanations[originalIndices[index]] = {
      explanation: normalizeExplanationText(`Answer: ${q.type} item.\nWhy it fits: Echo fallback should only run in explicit test environments.`),
    };
  });
  return explanations;
}

async function explainQuestions({ provider, model, questions = [], originalIndices = [], attemptedAnswers = [], env = process.env, callGemini, callOpenai } = {}) {
  const selected = resolveExplainProvider(provider, env);
  if (!selected) throw makeExplainError('Explanation provider is not configured', 'EXPLAIN_PROVIDER_NOT_CONFIGURED', 503);

  try {
    if (selected === 'echo') {
      if (!echoAllowed(env)) throw makeExplainError('Echo explanations are disabled', 'EXPLAIN_ECHO_DISABLED', 403);
      return echoExplain(questions, originalIndices);
    }

    const prompt = buildExplanationPrompt(questions, attemptedAnswers);
    let text = '';
    if (selected === 'gemini') {
      text = await (callGemini || defaultGeminiCall)({ apiKey: env.GEMINI_API_KEY, model: model || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, prompt });
    } else if (selected === 'openai') {
      text = await (callOpenai || defaultOpenaiCall)({ apiKey: env.OPENAI_API_KEY, model: model || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL, prompt });
    } else {
      throw makeExplainError(`Unsupported explanation provider: ${selected}`, 'EXPLAIN_PROVIDER_UNSUPPORTED', 400);
    }

    const explanations = parseExplanationOutput(text, originalIndices);
    if (!Object.keys(explanations).length) throw makeExplainError('The explainer returned an unreadable response', 'EXPLAIN_PROVIDER_UNREADABLE', 502);
    return explanations;
  } catch (err) {
    if (err && err.code) throw err;
    throw makeExplainError(String((err && err.message) || err), 'EXPLAIN_PROVIDER_ERROR', err && err.status, err && err.details);
  }
}

module.exports = {
  explainQuestions,
  buildExplanationPrompt,
  parseExplanationOutput,
  extractJsonObject,
  normalizeExplanationText,
  resolveExplainProvider,
};
