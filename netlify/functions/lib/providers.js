'use strict';

const { normalizeLegacyLines } = require('./normalizer.js');

// Utility: build strict prompt compatible with front-end parser
function buildPrompt(topic, count, types, difficulty){
  const allowed = Array.isArray(types) && types.length ? types.map(t=>t.toUpperCase()).filter(t=>/^(MC|TF|YN|MT)$/.test(t)) : ['MC','TF','YN','MT'];
  const allowLine = `Allowed question types: ${allowed.join(', ')} (use only these).`;
  const diff = (difficulty && String(difficulty).toLowerCase()) || '';
  const prettyDiff = diff ? diff.split(/[-_\s]+/).map(w=> w ? w.charAt(0).toUpperCase()+w.slice(1) : '').join(' ') : '';
  const diffLine = diff
    ? `Difficulty guidance: scale is Very Easy < Easy < Medium < Hard < Expert. Target level: ${prettyDiff}. Match question complexity, vocabulary, and expected knowledge to this level.`
    : '';
  return [
    `Task: Produce a quiz about ${topic}.`,
    allowLine,
    diffLine,
    `Output format:`,
    `1) First line must be: TITLE: <Professional Title>`,
    `   - Use Title Case, depluralize the last word if plural (e.g., "Histories" -> "History", "Ports" -> "Port").`,
    `   - No parentheses or file extensions; keep it concise (e.g., "World History Quiz").`,
    `2) Then output EXACTLY ${count} quiz lines, one per line, using ONLY these formats:`,
    `MC|Question?|A) Option 1;B) Option 2;C) Option 3;D) Option 4|A`,
    `MC|Question with multiple answers?|A) 1;B) 2;C) 3;D) 4|A,C`,
    `TF|A true/false statement.|T`,
    `YN|A yes/no question.|Y`,
    `MT|Match.|1) L1;2) L2;3) L3|A) R1;B) R2;C) R3|1-A,2-B,3-C`,
    `Hard rules:`,
    `- Output only plain text. No numbering, bullet points, or commentary.`,
    `- Exactly 1 title line starting with "TITLE:" plus ${count} quiz lines.`,
    `- Use only allowed types: ${allowed.join(', ')}.`,
    `- MC correct field may be single (A) or multiple (A,C).`,
    `- No blank lines.`,
  ].join('\n');
}

function buildStructuredPrompt(topic, count, types, difficulty){
  const allowed = Array.isArray(types) && types.length ? types.map(t=>t.toUpperCase()).filter(t=>/^(MC|TF|YN|MT)$/.test(t)) : ['MC','TF','YN','MT'];
  const diff = (difficulty && String(difficulty).toLowerCase()) || '';
  const prettyDiff = diff ? diff.split(/[-_\s]+/).map(w=> w ? w.charAt(0).toUpperCase()+w.slice(1) : '').join(' ') : '';
  const diffLine = diff
    ? `Match difficulty to ${prettyDiff} on a scale of Very Easy < Easy < Medium < Hard < Expert.`
    : '';
  return [
    `You are generating a structured quiz about ${topic}.`,
    diffLine,
    `Allowed question types: ${allowed.join(', ')}. Use only these codes.`,
    `Respond with valid minified JSON only. Do not include markdown fences or commentary.`,
    `Schema:`,
    `{`,
    `  "title": "Professional title in Title Case",`,
    `  "topic": "Short topic label",`,
    `  "questions": [`,
    `    {`,
    `      "type": "MC" | "TF" | "YN" | "MT",`,
    `      "prompt": "Question text",`,
    `      // MC only: "options": ["Option 1", "Option 2", ...], minimum 2,`,
    `      // MC only: "correct": ["A", "C"], letters for all correct options`,
    `      // TF only: "correct": true|false`,
    `      // YN only: "correct": true|false (true = Yes)`,
    `      // MT only: "left": ["Prompt 1", ...], "right": ["Match A", ...],`,
    `      // MT only: "matches": [[1, "A"], [2, "B"], ...] using 1-based numbers + letters`,
    `    }`,
    `  ]`,
    `}`,
    `Include exactly ${count} questions. Ensure arrays align and answers are accurate.`,
  ].filter(Boolean).join('\n');
}

