'use strict';

const TYPE_ALIASES = new Map([
  ['MULTIPLE_CHOICE', 'MC'],
  ['MULTIPLE-CHOICE', 'MC'],
  ['MULTIPLECHOICE', 'MC'],
  ['MULTIPLE CHOICE', 'MC'],
  ['CHOICE', 'MC'],
  ['MCQ', 'MC'],
  ['TRUE_FALSE', 'TF'],
  ['TRUEFALSE', 'TF'],
  ['TRUE/FALSE', 'TF'],
  ['TRUE FALSE', 'TF'],
  ['YES_NO', 'YN'],
  ['YESNO', 'YN'],
  ['YES/NO', 'YN'],
  ['MATCH', 'MT'],
  ['MATCHING', 'MT'],
  ['PAIR', 'MT'],
  ['PAIRING', 'MT'],
  ['MATCH_PAIRS', 'MT'],
]);

function sanitizeString(value){
  if(value == null) return '';
  return String(value).trim();
}

function normalizeLegacyLines(text, count){
  if(!text) return { title: '', lines: '' };
  const raw = String(text)
    .split('\n')
    .map((l)=>l.trim())
    .filter(Boolean)
    .map((l)=> l.replace(/^\d+\.\s*/, ''));
  let title = '';
  if(raw.length && /^title\s*:/i.test(raw[0])){
    title = raw.shift().replace(/^title\s*:/i,'').trim();
  }
  const limit = Math.max(1, Math.min(50, count == null ? raw.length : parseInt(count, 10) || raw.length));
  const lines = raw.filter((l)=> /^(MC|TF|YN|MT)\|/i.test(l)).slice(0, limit);
  return { title, lines: lines.join('\n') };
}

function tryParseJsonLoose(text){
  if(!text) return null;
  const trimmed = text.trim();
  if(!trimmed) return null;
  const withoutFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const candidates = [trimmed, withoutFence];
  for(const candidate of candidates){
    try {
      const parsed = JSON.parse(candidate);
      return parsed;
    } catch{}
  }
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  let start = -1;
  let isArray = false;
  if(firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)){
    start = firstBrace;
    isArray = false;
  } else if(firstBracket !== -1){
    start = firstBracket;
    isArray = true;
  }
  if(start === -1) return null;
  let depth = 0;
  for(let end = start; end < trimmed.length; end++){
    const ch = trimmed[end];
    if(ch === '{' || ch === '['){
      depth++;
    } else if(ch === '}' || ch === ']'){
      depth--;
      if(depth === 0){
        const snippet = trimmed.slice(start, end + 1);
        try {
          const parsed = JSON.parse(snippet);
          if(isArray && Array.isArray(parsed)) return { questions: parsed };
          return parsed;
        } catch{}
        break;
      }
    }
  }
  return null;
}

function toArray(value){
  if(value == null) return [];
  if(Array.isArray(value)) return value;
  return [value];
}

function letterToIndex(letter){
  if(typeof letter !== 'string') return null;
  const cleaned = letter.trim();
  if(!cleaned) return null;
  const single = cleaned.replace(/[^A-Za-z]/g, '').toUpperCase();
  if(single.length !== 1) return null;
  return single.charCodeAt(0) - 65;
}

function optionTextToIndex(text, options){
  if(typeof text !== 'string') return null;
  const cleaned = text.trim().toLowerCase();
  if(!cleaned) return null;
  const idx = options.findIndex(opt => opt.toLowerCase() === cleaned);
  return idx >= 0 ? idx : null;
}

