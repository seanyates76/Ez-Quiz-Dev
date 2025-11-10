import { S } from './state.js';
import { loadSettingsFromStorage, applyTheme } from './settings.js';
import { wireGenerator } from './generator.js?v=1.5.26';
import { has as hasFlag, hasCookie as hasCookieFlag } from './flags.js';

const noop = () => {};

function syncBetaState(){
  const betaCookieActive = hasCookieFlag('beta');
  const betaActive = hasFlag('beta') || betaCookieActive || !!S.settings.betaEnabled;
  S.settings.betaEnabled = !!betaActive;
  try{
    if(betaActive){ document.body.dataset.beta = 'true'; }
    else { document.body.removeAttribute('data-beta'); }
  }catch{}
}

function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      try { reg.update(); } catch {}
      if (reg.waiting) {
        try { reg.waiting.postMessage('SKIP_WAITING'); } catch {}
      }
    }).catch(() => {});
  });
}

async function hydrateShareAndEditor(){
  try {
    const share = await import('./share.js?v=1.5.26');
    if (typeof share.updateShareVisibility === 'function') {
      share.updateShareVisibility();
    }
  } catch (err) {
    console.warn('[create] Failed to load share helpers', err);
  }
  try {
    await import('./editor.gui.js?v=1.5.26');
  } catch (err) {
    console.warn('[create] Failed to load interactive editor', err);
  }
}

function initCreatePage(){
  loadSettingsFromStorage();
  try{
    document.body.dataset.page = 'create';
    document.body.classList.add('create-page');
  }catch{}
  syncBetaState();
  applyTheme(S.settings.theme);
  wireGenerator({ beginQuiz: noop, syncSettingsFromUI: noop });
  hydrateShareAndEditor();
  registerServiceWorker();
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initCreatePage);
}else{
  initCreatePage();
}

export { initCreatePage };
