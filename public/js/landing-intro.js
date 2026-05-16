export const LANDING_INTRO_STORAGE_KEY = 'ezq.landingIntro.visibility';
export const LEGACY_LANDING_PREVIEW_STORAGE_KEY = 'ezq.hideLandingPreview';
export const LANDING_INTRO_VISIBILITY = Object.freeze({
  AFTER_UPDATES: 'after-updates',
  NEVER: 'never',
  ALWAYS: 'always',
});

const VALID_VISIBILITY = new Set(Object.values(LANDING_INTRO_VISIBILITY));
function readStorage(key){
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value){
  try { localStorage.setItem(key, value); } catch {}
}

export function getLandingIntroVisibility(){
  const value = readStorage(LANDING_INTRO_STORAGE_KEY);
  if(VALID_VISIBILITY.has(value)) return value;
  if(readStorage(LEGACY_LANDING_PREVIEW_STORAGE_KEY) === '1') {
    return LANDING_INTRO_VISIBILITY.NEVER;
  }
  return LANDING_INTRO_VISIBILITY.AFTER_UPDATES;
}

export function shouldShowLandingIntro(){
  const visibility = getLandingIntroVisibility();
  if(visibility === LANDING_INTRO_VISIBILITY.NEVER) return false;
  return true;
}

export function dismissLandingIntro({ persist = false } = {}){
  const intro = document.getElementById('landingIntro');
  if(intro) intro.hidden = true;
  if(persist) {
    writeStorage(LANDING_INTRO_STORAGE_KEY, LANDING_INTRO_VISIBILITY.NEVER);
    writeStorage(LEGACY_LANDING_PREVIEW_STORAGE_KEY, '1');
  }
}

export function wireLandingIntro(){
  const intro = document.getElementById('landingIntro');
  if(!intro) return;

  if(!shouldShowLandingIntro()) {
    intro.hidden = true;
    return;
  }

  intro.hidden = false;

  const panel = document.getElementById('landingPreview');
  const closeBtn = document.getElementById('landingIntroClose') || document.getElementById('landingPreviewClose');
  const dontShow = document.getElementById('landingIntroDontShow') || document.getElementById('landingPreviewDontShow');
  const panels = Array.from(panel?.querySelectorAll('[data-preview-panel], [data-preview-slide]') || []);
  const tabs = Array.from(panel?.querySelectorAll('[data-preview-tab], [data-preview-step]') || []);
  let current = 0;

  function show(index){
    if(!panels.length) return;
    current = Math.max(0, Math.min(index, panels.length - 1));
    panels.forEach((tabPanel, i) => { tabPanel.hidden = i !== current; });
    tabs.forEach((tab, i) => {
      const active = i === current;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
  }

  closeBtn?.addEventListener('click', () => {
    dismissLandingIntro();
  });
  dontShow?.addEventListener('click', () => {
    dismissLandingIntro({ persist: true });
  });
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => show(index));
    tab.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if(event.key === 'ArrowRight') nextIndex = (current + 1) % tabs.length;
      if(event.key === 'ArrowLeft') nextIndex = (current - 1 + tabs.length) % tabs.length;
      if(event.key === 'Home') nextIndex = 0;
      if(event.key === 'End') nextIndex = tabs.length - 1;
      if(nextIndex == null) return;
      event.preventDefault();
      show(nextIndex);
      tabs[nextIndex]?.focus();
    });
  });

  show(0);
}
