import { S } from './state.js';
import { isBetaEnabled } from './beta.mjs';
import { $, byQSA, clamp, formatDuration, escapeHTML, indexesToLetters, arraysEqual, formatTopicLabel, mmSsToMs, showUpdateBannerIfReady, bindOnce, showToastNear } from './utils.js';

// Retake scope constants
const RETAKE_MISSED = 'missed';
const RETAKE_ALL = 'all';

// Elements helper
const el = (id) => $(id);

export function setMode(mode){
  S.mode = mode;
  const generatorCard = el('generatorCard');
  const quizView = el('quizView');
  const resultsView = el('resultsView');
  if(mode==='quiz'){
    generatorCard?.classList.add('is-hidden'); resultsView?.classList.add('is-hidden'); quizView?.classList.remove('is-hidden'); document.body.classList.add('is-quiz');
  }else if(mode==='results'){
    generatorCard?.classList.add('is-hidden'); quizView?.classList.add('is-hidden'); resultsView?.classList.remove('is-hidden'); document.body.classList.add('is-quiz');
  }else{
    generatorCard?.classList.remove('is-hidden'); quizView?.classList.add('is-hidden'); resultsView?.classList.add('is-hidden'); document.body.classList.remove('is-quiz');
    // If an update is ready, show banner when returning to main menu
    showUpdateBannerIfReady();
  }
}

let timerInterval=null, pausedAt=0, elapsedOffset=0, remainingOnPause=0;

export function syncSettingsFromUI(){
  const timerEnabledEl = el('timerEnabled');
  const countdownModeEl = el('countdownMode');
  const timerDurationEl = el('timerDuration');
  S.settings.timerEnabled=!!(timerEnabledEl?.checked);
  S.settings.countdown=!!(countdownModeEl?.checked);
  S.settings.durationMs = mmSsToMs(timerDurationEl?.value||'');
}

export function beginQuiz(){
  const timerEl = el('timer'); const quizTitleEl = el('quizTitle');
  S.quiz.index = 0; S.quiz.score = 0; S.quiz.startedAt = Date.now(); S.quiz.finishedAt = 0;
  clearInterval(timerInterval); timerInterval=null; pausedAt=0; elapsedOffset=0; remainingOnPause=0; if(timerEl) timerEl.textContent = '';
  if(S.settings.timerEnabled){ if(S.settings.countdown && S.settings.durationMs>0){ S.quiz.endAt = Date.now() + S.settings.durationMs; timerInterval = setInterval(tickCountdown, 1000); if(timerEl) timerEl.textContent = formatDuration(S.quiz.endAt - Date.now()); } else { timerInterval = setInterval(tickStopwatch, 1000); if(timerEl) timerEl.textContent = '00:00'; } }
  setMode('quiz');
  if (quizTitleEl) {
    let heading = (S.quiz.title || '').trim();
    if (!heading) { const pretty = formatTopicLabel(S.quiz.topic||''); heading = pretty ? (/\bquiz$/i.test(pretty) ? pretty : `${pretty} Quiz`) : 'Quiz'; }
    else { const m = heading.match(/\bquiz\b/i); if (!m) heading = `${heading} Quiz`; }
    quizTitleEl.textContent = heading;
  }
  renderCurrentQuestion(); updateNavButtons(); updateProgress();
}

function tickStopwatch(){ const timerEl=el('timer'); const elapsed = Date.now() - S.quiz.startedAt - elapsedOffset; if(timerEl) timerEl.textContent = formatDuration(elapsed); }
function tickCountdown(){ const timerEl=el('timer'); const remain=S.quiz.endAt - Date.now(); if(timerEl) timerEl.textContent = formatDuration(remain); if(remain<=0){ clearInterval(timerInterval); timerInterval=null; finishQuiz(true);} }

export function updateNavButtons(){
  const prevBtn=el('prevBtn'), nextBtn=el('nextBtn'), finishBtn=el('finishBtn'); const qChip=el('qChip');
  const i=S.quiz.index, total=S.quiz.questions.length;
  if(qChip){ qChip.textContent = total? `${i+1}/${total}` : '0/0'; }
  if(prevBtn) prevBtn.disabled = i<=0;
  if(nextBtn){ nextBtn.disabled = i>=total-1; if(i>=total-1){ nextBtn.classList.add('is-hidden'); } else { nextBtn.classList.remove('is-hidden'); } }
  if(finishBtn){ if(i>=total-1){ finishBtn.classList.remove('is-hidden'); } else { finishBtn.classList.add('is-hidden'); } }
  updateProgress();
}

