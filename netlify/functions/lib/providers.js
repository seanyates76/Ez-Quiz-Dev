'use strict';

const { normalizeLegacyLines } = require('./normalizer.js');
const { cleanSourceText: cleanSourceMaterial } = require('./sourceMaterial.js');

const PRIVATE_KNOWLEDGE_START = 'PRIVATE INSTRUCTOR KNOWLEDGE START';
const PRIVATE_KNOWLEDGE_END = 'PRIVATE INSTRUCTOR KNOWLEDGE END';

function privateInstructorKnowledgeBlock(source){
  return [
    `Private instructor knowledge follows. Use it only to determine subject-matter facts, vocabulary, constraints, and correct answers. It is hidden from the learner.`,
    PRIVATE_KNOWLEDGE_START,
    source,
    PRIVATE_KNOWLEDGE_END,
  ].join('\n');
}

function sourceFramingInstructions(){
  return [
    `Learner framing: Use the private instructor knowledge only as hidden teacher knowledge for the subject matter.`,
    `Do not mention or imply the existence of private instructor knowledge, source material, notes, lesson, documentation, provided information, provided text, workflow guidance, excerpts, handouts, readings, passages, or documents.`,
    `Every question, answer choice, and explanation must stand alone as a normal subject-matter quiz item.`,
    `Prefer real troubleshooting scenarios, device/config behavior questions, conceptual networking questions, command-output interpretation questions, and design/tradeoff questions.`,
    `If a draft only makes sense by referencing the private instructor knowledge, rewrite it into one of those subject-matter frames or discard it.`,
    `Do not use document-framing phrases such as "according to", "based solely on", "provided documentation", "provided material", or "the source material".`,
    `MC answer choices: each option must be a complete standalone answer choice. No option may begin with a dangling connector such as "however," "because," "therefore," or "although".`,
    `TF/YN statements: test one claim at a time. Avoid multi-claim sentences joined by "and," "while," "although," or "because" unless the relationship itself is being tested.`,
  ].join('\n');
}

function difficultyGuidance(difficulty){
  const diff = difficulty
    ? String(difficulty).trim().toLowerCase().replace(/[-_\s]+/g, ' ')
    : '';
  const prettyDiff = diff
    ? diff.split(/[-_\s]+/).map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : '').join(' ')
    : '';

  if(!diff) return '';

  const shared = [
    `Difficulty target: ${prettyDiff}. Difficulty should come from the thinking required, not from dense wording.`,
    `Use clear subject-matter language. Keep stems concise unless the scenario genuinely needs detail.`,
    `Use technical terms when the topic requires them, but do not make the wording artificially dense.`,
    `Avoid making questions harder by using inflated phrasing, vague abstractions, or excessive absolute traps.`,
    `Do not overuse words like "solely", "exclusively", "guarantee", "inherently", "unequivocally", or "definitively" unless that exact absolute meaning is the concept being tested.`,
  ];

  if(diff === 'very easy'){
    return [
      ...shared,
      `Very Easy: test one obvious fact, term, definition, purpose, command/function, or basic behavior. Use short direct stems and obvious distractors.`,
    ].join('\n');
  }

  if(diff === 'easy'){
    return [
      ...shared,
      `Easy: test one direct fact, definition, purpose, command/function, or basic behavior. Use short stems. Avoid trick wording.`,
    ].join('\n');
  }

  if(diff === 'medium'){
    return [
      ...shared,
      `Medium: test applied understanding. Use compact realistic scenarios that require one inference, comparison, or cause/effect link. Distractors should be plausible but not sneaky.`,
    ].join('\n');
  }

  if(diff === 'hard'){
    return [
      ...shared,
      `Hard: test applied judgment, important distinctions, cause/effect, classification, chronology, troubleshooting, design tradeoffs, or multi-step reasoning.`,
      `Use the subject's real context.`,
      `For technical topics, this may include device behavior, command output, configuration choices, protocols, procedures, or failure diagnosis.`,
      `For nontechnical topics, this may include meaningful comparisons, timeline/order relationships, role/status distinctions, evidence-based interpretation, or choosing the best action in a realistic scenario.`,
      `Prefer useful difficulty over obscure trivia. Avoid making Hard depend mainly on niche names, one-off facts, or fan-lore minutiae unless the provided material clearly emphasizes them.`,
      `For TF/YN, do not make most questions hinge on one sneaky absolute word.`,
    ].join('\n');
  }

  if(diff === 'expert'){
    return [
      ...shared,
      `Expert: test edge cases, competing interpretations, multi-step diagnosis, subtle distinctions, or advanced subject-matter relationships.`,
      `For technical topics, protocol/device behavior and command-output interpretation are appropriate when relevant.`,
      `Keep language clear even when reasoning is demanding.`,
    ].join('\n');
  }

  return [
    ...shared,
    `Match the requested level with appropriate reasoning depth and fair distractors.`,
  ].join('\n');
}

