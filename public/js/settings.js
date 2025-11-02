import { S, STORAGE_KEYS } from './state.js';
import { msToMmSs, mmSsToMs } from './utils.js';
import { has as hasFlag, setFlag, addCookieFlag, clearCookieFlag } from './flags.js';

// Cookie helpers for persistent flags (1 year)
const COOKIE_SHOW_QUIZ_EDITOR = 'ezq.showQuizEditor';
const LEGACY_COOKIE_ALWAYS_SHOW_ADV = 'ezq.alwaysShowAdvanced';
function setCookie(name, value){
  try{
    const secure = (typeof location !== 'undefined' && location.protocol === 'https:') ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(String(value))}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
  }catch{}
}
function getCookie(name){ try{ return document.cookie.split(';').map(s=>s.trim()).filter(Boolean).map(s=>s.split('='))
  .reduce((acc,[k,v])=>{ acc[decodeURIComponent(k)] = decodeURIComponent(v||''); return acc; }, {})[name] || ''; }catch{ return ''; } }

export function saveSettingsToStorage(){
  try{
    localStorage.setItem(STORAGE_KEYS.theme, S.settings.theme);
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      timerEnabled: !!S.settings.timerEnabled,
      countdown: !!S.settings.countdown,
      durationMs: Number(S.settings.durationMs||0),
      autoStart: !!S.settings.autoStart,
      requireAnswer: !!S.settings.requireAnswer,
      betaEnabled: !!S.settings.betaEnabled,
    }));
  }catch{}
}

export function loadSettingsFromStorage(){
  try{ const t=localStorage.getItem(STORAGE_KEYS.theme); if(t==='light'||t==='dark'||t==='system') S.settings.theme=t; }catch{}
  try{ const raw=localStorage.getItem(STORAGE_KEYS.settings); if(raw){ const obj=JSON.parse(raw);
    S.settings.timerEnabled=!!obj.timerEnabled; S.settings.countdown=!!obj.countdown; S.settings.durationMs=Number(obj.durationMs||0);
    if(obj.autoStart!==undefined) S.settings.autoStart=!!obj.autoStart; S.settings.requireAnswer=!!obj.requireAnswer;
    if(obj.betaEnabled!==undefined) S.settings.betaEnabled=!!obj.betaEnabled; } }catch{}
  if(hasFlag('beta')){
    S.settings.betaEnabled = true;
  }
  // Load cookie-backed flags
  try{
    const pref = getCookie(COOKIE_SHOW_QUIZ_EDITOR);
    if(pref){
      S.settings.showQuizEditor = pref === 'true';
    } else {
      const legacy = getCookie(LEGACY_COOKIE_ALWAYS_SHOW_ADV);
      if(legacy){ S.settings.showQuizEditor = legacy === 'true'; }
    }
  }catch{}
}

let _mql;
function ensureMql(){
  try{ if(!_mql && window.matchMedia){ _mql = window.matchMedia('(prefers-color-scheme: dark)'); } }catch{}
  return _mql;
}

export function applyTheme(theme){
  const t=(theme==='light'||theme==='dark'||theme==='system')?theme:'dark';
  S.settings.theme=t;
  let eff = t;
  if(t==='system'){
    const m=ensureMql(); eff = (m && m.matches) ? 'dark' : 'light';
  }
  try{
    const root = document.documentElement;
    root.setAttribute('data-theme', eff);
    const preload = window.__EZQ_PRELOADED_THEME || {};
    window.__EZQ_PRELOADED_THEME = { choice: t, applied: eff, previous: preload.applied };
  }catch{}
  // Swap brand logo asset based on theme, with simple, explicit mapping
  try{
    const img = document.querySelector('#brandTitle.brand-logo') || document.querySelector('.brand-logo');
    if(img){
      const attrDark = img.getAttribute('data-dark');
      const attrLight = img.getAttribute('data-light');
      const darkPng = attrDark || 'icons/brand-title-source.png';
      const lightPng = attrLight || 'icons/brand-title-source-light.png';
      const BUST = 'v=brand-20250911s';
      const withBust = (url) => url && (url.includes('?') ? url : `${url}?${BUST}`);
      const pick = t === 'light' ? lightPng : darkPng;
      const fallback = darkPng;
      img.onerror = () => { img.onerror = null; if(fallback) img.setAttribute('src', withBust(fallback)); };
      if(pick) img.setAttribute('src', withBust(pick));
    }
  }catch{}
  // If following system, react to changes
  try{
    const m=ensureMql();
    if(m){
      if(t==='system'){
        if(!applyTheme._bound){
          m.addEventListener ? m.addEventListener('change', ()=>{ if(S.settings.theme==='system'){ applyTheme('system'); } })
                             : m.addListener && m.addListener(()=>{ if(S.settings.theme==='system'){ applyTheme('system'); } });
          applyTheme._bound = true;
        }
      }
    }
  }catch{}

  saveSettingsToStorage();
}