export function updateProgress(){ const total=S.quiz.questions.length; const elBar = document.getElementById('progBar'); if(!elBar || !total){ if(elBar) elBar.style.width='0%'; return; } const pct = Math.max(0, Math.min(100, Math.round(((S.quiz.index+1)/total)*100))); elBar.style.width = pct + '%'; const wrap=document.getElementById('progWrap'); if(wrap){ wrap.setAttribute('aria-valuemin','0'); wrap.setAttribute('aria-valuemax','100'); wrap.setAttribute('aria-valuenow', String(pct)); } }

export function renderCurrentQuestion(){
  const questionHost=el('questionHost'); const q = S.quiz.questions[S.quiz.index]; if(!q){ questionHost.innerHTML = '<p>Missing question.</p>'; return; }
  const n=S.quiz.index+1, total=S.quiz.questions.length;
  let html = `<div class="qwrap">       <div class="qhdr"><strong>Question ${n}/${total}</strong></div>       <div class="qtext" style="margin:8px 0 12px">${escapeHTML(q.text)}</div>`;
  if(q.type==='MC'){
    const user = Array.isArray(S.quiz.answers[S.quiz.index]) ? S.quiz.answers[S.quiz.index] : [];
    const multiple = Array.isArray(q.correct) && q.correct.length>1;
    if(multiple){ html += `<div class="options">` + q.options.map((opt,i)=> { const checked = user.includes(i) ? 'checked' : ''; return `<label class="opt"><input type="checkbox" data-idx="${i}" ${checked}/> <span>${escapeHTML(opt)}</span></label>`; }).join('') + `</div>`; }
    else { html += `<div class="options">` + q.options.map((opt,i)=> { const checked = user.includes(i) ? 'checked' : ''; return `<label class="opt"><input type="radio" name="mc" data-idx="${i}" ${checked}/> <span>${escapeHTML(opt)}</span></label>`; }).join('') + `</div>`; }
  } else if(q.type==='TF'){
    const user=S.quiz.answers[S.quiz.index]; const tChecked=user===true?'checked':'', fChecked=user===false?'checked':'';
    html += `<div class="options"><label class="opt"><input type="radio" name="tf" data-bool="true" ${tChecked}/> True</label><label class="opt"><input type="radio" name="tf" data-bool="false" ${fChecked}/> False</label></div>`;
  } else if(q.type==='YN'){
    const user=S.quiz.answers[S.quiz.index]; const yChecked=user===true?'checked':'', nChecked=user===false?'checked':'';
    html += `<div class="options"><label class="opt"><input type="radio" name="yn" data-bool="true" ${yChecked}/> Yes</label><label class="opt"><input type="radio" name="yn" data-bool="false" ${nChecked}/> No</label></div>`;
  } else if(q.type==='MT'){
    const user=Array.isArray(S.quiz.answers[S.quiz.index])?S.quiz.answers[S.quiz.index]:new Array(q.left.length).fill(-1);
    html += `<div class="mtwrap">` + q.left.map((L,li)=>{ return `<div class="mtrow"><div class="mtleft">${escapeHTML(L)}</div><div class="mtright"><select data-li="${li}"><option value="">— choose —</option>${q.right.map((R,ri)=> `<option value="${ri}" ${user[li]===ri?'selected':''}>${String.fromCharCode(65+ri)}) ${escapeHTML(R)}</option>`).join('')}</select></div></div>`; }).join('') + `</div>`;
  }
  html += `</div>`; questionHost.innerHTML = html;
  // Progressbar in the body
  const qwrapProg = document.createElement('div'); qwrapProg.className='prog'; qwrapProg.id='progWrap'; qwrapProg.innerHTML='<div class="prog-bar" id="progBar" style="width:0%"></div>'; qwrapProg.setAttribute('role','progressbar'); qwrapProg.setAttribute('aria-label','Question progress');
  const hdrEl = questionHost.querySelector('.qhdr'); const qtextEl = questionHost.querySelector('.qtext'); if(hdrEl && qtextEl){ hdrEl.after(qwrapProg); }
  updateProgress();

  // Wire inputs
  if(q.type==='MC'){
    const multiple = q.correct.length>1;
    if(multiple){ byQSA('input[type="checkbox"]', questionHost).forEach(cb=>{ cb.addEventListener('change', ()=>{ const i=parseInt(cb.getAttribute('data-idx'),10); const cur=Array.isArray(S.quiz.answers[S.quiz.index])?[...S.quiz.answers[S.quiz.index]]:[]; if(cb.checked){ if(!cur.includes(i)) cur.push(i); } else { const at=cur.indexOf(i); if(at>=0) cur.splice(at,1); } S.quiz.answers[S.quiz.index] = cur.sort((a,b)=>a-b); try{ cb.blur(); }catch{} }); }); }
    else { byQSA('input[type="radio"][name="mc"]', questionHost).forEach(rb=>{ rb.addEventListener('change', ()=>{ const i=parseInt(rb.getAttribute('data-idx'),10); S.quiz.answers[S.quiz.index] = [i]; try{ rb.blur(); }catch{} }); }); }
  } else if(q.type==='TF'){
    byQSA('input[type="radio"][name="tf"]', questionHost).forEach(rb=>{ rb.addEventListener('change', ()=>{ const v=rb.getAttribute('data-bool')==='true'; S.quiz.answers[S.quiz.index] = v; try{ rb.blur(); }catch{} }); });
  } else if(q.type==='YN'){
    byQSA('input[type="radio"][name="yn"]', questionHost).forEach(rb=>{ rb.addEventListener('change', ()=>{ const v=rb.getAttribute('data-bool')==='true'; S.quiz.answers[S.quiz.index] = v; try{ rb.blur(); }catch{} }); });
  } else if(q.type==='MT'){
    byQSA('select[data-li]', questionHost).forEach(sel=>{ sel.addEventListener('change', ()=>{ const li=parseInt(sel.getAttribute('data-li'),10); const ri= sel.value===''? -1 : parseInt(sel.value,10); const cur=Array.isArray(S.quiz.answers[S.quiz.index])?[...S.quiz.answers[S.quiz.index]]:new Array(q.left.length).fill(-1); cur[li]=ri; S.quiz.answers[S.quiz.index]=cur; try{ sel.blur(); }catch{} }); });
  }
}