function normalizeCorrectIndexes(raw, options){
  const values = [];
  if(Array.isArray(raw)){
    for(const item of raw){ values.push(...normalizeCorrectIndexes(item, options)); }
  } else if(typeof raw === 'string'){
    const chunk = raw.split(/[;,]/).map(s=>s.trim()).filter(Boolean);
    if(chunk.length > 1){
      for(const part of chunk){ values.push(...normalizeCorrectIndexes(part, options)); }
    } else {
      const num = Number(raw);
      if(Number.isInteger(num)){
        values.push(num >= 1 ? num - 1 : num);
      } else {
        const letterIdx = letterToIndex(raw);
        if(letterIdx != null){ values.push(letterIdx); }
        else {
          const byText = optionTextToIndex(raw, options);
          if(byText != null) values.push(byText);
        }
      }
    }
  } else if(typeof raw === 'number' && Number.isFinite(raw)){
    values.push(raw >= 1 ? raw - 1 : raw);
  } else if(raw && typeof raw === 'object'){
    if('index' in raw){ values.push(...normalizeCorrectIndexes(raw.index, options)); }
    if('letter' in raw){ values.push(...normalizeCorrectIndexes(raw.letter, options)); }
    if('value' in raw){ values.push(...normalizeCorrectIndexes(raw.value, options)); }
  }
  const uniq = [];
  for(const v of values){
    const idx = Number.isFinite(v) ? parseInt(v, 10) : NaN;
    if(Number.isInteger(idx) && idx >= 0 && idx < options.length && !uniq.includes(idx)){
      uniq.push(idx);
    }
  }
  if(uniq.length === 0 && options.length){ uniq.push(0); }
  return uniq.sort((a,b)=>a-b);
}

function normalizeBoolean(raw, fallbackTrue){
  if(typeof raw === 'boolean') return raw;
  if(typeof raw === 'number') return raw !== 0;
  if(typeof raw === 'string'){
    const cleaned = raw.trim().toLowerCase();
    if(['true','t','yes','y','1'].includes(cleaned)) return true;
    if(['false','f','no','n','0'].includes(cleaned)) return false;
  }
  return !!fallbackTrue;
}

function toZeroBasedIndex(value, size){
  if(Number.isInteger(value)){
    if(value === 0) return 0;
    if(value > 0 && value <= size) return value - 1;
    if(value < 0 && Math.abs(value) <= size) return Math.abs(value) - 1;
    return null;
  }
  const parsed = parseInt(value, 10);
  if(Number.isInteger(parsed)){
    if(parsed === 0) return 0;
    if(parsed > 0 && parsed <= size) return parsed - 1;
    if(parsed < 0 && Math.abs(parsed) <= size) return Math.abs(parsed) - 1;
  }
  return null;
}

function normalizeMatches(raw, leftLen, rightLen){
  const pairs = [];
  const pushPair = (li, ri)=>{
    if(!Number.isInteger(li) || !Number.isInteger(ri)) return;
    if(li < 0 || li >= leftLen) return;
    if(ri < 0 || ri >= rightLen) return;
    if(!pairs.some(([a,b])=>a===li && b===ri)) pairs.push([li,ri]);
  };
  if(Array.isArray(raw)){
    for(const item of raw){
      if(Array.isArray(item)){
        if(item.length >= 2){
          const li = toZeroBasedIndex(item[0], leftLen);
          let ri = toZeroBasedIndex(item[1], rightLen);
          if(ri == null){
            const letter = letterToIndex(item[1]);
            if(letter != null) ri = letter;
          }
          if(Number.isInteger(li) && Number.isInteger(ri)) pushPair(li, ri);
        }
        continue;
      }
      if(item && typeof item === 'object'){
        const liSource = item.left ?? item.source ?? item.question ?? item.prompt;
        const riSource = item.right ?? item.target ?? item.answer ?? item.response ?? item.match;
        const li = toZeroBasedIndex(liSource, leftLen);
        let ri = toZeroBasedIndex(riSource, rightLen);
        if(ri == null){
          const letter = letterToIndex(riSource);
          if(letter != null) ri = letter;
        }
        if(Number.isInteger(li) && Number.isInteger(ri)) pushPair(li, ri);
        continue;
      }
      if(typeof item === 'string'){
        const parts = item.split(/[-:>]/).map(s=>s.trim()).filter(Boolean);
        if(parts.length >= 2){
          const li = toZeroBasedIndex(parts[0], leftLen);
          let ri = toZeroBasedIndex(parts[1], rightLen);
          if(ri == null){
            const letter = letterToIndex(parts[1]);
            if(letter != null) ri = letter;
          }
          if(Number.isInteger(li) && Number.isInteger(ri)) pushPair(li, ri);
        }
      }
    }
  } else if(typeof raw === 'string'){
    const segments = raw.split(',');
    for(const seg of segments){
      const parts = seg.split(/[-:>]/).map(s=>s.trim()).filter(Boolean);
      if(parts.length >= 2){
        const li = toZeroBasedIndex(parts[0], leftLen);
        let ri = toZeroBasedIndex(parts[1], rightLen);
        if(ri == null){
          const letter = letterToIndex(parts[1]);
          if(letter != null) ri = letter;
        }
        if(Number.isInteger(li) && Number.isInteger(ri)) pushPair(li, ri);
      }
    }
  }
  return pairs;
}

