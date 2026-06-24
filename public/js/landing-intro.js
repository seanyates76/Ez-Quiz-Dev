export const LANDING_INTRO_STORAGE_KEY = 'ezq.landingIntro.visibility';
export const LEGACY_LANDING_PREVIEW_STORAGE_KEY = 'ezq.hideLandingPreview';
export const LANDING_LAST_SEEN_VERSION_STORAGE_KEY = 'ezq.landingIntro.lastSeenVersion';
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

function currentAppVersion(){
  const explicit = document.documentElement?.dataset?.appVersion || document.body?.dataset?.appVersion || '';
  if(explicit) return String(explicit).trim();
  const releaseHeading = document.querySelector('#releaseNotesModal .release-notes--production h4');
  return String(releaseHeading?.textContent || '').trim();
}

export function getLandingIntroVisibility(){
  const value = readStorage(LANDING_INTRO_STORAGE_KEY);
  if(VALID_VISIBILITY.has(value)) return value;
  if(readStorage(LEGACY_LANDING_PREVIEW_STORAGE_KEY) === '1') {
    return LANDING_INTRO_VISIBILITY.NEVER;
  }
  return LANDING_INTRO_VISIBILITY.AFTER_UPDATES;
}

function hasUnseenVersion(version = currentAppVersion()){
  const normalized = String(version || '').trim();
  return !!(normalized && readStorage(LANDING_LAST_SEEN_VERSION_STORAGE_KEY) !== normalized);
}

function markVersionSeen(version = currentAppVersion()){
  const normalized = String(version || '').trim();
  if(normalized) writeStorage(LANDING_LAST_SEEN_VERSION_STORAGE_KEY, normalized);
}

function landingIntroMode(version = currentAppVersion()){
  const visibility = getLandingIntroVisibility();
  const normalized = String(version || '').trim();
  if(visibility === LANDING_INTRO_VISIBILITY.ALWAYS) return 'normal';
  if(visibility === LANDING_INTRO_VISIBILITY.NEVER) return hasUnseenVersion(normalized) ? 'update' : 'hidden';
  return !normalized || hasUnseenVersion(normalized) ? 'normal' : 'hidden';
}

export function shouldShowLandingIntro(options = {}){
  return landingIntroMode(options.version) !== 'hidden';
}

export function dismissLandingIntro({ persist = false, version = currentAppVersion() } = {}){
  const intro = document.getElementById('landingIntro');
  if(intro) intro.hidden = true;
  markVersionSeen(version);
  if(persist) {
    writeStorage(LANDING_INTRO_STORAGE_KEY, LANDING_INTRO_VISIBILITY.NEVER);
    writeStorage(LEGACY_LANDING_PREVIEW_STORAGE_KEY, '1');
  }
}

function wireFeatureCards(root){
  const toggles = Array.from(root?.querySelectorAll('[data-feature-card-toggle]') || []);
  toggles.forEach((toggle) => {
    if(toggle.dataset.featureCardWired === 'true') return;
    toggle.dataset.featureCardWired = 'true';
    const card = toggle.closest('.landing-feature-card');
    const detailId = toggle.getAttribute('aria-controls');
    const detail = detailId ? document.getElementById(detailId) : card?.querySelector('[data-feature-card-detail]');

    function setOpen(open){
      const expanded = !!open;
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if(detail) detail.hidden = !expanded;
      card?.classList.toggle('is-open', expanded);
    }

    setOpen(toggle.getAttribute('aria-expanded') === 'true' && !!detail && detail.hidden === false);
    toggle.addEventListener('click', () => {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    toggle.addEventListener('keydown', (event) => {
      if(event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
  });
}

export function wireLandingIntro(){
  const intro = document.getElementById('landingIntro');
  if(!intro) return;
  const version = currentAppVersion();
  const mode = landingIntroMode(version);

  if(mode === 'hidden') {
    intro.hidden = true;
    return;
  }

  intro.hidden = false;
  intro.dataset.landingMode = mode;

  const panel = document.getElementById('landingPreview');
  const closeBtn = document.getElementById('landingIntroClose') || document.getElementById('landingPreviewClose');
  const dontShow = document.getElementById('landingIntroDontShow') || document.getElementById('landingPreviewDontShow');
  const panels = Array.from(panel?.querySelectorAll('[data-preview-panel], [data-preview-slide]') || []);
  const tabs = Array.from(panel?.querySelectorAll('[data-preview-tab], [data-preview-step]') || []);
  const updateOnly = mode === 'update';
  let current = 0;

  if(updateOnly && dontShow) dontShow.hidden = true;
  wireFeatureCards(panel);

  function show(index){
    if(!panels.length) return;
    current = updateOnly ? 0 : Math.max(0, Math.min(index, panels.length - 1));
    panels.forEach((tabPanel, i) => { tabPanel.hidden = i !== current; });
    tabs.forEach((tab, i) => {
      const active = i === current;
      if(updateOnly && i !== 0) tab.hidden = true;
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