export function wireQuizControls(){
  const prevBtn=el('prevBtn'), nextBtn=el('nextBtn'), finishBtn=el('finishBtn'), backDuringQuiz=el('backDuringQuiz');
  prevBtn?.addEventListener('click', (e)=>{ S.quiz.index=clamp(S.quiz.index-1,0,S.quiz.questions.length-1); renderCurrentQuestion(); updateNavButtons(); try{e.currentTarget.blur();}catch{} });
  nextBtn?.addEventListener('click', (e)=>{ if(S.settings.requireAnswer && !isCurrentAnswered()) return; S.quiz.index=clamp(S.quiz.index+1,0,S.quiz.questions.length-1); renderCurrentQuestion(); updateNavButtons(); try{e.currentTarget.blur();}catch{} });
  finishBtn?.addEventListener('click', (e)=>{ if(S.settings.requireAnswer && !isCurrentAnswered()) return; finishQuiz(false); try{e.currentTarget.blur();}catch{} });
  backDuringQuiz?.addEventListener('click', (e)=>{ if(S.mode==='quiz'){ const confirmLeave = confirm('Leave quiz and return to menu? Your progress will be lost.'); if(!confirmLeave) return; } if(timerInterval){ clearInterval(timerInterval); timerInterval=null; } setMode('idle'); try{e.currentTarget.blur();}catch{} });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e)=>{
    if(S.mode!=='quiz') return; const a=document.activeElement; const tag=a?.tagName?.toLowerCase(); if(tag==='input'||tag==='textarea'||a?.isContentEditable||tag==='select') return;
    if(e.key === 'Enter' || e.key === 'ArrowRight'){
      e.preventDefault(); if(S.settings.requireAnswer && !isCurrentAnswered()) return;
      if(S.quiz.index < S.quiz.questions.length-1){ S.quiz.index++; renderCurrentQuestion(); updateNavButtons(); } else { if(!S.settings.requireAnswer || isCurrentAnswered()) finishQuiz(false); }
    }else if(e.key === 'Backspace' || e.key === 'ArrowLeft'){
      e.preventDefault(); if(S.quiz.index>0){ S.quiz.index--; renderCurrentQuestion(); updateNavButtons(); }
    } else {
      // answer hotkeys
      const q = S.quiz.questions[S.quiz.index]; if(!q) return; const k = e.key.toLowerCase();
      if(q.type==='MC'){
        let idx=-1; if(k>='a'&&k<='z') idx=k.charCodeAt(0)-97; else if(k>='1'&&k<='9') idx=parseInt(k,10)-1;
        if(idx>=0 && idx<q.options.length){ const multiple = q.correct && q.correct.length>1; if(multiple){ const inputs=byQSA('input[type="checkbox"]', el('questionHost')); const target=inputs[idx]; if(!target) return; target.checked=!target.checked; target.dispatchEvent(new Event('change',{bubbles:true})); } else { const inputs=byQSA('input[type="radio"][name="mc"]', el('questionHost')); const target=inputs[idx]; if(!target) return; target.checked=true; target.dispatchEvent(new Event('change',{bubbles:true})); } updateNavButtons(); }
      } else if(q.type==='TF'){
        if(k==='t'||k==='f'){ const val=(k==='t'); const inputs=byQSA('input[type="radio"][name="tf"]', el('questionHost')); const target=inputs.find(n=> (n.getAttribute('data-bool')==='true')===val); if(target){ target.checked=true; target.dispatchEvent(new Event('change',{bubbles:true})); updateNavButtons(); } }
      } else if(q.type==='YN'){
        if(k==='y'||k==='n'){ const val=(k==='y'); const inputs=byQSA('input[type="radio"][name="yn"]', el('questionHost')); const target=inputs.find(n=> (n.getAttribute('data-bool')==='true')===val); if(target){ target.checked=true; target.dispatchEvent(new Event('change',{bubbles:true})); updateNavButtons(); } }
      }
    }
  });
}