function splitNormalizedLines(lines){
  if(!lines) return [];
  return String(lines)
    .split('\n')
    .map((l)=>l.trim())
    .filter(Boolean);
}

function stemKeyFromLine(line){
  if(!line) return '';
  const raw = String(line).trim();
  if(!raw) return '';
  const parts = raw.split('|');
  const stem = parts.length > 1 ? parts[1] : raw;
  // Normalize whitespace and remove trivial spaces before punctuation
  return stem
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+([?!.,:;])/g, '$1')
    .toLowerCase();
}

async function geminiCall({ apiKey, model = 'gemini-2.5-flash-lite', prompt }){
  if(!apiKey) throw new Error('Missing GEMINI_API_KEY');
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const result = await m.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.6, topK: 32, topP: 0.9, maxOutputTokens: 1024 },
  });
  return (result?.response?.text?.() || '').trim();
}

async function openaiCall({ apiKey, model = 'gpt-4o-mini', prompt }){
  if(!apiKey) throw new Error('Missing OPENAI_API_KEY');
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a quiz line generator. Follow rules exactly.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 800,
    }),
  });
  if(!resp.ok){
    let detail = await resp.text().catch(()=>String(resp.status));
    try { detail = JSON.parse(detail); } catch {}
    const err = new Error(`OpenAI HTTP ${resp.status}`);
    err.status = resp.status;
    err.details = detail;
    throw err;
  }
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

function toTitleCase(str){
  if(!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/(^|[\s_-])([a-z])/g, (_, p1, p2) => `${p1}${p2.toUpperCase()}`)
    .trim();
}

function echoGenerate({ topic, count, types, kind }){
  const out = [];
  const t = topic || 'General knowledge';
  const T = toTitleCase(t);
  const allowed = Array.isArray(types) && types.length ? types.map(x=>x.toUpperCase()).filter(x=>/^(MC|TF|YN|MT)$/.test(x)) : ['MC','TF','YN','MT'];
  const pickType = (i)=> allowed[i % allowed.length];
  if(kind === 'structured'){
    const questions = [];
    for(let i=0;i<count;i++){
      const tt = pickType(i);
      if(tt==='MC'){
        questions.push({
          type: 'MC',
          prompt: `About ${T} — Sample Q ${i+1}?`,
          options: ['Option A','Option B','Option C','Option D'],
          correct: ['A'],
        });
      } else if(tt==='TF'){
        questions.push({ type: 'TF', prompt: `About ${T} — Sample Q ${i+1}.`, correct: true });
      } else if(tt==='YN'){
        questions.push({ type: 'YN', prompt: `About ${T} — Sample Q ${i+1}?`, correct: true });
      } else {
        questions.push({
          type: 'MT',
          prompt: `About ${T} — Match ${i+1}.`,
          left: ['Term 1','Term 2'],
          right: ['Definition A','Definition B'],
          matches: [[1,'A'],[2,'B']],
        });
      }
    }
    return JSON.stringify({ title: `${T} Quiz`, topic: T, questions }, null, 2);
  }
  for(let i=0;i<count;i++){
    const tt = pickType(i);
    if(tt==='MC') out.push(`MC|About ${T} — Sample Q ${i+1}?|A) Option A;B) Option B;C) Option C;D) Option D|A`);
    else if(tt==='TF') out.push(`TF|About ${T} — Sample Q ${i+1}.|T`);
    else if(tt==='YN') out.push(`YN|About ${T} — Sample Q ${i+1}?|Y`);
    else out.push(`MT|About ${T} — Match ${i+1}.|1) Term 1;2) Term 2|A) Definition A;B) Definition B|1-A,2-B`);
  }
  return out.join('\n');
}

