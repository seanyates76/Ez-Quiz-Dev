'use strict';

/**
 * Explanation providers for lazy on-demand explanations.
 *
 * This module intentionally avoids stub output by default. If a real model
 * provider is not configured, callers get a clear failure they can surface
 * honestly in the UI.
 */

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite-preview-09-2025';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

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

  if (q.type === 'TF') {
    return typeof answer === 'boolean' ? (answer ? 'True' : 'False') : 'No answer selected';
  }

  if (q.type === 'YN') {
    return typeof answer === 'boolean' ? (answer ? 'Yes' : 'No') : 'No answer selected';
  }

  if (q.type === 'MT') {
    const picked = Array.isArray(answer) ? answer : [];
    if (!picked.length) return 'No answer selected';
    return picked.map((ri, li) => {
      if (!Number.isInteger(ri) || ri < 0) return `${li + 1}-?`;
      const matchText = q.right && q.right[ri] ? ` ${q.right[ri]}` : '';
      return `${li + 1}-${String.fromCharCode(65 + ri)}${matchText ? ` ${matchText}` : ''}`;
    }).join('; ');
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
    '- Use a third line only when the learner answer adds value. Start it with "You chose:", "Still needed:", or "Not part of the key:".',
    '- Mention the correct answer explicitly and keep the wording direct.',
    '- Use plain ASCII punctuation only. Do not use markdown, bullets, code fences, or em dashes.',
    '- If a question lacks enough context for a fuller reason, use: "Why it fits: The quiz item does not include enough context for a fuller explanation."',
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
      const pairStrings = q.pairs.map(([li, ri]) => `${li + 1}-${String.fromCharCode(65 + ri)}`);
      prompt.push(`Correct matches: ${pairStrings.join(', ')}`);
    }

    prompt.push('');
  });

  return prompt.join('\n');
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const withoutFences = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return withoutFences.slice(start, end + 1);
  }
  return withoutFences;
}

function parseJsonExplanationOutput(text, originalIndices) {
  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText);
  const items = Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed)
      ? parsed
      : [];
  const explanations = {};

  items.forEach((item) => {
    const qNum = parseInt(String(item?.q ?? item?.index ?? ''), 10);
    const explanation = normalizeExplanationText(String(item?.explanation || '').trim());
    if (!Number.isFinite(qNum) || !explanation) return;
    if (qNum < 1 || qNum > originalIndices.length) return;
    const originalIndex = originalIndices[qNum - 1];
    explanations[originalIndex] = { explanation };
  });

  return explanations;
}

function parseLineBasedExplanationOutput(text, originalIndices) {
  const explanations = {};
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  let currentQ = 0;
  let buffer = [];

  function flushCurrent() {
    if (!Number.isFinite(currentQ) || currentQ < 1 || currentQ > originalIndices.length) return;
    const explanation = normalizeExplanationText(buffer.join('\n'));
    if (!explanation) return;
    const originalIndex = originalIndices[currentQ - 1];
    explanations[originalIndex] = { explanation };
  }

  for (const line of lines) {
    const match = line.match(/^Q(\d+):\s*(.*)$/);
    if (match) {
      flushCurrent();
      currentQ = parseInt(match[1], 10);
      buffer = match[2] ? [match[2].trim()] : [];
      continue;
    }
    if (currentQ) buffer.push(line);
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

async function geminiExplain({ apiKey, model = DEFAULT_GEMINI_MODEL, questions, originalIndices, attemptedAnswers }) {
  if (!apiKey) throw new Error('Explanation provider is not configured');
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const prompt = buildExplanationPrompt(questions, attemptedAnswers);
  const result = await m.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topK: 32,
      topP: 0.9,
      maxOutputTokens: 1536,
    },
  });
  const text = (result?.response?.text?.() || '').trim();
  const explanations = parseExplanationOutput(text, originalIndices);
  if (!Object.keys(explanations).length) {
    throw new Error('The explainer returned an unreadable response');
  }
  return explanations;
}

async function openaiExplain({ apiKey, model = DEFAULT_OPENAI_MODEL, questions, originalIndices, attemptedAnswers }) {
  if (!apiKey) throw new Error('Explanation provider is not configured');
  const prompt = buildExplanationPrompt(questions, attemptedAnswers);
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You write concise quiz explanations and follow JSON output requirements exactly.'
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });
  if (!resp.ok) {
    let detail = await resp.text().catch(() => String(resp.status));
    try { detail = JSON.parse(detail); } catch {}
    const err = new Error(`OpenAI HTTP ${resp.status}`);
    err.status = resp.status;
    err.details = detail;
    throw err;
  }
  const data = await resp.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  const explanations = parseExplanationOutput(text, originalIndices);
  if (!Object.keys(explanations).length) {
    throw new Error('The explainer returned an unreadable response');
  }
  return explanations;
}

function shouldAllowEcho(env) {
  return String(env?.ALLOW_ECHO_EXPLANATIONS || '').trim().toLowerCase() === 'true';
}

function echoExplain(questions, originalIndices) {
  const explanations = {};

  questions.forEach((q, index) => {
    const originalIndex = originalIndices[index];
    explanations[originalIndex] = {
      explanation: normalizeExplanationText(`Answer: ${q.type} item.\nWhy it fits: Echo fallback should only run in explicit test environments.`),
    };
  });

  return explanations;
}

function resolveExplainProvider(provider, env) {
  const selected = String(provider || env.EXPLAIN_PROVIDER || env.AI_PROVIDER || '').trim().toLowerCase();
  if (selected) return selected;
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.OPENAI_API_KEY) return 'openai';
  if (shouldAllowEcho(env)) return 'echo';
  return '';
}

async function explainQuestions({ provider, model, questions, originalIndices, attemptedAnswers, env }) {
  const selected = resolveExplainProvider(provider, env);
  const queue = [];
  const seen = new Set();

  function enqueue(name) {
    if (!name || seen.has(name)) return;
    seen.add(name);
    queue.push(name);
  }

  enqueue(selected);
  if (selected !== 'gemini' && env.GEMINI_API_KEY) enqueue('gemini');

  let lastErr = null;
  try {
    if (!queue.length) {
      throw new Error('Explanation provider is not configured');
    }

    for (const candidate of queue) {
      try {
        if (candidate === 'gemini') {
          return await geminiExplain({
            apiKey: env.GEMINI_API_KEY,
            model: model || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
            questions,
            originalIndices,
            attemptedAnswers,
          });
        }

        if (candidate === 'openai') {
          return await openaiExplain({
            apiKey: env.OPENAI_API_KEY,
            model: model || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
            questions,
            originalIndices,
            attemptedAnswers,
          });
        }

        if (candidate === 'echo' && shouldAllowEcho(env)) {
          return echoExplain(questions, originalIndices);
        }

        throw new Error('Explanation provider is not configured');
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error('Explanation provider is not configured');
  } catch (err) {
    const e = new Error(String((err && err.message) || err));
    e.status = err && err.status;
    e.details = err && err.details;
    throw e;
  }
}

module.exports = {
  explainQuestions,
  buildExplanationPrompt,
  parseExplanationOutput,
  extractJsonObject,
  normalizeExplanationText,
};