function compareQA(q, a){ if(q.type==='MC'){ const user=Array.isArray(a)?a.slice().sort((x,y)=>x-y):[]; const correct=(q.correct||[]).slice().sort((x,y)=>x-y); return user.length && arraysEqual(user, correct); } if(q.type==='TF' || q.type==='YN'){ return typeof a==='boolean' && a===q.correct; } if(q.type==='MT'){ const user=Array.isArray(a)?a:[]; const target=new Array(q.left.length).fill(-1); q.pairs.forEach(([li,ri])=>{ target[li]=ri; }); return user.length===target.length && arraysEqual(user, target); } return false; }
function viewCorrect(q){ if(q.type==='MC'){ return indexesToLetters(q.correct).join(','); } if(q.type==='TF'){ return q.correct ? 'T' : 'F'; } if(q.type==='YN'){ return q.correct ? 'Y' : 'N'; } if(q.type==='MT'){ return q.pairs.map(([li,ri]) => `${li+1}-${String.fromCharCode(65+ri)}`).join(','); } return ''; }
function viewUser(q,a){ if(q.type==='MC'){ const arr=Array.isArray(a)?a:[]; return indexesToLetters(arr).join(','); } if(q.type==='TF'){ if(typeof a!=='boolean') return ''; return a?'T':'F'; } if(q.type==='YN'){ if(typeof a!=='boolean') return ''; return a?'Y':'N'; } if(q.type==='MT'){ const arr=Array.isArray(a)?a:[]; return arr.map((ri,li)=> (ri<0?`${li+1}-?`:`${li+1}-${String.fromCharCode(65+ri)}`)).join(','); } return ''; }

export function finishQuiz(auto=false){
  if(timerInterval){ clearInterval(timerInterval); timerInterval=null; }
  S.quiz.finishedAt = Date.now();
  let score=0; const qs=S.quiz.questions, ans=S.quiz.answers;
  for(let i=0;i<qs.length;i++){
    const q=qs[i], a=ans[i];
    if(q.type==='MC'){
      const user=Array.isArray(a)?a.slice().sort((x,y)=>x-y):[];
      const correct=(q.correct||[]).slice().sort((x,y)=>x-y);
      if(user.length && arraysEqual(user, correct)) score++;
    } else if(q.type==='TF' || q.type==='YN'){
      if(typeof a==='boolean' && a===q.correct) score++;
    } else if(q.type==='MT'){
      const user=Array.isArray(a)?a:[];
      const target=new Array(q.left.length).fill(-1);
      q.pairs.forEach(([li,ri])=>{ target[li]=ri; });
      if(user.length===target.length && arraysEqual(user, target)) score++;
    }
  }
  // Merge current run answers into originalAnswers snapshot
  const baseQs = (Array.isArray(S.quiz.originalQuestions) && S.quiz.originalQuestions.length) ? S.quiz.originalQuestions : S.quiz.questions;
  const baseLen = baseQs.length;
  if(!Array.isArray(S.quiz.originalAnswers) || S.quiz.originalAnswers.length !== baseLen){
    S.quiz.originalAnswers = new Array(baseLen).fill(null);
  }
  const map = (Array.isArray(S.quiz.indexMap) && S.quiz.indexMap.length) ? S.quiz.indexMap : S.quiz.questions.map((_,i)=>i);
  for(let i=0;i<ans.length;i++){
    const oi = map[i];
    if(Number.isInteger(oi) && oi>=0 && oi<baseLen){ S.quiz.originalAnswers[oi] = ans[i]; }
  }
  S.quiz.score=score;
  renderResults();
  setMode('results');
}

