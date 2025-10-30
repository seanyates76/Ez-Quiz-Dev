import { normalizeLettersToIndexes, getMaxQuestions } from './utils.js';

function parseLines(lines){
  const questions=[], errors=[];
  const MC_RE=/^MC\|(.*)\|(.+?)\|([A-Za-z](?:\s*,\s*[A-Za-z])*)$/i;
  const TF_RE=/^TF\|(.*)\|(T|F)$/i;
  const YN_RE=/^YN\|(.*)\|(Y|N)$/i;
  const MT_RE=/^MT\|(.*)\|(.+?)\|(.+?)\|(.+?)$/i;

  for(const [i,raw] of lines.entries()){
    const idx=i+1;
    if(MC_RE.test(raw)){
      const m=raw.match(MC_RE);
      try{
        const text=m[1].trim(), optRaw=m[2].trim(), corrRaw=m[3].trim();
        const options=optRaw.split(';').map(s=>s.trim().replace(/^[A-D]\)\s*/i,'').trim());
        const correct=normalizeLettersToIndexes(corrRaw);
        const bad=correct.find(c=>c<0||c>=options.length);
        if(bad!==undefined) throw new Error('MC correct out of range');
        questions.push({type:'MC', text, options, correct: correct.sort((a,b)=>a-b)});
      }catch{ errors.push(`Line ${idx}: MC parse error`); }
      continue;
    }
    if(TF_RE.test(raw)){
      const m=raw.match(TF_RE);
      try{ const text=m[1].trim(); const t=m[2].toUpperCase()==='T'; questions.push({type:'TF', text, correct:t}); }
      catch{ errors.push(`Line ${idx}: TF parse error`); }
      continue;
    }
    if(YN_RE.test(raw)){
      const m=raw.match(YN_RE);
      try{ const text=m[1].trim(); const y=m[2].toUpperCase()==='Y'; questions.push({type:'YN', text, correct:y}); }
      catch{ errors.push(`Line ${idx}: YN parse error`); }
      continue;
    }
    if(MT_RE.test(raw)){
      const m=raw.match(MT_RE);
      try{
        const text=m[1].trim(), leftRaw=m[2].trim(), rightRaw=m[3].trim(), pairsRaw=m[4].trim();
        const left=leftRaw.split(';').map(s=>s.trim().replace(/^\d+\)\s*/,'').trim()).filter(Boolean);
        const right=rightRaw.split(';').map(s=>s.trim().replace(/^[A-Z]\)\s*/i,'').trim()).filter(Boolean);
        const pairs=pairsRaw.split(',').map(p=>{ const m2=p.split('-').map(x=>x.trim()); const li=parseInt(m2[0],10)-1; const ri=m2[1].toUpperCase().charCodeAt(0)-65; return [li,ri]; });
        const invalid=pairs.some(([li,ri])=>li<0||li>=left.length||ri<0||ri>=right.length);
        if(invalid) throw new Error('MT pair out of range');
        questions.push({type:'MT', text, left, right, pairs});
      }catch{ errors.push(`Line ${idx}: MT parse error`); }
      continue;
    }
    errors.push(`Line ${idx}: Unknown or invalid format`);
  }
  return { questions, errors };
}

export function parseLinesToState(lines){
  const parsed = parseLines(lines || []);
  const max = getMaxQuestions();
  if(parsed.questions.length > max){
    return {
      ...parsed,
      error: `Too many questions (${parsed.questions.length}). Limit is ${max}. Trim your list or split into multiple quizzes.`
    };
  }
  return parsed;
}

export function parseEditorInput(text){
  const lines=(text||'').split('\n').map(l=>l.trim()).filter(l=>l.length);
  return parseLinesToState(lines);
}

