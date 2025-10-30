// Interactive Editor (beta) — rebuilt v2
// Simple, robust, no global delegation; uses pointerdown to beat Options capture
import { runParseFlow } from './generator.js?v=1.5.21';

const IE2 = (()=>{
  const SKEY = 'ezq.ie.v2.on';
  const state = { enabled:false, model:[] };
  let isSyncingToEditor = false;
  let summaryHint = '';
  let summaryHintTimer = null;
  const typeLabels = { MC:'Multiple Choice', TF:'True/False', YN:'Yes/No', MT:'Matching' };
  const friendlyType = (type)=> typeLabels[type] || type;

  const qs = (id) => document.getElementById(id);
  const qSel = (sel) => document.querySelector(sel);
  const els = () => ({
    mount: qs('interactiveEditor'),
    toggle: qs('toggleInteractiveEditor') || qSel('[data-role="quiz-editor-toggle"]'),
    editor: qs('editor'),
    mirror: qs('mirror'),
    grid: qs('ieGrid'),
    summary: qs('ieSummary'),
  });

  function saveEnabled(on){ try{ localStorage.setItem(SKEY, on?'1':'0'); }catch{} }
  function loadEnabled(){
    try{
      const raw = localStorage.getItem(SKEY);
      if(raw === null) return true;
      return raw === '1';
    }catch{
      return true;
    }
  }

  function setSummaryHint(message, duration=2600){
    if(summaryHintTimer){
      clearTimeout(summaryHintTimer);
      summaryHintTimer = null;
    }
    summaryHint = message || '';
    renderSummary();
    if(summaryHint){
      summaryHintTimer = window.setTimeout(()=>{
        summaryHint='';
        renderSummary();
      }, Math.max(1200, duration|0));
    }
  }

  function normalizeMT(q){
    if(!q || q.type!=='MT') return q;
    const toStrings = (arr)=> Array.isArray(arr) ? arr.map(v=> (v==null?'':String(v))) : [];
    q.left = toStrings(q.left);
    q.right = toStrings(q.right);
    if(q.left.length===0){ q.left=['','']; }
    if(q.right.length===0){ q.right=['','']; }
    if(Array.isArray(q.pairs) && !Array.isArray(q.matches)){
      q.matches = new Array(q.left.length).fill(-1);
      q.pairs.forEach((pair)=>{
        if(!Array.isArray(pair) || pair.length<2) return;
        const li=Number(pair[0]);
        const ri=Number(pair[1]);
        if(Number.isInteger(li) && li>=0 && li<q.left.length && Number.isInteger(ri) && ri>=0 && ri<q.right.length){
          q.matches[li]=ri;
        }
      });
    }
    if(!Array.isArray(q.matches)) q.matches=[];
    q.matches=q.matches.map((v)=> Number.isInteger(v)&&v>=0&&v<q.right.length ? v : -1);
    if(q.matches.length>q.left.length){ q.matches.length=q.left.length; }
    while(q.matches.length<q.left.length){ q.matches.push(-1); }
    delete q.pairs;
    return q;
  }

  function createQuestion(type){
    if(type==='TF'){ return { type:'TF', prompt:'', answer:false }; }
    if(type==='YN'){ return { type:'YN', prompt:'', answer:false }; }
    if(type==='MT'){ return normalizeMT({ type:'MT', prompt:'', left:['',''], right:['',''], matches:[-1,-1] }); }
    return { type:'MC', prompt:'', options:[{text:'',correct:false},{text:'',correct:false}] };
  }

  // Formatting (match app parser rules)
  function toLine(q){
    const p=(q.prompt||'').trim();
    if(q.type==='MC'){
      const opts=(q.options||[]).filter(o=>o.text && o.text.trim());
      const letters=(q.options||[]).map((o,i)=>o.correct?String.fromCharCode(65+i):null).filter(Boolean).join(',');
      if(!p||!opts.length||!letters) return null;
      const optText=opts.map((o,i)=>`${String.fromCharCode(65+i)}) ${o.text.trim()}`).join(';');
      return `MC|${p}|${optText}|${letters}`;
    }
    if(q.type==='TF'){ if(!p||typeof q.answer!=='boolean') return null; return `TF|${p}|${q.answer?'T':'F'}`; }
    if(q.type==='YN'){ if(!p||typeof q.answer!=='boolean') return null; return `YN|${p}|${q.answer?'Y':'N'}`; }
    if(q.type==='MT'){
      normalizeMT(q);
      if(!p) return null;
      const leftEntries=[];
      (q.left||[]).forEach((text,idx)=>{ const t=String(text||'').trim(); if(t) leftEntries.push({text:t, idx}); });
      const rightEntries=[];
      (q.right||[]).forEach((text,idx)=>{ const t=String(text||'').trim(); if(t) rightEntries.push({text:t, idx}); });
      if(!leftEntries.length || !rightEntries.length) return null;
      const matches=Array.isArray(q.matches)?q.matches:[];
      const pairs=[];
      leftEntries.forEach(({idx:origLi},newLi)=>{
        const matchIdx=matches[origLi];
        const rightPos=rightEntries.findIndex(({idx})=>idx===matchIdx);
        if(rightPos>=0){ pairs.push(`${newLi+1}-${String.fromCharCode(65+rightPos)}`); }
      });
      if(!pairs.length) return null;
      const leftText=leftEntries.map(({text},i)=>`${i+1}) ${text}`).join(';');
      const rightText=rightEntries.map(({text},i)=>`${String.fromCharCode(65+i)}) ${text}`).join(';');
      return `MT|${p}|${leftText}|${rightText}|${pairs.join(',')}`;
    }
    return null;
  }
  function fromLine(s){
    const line=String(s||'').trim(); if(!line) return null; const up=line.toUpperCase();
    if(up.startsWith('MC|')){ const p=line.split('|'); if(p.length<4) return null; const prompt=p[1]||''; const optsRaw=p[2]||''; const ans=p[3]||''; const opts=(optsRaw.split(';').map(x=>String(x||'').trim()).filter(Boolean)).map(t=>({text:t.replace(/^[A-Z]\)\s*/,'').trim(), correct:false})); const set=new Set(String(ans||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean)); opts.forEach((o,i)=>{ const L=String.fromCharCode(65+i); o.correct=set.has(L); }); return { type:'MC', prompt:prompt, options:opts }; }
    if(up.startsWith('TF|')){ const p=line.split('|'); if(p.length<3) return null; return { type:'TF', prompt:p[1]||'', answer:(String(p[2]||'').toUpperCase().startsWith('T')) }; }
    if(up.startsWith('YN|')){ const p=line.split('|'); if(p.length<3) return null; return { type:'YN', prompt:p[1]||'', answer:(String(p[2]||'').toUpperCase().startsWith('Y')) }; }
    if(up.startsWith('MT|')){
      const parts=line.split('|');
      if(parts.length<5) return null;
      const prompt=parts[1]||'';
      const leftRaw=parts[2]||'';
      const rightRaw=parts[3]||'';
      const pairsRaw=parts.slice(4).join('|');
      const left=leftRaw.split(';').map(s=>String(s||'').trim().replace(/^\d+\)\s*/,'').trim()).filter(Boolean);
      const right=rightRaw.split(';').map(s=>String(s||'').trim().replace(/^[A-Z]\)\s*/i,'').trim()).filter(Boolean);
      const matches=new Array(left.length).fill(-1);
      pairsRaw.split(',').map(s=>s.trim()).filter(Boolean).forEach((pair)=>{
        const segs=pair.split('-').map(x=>x.trim());
        if(segs.length<2) return;
        const li=parseInt(segs[0],10)-1;
        const code=segs[1] ? segs[1].toUpperCase().charCodeAt(0) : NaN;
        const ri=Number.isInteger(code)? code-65 : NaN;
        if(Number.isInteger(li) && li>=0 && li<left.length && Number.isInteger(ri) && ri>=0 && ri<right.length){
          matches[li]=ri;
        }
      });
      return normalizeMT({ type:'MT', prompt, left, right, matches });
    }
    return null;
  }
  function parseEditor(){ const ed=els().editor; const txt=(ed?.value||'').trim(); if(!txt) return []; return txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(fromLine).filter(Boolean); }

  function syncToEditor(){
    if(isSyncingToEditor) return;
    const { editor, mirror } = els();
    const lines = state.model.map(toLine).filter(Boolean).join('\n');
    isSyncingToEditor = true;
    try {
      if(editor){ editor.value = lines; editor.dispatchEvent(new Event('input', { bubbles:true })); }
      if(mirror){ mirror.value = lines; mirror.dispatchEvent(new Event('input', { bubbles:true })); }
    } finally {
      isSyncingToEditor = false;
    }
    try{ const topic=(qs('topicInput')?.value||'Edited').trim()||'Edited'; runParseFlow(lines, topic, ''); const box=qs('mirrorBox'); if(box && lines){ box.setAttribute('data-on','true'); } }catch{}
  }
  function syncFromEditor(){ if(isSyncingToEditor) return; state.model = parseEditor(); renderCards(); renderSummary(); }

  function setEnabled(on){
    state.enabled = !!on;
    saveEnabled(state.enabled);
    const m = els().mount;
    if(m) m.classList.toggle('hidden', !state.enabled);
    if(state.enabled){
      syncFromEditor();
    } else {
      renderCards();
      renderSummary();
    }
  }

  function buildUI(){
    const m=els().mount; if(!m) return;
    m.innerHTML = `
      <div class="ie-toolbar" role="group" aria-label="Interactive editor toolbar">
        <button id="ieAddMC" class="btn btn-solid" type="button" title="Add Multiple Choice">Add Multiple Choice</button>
        <button id="ieAddTF" class="btn btn-solid" type="button" title="Add True/False">Add True/False</button>
        <button id="ieAddYN" class="btn btn-solid" type="button" title="Add Yes/No">Add Yes/No</button>
        <button id="ieAddMT" class="btn btn-solid" type="button" title="Add Matching">Add Matching</button>
        <span class="flex-spacer"></span>
        <button id="ieImport" class="btn btn-ghost" type="button" title="Import from raw">Import from raw</button>
        <button id="ieClear" class="btn btn-ghost" type="button" title="Clear all">Clear all</button>
      </div>
      <div id="ieGrid" class="ie-grid" aria-live="polite"></div>
      <div id="ieSummary" class="ie-summary" role="status" aria-live="polite"></div>
    `;

    // Wire toolbar using pointerdown in capture phase to beat Options' doc-level click-away
    const bind = (id, fn)=>{
      const b=qs(id);
      if(!b) return;
      const h=(e)=>{
        try{
          e.preventDefault();
          e.stopPropagation();
          if(e.stopImmediatePropagation) e.stopImmediatePropagation();
        }catch{}
        if(e.type==='click' && e.detail!==0) return;
        fn();
      };
      b.addEventListener('pointerdown', h, true);
      b.addEventListener('click', h, false);
    };
    const addQ=(type)=>{
      const q=createQuestion(type);
      state.model.push(q);
      syncToEditor();
      renderCards();
      ensureLastVisible();
      focusLastPrompt();
      setSummaryHint(`Added ${friendlyType(q.type)} question`);
    };
    bind('ieAddMC', ()=> addQ('MC'));
    bind('ieAddTF', ()=> addQ('TF'));
    bind('ieAddYN', ()=> addQ('YN'));
    bind('ieAddMT', ()=> addQ('MT'));
    bind('ieImport', ()=>{ syncFromEditor(); setSummaryHint('Synced from raw text'); });
    bind('ieClear', ()=>{ state.model=[]; syncToEditor(); renderCards(); setSummaryHint('Cleared all questions'); });

    // Keyboard shortcuts (disabled when QE closed or text inputs are active)
    function isQEVisible(){
      try{
        const op = document.getElementById('optionsPanel');
        if(!op || op.hidden) return false;
        const adv = document.getElementById('advancedBlock');
        if(!adv || adv.hidden) return false;
        const mount = document.getElementById('interactiveEditor');
        if(!mount || mount.classList.contains('hidden')) return false;
        return true;
      }catch{ return false; }
    }
    document.addEventListener('keydown', (e)=>{
      if(!state.enabled) return;
      if(!isQEVisible()) return; // QE closed or manual editor active
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      // Don't trigger when typing in inputs/textareas/contenteditable (e.g., Topic field or manual editor)
      const ae = document.activeElement;
      if(ae && ((ae.tagName==='INPUT') || (ae.tagName==='TEXTAREA') || (ae.tagName==='SELECT') || (ae.isContentEditable===true))) return;
      const k = (typeof e.key === 'string') ? e.key.toLowerCase() : '';
      if(!k) return;
      if(k==='m'){
        e.preventDefault();
        addQ(e.shiftKey?'MT':'MC');
      }
      else if(k==='t'){ e.preventDefault(); addQ('TF'); }
      else if(k==='y'){ e.preventDefault(); addQ('YN'); }
    });
  }

  // Document-level capture safety net: handle IE toolbar clicks before
  // Options' own document capture closes the panel.
  function ensureDocDelegation(){
    if(window.__EZQ__ && window.__EZQ__.__ieV2Doc){ return; }
    const handler = (e)=>{
      const mt = qs('interactiveEditor'); if(!mt || mt.classList.contains('hidden')) return;
      let n = e.target && (e.target.nodeType===1? e.target : e.target.parentElement);
      const isInside = (el)=> !!(el && mt.contains(el));
      const findUp = (sel)=>{ let x=n; while(x){ if(x.matches && x.matches(sel)) return x; x = x.parentElement; } return null; };
      if(!isInside(n)) return;
      const add = findUp('[id="ieAddMC"], [id="ieAddTF"], [id="ieAddYN"], [id="ieAddMT"], [data-ie-add]');
      const imp = add ? null : findUp('#ieImport');
      const clr = (!add && !imp) ? findUp('#ieClear') : null;
      if(add||imp||clr){
        try{ e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); }catch{}
        if(e.type==='click' && e.detail!==0) return;
        if(add){
          const fallback = add.id==='ieAddTF' ? 'TF' : add.id==='ieAddYN' ? 'YN' : add.id==='ieAddMT' ? 'MT' : 'MC';
          const type = add.getAttribute('data-ie-add') || fallback;
          state.model.push(createQuestion(type));
          syncToEditor(); renderCards(); ensureLastVisible(); focusLastPrompt(); setSummaryHint(`Added ${friendlyType(type)} question`);
        } else if(imp){
          syncFromEditor();
          setSummaryHint('Synced from raw text');
        } else if(clr){
          state.model=[]; syncToEditor(); renderCards(); setSummaryHint('Cleared all questions');
        }
      }
    };
    // Prefer pointerdown capture to beat other capture listeners
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('click', handler, true);
    window.__EZQ__ = window.__EZQ__ || {}; window.__EZQ__.__ieV2Doc = true;
  }

  function ensureLastVisible(){ try{ const m=els().mount; const last = m && m.querySelector('.ie-card:last-of-type'); last && last.scrollIntoView({ behavior:'smooth', block:'end' }); }catch{} }
  function focusLastPrompt(){ try{ const lastPrompt = els().grid?.querySelector('.ie-card:last-of-type .ie-prompt'); if(lastPrompt){ lastPrompt.focus({ preventScroll:true }); if(typeof lastPrompt.select==='function'){ lastPrompt.select(); } } }catch{} }
  function ok(q){
    if(!q||!q.type) return false;
    if(!q.prompt||!q.prompt.trim()) return false;
    if(q.type==='MC'){ const a=(q.options||[]); const filled=a.filter(o=>o.text&&o.text.trim()).length; const corr=a.filter(o=>o.correct).length; return filled>=2 && corr>=1; }
    if(q.type==='TF'||q.type==='YN'){ return typeof q.answer==='boolean'; }
    if(q.type==='MT'){
      normalizeMT(q);
      const leftFilled=(q.left||[]).map((text,idx)=>({ idx, text:String(text||'').trim() })).filter(({text})=>text);
      const rightFilled=(q.right||[]).map((text,idx)=>({ idx, text:String(text||'').trim() })).filter(({text})=>text);
      if(!leftFilled.length || !rightFilled.length) return false;
      const rightValid=new Set(rightFilled.map(({idx})=>idx));
      return leftFilled.every(({idx})=>{
        const match=Array.isArray(q.matches)?q.matches[idx]:-1;
        return Number.isInteger(match) && match>=0 && rightValid.has(match);
      });
    }
    return false;
  }

  function btn(text, title, classes){
    const b=document.createElement('button');
    b.className='btn';
    if(typeof classes==='string' && classes.trim()){
      b.className += ` ${classes.trim()}`;
    } else {
      b.className += ' btn-ghost';
    }
    b.type='button';
    b.textContent=text;
    if(title){
      b.title=title;
      b.setAttribute('aria-label', title);
    }
    return b;
  }

  function renderCards(){
    const g=els().grid; if(!g) return; g.innerHTML='';
    state.model.forEach((q,idx)=>{
      const card=document.createElement('div'); card.className='ie-card'; card.dataset.idx=String(idx);
      const row=document.createElement('div'); row.className='ie-row';
      const type=document.createElement('select'); type.className='toolbar-input ie-type'; ['MC','TF','YN','MT'].forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=typeLabels[t] || t; if(q.type===t) o.selected=true; type.appendChild(o); });
      const actions=document.createElement('div'); actions.className='ie-actions'; const up=btn('↑','Move up','btn-ghost ie-action-btn'), down=btn('↓','Move down','btn-ghost ie-action-btn'), dup=btn('⧉','Duplicate','btn-ghost ie-action-btn'), del=btn('✕','Delete','btn-ghost ie-action-btn danger'); actions.append(up,down,dup,del); row.append(type, actions); card.appendChild(row);
      const prompt=document.createElement('input'); prompt.type='text'; prompt.className='toolbar-input ie-prompt'; prompt.placeholder='Question prompt'; prompt.value=q.prompt||''; card.appendChild(prompt);
      const area=document.createElement('div'); area.className='ie-choices';
      if(q.type==='MC'){
        q.options=q.options||[]; if(q.options.length<2) q.options=[{text:'',correct:false},{text:'',correct:false}];
        q.options.forEach((opt,i)=>{ const line=document.createElement('div'); line.className='ie-choice'; const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=!!opt.correct; const txt=document.createElement('input'); txt.type='text'; txt.value=opt.text||''; txt.placeholder=`Option ${String.fromCharCode(65+i)}`; const rm=btn('✕','Remove option','btn-ghost btn-icon'); line.append(chk,txt,rm); area.appendChild(line); chk.addEventListener('change', ()=>{ opt.correct=!!chk.checked; syncToEditor(); refreshStatus(); renderSummary(); }); txt.addEventListener('input', ()=>{ opt.text=txt.value; syncToEditor(); refreshStatus(); renderSummary(); }); rm.addEventListener('click', ()=>{ q.options.splice(i,1); syncToEditor(); renderCards(); renderSummary(); }); });
        const addOpt=btn('+ Add option','Add option','btn-ghost ie-link-btn'); addOpt.addEventListener('click', ()=>{ if(q.options.length<8){ q.options.push({text:'',correct:false}); syncToEditor(); renderCards(); renderSummary(); } }); area.appendChild(addOpt);
      } else if(q.type==='MT'){
        normalizeMT(q);
        area.className='ie-mt';
        const columns=document.createElement('div'); columns.className='ie-mt-columns';
        const pairSelectors=[];
        const refreshPairs=()=>{
          pairSelectors.forEach(({sel, li})=>{
            const current = (Array.isArray(q.matches) && Number.isInteger(q.matches[li]) && q.matches[li]>=0) ? String(q.matches[li]) : '';
            while(sel.options.length>1){ sel.remove(1); }
            q.right.forEach((text,ri)=>{ const opt=document.createElement('option'); opt.value=String(ri); const trimmed=String(text||'').trim(); opt.textContent = trimmed ? `${String.fromCharCode(65+ri)}) ${trimmed}` : `${String.fromCharCode(65+ri)})`; sel.appendChild(opt); });
            if(current){ sel.value=current; if(sel.value!==current) sel.value=''; }
            else { sel.value=''; }
          });
        };

        const leftSection=document.createElement('div'); leftSection.className='ie-mt-column';
        const leftTitle=document.createElement('div'); leftTitle.className='ie-mt-head'; leftTitle.textContent='Left side'; leftSection.appendChild(leftTitle);
        const leftList=document.createElement('div'); leftList.className='ie-mt-list ie-mt-left-list';
        q.left.forEach((text,li)=>{
          const line=document.createElement('div'); line.className='ie-choice ie-mt-item ie-mt-left';
          const lbl=document.createElement('span'); lbl.className='ie-mt-chip'; lbl.textContent=`${li+1}`;
          const pairWrap=document.createElement('div'); pairWrap.className='ie-mt-pair';
          const txt=document.createElement('input'); txt.type='text'; txt.className='toolbar-input'; txt.placeholder=`Left ${li+1}`; txt.value=text||'';
          const sel=document.createElement('select'); sel.className='toolbar-input ie-mt-select'; const none=document.createElement('option'); none.value=''; none.textContent='—'; sel.appendChild(none);
          pairSelectors.push({ sel, li });
          pairWrap.append(txt, sel);
          const rm=btn('✕','Remove left item','btn-ghost btn-icon');
          line.append(lbl, pairWrap, rm);
          leftList.appendChild(line);
          txt.addEventListener('input', ()=>{ q.left[li]=txt.value; syncToEditor(); refreshStatus(); renderSummary(); });
          sel.addEventListener('change', ()=>{ q.matches[li] = sel.value==='' ? -1 : parseInt(sel.value,10); syncToEditor(); refreshStatus(); renderSummary(); });
          rm.addEventListener('click', ()=>{ q.left.splice(li,1); q.matches.splice(li,1); syncToEditor(); renderCards(); renderSummary(); });
        });
        leftSection.appendChild(leftList);
        const addLeft=btn('+ Add left item','Add left item','btn-ghost ie-link-btn');
        addLeft.addEventListener('click', ()=>{ q.left.push(''); q.matches.push(-1); syncToEditor(); renderCards(); renderSummary(); });
        const leftFoot=document.createElement('div'); leftFoot.className='ie-mt-foot'; leftFoot.appendChild(addLeft);
        leftSection.appendChild(leftFoot);

        const rightSection=document.createElement('div'); rightSection.className='ie-mt-column';
        const rightTitle=document.createElement('div'); rightTitle.className='ie-mt-head'; rightTitle.textContent='Right side'; rightSection.appendChild(rightTitle);
        const rightList=document.createElement('div'); rightList.className='ie-mt-list ie-mt-right-list';
        q.right.forEach((text,ri)=>{
          const line=document.createElement('div'); line.className='ie-choice ie-mt-item ie-mt-right';
          const lbl=document.createElement('span'); lbl.className='ie-mt-chip'; lbl.textContent=`${String.fromCharCode(65+ri)}`;
          const txt=document.createElement('input'); txt.type='text'; txt.className='toolbar-input'; txt.placeholder=`Right ${String.fromCharCode(65+ri)}`; txt.value=text||'';
          const rm=btn('✕','Remove right item','btn-ghost btn-icon');
          line.append(lbl, txt, rm);
          rightList.appendChild(line);
          txt.addEventListener('input', ()=>{ q.right[ri]=txt.value; syncToEditor(); refreshStatus(); renderSummary(); refreshPairs(); });
          rm.addEventListener('click', ()=>{ q.right.splice(ri,1); q.matches=q.matches.map((m)=> (m===ri?-1: m>ri?m-1:m)); syncToEditor(); renderCards(); renderSummary(); });
        });
        rightSection.appendChild(rightList);
        const addRight=btn('+ Add right item','Add right item','btn-ghost ie-link-btn');
        addRight.addEventListener('click', ()=>{ q.right.push(''); syncToEditor(); renderCards(); renderSummary(); });
        const rightFoot=document.createElement('div'); rightFoot.className='ie-mt-foot'; rightFoot.appendChild(addRight);
        rightSection.appendChild(rightFoot);

        columns.append(leftSection, rightSection);
        area.appendChild(columns);
        refreshPairs();
      } else {
        const line=document.createElement('div'); line.className='ie-choice'; const sel=document.createElement('select'); const opts=(q.type==='TF')?[['T','True'],['F','False']]:[['Y','Yes'],['N','No']]; opts.forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; sel.appendChild(o); }); sel.value = (q.type==='TF') ? (q.answer?'T':'F') : (q.answer?'Y':'N'); const lbl=document.createElement('span'); lbl.textContent='Correct'; line.append(sel,lbl); area.appendChild(line); sel.addEventListener('change', ()=>{ const v=sel.value; q.answer = (q.type==='TF') ? v==='T' : v==='Y'; syncToEditor(); refreshStatus(); renderSummary(); });
      }
      card.appendChild(area);
      const status=document.createElement('div');
      const refreshStatus=()=>{
        const good=ok(q);
        status.className = good ? 'ie-status ie-status-good' : 'ie-status ie-status-warn';
        status.textContent = good ? 'Ready to use' : 'Needs details';
      };
      refreshStatus();
      card.appendChild(status);
      type.addEventListener('change', ()=>{
        const selected=type.value;
        if(selected==='MC'){
          q.type='MC';
          q.options = Array.isArray(q.options)
            ? q.options.map((opt)=>({ text: opt?.text||'', correct: !!opt?.correct }))
            : [];
          while(q.options.length<2){ q.options.push({ text:'', correct:false }); }
          delete q.answer;
          delete q.left; delete q.right; delete q.matches; delete q.pairs;
        } else if(selected==='MT'){
          q.type='MT';
          delete q.answer;
          q.options=[];
          const defaults=createQuestion('MT');
          q.left = Array.isArray(q.left) && q.left.length ? q.left : defaults.left.slice();
          q.right = Array.isArray(q.right) && q.right.length ? q.right : defaults.right.slice();
          q.matches = Array.isArray(q.matches) && q.matches.length ? q.matches : defaults.matches.slice();
          delete q.pairs;
          normalizeMT(q);
        } else {
          const defaults=createQuestion(selected);
          q.type=defaults.type;
          q.answer=defaults.answer;
          q.options=[];
          delete q.left; delete q.right; delete q.matches; delete q.pairs;
        }
        syncToEditor(); renderCards(); setSummaryHint(`Switched to ${friendlyType(selected)} question`);
      });
      prompt.addEventListener('input', ()=>{ q.prompt=prompt.value; syncToEditor(); refreshStatus(); renderSummary(); });
      up.addEventListener('click', ()=>{ if(idx>0){ const a=state.model; [a[idx-1],a[idx]]=[a[idx],a[idx-1]]; syncToEditor(); renderCards(); setSummaryHint('Moved question up'); }});
      down.addEventListener('click', ()=>{ const a=state.model; if(idx<a.length-1){ [a[idx+1],a[idx]]=[a[idx],a[idx+1]]; syncToEditor(); renderCards(); setSummaryHint('Moved question down'); }});
      dup.addEventListener('click', ()=>{ const a=state.model; a.splice(idx+1,0, JSON.parse(JSON.stringify(q))); syncToEditor(); renderCards(); ensureLastVisible(); focusLastPrompt(); setSummaryHint('Duplicated question'); });
      del.addEventListener('click', ()=>{ const a=state.model; a.splice(idx,1); syncToEditor(); renderCards(); setSummaryHint('Removed question'); });
      g.appendChild(card);
    });
  }

  function renderSummary(){
    const s=els().summary; if(!s) return;
    const total=state.model.length;
    const valid=state.model.filter(ok).length;
    if(!total){
      const hint = summaryHint || 'Use the Add buttons or import from raw text. Hotkeys: M, Shift+M, T, Y.';
      s.innerHTML = `
        <span class="ie-summary-pill ie-summary-empty">No questions yet</span>
        <span class="ie-summary-hint">${hint}</span>
      `;
      return;
    }
    const allValid = valid===total;
    const validityClass = allValid ? 'ie-summary-valid' : 'ie-summary-warn';
    const baseHint = allValid ? 'All set — ready to generate.' : 'Finish the highlighted cards to preview.';
    const hint = summaryHint || `${baseHint} Hotkeys: M, Shift+M, T, Y.`;
    s.innerHTML = `
      <span class="ie-summary-pill">${total} ${total===1?'question':'questions'}</span>
      <span class="ie-summary-pill ${validityClass}">${valid}/${total} ready</span>
      <span class="ie-summary-hint">${hint}</span>
    `;
  }

  function init(){
    buildUI();
    ensureDocDelegation();
    const t=els().toggle;
    if(t){
      const initial = loadEnabled();
      t.checked = initial;
      t.addEventListener('change', ()=> setEnabled(!!t.checked));
      setEnabled(initial);
      try{ t.dispatchEvent(new Event('change')); }catch{}
    } else {
      setEnabled(loadEnabled());
    }
    els().editor?.addEventListener('input', ()=>{ if(!state.enabled) return; syncFromEditor(); });
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }
  return { init };
})();

export default IE2;