export function renderResults(){
  const resultsSummary=el('resultsSummary'); const missedList=el('missedList');
  const chip=el('resultsChip'); const filterMissed=el('filterMissed'); const filterAll=el('filterAll');
  const total=S.quiz.questions.length; const duration = S.quiz.finishedAt && S.quiz.startedAt ? (S.quiz.finishedAt - S.quiz.startedAt - 0) : 0;
  const showTime = !!(S.settings && S.settings.timerEnabled);
  // Legacy score/time block removed in favor of compact summary chip in header
  if(resultsSummary) resultsSummary.innerHTML = '';
  // Build results relative to the original question set, even after a retake
  const baseQs = (Array.isArray(S.quiz.originalQuestions) && S.quiz.originalQuestions.length)
    ? S.quiz.originalQuestions
    : S.quiz.questions;
  const baseIsOriginal = Array.isArray(S.quiz.originalQuestions) && S.quiz.originalQuestions.length && (baseQs === S.quiz.originalQuestions);
  const indexMap = (Array.isArray(S.quiz.indexMap) && S.quiz.indexMap.length)
    ? S.quiz.indexMap
    : S.quiz.questions.map((_,i)=>i);
  const isBeta = isBetaEnabled(S.settings);
  // Prefer persistent originalAnswers when available; fallback to mapping current run
  let answersFull;
  if (Array.isArray(S.quiz.originalAnswers) && S.quiz.originalAnswers.length === baseQs.length) {
    answersFull = S.quiz.originalAnswers.slice();
  } else {
    answersFull = new Array(baseQs.length).fill(null);
    for(let i=0;i<S.quiz.answers.length;i++){
      const origIdx = indexMap[i];
      if(Number.isInteger(origIdx) && origIdx>=0 && origIdx<baseQs.length){ answersFull[origIdx] = S.quiz.answers[i]; }
    }
  }
  let correctCountFull = 0;
  const items=[]; for(let i=0;i<baseQs.length;i++){ const q=baseQs[i], a=answersFull[i]; const correctView=viewCorrect(q), userView=viewUser(q,a); const isCorrect=compareQA(q,a); if(isCorrect) correctCountFull++; items.push({ idx:i+1, text:q.text, userView, correctView, isCorrect }); }
  // Apply desired filter preference if set (e.g., from retake action)
  try{
    if(S.ui && S.ui.nextResultsFilter){
      const wantAll = S.ui.nextResultsFilter === 'all';
      if(filterMissed){ filterMissed.classList.toggle('active', !wantAll); filterMissed.setAttribute('aria-pressed', String(!wantAll)); }
      if(filterAll){ filterAll.classList.toggle('active', wantAll); filterAll.setAttribute('aria-pressed', String(wantAll)); }
      S.ui.nextResultsFilter = '';
    }
  }catch{}
  // Determine filter state from buttons (default comes from HTML)
  const isAll = !!(filterAll && filterAll.classList.contains('active'));
  const showMissedOnly = !isAll;
  let view = showMissedOnly ? items.filter(it=>!it.isCorrect) : items.slice();
  if(!showMissedOnly){ view.sort((a,b)=> Number(a.isCorrect) - Number(b.isCorrect)); }
  if(!view.length){
    missedList.innerHTML = `<div class="missed-item"><em>${showMissedOnly ? 'No missed questions 🎉' : 'No questions'}</em></div>`;
    try{ updateRetakeUI(); }catch{}
    return;
  }
  missedList.innerHTML = view.map(item => {
    const q = baseQs[item.idx-1];
    const a = answersFull[item.idx-1];
    const origIdx = baseIsOriginal ? (item.idx-1) : (indexMap[item.idx-1] ?? (item.idx-1));
    if(q && q.type==='MT'){
      return renderMTResult(origIdx, q, a);
    }
    const userDetail = buildUserAnswerDetail(q,a);
    const correctDetail = buildCorrectAnswerDetail(q);
    const header = `<div class="res-head"><strong>${item.idx}.</strong> ${escapeHTML(item.text)}${isBeta ? ` <button type=\"button\" class=\"chip-btn explain-btn\" data-explain=\"${origIdx}\">Explain</button>` : ''}</div>`;
    if (item.isCorrect) {
      const line = `<div class="user-ans ans-correct"><strong>Answer:</strong> ${userDetail} <span class=\"chip tag good\">Correct</span></div>`;
      return `<div class="missed-item is-correct" data-orig="${origIdx}">` + header + line + `</div>`;
    } else {
      const yours = `<div class="user-ans ans-wrong"><strong>Your answer:</strong> ${userDetail} <span class="chip tag bad">Incorrect</span></div>`;
      const corr = `<div><strong>Correct:</strong> ${correctDetail}</div>`;
      return `<div class="missed-item is-wrong" data-orig="${origIdx}">` + header + yours + corr + `</div>`;
    }
  }).join('');
  // Sync retake controls UI when results are shown/updated
  try{ updateRetakeUI(); }catch{}
  // Wire Explain delegation once (beta only)
  try{ if(isBetaEnabled(S.settings)){ wireExplainDelegation(); } }catch{}
  // Update chip after we know full correctness
  if(chip){
    const labelText = `${correctCountFull}/${baseQs.length}`;
    const timeText = showTime ? formatDuration(Math.max(0,duration)) : '';
    const pct = baseQs.length ? Math.round((correctCountFull / baseQs.length) * 100) : 0;
    const aria = showTime ? `${correctCountFull} out of ${baseQs.length} in ${timeText}` : `${correctCountFull} out of ${baseQs.length}`;
    chip.setAttribute('aria-label', aria);
    chip.innerHTML = `<span class="score-bar" aria-hidden="true"><span class=\"score-fill\" style=\"width:${pct}%\"></span></span>`
      + `<span class="score-label">${labelText}</span>`
      + (showTime ? `<span class="sg-time">${timeText}</span>` : '');
  }
}