function hasCompleteLeftCoverage(matches, leftLen){
  if(!Array.isArray(matches) || matches.length !== leftLen) return false;
  const seen = new Set();
  for(const pair of matches){
    if(!Array.isArray(pair) || pair.length < 2) return false;
    const li = pair[0];
    if(!Number.isInteger(li) || li < 0 || li >= leftLen || seen.has(li)) return false;
    seen.add(li);
  }
  return seen.size === leftLen;
}

function parseLegacyIndex(raw, size){
  const cleaned = sanitizeString(raw);
  if(!/^\d+$/.test(cleaned)) return null;
  const parsed = parseInt(cleaned, 10);
  if(!Number.isInteger(parsed) || parsed < 1 || parsed > size) return null;
  return parsed - 1;
}

function parseLegacyRightLetter(raw, size){
  const cleaned = sanitizeString(raw);
  if(!/^[A-Za-z]$/.test(cleaned)) return null;
  const idx = letterToIndex(cleaned);
  return Number.isInteger(idx) && idx >= 0 && idx < size ? idx : null;
}

function normalizeLegacyCorrectLetters(raw, optionsLen){
  const parts = sanitizeString(raw).split(',').map(s=>s.trim()).filter(Boolean);
  if(!parts.length) return [];
  const out = [];
  for(const part of parts){
    const idx = parseLegacyRightLetter(part, optionsLen);
    if(idx == null || out.includes(idx)) return [];
    out.push(idx);
  }
  return out.sort((a,b)=>a-b);
}