export function reflectSettingsIntoUI(els){
  els.themeRadios.forEach(r=>{ r.checked=(r.value===S.settings.theme); });
  if(els.timerEnabledEl) els.timerEnabledEl.checked=!!S.settings.timerEnabled;
  if(els.countdownModeEl) els.countdownModeEl.checked=!!S.settings.countdown;
  if(els.timerDurationEl) els.timerDurationEl.value=msToMmSs(S.settings.durationMs);
  if(els.autoStartEl) els.autoStartEl.checked=!!S.settings.autoStart;
  if(els.requireAnswerEl) els.requireAnswerEl.checked=!!S.settings.requireAnswer;
  if(els.quizEditorPrefEl) els.quizEditorPrefEl.checked=!!S.settings.showQuizEditor;
  if(els.betaEnabledEl) els.betaEnabledEl.checked=!!S.settings.betaEnabled;
}

export function wireSettingsPanel(els){
  els.themeRadios.forEach(radio=>{ radio.addEventListener('change', ()=>{ if(radio.checked) applyTheme(radio.value); }); });
  els.timerEnabledEl?.addEventListener('change', ()=>{ S.settings.timerEnabled=!!els.timerEnabledEl.checked; saveSettingsToStorage(); });
  els.countdownModeEl?.addEventListener('change', ()=>{ S.settings.countdown=!!els.countdownModeEl.checked; saveSettingsToStorage(); });
  els.timerDurationEl?.addEventListener('input', ()=>{ S.settings.durationMs=mmSsToMs(els.timerDurationEl.value); saveSettingsToStorage(); });
  els.autoStartEl?.addEventListener('change', ()=>{ S.settings.autoStart=!!els.autoStartEl.checked; saveSettingsToStorage(); });
  els.requireAnswerEl?.addEventListener('change', ()=>{ S.settings.requireAnswer=!!els.requireAnswerEl.checked; saveSettingsToStorage(); });
  els.quizEditorPrefEl?.addEventListener('change', ()=>{
    S.settings.showQuizEditor = !!els.quizEditorPrefEl.checked;
    try{
      const serialized = String(!!S.settings.showQuizEditor);
      setCookie(COOKIE_SHOW_QUIZ_EDITOR, serialized);
      setCookie(LEGACY_COOKIE_ALWAYS_SHOW_ADV, serialized);
    }catch{}
  });
  els.betaEnabledEl?.addEventListener('change', ()=>{
    S.settings.betaEnabled = !!els.betaEnabledEl.checked;
    saveSettingsToStorage();
    try{ setFlag('beta', !!S.settings.betaEnabled); }catch{}
    try{
      const g = (window.__EZQ__ = window.__EZQ__ || {});
      if(S.settings.betaEnabled){
        addCookieFlag('beta');
        // Request a clean redirect to /beta when Settings closes
        g.__betaPendingRedirect = '/beta';
        g.__betaRefreshPending = false;
      }else{
        clearCookieFlag('beta');
        // No redirect on disable; stay put
        g.__betaPendingRedirect = null;
        g.__betaRefreshPending = false;
      }
    }catch{}
  });

}

// Expose cookie helpers for other modules
export function getShowQuizEditorPreference(){ return !!S.settings.showQuizEditor; }