function wireExplainDelegation(){
  const host = document.getElementById('missedList'); if(!host) return;
  if(host.__explBound) return; host.__explBound = true;
  host.addEventListener('click', (e)=>{
    const btn = e.target && (e.target.closest ? e.target.closest('.explain-btn') : null);
    if(!btn) return;
    e.preventDefault();
    showToastNear(btn, 'Explanations are coming soon.');
  });
}

function buildUserAnswerDetail(q,a){
  if(!q) return '';
  if(q.type==='MC'){
    const arr=Array.isArray(a)?a:[];
    return arr.map(idx => {
      const letter = String.fromCharCode(65+idx);
      const text = q.options && q.options[idx] ? q.options[idx] : '';
      return `${letter} — <span class="ans-text">${escapeHTML(text)}</span>`;
    }).join(', ');
  }
  if(q.type==='TF'){
    if(typeof a!=='boolean') return '';
    const text = a ? 'True':'False';
    return `<span class="chip">${text}</span>`;
  }
  if(q.type==='YN'){
    if(typeof a!=='boolean') return '';
    const text = a ? 'Yes':'No';
    return `<span class="chip">${text}</span>`;
  }
  if(q.type==='MT'){
    const arr=Array.isArray(a)?a:[];
    return arr.map((ri,li)=>{
      if(ri<0) return `${li+1}-?`;
      const letter=String.fromCharCode(65+ri);
      const text = q.right && q.right[ri] ? q.right[ri] : '';
      return `${li+1}-${letter} — <span class="ans-text">${escapeHTML(text)}</span>`;
    }).join(', ');
  }
  return '';
}

function buildCorrectAnswerDetail(q){
  if(!q) return '';
  if(q.type==='MC'){
    const arr=Array.isArray(q.correct)?q.correct:[];
    return arr.map(idx => {
      const letter = String.fromCharCode(65+idx);
      const text = q.options && q.options[idx] ? q.options[idx] : '';
      return `${letter} — <span class="ans-text">${escapeHTML(text)}</span>`;
    }).join(', ');
  }
  if(q.type==='TF'){
    const text = q.correct ? 'True':'False';
    return `<span class="chip">${text}</span>`;
  }
  if(q.type==='YN'){
    const text = q.correct ? 'Yes':'No';
    return `<span class="chip">${text}</span>`;
  }
  if(q.type==='MT'){
    const pairs = Array.isArray(q.pairs)?q.pairs:[];
    return pairs.map(([li,ri]) => {
      const letter = String.fromCharCode(65+ri);
      const text = q.right && q.right[ri] ? q.right[ri] : '';
      return `${li+1}-${letter} — <span class="ans-text">${escapeHTML(text)}</span>`;
    }).join(', ');
  }
  return '';
}

function renderMTResult(origIdx, q, a){
  const isBeta = isBetaEnabled(S.settings);
  // Build map of correct right indexes by left index
  const correctMap = new Array(q.left.length).fill(-1);
  (Array.isArray(q.pairs)?q.pairs:[]).forEach(([li,ri])=>{ correctMap[li]=ri; });
  const userArr = Array.isArray(a)?a:[]; // array of ri by li, or -1
  const toLetter = (ri)=> ri>=0 ? String.fromCharCode(65+ri) : '?';
  const rightText = (ri)=> (ri>=0 && q.right && q.right[ri]) ? q.right[ri] : '';
  const rows = q.left.map((lt, li)=>{
    const u = (userArr[li] != null ? userArr[li] : -1);
    const c = (correctMap[li] != null ? correctMap[li] : -1);
    const ok = (u>=0 && u===c);
    const your = u>=0 ? `— <span class="ans-text">${escapeHTML(rightText(u))}</span>` : `— <span class="ans-text">No selection</span>`;
    const corr = c>=0 ? `— <span class="ans-text">${escapeHTML(rightText(c))}</span>` : '';
    const yourLine = `<div class=\"mt-your\"><span class=\"lbl\">Your answer</span> <span class=\"chip letter ${ok?'good':'bad'}\">${toLetter(u)}</span> ${your}${ok ? ' <span class=\\\"chip tag good\\\">Correct</span>' : ' <span class=\\\"chip tag bad\\\">Incorrect</span>'}</div>`;
    const corrLine = ok ? '' : `<div class=\"mt-correct\"><span class=\"lbl\">Correct answer</span> <span class=\"chip letter\">${toLetter(c)}</span> ${corr}</div>`;
    return `
      <div class="mt-row ${ok?'is-correct':'is-wrong'}">
        <div class="mt-left">${escapeHTML(lt)}</div>
        ${yourLine}
        ${corrLine}
      </div>`;
  }).join('');
  const okAll = Array.isArray(a)&&a.length&&a.every((ri,li)=>ri===correctMap[li]);
  const explainBtn = isBeta ? ` <button type="button" class="chip-btn explain-btn" data-explain="${origIdx}">Explain</button>` : '';
  return `<div class="missed-item ${okAll?'is-correct':'is-wrong'}" data-orig="${origIdx}">
    <div class="res-head"><strong>${(origIdx+1)}.</strong> ${escapeHTML(q.text)}${explainBtn}</div>
    <div class="mt-result">${rows}</div>
  </div>`;
}