function normalizeLegacyMatchPairs(raw, leftLen, rightLen){
  const segments = sanitizeString(raw).split(',').map(s=>s.trim());
  if(!segments.length || segments.some((segment)=>!segment) || segments.length !== leftLen) return null;
  const pairs = [];
  const seenLeft = new Set();
  for(const segment of segments){
    const parts = segment.split('-').map(s=>s.trim());
    if(parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const li = parseLegacyIndex(parts[0], leftLen);
    const ri = parseLegacyRightLetter(parts[1], rightLen);
    if(li == null || ri == null || seenLeft.has(li)) return null;
    seenLeft.add(li);
    pairs.push([li, ri]);
  }
  return hasCompleteLeftCoverage(pairs, leftLen) ? pairs : null;
}

function resolveType(rawType){
  const t = sanitizeString(rawType).toUpperCase();
  if(!t) return '';
  if(['MC','TF','YN','MT'].includes(t)) return t;
  return TYPE_ALIASES.get(t) || '';
}

function normalizeStructuredQuestion(raw){
  if(!raw || typeof raw !== 'object') return null;
  const type = resolveType(raw.type ?? raw.kind ?? raw.questionType ?? raw.format);
  if(!type) return null;
  const prompt = sanitizeString(raw.prompt ?? raw.question ?? raw.text ?? raw.stem ?? raw.body);
  if(!prompt) return null;
  if(type === 'MC'){
    const options = toArray(raw.options ?? raw.choices ?? raw.answers ?? raw.variants ?? raw.optionsText)
      .map(sanitizeString)
      .filter(Boolean)
      .slice(0, 8);
    if(options.length < 2) return null;
    const correctRaw = raw.correct ?? raw.answer ?? raw.answers ?? raw.correctOptions ?? raw.correctAnswer ?? raw.key;
    const correct = normalizeCorrectIndexes(correctRaw, options);
    return { type: 'MC', prompt, options, correct };
  }
  if(type === 'TF'){
    const correctRaw = raw.correct ?? raw.answer ?? raw.value ?? raw.solution;
    const correct = normalizeBoolean(correctRaw, true);
    return { type: 'TF', prompt, correct };
  }
  if(type === 'YN'){
    const correctRaw = raw.correct ?? raw.answer ?? raw.value ?? raw.solution;
    const correct = normalizeBoolean(correctRaw, true);
    return { type: 'YN', prompt, correct };
  }
  if(type === 'MT'){
    const left = toArray(raw.left ?? raw.columnA ?? raw.prompts ?? raw.source ?? (Array.isArray(raw.pairs) ? raw.pairs.map((p)=>p.left) : undefined))
      .map(sanitizeString)
      .filter(Boolean);
    const right = toArray(raw.right ?? raw.columnB ?? raw.responses ?? raw.target ?? (Array.isArray(raw.pairs) ? raw.pairs.map((p)=>p.right) : undefined))
      .map(sanitizeString)
      .filter(Boolean);
    if(left.length === 0 || right.length === 0) return null;
    const matchesRaw = raw.matches ?? raw.pairs ?? raw.mapping ?? raw.answers ?? raw.correct;
    const matches = normalizeMatches(matchesRaw, left.length, right.length);
    if(matches.length === 0) return null;
    if(!hasCompleteLeftCoverage(matches, left.length)) return null;
    return { type: 'MT', prompt, left, right, matches };
  }
  return null;
}

const LEGACY_MC_RE = /^MC\|(.*)\|(.+?)\|([A-Za-z](?:\s*,\s*[A-Za-z])*)$/i;
const LEGACY_TF_RE = /^TF\|(.*)\|(T|F)$/i;
const LEGACY_YN_RE = /^YN\|(.*)\|(Y|N)$/i;
const LEGACY_MT_RE = /^MT\|(.*)\|(.+?)\|(.+?)\|(.+?)$/i;

function parseLegacyQuestion(line){
  const trimmed = sanitizeString(line);
  if(!trimmed) return null;
  if(LEGACY_MC_RE.test(trimmed)){
    const [, prompt, optsRaw, correctRaw] = trimmed.match(LEGACY_MC_RE);
    const options = optsRaw.split(';').map(s=>sanitizeString(s.replace(/^[A-D]\)\s*/i,''))).filter(Boolean);
    if(options.length < 2) return null;
    const correct = normalizeLegacyCorrectLetters(correctRaw, options.length);
    if(!correct.length) return null;
    return { type: 'MC', prompt: sanitizeString(prompt), options, correct };
  }
  if(LEGACY_TF_RE.test(trimmed)){
    const [, prompt, value] = trimmed.match(LEGACY_TF_RE);
    return { type: 'TF', prompt: sanitizeString(prompt), correct: /^T$/i.test(value) };
  }
  if(LEGACY_YN_RE.test(trimmed)){
    const [, prompt, value] = trimmed.match(LEGACY_YN_RE);
    return { type: 'YN', prompt: sanitizeString(prompt), correct: /^Y$/i.test(value) };
  }
  if(LEGACY_MT_RE.test(trimmed)){
    const [, prompt, leftRaw, rightRaw, pairsRaw] = trimmed.match(LEGACY_MT_RE);
    const left = leftRaw.split(';').map(s=>sanitizeString(s.replace(/^\d+\)\s*/,''))).filter(Boolean);
    const right = rightRaw.split(';').map(s=>sanitizeString(s.replace(/^[A-Z]\)\s*/i,''))).filter(Boolean);
    const matches = normalizeLegacyMatchPairs(pairsRaw, left.length, right.length);
    if(left.length && right.length && matches && matches.length){
      return { type: 'MT', prompt: sanitizeString(prompt), left, right, matches };
    }
  }
  return null;
}

function quizFromLegacyLines({ title, lines }, { topic = '', allowedTypes, limit }){
  const questions = [];
  const allowed = allowedTypes instanceof Set && allowedTypes.size ? allowedTypes : null;
  const pieces = String(lines || '')
    .split('\n')
    .map((l)=>l.trim())
    .filter(Boolean);
  for(const piece of pieces){
    const q = parseLegacyQuestion(piece);
    if(!q) continue;
    if(allowed && !allowed.has(q.type)) continue;
    questions.push(q);
    if(limit && questions.length >= limit) break;
  }
  return {
    title: sanitizeString(title),
    topic: sanitizeString(topic),
    questions,
  };
}

