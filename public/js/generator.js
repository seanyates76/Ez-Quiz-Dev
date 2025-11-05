import { S } from './state.js';
import { $, byQSA, mmSsToMs, clampCount, getMaxQuestions } from './utils.js';
import { parseEditorInput } from './parser.js';
import { generateWithAI } from './api.js?v=1.5.23';
import { ImportController } from './import-controller.js';
import { sniffFileKind, isSupportedImportKind } from './file-type-validation.js';
import { attachDragDrop } from './drag-drop.js';
import { announce } from './a11y-announcer.js?v=1.5.23';
import { buildGeneratorPayload } from './generator-payload.js?v=1.5.23';
import { showVeil, hideVeil, MESSAGES } from './veil.js';
import { applyTheme, saveSettingsToStorage, getShowQuizEditorPreference } from './settings.js';
import { STORAGE_KEYS } from './state.js';

// Keep reference to drag/drop wiring so re-init can dispose previous listeners
let __topicAffixDragHandle = null;

export function runParseFlow(sourceText, topicLabel, fullTitle){
  const mirror = $('mirror');
  const startBtn = $('startBtn');
  const { questions, errors, error: limitError } = parseEditorInput(sourceText);
  S.quiz.questions = questions;
  // Preserve the full original question set for future full retakes
  S.quiz.originalQuestions = Array.isArray(questions) ? questions.slice() : [];
  // Map current question indexes to original indexes (identity on first parse)
  S.quiz.indexMap = questions.map((_, i) => i);
  // Reset original answers snapshot (one slot per original question)
  S.quiz.originalAnswers = new Array(questions.length).fill(null);
  S.quiz.index = 0;
  S.quiz.answers = new Array(questions.length).fill(null);
  if (topicLabel) { S.quiz.topic = String(topicLabel).trim(); }
  if (fullTitle) { S.quiz.title = String(fullTitle).trim(); } else { S.quiz.title = S.quiz.title || ''; }
  S.mode = 'generated';
  if(mirror) { mirror.value = sourceText; try{ const box=document.getElementById('mirrorBox'); const empty = !(sourceText||'').trim(); mirror.setAttribute('data-empty', empty?'true':'false'); if(box) box.setAttribute('data-empty', empty?'true':'false'); }catch{} }
  // Persist last quiz lines for quick restore
  try{ localStorage.setItem('ezq.last', String(sourceText||'')); }catch{}

  const statusBox = $('status');
  const firstErrors = errors.slice(0, 5);
  const parseErrorMessages = [];
  if (limitError) {
    parseErrorMessages.push(limitError);
    announce(limitError, 'assertive');
  }
  if (errors.length) parseErrorMessages.push(...errors);
  const summary = errors.length
    ? `Parsed ${questions.length} question(s). ${errors.length} error(s). ${firstErrors.join(' | ')}`
    : `Parsed ${questions.length} question(s).`;
  const statusMessage = limitError ? `${summary} ${limitError}`.trim() : summary;
  statusBox && (statusBox.textContent = statusMessage);
  try {
    const pe = document.getElementById('parseErrors');
    if (pe) {
      if (parseErrorMessages.length) {
        pe.textContent = parseErrorMessages.join(' | ');
        pe.classList.remove('visually-hidden');
      } else {
        pe.textContent = '';
        pe.classList.add('visually-hidden');
      }
    }
  } catch {}
  if(startBtn) startBtn.disabled = questions.length === 0 || !!limitError;
}