// Determine missed indexes from last completed attempt (incorrect or unanswered)
function getMissedIndexes(){ const idxs=[]; const qs=S.quiz.questions, ans=S.quiz.answers; for(let i=0;i<qs.length;i++){ if(!compareQA(qs[i], ans[i])) idxs.push(i); } return idxs; }

// Public retake runner wired to existing flow
function runRetake(scope){
  const total = Array.isArray(S.quiz?.questions) ? S.quiz.questions.length : 0;
  if (total === 0) { return; }
  if (scope === RETAKE_MISSED) {
    const idxs = getMissedIndexes();
    if (!idxs.length) { return; }
    S.quiz.questions = idxs.map(i => S.quiz.questions[i]);
    const priorMap = Array.isArray(S.quiz.indexMap) ? S.quiz.indexMap : S.quiz.questions.map((_,i)=>i);
    S.quiz.indexMap = idxs.map(i => priorMap[i]);
    try{ S.ui.nextResultsFilter = 'missed'; }catch{}
  } else {
    if (Array.isArray(S.quiz.originalQuestions) && S.quiz.originalQuestions.length) {
      S.quiz.questions = S.quiz.originalQuestions.slice();
      S.quiz.indexMap = S.quiz.originalQuestions.map((_, i) => i);
    }
    try{ S.ui.nextResultsFilter = 'all'; }catch{}
  }
  S.quiz.answers = new Array(S.quiz.questions.length).fill(null);
  beginQuiz();
}

// Expose scope and runner on a lightweight global per spec
function getRTGlobal(){ const g = (window.__EZQ__ = window.__EZQ__ || {}); if(!g.retakeScope) g.retakeScope = RETAKE_MISSED; g.runRetake = runRetake; return g; }

