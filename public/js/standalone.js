import { S } from './state.js';
const CONFIG_KEY = 'ezq.ai.config';
const SECRET_KEY = 'ezq.ai.key';
const DEFAULTS = { gemini: 'gemini-3.5-flash-lite', openai: 'gpt-4.1-mini' };
let apiKey = '';
let config = { provider: 'gemini', model: DEFAULTS.gemini };
let token = '';
let sharedConnection = null;
let connectionReady = Promise.resolve();
export function forgetKey() {
  apiKey = '';
  try { localStorage.removeItem(SECRET_KEY); } catch {}
  const field = document.getElementById('aiKey');
  if (field) field.value = '';
  reflectConnection();
}
function reflectConnection() {
  const label = document.getElementById('aiConnectionStatus');
  if (label) label.textContent = apiKey ? (config.provider === 'gemini' ? 'Gemini' : 'OpenAI') + ' key ready' : sharedConnection ? 'Shared OpenAI ready' : 'Set up AI';
}
function localOrigin() { return location.protocol === 'http:' && location.hostname === '127.0.0.1'; }
async function localRequest(route, payload, { signal, needsKey = true } = {}) {
  if (needsKey && !apiKey) await connectionReady;
  if (needsKey && !apiKey && !sharedConnection) throw new Error('Add your API key in AI settings first, or try the demo without a key.');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(100000)]) : AbortSignal.timeout(100000);
  if (localOrigin() && !token) {
    let session;
    try {
      const response = await fetch('/api/session', { cache: 'no-store', signal: requestSignal, credentials: 'omit', redirect: 'error' });
      session = response.ok ? await response.json() : null;
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new Error('Start the local launcher with npm start, then open the address it prints.');
    }
    if (!/^[a-f0-9]{64}$/.test(session?.token || '')) throw new Error('Start the local launcher with npm start, then open the address it prints.');
    token = session.token;
  }
  try {
    const local = localOrigin();
    const response = await fetch(local ? route : '/.netlify/functions/standalone-ai', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: requestSignal,
      headers: { 'Content-Type': 'application/json', ...(local ? { 'X-EZQ-Token': token } : {}) },
      body: JSON.stringify({ ...payload, ...(!local ? { route } : {}), ...(needsKey ? (apiKey ? { connection: { ...config, apiKey } } : { useShared: true }) : {}) }),
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 403) token = '';
      throw new Error(body.error || 'The request could not be completed.');
    }
    return body;
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (err.name === 'TimeoutError') throw new Error('The provider took too long. Try fewer questions.');
    if (err instanceof TypeError) throw new Error(localOrigin() ? 'The local launcher is unavailable. Restart npm start and try again.' : 'Could not reach AI. Check your connection and try again.');
    throw err;
  }
}
export function wireStandalone() {
  if (document.documentElement.dataset.edition !== 'standalone') return;
  S.standalone = {
    request: localRequest, forget: forgetKey,
    async import(payload, options) {
      const needsKey = ['pdf', 'png', 'jpeg', 'gif'].includes(payload.kind);
      if (needsKey) {
        if (!apiKey) await connectionReady;
        if (!apiKey && !sharedConnection) throw new Error('Add your API key in AI settings to read PDFs or images. Text and DOCX imports work locally.');
        const provider = (apiKey ? config : sharedConnection).provider === 'gemini' ? 'Google Gemini' : 'OpenAI';
        if (!window.confirm('Send “' + (payload.name || 'this file') + '” to ' + provider + ' to extract study text? Your provider’s data policies and API charges apply.')) throw new DOMException('Aborted', 'AbortError');
      }
      return localRequest('/api/import', payload, { ...options, needsKey });
    },
  };
  apiKey = '';
  try { apiKey = localStorage.getItem(SECRET_KEY) || ''; } catch {}
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (saved && Object.hasOwn(DEFAULTS, saved.provider)) config = { provider: saved.provider, model: String(saved.model || DEFAULTS[saved.provider]) };
  } catch {}
  const $ = id => document.getElementById(id);
  const provider = $('aiProvider'), model = $('aiModel'), key = $('aiKey'), status = $('aiSettingsStatus');
  provider.value = config.provider; model.value = config.model; key.value = apiKey;
  function updateKeyLink() {
    const gemini = provider.value === 'gemini';
    $('aiKeyLink').href = gemini ? 'https://aistudio.google.com/api-keys' : 'https://platform.openai.com/api-keys';
    $('aiKeyLink').textContent = gemini ? 'Get a Gemini API key' : 'Get an OpenAI API key';
  }
  function save() {
    config = { provider: provider.value, model: model.value.trim() || DEFAULTS[provider.value] };
    apiKey = key.value.trim();
    let saved = false;
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      if (apiKey && $('aiRemember').checked) {
        localStorage.setItem(SECRET_KEY, apiKey);
        saved = true;
      } else localStorage.removeItem(SECRET_KEY);
    } catch {
      model.value = config.model; reflectConnection();
      status.textContent = 'Browser storage is unavailable. Your key works for this visit.';
      return;
    }
    model.value = config.model; reflectConnection();
    status.textContent = !apiKey ? (sharedConnection ? 'Shared OpenAI is ready. No key needed; the preview uses gpt-4.1-mini.' : 'No key set. The demo and imports are ready to use.') : saved ? 'Settings saved.' : 'Key ready for this visit.';
  }
  provider.addEventListener('change', () => {
    forgetKey(); config = { provider: provider.value, model: DEFAULTS[provider.value] }; model.value = config.model;
    $('aiModels').replaceChildren(); updateKeyLink(); save();
  });
  $('aiSave').addEventListener('click', save);
  $('aiForget').addEventListener('click', () => { forgetKey(); status.textContent = sharedConnection ? 'Your key was removed. Shared OpenAI is ready.' : 'Key removed.'; });
  $('aiLoadModels').addEventListener('click', async () => {
    save(); const button = $('aiLoadModels'); button.disabled = true; status.textContent = 'Checking access and loading model IDs…';
    try {
      const result = await localRequest('/api/models', {});
      $('aiModels').replaceChildren(...result.models.map(id => { const option = document.createElement('option'); option.value = id; return option; }));
      status.textContent = result.models.length ? result.models.length + (apiKey ? ' models found. Choose a text model from the Model field. No quiz was generated.' : ' models found. Shared AI uses gpt-4.1-mini. No quiz was generated.') : 'No compatible model IDs were returned. Enter one from the provider documentation.';
    } catch (err) { status.textContent = err.message; }
    finally { button.disabled = false; }
  });
  $('aiSettingsBtn')?.addEventListener('click', () => { $('settingsBtn').click(); $('aiProvider').focus(); });
  function openEditor() {
    if ($('optionsPanel').hidden) $('optionsBtn').click();
    if ($('advancedBlock').hidden) document.querySelector('.advanced-disclosure')?.click();
    $('advancedBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('quickDemoBtn')?.addEventListener('click', () => { $('demoBtn').click(); $('startToolbarBtn').focus(); });
  $('quickLoadBtn')?.addEventListener('click', () => $('fileInput')?.click());
  $('quickLastBtn')?.addEventListener('click', () => $('loadLastBtn').click());
  $('quickExportBtn')?.addEventListener('click', () => $('exportTxtBtn').click());
  updateKeyLink(); reflectConnection();
  sharedConnection = null;
  connectionReady = localOrigin() ? Promise.resolve() : localRequest('/api/connection', {}, { needsKey: false }).then(result => {
    if (result.shared?.provider !== 'openai' || result.shared.model !== DEFAULTS.openai) return;
    sharedConnection = { provider: 'openai', model: result.shared.model };
    if (!apiKey) {
      config = { ...sharedConnection };
      provider.value = config.provider; model.value = config.model;
      status.textContent = 'Shared OpenAI is ready. No key needed; the preview uses gpt-4.1-mini.';
      updateKeyLink();
    }
    const description = $('aiConnectionHelp');
    if (description) description.textContent = 'AI is included in this preview through OpenAI. Create a quiz without adding a key. You can optionally use your own key below.';
    reflectConnection();
  }).catch(() => {});
  S.standalone.ready = connectionReady;
}