export function wireGenerator({ beginQuiz, syncSettingsFromUI }){
  const generateBtn = $('generateBtn');
  const topicInput = $('topicInput');
  const countInput = $('countInput');
  const countUpBtn = document.querySelector('[data-step="up"]');
  const countDownBtn = document.querySelector('[data-step="down"]');
  const importBtn = $('importBtn');
  const importFile = $('importFile');
  const importCtl = new ImportController();
  const MIME_BY_KIND = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
  };
  const toolbar = document.querySelector('.gen-toolbar');
  const topicAffix = document.querySelector('.topic-affix');
  const editor = $('editor');
  const mirror = $('mirror');
  const statusBox = $('status');

  function updateCountHint(){
    const max = getMaxQuestions();
    try {
      if (countInput) {
        countInput.setAttribute('max', String(max));
        countInput.setAttribute('aria-describedby', 'genCountHint');
      }
      const hint = document.getElementById('genCountHint');
      if (hint) {
        hint.textContent = `Max ${max} questions`;
      }
    } catch {}
  }

  function readGeneratorForm(){
    const el = countInput || document.getElementById('countInput');
    const fallbackCount = clampCount(el?.defaultValue ?? 10);
    const raw = el ? el.value : '';
    const count = clampCount(raw, { fallback: fallbackCount });
    updateCountHint();
    if (el && String(count) !== String(raw)) {
      el.value = String(count);
    }
    return {
      topic: (topicInput?.value || '').trim(),
      difficulty: getDifficultyKey(),
      count
    };
  }

  updateCountHint();

  const loadBtn = $('loadBtn');
  const fileInput = $('fileInput');
  const demoBtn = $('demoBtn');
  const clearBtn = $('clearBtn');
  const loadLastBtn = $('loadLastBtn');
  const optionsBtn = $('optionsBtn');
  const optionsPanel = $('optionsPanel');
  const advDisclosure = document.querySelector('.advanced-disclosure');
  const advBlock = $('advancedBlock');
  const mirrorToggle = $('mirrorToggle');
  const mirrorBox = document.getElementById('mirrorBox');
  const difficultySlider = $('difficultySlider');
  const ieToggle = $('toggleInteractiveEditor');
  const editorModeButtons = byQSA('[data-editor-mode]');
  const editorPanels = document.querySelector('[data-editor-panels]');
  const manualPanel = document.querySelector('[data-editor-panel="manual"]');
  const interactiveMount = $('interactiveEditor');
  const DIFFICULTY_VALUES = ['very-easy','easy','medium','hard','expert'];
  const DIFFICULTY_LABELS = {
    'very-easy':'Very Easy',
    'easy':'Easy',
    'medium':'Medium',
    'hard':'Hard',
    'expert':'Expert',
  };
  const copyPromptsBtn = $('copyPromptsBtn');
  const exportTxtBtn = $('exportTxtBtn');
  
  // --- Media Import (beta) ---
  function isBeta(){ try{ return document.body?.dataset?.beta === 'true' || !!S.settings?.betaEnabled; }catch{ return false; } }
  function setHint(msg){ try{ const hint=document.getElementById('regenHint'); if(hint){ hint.textContent = msg; hint.hidden = false; } }catch{} }
  function clearHint(){ try{ const hint=document.getElementById('regenHint'); if(hint){ hint.hidden = true; } }catch{} }
  // Improve accessible label on import button
  try {
    if (importBtn) {
      const improvedLabel = 'Attach PDF/Image to populate quiz editor (beta)';
      importBtn.setAttribute('title', improvedLabel);
      importBtn.setAttribute('aria-label', improvedLabel);
    }
  } catch {}
  async function postIngest(payload, { signal } = {}){
    const endpoint = '/.netlify/functions/ingest-media';
    try{
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ezq-beta': '1' },
        body: JSON.stringify(payload),
        signal,
      });
      const ct = res.headers.get('content-type')||'';
      const isJson = ct.includes('application/json');
      const data = isJson ? await res.json() : await res.text();
      return { ok: res.ok, status: res.status, data };
    }catch(err){
      if(err && err.name === 'AbortError'){ throw err; }
      return { ok: false, status: 0, data: { error: String(err&&err.message||err||'Network error') } };
    }
  }
  function toBase64(file, { signal } = {}){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      let settled = false;
      const cleanup = ()=>{
        settled = true;
        reader.onload = null;
        reader.onerror = null;
        if(signal){
          try{ signal.removeEventListener('abort', abort); }catch{}
        }
      };
      const abort = ()=>{
        if(settled) return;
        cleanup();
        try{ reader.abort(); }catch{}
        reject(new DOMException('Aborted','AbortError'));
      };
      if(signal){
        if(signal.aborted){ return abort(); }
        signal.addEventListener('abort', abort, { once: true });
      }
      reader.onload = ()=>{
        if(settled) return;
        cleanup();
        try{
          const url = String(reader.result||'');
          const comma = url.indexOf(',');
          const meta = url.slice(0, comma);
          const b64 = comma>=0 ? url.slice(comma+1) : '';
          resolve({ base64: b64, meta });
        }catch(e){ reject(e); }
      };
      reader.onerror = ()=>{
        if(settled) return;
        cleanup();
        reject(reader.error||new Error('Read failed'));
      };
      reader.readAsDataURL(file);
    });
  }
  async function handleImportFile(file){
    if(!file) return;
    const { token, signal } = importCtl.start();
    try{
      importBtn?.setAttribute('disabled', 'true');
      clearHint();
      if(importCtl.isCurrent(token)) {
        setHint('Importing…');
        try { announce('Importing file…', 'polite'); } catch {}
      }

      const kind = await sniffFileKind(file);
      if(!importCtl.isCurrent(token)) return;
      if(!isSupportedImportKind(kind)){
        if(importCtl.isCurrent(token)) {
          setHint('Unsupported file. Choose a PDF or image.');
          try { announce('Import failed: Unsupported file.', 'assertive'); } catch {}
        }
        return;
      }

      const { base64 } = await toBase64(file, { signal });
      if(!importCtl.isCurrent(token)) return;

      const resp = await postIngest({
        name: file.name||'',
        type: file.type || MIME_BY_KIND[kind] || '',
        size: file.size||0,
        data: base64,
        kind,
      }, { signal });
      if(!importCtl.isCurrent(token)) return;

      if(resp && resp.ok && resp.data && resp.data.text){
        const text = String(resp.data.text||'');
        if(importCtl.isCurrent(token)){
          setEditorText(text);
          try{ setMirrorVisible(true); }catch{}
          try{
            runParseFlow(text, file.name||'Imported', '');
            setHint('Imported text added to editor.');
            try { announce('Imported text added to editor.', 'polite'); } catch {}
          }catch(e){
            setHint(`Parse error: ${e && e.message ? e.message : 'Unknown error'}`);
            try { announce(`Import failed: ${e && e.message ? e.message : 'Unknown error'}`, 'assertive'); } catch {}
          }
        }
      } else if(importCtl.isCurrent(token)){
        if(resp && resp.status === 404){ setHint('Media import not enabled on this site.'); try { announce('Import failed: Not enabled.', 'assertive'); } catch {} }
        else if(resp && resp.status === 501){ setHint('Media ingest is not enabled yet (beta stub).'); try { announce('Import failed: Not enabled yet.', 'assertive'); } catch {} }
        else if(resp && resp.status === 403){ setHint('Media import is beta-only. Enable beta in Settings or visit /beta.'); try { announce('Import failed: Beta-only.', 'assertive'); } catch {} }
        else if(resp && resp.data && resp.data.error){ const msg=String(resp.data.error); setHint(msg); try { announce(`Import failed: ${msg}`, 'assertive'); } catch {} }
        else { setHint('Media import unavailable.'); try { announce('Import failed: Unavailable.', 'assertive'); } catch {} }
      }
    }catch(err){
      if(err && err.name === 'AbortError'){ return; }
      if(importCtl.isCurrent(token)){
        const msg = `Import error: ${err && err.message ? err.message : 'Unknown error'}`;
        setHint(msg);
        try { announce(msg, 'assertive'); } catch {}
      }
    }finally{
      importCtl.finish(token);
      if(importCtl.isCurrent(token)){
        importBtn?.removeAttribute('disabled');
      }
      if(importFile) importFile.value='';
    }
  }
  importBtn?.addEventListener('click', ()=>{ if(!isBeta()) return; importFile?.click(); });
  importFile?.addEventListener('change', async ()=>{
    if(!isBeta()) return;
    const f = importFile?.files && importFile.files[0];
    if(!f) return;
    await handleImportFile(f);
  });
  // Drag-drop on toolbar (beta)
  let __affixEscapeListener = null;
  const addAffixEscapeHandler = ()=>{
    if(__affixEscapeListener) return;
    __affixEscapeListener = (evt)=>{
      if(evt && (evt.key==='Escape' || evt.key==='Esc')){
        try{
          topicAffix?.classList.remove('drag-on');
          topicAffix?.classList.remove('drag-active');
          if(topicAffix) clearDrag(topicAffix);
          if(importBtn && typeof importBtn.focus==='function'){ importBtn.focus(); }
        }catch{}
        try{ announce('Import canceled.', 'polite'); }catch{}
        removeAffixEscapeHandler();
      }
    };
    document.addEventListener('keydown', __affixEscapeListener, { capture: true });
  };
  const removeAffixEscapeHandler = ()=>{
    if(!__affixEscapeListener) return;
    try{ document.removeEventListener('keydown', __affixEscapeListener, { capture: true }); }catch{}
    __affixEscapeListener = null;
  };
  const onDragOver = (e, el)=>{ if(!isBeta()) return; try{ e.preventDefault(); }catch{}; el.classList.add('drag-on'); el.classList.add('drag-active'); addAffixEscapeHandler(); };
  const clearDrag = (el)=>{ el.classList.remove('drag-on'); el.classList.remove('drag-active'); removeAffixEscapeHandler(); };
  const onDrop = (e, el)=>{ if(!isBeta()) return; try{ e.preventDefault(); }catch{}; el.classList.remove('drag-on'); const dt=e.dataTransfer; if(!dt||!dt.files||!dt.files.length) return; handleImportFile(dt.files[0]); };
  // Use helper to attach listeners and ensure we can dispose on re-init
  try { __topicAffixDragHandle?.dispose?.(); } catch {}
  if (topicAffix) {
    __topicAffixDragHandle = attachDragDrop(topicAffix, {
      onDragEnter: (e) => onDragOver(e, topicAffix),
      onDragOver: (e) => onDragOver(e, topicAffix),
      onDragLeave: () => clearDrag(topicAffix),
      onDrop: (e) => { clearDrag(topicAffix); onDrop(e, topicAffix); },
    }, { preventDefault: isBeta() });
  }

  function updateMirrorText(raw){
    if(!mirror) return;
    const text = raw == null ? '' : String(raw);
    mirror.value = text;
    try{
      const empty = !text.trim();
      mirror.setAttribute('data-empty', empty ? 'true' : 'false');
      if(mirrorBox) mirrorBox.setAttribute('data-empty', empty ? 'true' : 'false');
    }catch{}
  }

  function setEditorText(raw){
    const text = raw == null ? '' : String(raw);
    if(editor){
      editor.value = text;
      try{ editor.dispatchEvent(new Event('input', { bubbles:true })); }catch{}
    }
    updateMirrorText(text);
  }

  // Options: controls
  const optTimerEnabled = $('optTimerEnabled');
  const optCountdownMode = $('optCountdownMode');
  const optTimerDuration = $('optTimerDuration');
  const optThemeRadios = byQSA('input[name="optTheme"]');
  const saveDefaultsBtn = $('saveDefaultsBtn');
  const resetDefaultsBtn = $('resetDefaultsBtn');
  const defaultsStatus = $('defaultsStatus');
  // Types checkboxes
  const qtMC = $('qtMC');
  const qtTF = $('qtTF');
  const qtYN = $('qtYN');
  const qtMT = $('qtMT');
  const startBtn2 = $('startBtn');

  // Primary action: Start | Generate | Regenerate
  function snapshotChanged(last, curr){
    if(!last || !curr) return false;
    return last.topic !== curr.topic || last.count !== curr.count || last.difficulty !== curr.difficulty;
  }
  function __devDebug(){
    try{ return !!(localStorage.getItem('EZQ_DEBUG') || /localhost|127\.0\.0\.1/.test(location && location.hostname)); }catch{ return false; }
  }
  function computePrimaryMode(){
    const hasLoaded = Array.isArray(S.quiz?.questions) && S.quiz.questions.length > 0;
    const qeOpen = !!(optionsPanel && !optionsPanel.hidden && advBlock && !advBlock.hidden);
    const editorHasText = !!(editor && (editor.value||'').trim());
    const ui = (window.EZQ.ui = window.EZQ.ui || {});
    const last = ui.lastGeneratedParams;
    const curr = getParamsSnapshot();
    const changed = snapshotChanged(last, curr);
    if (hasLoaded) {
      if (last && changed) return qeOpen ? 'regenerate' : 'start-new';
      return 'start';
    }
    // No quiz loaded
    if (editorHasText) return 'start';
    return qeOpen ? 'generate' : 'start';
  }
  function setPrimaryAction(mode){
    const ui = (window.EZQ.ui = window.EZQ.ui || {});
    const m = mode || computePrimaryMode();
    ui.primaryMode = m;
    const label = (m === 'regenerate') ? 'Regenerate'
                : (m === 'start-new') ? 'Start New'
                : (m === 'generate') ? 'Generate'
                : 'Start';
    const dataMode = (m === 'regenerate') ? 'generate'
                   : (m === 'start-new') ? 'start-new'
                   : (m === 'generate') ? 'generate'
                   : 'start';
    generateBtn?.setAttribute('data-mode', dataMode);
    if (generateBtn) generateBtn.textContent = label;
    if(__devDebug() && ui.__lastPrimaryLogged !== m){ try{ console.debug('[ezq:dev] primary-action', { mode: m }); }catch{} ui.__lastPrimaryLogged = m; }
  }
  function updatePrimaryHint(){
    try{
      const hint=document.getElementById('regenHint'); if(!hint) return;
      const mode = computePrimaryMode();
      const hasLoaded = Array.isArray(S.quiz?.questions) && S.quiz.questions.length > 0;
      const qeOpen = !!(optionsPanel && !optionsPanel.hidden && advBlock && !advBlock.hidden);
      const editorHasText = !!(editor && (editor.value||'').trim());
      const ui = (window.EZQ.ui = window.EZQ.ui || {});
      const last = ui.lastGeneratedParams;
      const curr = getParamsSnapshot();
      const changed = snapshotChanged(last, curr);

      // No quiz cases
      if(!hasLoaded){
        if(editorHasText){
          hint.textContent = 'Start will parse your text and begin.';
          hint.hidden = false; return;
        }
        if(qeOpen){
          hint.textContent = 'Enter Topic, Difficulty, and Length, then click Generate to fill the editor.';
          hint.hidden = false; return;
        }
        hint.textContent = 'Enter Topic, Difficulty, and Length. Start will generate and begin a new quiz.';
        hint.hidden = false; return;
      }

      // Quiz loaded
      if(last && changed){
        if(mode === 'regenerate'){
          hint.textContent = 'Changes detected. Regenerate updates the editor; press Start to begin.';
          hint.hidden = false; return;
        }
        if(mode === 'start-new'){
          hint.textContent = 'Changes detected. Start New will generate a new quiz and begin.';
          hint.hidden = false; return;
        }
      }
      // Loaded, unchanged
      hint.textContent = 'Quiz ready. Press Start to begin.';
      hint.hidden = false;
    }catch{}
  }
  const clampDifficultyIndex = (idx)=>{
    if(Number.isNaN(idx)) return 2;
    return Math.min(Math.max(idx, 0), DIFFICULTY_VALUES.length-1);
  };
  const normalizeDifficultyKey = (value)=>{
    if(value == null) return 'medium';
    const key = String(value).trim().toLowerCase().replace(/\s+/g,'-');
    return DIFFICULTY_VALUES.includes(key) ? key : 'medium';
  };
  function setDifficultyValue(value){
    if(!difficultySlider) return;
    const key = normalizeDifficultyKey(value);
    let idx = DIFFICULTY_VALUES.indexOf(key);
    if(idx === -1) idx = 2;
    difficultySlider.value = String(idx);
    const label = DIFFICULTY_LABELS[DIFFICULTY_VALUES[idx]];
    difficultySlider.setAttribute('aria-valuetext', label);
    difficultySlider.setAttribute('title', label);
  }
  function getDifficultyKey(){
    if(!difficultySlider) return 'medium';
    const idx = clampDifficultyIndex(Number(difficultySlider.value));
    return DIFFICULTY_VALUES[idx] || 'medium';
  }
  // Initialize slider value
  setDifficultyValue(difficultySlider ? DIFFICULTY_VALUES[clampDifficultyIndex(Number(difficultySlider.value))] : 'medium');
  difficultySlider?.addEventListener('input', ()=>{
    const idx = clampDifficultyIndex(Number(difficultySlider.value));
    setDifficultyValue(DIFFICULTY_VALUES[idx]);
  });

  // Initialize primary action based on current state
  setPrimaryAction();
  updatePrimaryHint();

  // Track last generated params and "dirty since generation" state
  function getParamsSnapshot(){
    const form = readGeneratorForm();
    const topic = form.topic || 'General knowledge';
    return { topic, count: form.count, difficulty: form.difficulty };
  }
  function setLastGen(params){
    const ui = (window.EZQ.ui = window.EZQ.ui || {});
    ui.lastGeneratedParams = { topic: params.topic, count: clampCount(params.count), difficulty: params.difficulty };
    ui.genDirty = false;
    // Reset primary according to layout state when not dirty
    setPrimaryAction();
    try{ const hint=document.getElementById('regenHint'); if(hint) hint.hidden = true; }catch{}
  }
  function markDirtyIfChanged(){
    const ui = (window.EZQ.ui = window.EZQ.ui || {});
    const last = ui.lastGeneratedParams;
    const curr = getParamsSnapshot();
    const changed = snapshotChanged(last, curr);
    ui.genDirty = !!changed; // keep for potential future behavior
    updatePrimaryHint();
    setPrimaryAction();
  }
  // Mark dirty when topic, count, or difficulty changes after a generation
  topicInput?.addEventListener('input', markDirtyIfChanged);
  countInput?.addEventListener('input', markDirtyIfChanged);
  difficultySlider?.addEventListener('input', markDirtyIfChanged);

  loadBtn?.addEventListener('click', ()=> fileInput?.click());
  fileInput?.addEventListener('change', ()=>{
    const f = fileInput.files && fileInput.files[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = () => { const text = String(reader.result || ''); setEditorText(text); try{ setMirrorVisible(true); }catch{}; runParseFlow(text, f.name || 'Imported', ''); statusBox && (statusBox.textContent = `Loaded ${f.name} (${text.length} chars)`); };
    reader.onerror = () => { statusBox && (statusBox.textContent = 'Failed to read file'); };
    reader.readAsText(f);
  });

  demoBtn?.addEventListener('click', ()=>{
    const demo = [
      'MC|Which planet is known as the Red Planet?|A) Venus;B) Mars;C) Jupiter;D) Saturn|B',
      'MC|Select prime numbers.|A) 2;B) 4;C) 5;D) 9|A,C',
      'TF|The Pacific Ocean is larger than the Atlantic.|T',
      'YN|Is 0 an even number?|Y',
      'MT|Match ports to services.|1) 22;2) 53|A) SSH;B) DNS|1-A,2-B',
      'TF|Lightning never strikes the same place twice.|F',
    ].join('\n');
    setEditorText(demo); try{ setMirrorVisible(true); }catch{}; runParseFlow(demo, 'Demo', '');
  });

  clearBtn?.addEventListener('click', ()=>{ setEditorText(''); const startBtn=$('startBtn'); if(startBtn) startBtn.disabled = true; statusBox && (statusBox.textContent = 'Cleared.'); try{ const ui=(window.EZQ.ui=window.EZQ.ui||{}); ui.lastGeneratedParams=null; ui.genDirty=false; const hint=document.getElementById('regenHint'); if(hint) hint.hidden=true; }catch{} setPrimaryAction(); });
  loadLastBtn?.addEventListener('click', ()=>{ try{ const last = localStorage.getItem('ezq.last')||''; if(!last){ statusBox && (statusBox.textContent='No previous quiz found.'); return; } setEditorText(last); try{ setMirrorVisible(true); }catch{}; runParseFlow(last, topicInput?.value||'Last', ''); statusBox && (statusBox.textContent = 'Loaded last quiz.'); }catch{} });

  generateBtn?.addEventListener('click', async ()=>{
    const ui = (window.EZQ.ui = window.EZQ.ui || {});
    const mode = generateBtn?.getAttribute('data-mode') || computePrimaryMode();
    const editorText = (editor?.value || '').trim();
    const topicTyped = (topicInput?.value || '').trim();
    const isDirty = !!ui.genDirty;
    // In Start mode, prefer existing editor content or run/generate+start
    if(mode==='start' && editorText.length){
      runParseFlow(editorText, topicTyped || 'Custom', '');
      if(S.quiz.questions && S.quiz.questions.length){ syncSettingsFromUI(); beginQuiz(); }
      return;
    }
    if(mode==='start' && !editorText.length){
      if(Array.isArray(S.quiz?.questions) && S.quiz.questions.length){ syncSettingsFromUI(); beginQuiz(); return; }
      // No quiz yet: Start should generate + start
      const snap = getParamsSnapshot();
      const topicRaw = (topicInput?.value || '').trim();
      const topic = snap.topic; if(!topicRaw){ statusBox && (statusBox.textContent = 'Using default topic: General knowledge'); }
      const types = [ qtMC?.checked ? 'MC':null, qtTF?.checked? 'TF':null, qtYN?.checked? 'YN':null, qtMT?.checked? 'MT':null ].filter(Boolean);
      const difficulty = getDifficultyKey();
      const payload = buildGeneratorPayload({ topic, difficulty, count: snap.count });
      try{
        statusBox && (statusBox.textContent = 'Generating via AI…');
        generateBtn.disabled = true; showVeil(Math.floor(Math.random()*MESSAGES.length));
        const out = await generateWithAI(payload.topic, payload.count, { types, difficulty: payload.difficulty });
        const lines = out && out.lines || '';
        if(!lines){ statusBox && (statusBox.textContent = 'AI did not return any lines. Try again or use the Prompt Builder.'); generateBtn.disabled = false; hideVeil('Nothing yet…'); return; }
        setEditorText(lines); try{ setMirrorVisible(true); }catch{}
        const title = (out && out.title) ? out.title : '';
        runParseFlow(lines, payload.topic, title);
        setLastGen(payload);
        setPrimaryAction('start');
        if (S.quiz.questions && S.quiz.questions.length){ syncSettingsFromUI(); beginQuiz(); }
      }catch(err){
        const msg = String(err && err.message || err || 'Error'); let pretty = msg;
        try { const parsed = JSON.parse(msg); const status = parsed.status; const body = parsed.body; if(status === 429 || /quota|rate limit/i.test(JSON.stringify(body))){ pretty = 'Rate limit hit. Please wait ~30s and try again.'; } else if (typeof body === 'object' && body && body.error){ pretty = body.error; } } catch {}
        statusBox && (statusBox.textContent = `Generation failed: ${pretty}`);
      }finally{ generateBtn.disabled = false; hideVeil('Done'); }
      return;
    }
    // In Generate/Regenerate/Start New, (re)generate fresh content first
    if(mode==='generate' || mode==='start-new'){
      setEditorText('');
    }
    const snap = getParamsSnapshot();
    const topicRaw = (topicInput?.value || '').trim();
    const topic = snap.topic; if(!topicRaw){ statusBox && (statusBox.textContent = 'Using default topic: General knowledge'); }
    // Gather options
    const types = [ qtMC?.checked ? 'MC':null, qtTF?.checked? 'TF':null, qtYN?.checked? 'YN':null, qtMT?.checked? 'MT':null ].filter(Boolean);
    const difficulty = getDifficultyKey();
    const payload = buildGeneratorPayload({ topic, difficulty, count: snap.count });
    try{
      statusBox && (statusBox.textContent = 'Generating via AI…');
      generateBtn.disabled = true;
      showVeil(Math.floor(Math.random()*MESSAGES.length));
      const out = await generateWithAI(payload.topic, payload.count, { types, difficulty: payload.difficulty });
      const lines = out && out.lines || '';
      if(!lines){ statusBox && (statusBox.textContent = 'AI did not return any lines. Try again or use the Prompt Builder.'); generateBtn.disabled = false; hideVeil('Nothing yet…'); return; }
      setEditorText(lines); /* mirror stays hidden by default */
      // Auto-show Mirror when content exists so it’s visible on mobile too
      try{ setMirrorVisible(true); }catch{}
      const title = (out && out.title) ? out.title : '';
      runParseFlow(lines, payload.topic, title);
      setLastGen(payload);
      // After (re)generation completes
      if(mode==='start-new'){
        if (S.quiz.questions && S.quiz.questions.length){ syncSettingsFromUI(); beginQuiz(); }
      }
      setPrimaryAction('start');
    }catch(err){
      const msg = String(err && err.message || err || 'Error'); let pretty = msg;
      try { const parsed = JSON.parse(msg); const status = parsed.status; const body = parsed.body; if(status === 429 || /quota|rate limit/i.test(JSON.stringify(body))){ pretty = 'Rate limit hit. Please wait ~30s and try again.'; } else if (typeof body === 'object' && body && body.error){ pretty = body.error; } } catch {}
      statusBox && (statusBox.textContent = `Generation failed: ${pretty}`);
    }finally{ generateBtn.disabled = false; hideVeil('Done'); }
  });

  // Options drop-down toggle
  function reflectOptionsFromSettings(){
    if(optTimerEnabled) optTimerEnabled.checked = !!S.settings.timerEnabled;
    if(optCountdownMode) optCountdownMode.checked = !!S.settings.countdown;
    if(optTimerDuration){
      const ms = Number(S.settings.durationMs||0);
      if(ms>0){ const total = Math.floor(ms/1000); const mm = Math.floor(total/60); const ss = total%60; optTimerDuration.value = String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0'); }
      else { optTimerDuration.value = ''; }
    }
    optThemeRadios.forEach(r=>{ r.checked = (r.value===S.settings.theme); });
    // Sync mirror toggle from container state
    const isOn = !!(mirrorBox && mirrorBox.getAttribute('data-on') === 'true');
    setMirrorVisible(isOn);
  }
  function applyMirrorToggle(){ const on = !!mirrorToggle?.checked; setMirrorVisible(on); }
  function openOptions(){ if(!optionsPanel) return; optionsPanel.hidden = false; optionsBtn?.setAttribute('aria-expanded','true'); reflectOptionsFromSettings(); applyMirrorToggle(); if(advDisclosure && advBlock){ const shouldOpen = !!getShowQuizEditorPreference(); advDisclosure.setAttribute('aria-expanded', shouldOpen? 'true':'false'); advBlock.hidden = !shouldOpen; } setPrimaryAction(); updatePrimaryHint(); document.addEventListener('keydown', onEscCloseOptions); document.addEventListener('click', onDocClick, true); }
  function closeOptions(){ if(!optionsPanel) return; optionsPanel.hidden = true; optionsBtn?.setAttribute('aria-expanded','false'); document.removeEventListener('keydown', onEscCloseOptions); document.removeEventListener('click', onDocClick, true); setPrimaryAction(); updatePrimaryHint(); optionsBtn?.focus(); }
  function onEscCloseOptions(e){ if(e.key==='Escape'){ e.preventDefault(); closeOptions(); }}
  optionsBtn?.addEventListener('click', ()=>{ if(optionsPanel?.hidden){ openOptions(); } else { closeOptions(); } });
  // Click-away to close
  function onDocClick(e){
    if(!optionsPanel || optionsPanel.hidden) return;
    const t = e.target;
    if(t===optionsBtn || optionsBtn?.contains(t)) return;
    // Do not close when clicking the primary Generate/Start button
    if(t===generateBtn || generateBtn?.contains(t)) return;
    if(optionsPanel.contains(t)) return;
    // Allow clicks on primary toolbar inputs without closing Options
    const allow = [topicInput, countInput, difficultySlider].filter(Boolean);
    for(const el of allow){ if(el && (t===el || el.contains?.(t))) return; }
    closeOptions();
  }
  // Click-away listener is attached only while open (see openOptions/closeOptions)

  // Quiz Editor disclosure behavior (formerly “Advanced”)
  function toggleAdvanced(open){ if(!advDisclosure||!advBlock) return; const willOpen = (open===undefined) ? (advDisclosure.getAttribute('aria-expanded')!=='true') : !!open; advDisclosure.setAttribute('aria-expanded', String(willOpen)); advBlock.hidden = !willOpen; setPrimaryAction(); updatePrimaryHint(); }
  advDisclosure?.addEventListener('click', ()=> toggleAdvanced());
  advDisclosure?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleAdvanced(); } else if(e.key==='Escape'){ e.preventDefault(); closeOptions(); }});
  if(advBlock){ const mo = new MutationObserver(()=>{ setPrimaryAction(); updatePrimaryHint(); }); mo.observe(advBlock, { attributes:true, attributeFilter:['hidden','class','style'] }); }

  // Focus trap for Options panel when open
  function trapFocusOptions(e){
    if(!optionsPanel || optionsPanel.hidden) return; if(e.key!=='Tab') return;
    const els = Array.from(optionsPanel.querySelectorAll('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])'));
    if(!els.length) return; const first=els[0], last=els[els.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', trapFocusOptions);

  // Mirror toggle
  function setMirrorVisible(on){ if(mirrorBox){ mirrorBox.setAttribute('data-on', on ? 'true':'false'); } if(mirrorToggle){ mirrorToggle.checked = !!on; } }
  function reflectEditorMode(){
    const mode = ieToggle && !ieToggle.checked ? 'manual' : 'interactive';
    editorModeButtons.forEach((btn)=>{
      if(!btn) return;
      const active = btn.dataset.editorMode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if(editorPanels){ editorPanels.classList.toggle('is-ie-mode', mode === 'interactive'); }
    if(manualPanel){
      if(mode === 'manual'){ manualPanel.removeAttribute('hidden'); }
      else { manualPanel.setAttribute('hidden', ''); }
    }
    interactiveMount?.classList.toggle('hidden', mode !== 'interactive');
  }
  function setEditorMode(mode){
    const wantsInteractive = mode !== 'manual';
    if(ieToggle){
      if(ieToggle.checked !== wantsInteractive){
        ieToggle.checked = wantsInteractive;
        ieToggle.dispatchEvent(new Event('change'));
      } else {
        reflectEditorMode();
      }
    } else {
      reflectEditorMode();
    }
  }
  // Debounced mirror toggle; keep container height stable
  let mirrorToggleBusy = false;
  mirrorToggle?.addEventListener('change', ()=>{
    if(mirrorToggleBusy) return;
    mirrorToggleBusy = true;
    setMirrorVisible(!!mirrorToggle.checked);
    setTimeout(()=>{ mirrorToggleBusy = false; }, 180);
  });

  // Options: Settings wiring
  optTimerEnabled?.addEventListener('change', ()=>{ S.settings.timerEnabled=!!optTimerEnabled.checked; saveSettingsToStorage(); });
  optCountdownMode?.addEventListener('change', ()=>{ S.settings.countdown=!!optCountdownMode.checked; saveSettingsToStorage(); });
  optTimerDuration?.addEventListener('input', ()=>{ S.settings.durationMs = mmSsToMs(optTimerDuration.value||''); saveSettingsToStorage(); });
  optThemeRadios.forEach(r=> r.addEventListener('change', ()=>{ if(r.checked){ applyTheme(r.value); }}));
  saveDefaultsBtn?.addEventListener('click', ()=>{
    // Save current generation defaults (Count/Difficulty/Types)
    saveDefaults(getCurrentGenDefaults());
    saveSettingsToStorage();
    if(defaultsStatus){ defaultsStatus.textContent = 'Defaults saved.'; }
  });
  resetDefaultsBtn?.addEventListener('click', ()=>{ clearDefaults(); applyDefaultsToUI(); });
  resetDefaultsBtn?.addEventListener('click', ()=>{ if(defaultsStatus){ defaultsStatus.textContent = 'Defaults cleared.'; } });

  // Start button in Quiz Editor
  startBtn2?.addEventListener('click', ()=>{ if(S.quiz?.questions?.length){ syncSettingsFromUI(); beginQuiz(); } });
  // Copy / Export actions in Quiz Editor
  function getMirrorText(){ return (mirror?.value || '').trim(); }
  copyPromptsBtn?.addEventListener('click', ()=>{ const t=getMirrorText(); if(!t){ statusBox && (statusBox.textContent='Nothing to copy. Generate first.'); return; } navigator.clipboard.writeText(t).then(()=>{ statusBox && (statusBox.textContent='Copied prompts.'); }).catch(()=>{ statusBox && (statusBox.textContent='Copy failed.'); }); });
  // Defaults storage (types, difficulty, count)
  function loadDefaults(){
    try{ const raw=localStorage.getItem(STORAGE_KEYS.defaults); if(!raw) return null; const obj=JSON.parse(raw); return obj && typeof obj==='object' ? obj : null; }catch{ return null; }
  }
  function saveDefaults(obj){
    try{
      if(!obj || typeof obj!=='object'){
        localStorage.setItem(STORAGE_KEYS.defaults, JSON.stringify({}));
        return;
      }
      const { count, ...rest } = obj;
      const safeCount = clampCount(count);
      localStorage.setItem(STORAGE_KEYS.defaults, JSON.stringify({ ...rest, count: safeCount }));
      statusBox && (statusBox.textContent='Defaults saved.');
    }catch{}
  }
  function clearDefaults(){ try{ localStorage.removeItem(STORAGE_KEYS.defaults); statusBox && (statusBox.textContent='Defaults cleared.'); }catch{} }
  function getCurrentGenDefaults(){
    const form = readGeneratorForm();
    const types = { MC: !!qtMC?.checked, TF: !!qtTF?.checked, YN: !!qtYN?.checked, MT: !!qtMT?.checked };
    return { count: form.count, difficulty: form.difficulty, types };
  }
  function applyDefaultsToUI(){
    const d = loadDefaults();
    if(!d){ updateCountHint(); return; }
    if(typeof d.count==='number' && countInput){
      countInput.value = String(clampCount(d.count));
      updateCountHint();
    }
    if(typeof d.difficulty==='string'){ setDifficultyValue(d.difficulty); }
    if(d.types){ if(qtMC) qtMC.checked = !!d.types.MC; if(qtTF) qtTF.checked = !!d.types.TF; if(qtYN) qtYN.checked = !!d.types.YN; if(qtMT) qtMT.checked = !!d.types.MT; }
    updateCountHint();
  }
  // Apply on init
  applyDefaultsToUI();
  exportTxtBtn?.addEventListener('click', ()=>{ const t=getMirrorText(); if(!t){ statusBox && (statusBox.textContent='Nothing to export. Generate first.'); return; } const blob=new Blob([t],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='quiz-prompts.txt'; a.click(); URL.revokeObjectURL(url); statusBox && (statusBox.textContent='Exported quiz-prompts.txt'); });
  // Enter triggers generate
  topicInput?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); generateBtn?.click(); } });
  countInput?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); generateBtn?.click(); } });
  difficultySlider?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); generateBtn?.click(); } });
  editorModeButtons.forEach((btn)=>{
    btn.addEventListener('click', ()=> setEditorMode(btn.dataset.editorMode || 'interactive'));
  });
  ieToggle?.addEventListener('change', reflectEditorMode);
  reflectEditorMode();

  function adjustCount(delta){
    if(!countInput) return;
    const current = parseInt(countInput.value, 10);
    const base = Number.isFinite(current) ? current + delta : delta;
    const next = clampCount(base);
    countInput.value = String(next);
    updateCountHint();
    markDirtyIfChanged();
  }
  countUpBtn?.addEventListener('click', ()=> adjustCount(1));
  countDownBtn?.addEventListener('click', ()=> adjustCount(-1));
}

// Optional teardown for SPA navigation or re-init
export function disposeGenerator(){
  try { __topicAffixDragHandle?.dispose?.(); } catch {}
  try { /* ensure escape handler removed */
    // The remove function is scoped above; call if present via closure guards
  } catch {}
}