function normalizeQuizV2(raw, opts = {}){
  const { topic = '', count, types } = opts;
  const limit = Number.isFinite(count) ? Math.max(1, Math.min(50, parseInt(count, 10))) : undefined;
  const allowed = Array.isArray(types) && types.length
    ? new Set(types.map((t)=>sanitizeString(t).toUpperCase()).filter((t)=>/^(MC|TF|YN|MT)$/.test(t)))
    : null;

  const warnFallback = (reason, source)=>{
    try {
      const rendered = typeof source === 'string' ? source : JSON.stringify(source);
      const len = rendered ? rendered.length : 0;
      console.warn('[quiz-v2]', { reason, len });
    } catch {
      console.warn('[quiz-v2]', { reason, len: 0 });
    }
  };

  const fallbackFromLegacy = (text, reason)=>{
    warnFallback(reason, text);
    const legacy = normalizeLegacyLines(text, limit);
    const quiz = quizFromLegacyLines(legacy, { topic, allowedTypes: allowed, limit });
    if(!quiz.questions.length){
      throw Object.assign(new Error('No valid quiz lines found'), { code: 'NO_QUESTIONS' });
    }
    return quiz;
  };

  let data = raw;
  if(typeof data === 'string'){
    const parsed = tryParseJsonLoose(data);
    if(parsed) data = parsed;
    else return fallbackFromLegacy(data, 'json-parse-failed');
  }

  if(data && typeof data === 'object' && !Array.isArray(data)){
    if(data.quiz && typeof data.quiz === 'object') data = data.quiz;
    else if(data.result && typeof data.result === 'object') data = data.result;

    if(Array.isArray(data) && data.length){
      data = { questions: data };
    }

    const maybeLines = data.lines ?? data.output ?? data.text;
    const questionSource = Array.isArray(data.questions)
      ? data.questions
      : (Array.isArray(data.items) ? data.items : (Array.isArray(data.quizItems) ? data.quizItems : null));

    if(questionSource && questionSource.length){
      const questions = [];
      for(const rawQ of questionSource){
        const q = normalizeStructuredQuestion(rawQ);
        if(!q) continue;
        if(allowed && !allowed.has(q.type)) continue;
        questions.push(q);
        if(limit && questions.length >= limit) break;
      }
      if(questions.length){
        return {
          title: sanitizeString(data.title ?? data.quizTitle ?? data.name ?? ''),
          topic: sanitizeString(data.topic ?? topic),
          questions,
        };
      }
    }

    if(typeof maybeLines === 'string' && maybeLines.trim()){
      return fallbackFromLegacy(maybeLines, 'legacy-lines-field');
    }
  }

  return fallbackFromLegacy(typeof raw === 'string' ? raw : JSON.stringify(raw), 'no-structured-questions');
}

function quizToLegacyLines(quiz, opts = {}){
  const limit = Number.isFinite(opts.count) ? Math.max(1, Math.min(50, parseInt(opts.count, 10))) : undefined;
  if(!quiz || typeof quiz !== 'object') return { title: '', lines: '' };
  const lines = [];
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  for(const q of questions){
    if(q.type === 'MC'){
      const options = Array.isArray(q.options) ? q.options : [];
      if(options.length < 2) continue;
      const correct = Array.isArray(q.correct) && q.correct.length ? q.correct : [0];
      const optText = options.map((opt, idx)=>`${String.fromCharCode(65+idx)}) ${sanitizeString(opt)}`).join(';');
      const ans = correct.map((idx)=>String.fromCharCode(65+idx)).join(',');
      lines.push(`MC|${sanitizeString(q.prompt)}|${optText}|${ans}`);
    } else if(q.type === 'TF'){
      const ans = q.correct ? 'T' : 'F';
      lines.push(`TF|${sanitizeString(q.prompt)}|${ans}`);
    } else if(q.type === 'YN'){
      const ans = q.correct ? 'Y' : 'N';
      lines.push(`YN|${sanitizeString(q.prompt)}|${ans}`);
    } else if(q.type === 'MT'){
      const left = Array.isArray(q.left) ? q.left : [];
      const right = Array.isArray(q.right) ? q.right : [];
      const matches = Array.isArray(q.matches) ? q.matches : [];
      if(!left.length || !right.length || !matches.length) continue;
      const leftText = left.map((item, idx)=>`${idx+1}) ${sanitizeString(item)}`).join(';');
      const rightText = right.map((item, idx)=>`${String.fromCharCode(65+idx)}) ${sanitizeString(item)}`).join(';');
      const pairText = matches.map(([li, ri])=>`${li+1}-${String.fromCharCode(65+ri)}`).join(',');
      lines.push(`MT|${sanitizeString(q.prompt)}|${leftText}|${rightText}|${pairText}`);
    }
    if(limit && lines.length >= limit) break;
  }
  return { title: sanitizeString(quiz.title), lines: lines.join('\n') };
}

module.exports = {
  normalizeLegacyLines,
  normalizeQuizV2,
  parseLegacyQuestion,
  quizToLegacyLines,
};