// Utility: build strict prompt compatible with front-end parser
function buildPrompt(topic, count, types, difficulty, avoidStems, sourceText){
  const allowed = Array.isArray(types) && types.length ? types.map(t=>t.toUpperCase()).filter(t=>/^(MC|TF|YN|MT)$/.test(t)) : ['MC','TF','YN','MT'];
  const allowLine = `Allowed question types: ${allowed.join(', ')} (use only these).`;
  const diffLine = difficultyGuidance(difficulty);
  const avoid = Array.isArray(avoidStems) && avoidStems.length
    ? `Avoid repeating these already-used question stems: ${avoidStems.slice(-60).join(' | ')}.`
    : '';
  const source = cleanSourceMaterial(sourceText);
  const sourceBlock = source ? privateInstructorKnowledgeBlock(source) : '';
  return [
    source ? `Task: Produce a normal subject-matter quiz about ${topic}.` : `Task: Produce a quiz about ${topic}.`,
    source ? sourceFramingInstructions() : '',
    sourceBlock,
    allowLine,
    diffLine,
    avoid,
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
  ].filter(Boolean).join('\n');
}

function buildStructuredPrompt(topic, count, types, difficulty, sourceText){
  const allowed = Array.isArray(types) && types.length ? types.map(t=>t.toUpperCase()).filter(t=>/^(MC|TF|YN|MT)$/.test(t)) : ['MC','TF','YN','MT'];
  const diffLine = difficultyGuidance(difficulty);
  const source = cleanSourceMaterial(sourceText);
  const sourceBlock = source ? privateInstructorKnowledgeBlock(source) : '';
  return [
    source ? `You are generating a structured normal subject-matter quiz about ${topic}.` : `You are generating a structured quiz about ${topic}.`,
    source ? sourceFramingInstructions() : '',
    sourceBlock,
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

function stemFromLine(line){
  if(!line) return '';
  const raw = String(line).trim();
  if(!raw) return '';
  const parts = raw.split('|');
  return (parts.length > 1 ? parts[1] : raw).trim();
}

function outputTokenBudget(count, kind = 'legacy'){
  const n = Math.max(1, Math.min(50, parseInt(count || 10, 10) || 10));
  const perQuestion = kind === 'structured' ? 220 : 260;
  return Math.max(2500, Math.min(12000, 900 + (n * perQuestion)));
}

async function geminiCall({ apiKey, model = 'gemini-2.5-flash-lite-preview-09-2025', prompt, maxOutputTokens = 1024 }){
  if(!apiKey) throw new Error('Missing GEMINI_API_KEY');
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const result = await m.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.6, topK: 32, topP: 0.9, maxOutputTokens },
  });
  return (result?.response?.text?.() || '').trim();
}