function updateRetakeUI(){
  const g = getRTGlobal();
  const total = Array.isArray(S.quiz?.questions) ? S.quiz.questions.length : 0;
  const missed = getMissedIndexes().length;

  const root = document.getElementById('retakeControl');
  const primary = document.getElementById('retakePrimary');
  const caret = document.getElementById('retakeCaret');
  const label = document.getElementById('retakeLabel');
  const menu = document.getElementById('retakeMenu');
  const switchBtn = document.getElementById('retakeSwitch');
  if(!root || !primary || !caret || !label || !menu || !switchBtn) return;

  // Bind scope to results filter if present (source of truth for default)
  try{
    const fm = document.getElementById('filterMissed');
    const fa = document.getElementById('filterAll');
    const isAll = !!(fa && fa.classList.contains('active'));
    g.retakeScope = isAll ? RETAKE_ALL : RETAKE_MISSED;
  }catch{}

  // Label and caret aria
  const scope = g.retakeScope === RETAKE_ALL ? RETAKE_ALL : RETAKE_MISSED;
  label.textContent = `Retake: ${scope===RETAKE_ALL ? 'All' : 'Missed'}`;
  const opp = scope === RETAKE_ALL ? RETAKE_MISSED : RETAKE_ALL;
  const caretAria = opp===RETAKE_ALL ? 'Retake All (opposite)' : 'Retake Missed (opposite)';
  caret.setAttribute('aria-label', caretAria);
  switchBtn.textContent = opp===RETAKE_ALL ? 'Retake All' : 'Retake Missed';

  // Disabled state for primary
  let disable = false, title='';
  if (total === 0){ disable = true; title = 'Nothing to retake'; }
  else if (scope === RETAKE_MISSED && missed === 0){ disable = true; title = 'No missed questions'; }
  primary.disabled = !!disable;
  root.classList.toggle('is-disabled', !!disable);
  if(title) primary.setAttribute('title', title); else primary.removeAttribute('title');

  // Bind actions once (compute scope at click time to stay in sync)
  bindOnce(primary, 'click', ()=>{
      if(primary.disabled) return;
      const curr = (getRTGlobal().retakeScope === RETAKE_ALL) ? RETAKE_ALL : RETAKE_MISSED;
      runRetake(curr);
  });
  function trapMenuFocus(e){
    if(e.key !== 'Tab') return;
    const focusables = [switchBtn];
    const first = focusables[0], last = focusables[focusables.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  const toggle = ()=>{
    const isHidden = menu.classList.contains('hidden');
    if(isHidden){
      // Decide drop direction based on available space
      try{
        const ctrl = document.getElementById('retakeControl');
        const rect = ctrl ? ctrl.getBoundingClientRect() : caret.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const approxMenuH = 160; // conservative estimate
        if(spaceBelow < approxMenuH){ menu.classList.add('drop-up'); }
        else { menu.classList.remove('drop-up'); }
      }catch{}
    }
    menu.classList.toggle('hidden', !isHidden);
    caret.setAttribute('aria-expanded', String(isHidden));
    if(isHidden){
      switchBtn.focus();
      document.addEventListener('keydown', trapMenuFocus, true);
    } else {
      document.removeEventListener('keydown', trapMenuFocus, true);
    }
  };
  bindOnce(caret, 'click', toggle, '__rtCaret');
  bindOnce(caret, 'keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle(); }}, '__rtCaretKey');
  bindOnce(switchBtn, 'click', (e)=>{
      if(e) e.preventDefault();
      const totalNow = Array.isArray(S.quiz?.questions) ? S.quiz.questions.length : 0;
      if(totalNow===0) return; // both disabled state
      const curr = (getRTGlobal().retakeScope === RETAKE_ALL) ? RETAKE_ALL : RETAKE_MISSED;
      const opposite = curr === RETAKE_ALL ? RETAKE_MISSED : RETAKE_ALL;
      // Close menu first for immediate visual feedback
      menu.classList.add('hidden'); caret.setAttribute('aria-expanded','false');
      document.removeEventListener('keydown', trapMenuFocus, true);
      // Set scope to opposite for consistency and run
      getRTGlobal().retakeScope = opposite;
      runRetake(opposite);
  }, '__rtSwitch');
  bindOnce(switchBtn, 'keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); const click = new Event('click', { bubbles:true }); switchBtn.dispatchEvent(click); }}, '__rtSwitchKey');

  // Dismiss on outside click / Esc
  if(!root.__rtDismissBound){
    document.addEventListener('click', (e)=>{ if(!menu.classList.contains('hidden')){ if(!root.contains(e.target)){ menu.classList.add('hidden'); caret.setAttribute('aria-expanded','false'); } } });
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ if(!menu.classList.contains('hidden')){ menu.classList.add('hidden'); caret.setAttribute('aria-expanded','false'); } }});
    root.__rtDismissBound = true;
  }
}

export function wireResultsControls(){
  const backToMenuBtn=el('backToMenuBtn');
  const filterMissed=el('filterMissed'); const filterAll=el('filterAll');
  backToMenuBtn?.addEventListener('click', ()=> setMode('idle'));
  // Results filter chips (unchanged)
  function setFilter(isAll){
    if(filterMissed){ filterMissed.classList.toggle('active', !isAll); filterMissed.setAttribute('aria-pressed', String(!isAll)); }
    if(filterAll){ filterAll.classList.toggle('active', !!isAll); filterAll.setAttribute('aria-pressed', String(!!isAll)); }
    renderResults();
  }
  filterMissed?.addEventListener('click', ()=> setFilter(false));
  filterAll?.addEventListener('click', ()=> setFilter(true));
  // Initialize retake UI once controls exist
  try{ updateRetakeUI(); }catch{}
}

export function pauseTimerIfQuiz(){ if(S.mode!=='quiz') return; if(!timerInterval) return; pausedAt = Date.now(); if(S.settings.timerEnabled){ if(S.settings.countdown && S.quiz.endAt){ remainingOnPause = Math.max(0, S.quiz.endAt - Date.now()); } } clearInterval(timerInterval); timerInterval=null; }
export function resumeTimerIfQuiz(){ if(S.mode!=='quiz') return; if(timerInterval) return; if(!S.settings.timerEnabled) return; const timerEl=el('timer'); if(S.settings.countdown && S.settings.durationMs>0){ if(remainingOnPause>0){ S.quiz.endAt = Date.now() + remainingOnPause; remainingOnPause = 0; } timerInterval = setInterval(tickCountdown, 1000); if(timerEl) timerEl.textContent = formatDuration(S.quiz.endAt - Date.now()); } else { if(pausedAt){ elapsedOffset += (Date.now() - pausedAt); pausedAt = 0; } timerInterval = setInterval(tickStopwatch, 1000); }
}
