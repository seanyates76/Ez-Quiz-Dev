export const $ = (id) => document.getElementById(id);
export const byQSA = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function readGlobalMaxQuestions() {
  try {
    const root = typeof window !== 'undefined' && window
      ? window
      : (typeof globalThis !== 'undefined' ? globalThis : null);
    if (!root) return NaN;
    const scoped = root.__EZQ__;
    if (scoped && Number.isFinite(scoped.MAX_QUESTIONS)) {
      return Math.max(1, Math.trunc(scoped.MAX_QUESTIONS));
    }
  } catch {}
  return NaN;
}

export function getMaxQuestions() {
  const configured = readGlobalMaxQuestions();
  if (Number.isFinite(configured)) return configured;
  return 30;
}

export function clampCount(n, options = {}) {
  const { fallback = null, min = 1 } = options || {};
  const minValue = Number.isFinite(min) ? Math.max(1, Math.trunc(min)) : 1;
  const max = Math.max(minValue, getMaxQuestions());

  const useFallback = (value) => {
    if (!Number.isFinite(value)) return minValue;
    const intVal = Math.trunc(value);
    return Math.min(max, Math.max(minValue, intVal));
  };

  if (n === '' || n === null || n === undefined) {
    if (Number.isFinite(fallback)) {
      return useFallback(fallback);
    }
    return minValue;
  }

  if (typeof n === 'string' && n.trim() === '') {
    if (Number.isFinite(fallback)) {
      return useFallback(fallback);
    }
    return minValue;
  }

  const x = Number(n);
  if (!Number.isFinite(x)) {
    if (Number.isFinite(fallback)) {
      return useFallback(fallback);
    }
    return minValue;
  }

  return useFallback(x);
}
export function pad2(n){ return String(n).padStart(2,'0'); }
export function formatDuration(ms){ if(!ms || ms < 0) ms = 0; const total = Math.floor(ms/1000); const mm = Math.floor(total/60); const ss = total % 60; return `${pad2(mm)}:${pad2(ss)}`; }
export function arraysEqual(a,b){ if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length) return false; for(let i=0;i<a.length;i++){ if(a[i]!==b[i]) return false; } return true; }
export function escapeHTML(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
export function normalizeLettersToIndexes(letterStr){ if(!letterStr) return []; return letterStr.split(',').map(s=>s.trim()).filter(Boolean).map(ch => ch.toUpperCase().charCodeAt(0) - 65).filter(n => n >= 0); }
export function indexesToLetters(idxs){ return (idxs||[]).map(i => String.fromCharCode(65 + i)); }
export function msToMmSs(ms){ if(!ms || ms<=0) return ''; const mm = Math.floor(ms/60000), ss = Math.floor((ms%60000)/1000); return `${pad2(mm)}:${pad2(ss)}`; }
export function mmSsToMs(txt){ const s=(txt||'').trim(); if(!s) return 0; const parts=s.split(':'); if(parts.length===2){ const mm=parseInt(parts[0],10)||0; const ss=parseInt(parts[1],10)||0; return (mm*60+ss)*1000; } const mm=parseInt(s,10)||0; return mm*60*1000; }
export function formatTopicLabel(raw){ if(!raw) return ''; const base = String(raw).replace(/\.[a-zA-Z0-9]{1,5}$/,''); const parts = base.trim().split(/\s+/); return parts.map(w=> w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' '); }

// UI helpers
export function showUpdateBannerIfReady(){
  try{
    const flag = localStorage.getItem('ezq.update.ready');
    if(flag === '1'){
      const banner = document.getElementById('updateBanner');
      if(banner){
        banner.classList.remove('hidden');
        banner.hidden = false;
      }
    }
  }catch{}
}

// Event helper: bind once per element/property name
export function bindOnce(el, type, handler, flagName){
  if(!el) return;
  const key = flagName || (`__bound_${type}`);
  if(el[key]) return;
  el.addEventListener(type, handler);
  el[key] = true;
}

// Localized toast near an anchor element
export function showToastNear(anchor, message, opts = {}){
  try{
    if(!anchor || !anchor.getBoundingClientRect) return;
    const rect = anchor.getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'toast-fly';
    t.role = 'status';
    t.textContent = String(message || '');
    // Position: prefer above the anchor; fallback below if near top edge
    const margin = 8;
    let top = rect.top - margin;
    let placeAbove = true;
    if (top < 24) { placeAbove = false; top = rect.bottom + margin; }
    const left = Math.round(rect.left + rect.width / 2);
    t.style.position = 'fixed';
    t.style.top = `${Math.round(top)}px`;
    t.style.left = `${left}px`;
    t.style.transform = placeAbove ? 'translate(-50%, -8px)' : 'translate(-50%, 8px)';
    t.style.zIndex = '1200';
    document.body.appendChild(t);
    // Animate in
    requestAnimationFrame(() => t.classList.add('show'));
    const lifetime = Number.isFinite(opts.ms) ? Math.max(800, Math.min(10000, opts.ms)) : 2200;
    setTimeout(() => {
      try{
        t.classList.remove('show');
        t.classList.add('hide');
        setTimeout(() => { t.remove(); }, 180);
      }catch{}
    }, lifetime);
  }catch{}
}