async function callProvider({ provider, model, topic, count, types, difficulty, env, prompt, kind = 'legacy' }){
  const selected = (provider || (env.AI_PROVIDER || 'gemini')).toLowerCase();
  const normalizedCount = Math.max(1, Math.min(50, parseInt(count || 10, 10)));
  const resolvedPrompt = prompt || buildPrompt(topic, normalizedCount, types, difficulty);
  // [quiz-v2: hook] provider call surface — swap prompt/response handling when structured default graduates.

  try {
    if (selected === 'gemini') {
      const resolvedModel = model || env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
      const text = await geminiCall({ apiKey: env.GEMINI_API_KEY, model: resolvedModel, prompt: resolvedPrompt });
      return { provider: 'gemini', model: resolvedModel, text };
    }
    if (selected === 'openai') {
      const resolvedModel = model || env.OPENAI_MODEL || 'gpt-4o-mini';
      const text = await openaiCall({ apiKey: env.OPENAI_API_KEY, model: resolvedModel, prompt: resolvedPrompt });
      return { provider: 'openai', model: resolvedModel, text };
    }
    if (selected === 'echo') {
      const text = echoGenerate({ topic, count: normalizedCount, types, difficulty, kind });
      return { provider: 'echo', model: 'stub', text };
    }
    throw new Error(`Unknown provider: ${provider}`);
  } catch (err) {
    const e = new Error(String((err && err.message) || err));
    e.status = err && err.status;
    e.details = err && err.details;
    throw e;
  }
}

async function generateLines({ provider, model, topic, count, types, difficulty, env }){
  const n = Math.max(1, Math.min(50, parseInt(count||10,10)));
  const prompt = buildPrompt(topic, n, types, difficulty);
  const { provider: usedProvider, model: usedModel, text } = await callProvider({ provider, model, topic, count: n, types, difficulty, env, prompt, kind: 'legacy' });
  const { title, lines } = normalizeLegacyLines(text, n);
  return { provider: usedProvider, model: usedModel, title, lines };
}

async function generateInBatches({ provider, model, topic, count, types, difficulty, env = process.env, batchSize, maxPasses }){
  const targetRaw = count == null ? 10 : count;
  let target = parseInt(targetRaw, 10);
  if(!Number.isFinite(target)) target = 10;
  target = Math.max(1, Math.min(100, target));

  let batch = parseInt(batchSize, 10);
  if(!Number.isFinite(batch)) batch = Math.min(40, target);
  batch = Math.max(1, Math.min(50, batch));

  let passes = parseInt(maxPasses, 10);
  if(!Number.isFinite(passes) || passes < 1){
    passes = Math.ceil(target / batch) + 2;
  }
  passes = Math.max(2, Math.min(12, passes));

  const seen = new Set();
  const collected = [];
  let resolvedTitle = '';
  let resolvedProvider = '';
  let resolvedModel = '';

  for(let attempt = 0; attempt < passes && collected.length < target; attempt++){
    const remaining = target - collected.length;
    const ask = Math.min(50, Math.max(batch, remaining));
    const { title, lines, provider: usedProvider, model: usedModel } = await generateLines({ provider, model, topic, count: ask, types, difficulty, env });

    if(!resolvedTitle && title) resolvedTitle = title;
    if(usedProvider) resolvedProvider = usedProvider;
    if(usedModel) resolvedModel = usedModel;

    const chunkLines = splitNormalizedLines(lines);
    for(const line of chunkLines){
      const key = stemKeyFromLine(line);
      if(!key || seen.has(key)) continue;
      seen.add(key);
      collected.push(line);
      if(collected.length >= target) break;
    }
  }

  return {
    provider: resolvedProvider || provider || '',
    model: resolvedModel || model || '',
    title: resolvedTitle,
    lines: collected.slice(0, target).join('\n'),
  };
}

module.exports = { generateLines, generateInBatches, callProvider, buildStructuredPrompt };
