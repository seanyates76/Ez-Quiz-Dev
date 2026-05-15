export const LANDING_INTRO_STORAGE_KEY = 'ezq.landingIntro.visibility';
export const LEGACY_LANDING_PREVIEW_STORAGE_KEY = 'ezq.hideLandingPreview';
export const LANDING_INTRO_VISIBILITY = Object.freeze({
  AFTER_UPDATES: 'after-updates',
  NEVER: 'never',
  ALWAYS: 'always',
});

const VALID_VISIBILITY = new Set(Object.values(LANDING_INTRO_VISIBILITY));
const SLIDE_LABELS = ['What’s new', 'Coming soon', 'Tips'];

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
  const title = document.getElementById('landingPreviewTitle');
  const closeBtn = document.getElementById('landingPreviewClose');
  const dontShow = document.getElementById('landingPreviewDontShow');
  const prevBtn = document.getElementById('landingPreviewPrev');
  const nextBtn = document.getElementById('landingPreviewNext');
  const slides = Array.from(panel?.querySelectorAll('[data-preview-slide]') || []);
  const steps = Array.from(panel?.querySelectorAll('[data-preview-step]') || []);
  let current = 0;

  function show(index){
    if(!slides.length) return;
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== current; });
    steps.forEach((step, i) => {
      step.classList.toggle('is-active', i === current);
      step.setAttribute('aria-selected', i === current ? 'true' : 'false');
    });
    if(title) title.textContent = SLIDE_LABELS[current] || SLIDE_LABELS[0];
  }

  closeBtn?.addEventListener('click', () => {
    dismissLandingIntro({ persist: !!dontShow?.checked });
  });
  prevBtn?.addEventListener('click', () => show(current - 1));
  nextBtn?.addEventListener('click', () => show(current + 1));
  steps.forEach((step) => {
    step.addEventListener('click', () => show(Number(step.dataset.previewStep || 0)));
  });

  show(0);
}