async function openaiCall({ apiKey, model = 'gpt-4o-mini', prompt, maxTokens = 800 }){
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
      max_tokens: maxTokens,
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

function echoGenerate({ topic, count, types, kind, avoidStems }){
  const out = [];
  const t = topic || 'General knowledge';
  const T = toTitleCase(t);
  const allowed = Array.isArray(types) && types.length ? types.map(x=>x.toUpperCase()).filter(x=>/^(MC|TF|YN|MT)$/.test(x)) : ['MC','TF','YN','MT'];
  const pickType = (i)=> allowed[i % allowed.length];
  const start = Array.isArray(avoidStems) ? avoidStems.length : 0;
  if(kind === 'structured'){
    const questions = [];
    for(let i=0;i<count;i++){
      const num = start + i + 1;
      const tt = pickType(i);
      if(tt==='MC'){
        questions.push({
          type: 'MC',
          prompt: `About ${T} — Sample Q ${num}?`,
          options: ['Option A','Option B','Option C','Option D'],
          correct: ['A'],
        });
      } else if(tt==='TF'){
        questions.push({ type: 'TF', prompt: `About ${T} — Sample Q ${num}.`, correct: true });
      } else if(tt==='YN'){
        questions.push({ type: 'YN', prompt: `About ${T} — Sample Q ${num}?`, correct: true });
      } else {
        questions.push({
          type: 'MT',
          prompt: `About ${T} — Match ${num}.`,
          left: ['Term 1','Term 2'],
          right: ['Definition A','Definition B'],
          matches: [[1,'A'],[2,'B']],
        });
      }
    }
    return JSON.stringify({ title: `${T} Quiz`, topic: T, questions }, null, 2);
  }
  for(let i=0;i<count;i++){
    const num = start + i + 1;
    const tt = pickType(i);
    if(tt==='MC') out.push(`MC|About ${T} — Sample Q ${num}?|A) Option A;B) Option B;C) Option C;D) Option D|A`);
    else if(tt==='TF') out.push(`TF|About ${T} — Sample Q ${num}.|T`);
    else if(tt==='YN') out.push(`YN|About ${T} — Sample Q ${num}?|Y`);
    else out.push(`MT|About ${T} — Match ${num}.|1) Term 1;2) Term 2|A) Definition A;B) Definition B|1-A,2-B`);
  }
  return out.join('\n');
}

async function callProvider({ provider, model, topic, count, types, difficulty, env, prompt, kind = 'legacy', sourceText, avoidStems }){
  const selected = (provider || (env.AI_PROVIDER || 'gemini')).toLowerCase();
  const normalizedCount = Math.max(1, Math.min(50, parseInt(count || 10, 10)));
  const resolvedPrompt = prompt || buildPrompt(topic, normalizedCount, types, difficulty, avoidStems, sourceText);
  // [quiz-v2: hook] provider call surface — swap prompt/response handling when structured default graduates.

  try {
    if (selected === 'gemini') {
      const resolvedModel = model || env.GEMINI_MODEL || 'gemini-2.5-flash-lite-preview-09-2025';
      const text = await geminiCall({ apiKey: env.GEMINI_API_KEY, model: resolvedModel, prompt: resolvedPrompt, maxOutputTokens: outputTokenBudget(normalizedCount, kind) });
      return { provider: 'gemini', model: resolvedModel, text };
    }
    if (selected === 'openai') {
      const resolvedModel = model || env.OPENAI_MODEL || 'gpt-4o-mini';
      const text = await openaiCall({ apiKey: env.OPENAI_API_KEY, model: resolvedModel, prompt: resolvedPrompt, maxTokens: outputTokenBudget(normalizedCount, kind) });
      return { provider: 'openai', model: resolvedModel, text };
    }
    if (selected === 'echo') {
      const text = echoGenerate({ topic, count: normalizedCount, types, difficulty, kind, avoidStems });
      return { provider: 'echo', model: 'echo', text };
    }
    throw new Error(`Unknown provider: ${provider}`);
  } catch (err) {
    const e = new Error(String((err && err.message) || err));
    e.status = err && err.status;
    e.details = err && err.details;
    e.code = err && err.code;
    throw e;
  }
}

async function generateLines({ provider, model, topic, count, types, difficulty, env, avoidStems, sourceText }){
  const n = Math.max(1, Math.min(50, parseInt(count||10,10)));
  const prompt = buildPrompt(topic, n, types, difficulty, avoidStems, sourceText);
  const { provider: usedProvider, model: usedModel, text } = await callProvider({ provider, model, topic, count: n, types, difficulty, env, prompt, kind: 'legacy', sourceText, avoidStems });
  const { title, lines } = normalizeLegacyLines(text, n);
  return { provider: usedProvider, model: usedModel, title, lines };
}

async function generateInBatches({ provider, model, topic, count, types, difficulty, env = process.env, batchSize, maxPasses, sourceText, avoidStems }){
  const targetRaw = count == null ? 10 : count;
  let target = parseInt(targetRaw, 10);
  if(!Number.isFinite(target)) target = 10;
  target = Math.max(1, Math.min(100, target));

  let batch = parseInt(batchSize, 10);
  if(!Number.isFinite(batch)) batch = Math.min(40, target);
  if(!batchSize && env && env.GENERATE_BATCH_SIZE) {
    const configuredBatch = parseInt(env.GENERATE_BATCH_SIZE, 10);
    if(Number.isFinite(configuredBatch)) batch = configuredBatch;
  }
  if(!batchSize && target > 25 && batch > 20) batch = 20;
  batch = Math.max(1, Math.min(50, batch));

  let passes = parseInt(maxPasses, 10);
  if(!Number.isFinite(passes) || passes < 1){
    passes = Math.ceil(target / batch) + 2;
  }
  passes = Math.max(2, Math.min(12, passes));

  const seen = new Set();
  const avoidList = [];
  if(Array.isArray(avoidStems)){
    for(const stem of avoidStems){
      const rawStem = String(stem || '').trim();
      const key = stemKeyFromLine(rawStem);
      if(!rawStem || !key || seen.has(key)) continue;
      seen.add(key);
      avoidList.push(rawStem);
    }
  }
  const collected = [];
  let resolvedTitle = '';
  let resolvedProvider = '';
  let resolvedModel = '';

  for(let attempt = 0; attempt < passes && collected.length < target; attempt++){
    const remaining = target - collected.length;
    const ask = Math.min(batch, remaining);
    const { title, lines, provider: usedProvider, model: usedModel } = await generateLines({ provider, model, topic, count: ask, types, difficulty, env, avoidStems: avoidList.slice(-60), sourceText });

    if(!resolvedTitle && title) resolvedTitle = title;
    if(usedProvider) resolvedProvider = usedProvider;
    if(usedModel) resolvedModel = usedModel;

    const chunkLines = splitNormalizedLines(lines);
    for(const line of chunkLines){
      const key = stemKeyFromLine(line);
      if(!key || seen.has(key)) continue;
      seen.add(key);
      const stem = stemFromLine(line);
      if(stem) avoidList.push(stem);
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

module.exports = { generateLines, generateInBatches, callProvider, buildPrompt, buildStructuredPrompt, cleanSourceMaterial, outputTokenBudget };
