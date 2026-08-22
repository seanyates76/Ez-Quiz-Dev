'use strict';

// Keep the original URI stable because ChatGPT caches the tool template URI
// when an app connection is created. Widget revisions update the content at the
// stable URI instead of breaking existing cards.
const QUIZ_WIDGET_URI = 'ui://ez-quiz/quiz-v1.html';
const QUIZ_WIDGET_ALIASES = Object.freeze([
  QUIZ_WIDGET_URI,
  'ui://ez-quiz/quiz-v2.html',
]);
const QUIZ_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';
const SITE_ORIGIN = 'https://ez-quiz.app';
const BRAND_LOGO_DARK = `${SITE_ORIGIN}/icons/brand-title-source.png`;
const BRAND_LOGO_LIGHT = `${SITE_ORIGIN}/icons/brand-title-source-light.png`;
const BRAND_ICON = `${SITE_ORIGIN}/icons/icon-192.png`;

function quizWidgetHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <style>
    :root {
      color-scheme: light;
      --surface: #ffffff;
      --surface-raised: #f7f7f8;
      --surface-selected: #eef5ff;
      --text: #202123;
      --muted: #676b75;
      --border: #dedfe3;
      --border-strong: #c9cbd1;
      --brand-surface: #f7f7f8;
      --accent: #3478f6;
      --accent-press: #2867d8;
      --purple: #7133d4;
      --success: #16885a;
      --danger: #b83246;
      --warning: #9a6500;
      --focus: rgba(52, 120, 246, .25);
      --shadow: 0 8px 24px rgba(25, 31, 45, .08);
      --safe-top: 0px;
      --safe-right: 0px;
      --safe-bottom: 0px;
      --safe-left: 0px;
      --radius-card: 18px;
      --radius-control: 13px;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --surface: #232428;
      --surface-raised: #2c2e33;
      --surface-selected: #26374f;
      --text: #f2f3f5;
      --muted: #adb1bb;
      --border: #3b3d43;
      --border-strong: #4a4d55;
      --brand-surface: #1d1d22;
      --accent: #6698ff;
      --accent-press: #77a4ff;
      --purple: #a97aff;
      --success: #35c982;
      --danger: #ff7c89;
      --warning: #f2bd55;
      --focus: rgba(102, 152, 255, .3);
      --shadow: 0 9px 28px rgba(0, 0, 0, .24);
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme]) {
        color-scheme: dark;
        --surface: #232428;
        --surface-raised: #2c2e33;
        --surface-selected: #26374f;
        --text: #f2f3f5;
        --muted: #adb1bb;
        --border: #3b3d43;
        --border-strong: #4a4d55;
        --brand-surface: #1d1d22;
        --accent: #6698ff;
        --accent-press: #77a4ff;
        --purple: #a97aff;
        --success: #35c982;
        --danger: #ff7c89;
        --warning: #f2bd55;
        --focus: rgba(102, 152, 255, .3);
        --shadow: 0 9px 28px rgba(0, 0, 0, .24);
      }
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; overflow: visible; }
    body {
      padding:
        max(8px, var(--safe-top))
        max(8px, var(--safe-right))
        max(12px, var(--safe-bottom))
        max(8px, var(--safe-left));
      color: var(--text);
      background: transparent;
      font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-text-size-adjust: 100%;
      text-rendering: optimizeLegibility;
    }
    button, input, select { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    .app {
      width: 100%;
      max-width: 680px;
      margin: 0 auto;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .brandbar {
      position: relative;
      display: flex;
      min-height: 58px;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 14px 10px;
      border-bottom: 1px solid var(--border);
      background: var(--brand-surface);
      box-shadow: inset 0 3px 0 #5c2ab3;
    }
    .brand-logo {
      display: block;
      width: min(158px, 46vw);
      height: auto;
      max-height: 38px;
      object-fit: contain;
      object-position: left center;
    }
    .brand-actions { display: flex; min-width: 0; align-items: center; gap: 8px; }
    .tag {
      overflow: hidden;
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .icon-button {
      display: inline-grid;
      flex: 0 0 auto;
      width: 38px;
      min-height: 38px;
      place-items: center;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 11px;
      color: var(--text);
      background: var(--surface);
      cursor: pointer;
    }
    .icon-button:hover { background: var(--surface-raised); }
    .icon-button svg { width: 18px; height: 18px; }
    .ezq-main { padding: clamp(14px, 3.6vw, 20px); }
    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 9px;
    }
    .eyebrow { color: var(--purple); font-size: 14px; font-weight: 780; }
    .score { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
    .progress {
      height: 7px;
      margin-bottom: 17px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-raised);
    }
    .progress > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
      transition: width .25s ease;
    }
    h1, h2, p { overflow-wrap: anywhere; }
    h2 { margin: 0 0 16px; font-size: 19px; line-height: 1.34; letter-spacing: -.012em; }
    .answers, .match-list { display: grid; gap: 9px; }
    .answer {
      display: flex;
      min-height: 52px;
      align-items: flex-start;
      gap: 11px;
      padding: 12px 13px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-control);
      background: var(--surface-raised);
      cursor: pointer;
      transition: border-color .15s ease, background-color .15s ease, box-shadow .18s ease;
    }
    .answer:hover { border-color: var(--accent); }
    .answer:has(input:checked) {
      border-color: var(--accent);
      background: var(--surface-selected);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 13%, transparent);
    }
    .answer:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
    .answer input {
      flex: 0 0 auto;
      width: 19px;
      height: 19px;
      margin: 1px 0 0;
      accent-color: var(--accent);
    }
    .answer span { min-width: 0; line-height: 1.42; }
    .match {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(132px, .78fr);
      align-items: center;
      gap: 10px;
      padding: 11px 12px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-control);
      background: var(--surface-raised);
    }
    .match select {
      width: 100%;
      min-width: 0;
      padding: 9px 30px 9px 10px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      color: var(--text);
      background: var(--surface);
    }
    .match select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .feedback { min-height: 22px; margin-top: 12px; font-size: 14px; font-weight: 750; }
    .feedback.good { color: var(--success); }
    .feedback.bad { color: var(--danger); }
    .feedback.hint { color: var(--warning); }
    .buttons { display: flex; gap: 9px; margin-top: 11px; }
    .buttons > button { flex: 1; }
    button:not(.icon-button) {
      min-height: 46px;
      padding: 10px 15px;
      border: 1px solid transparent;
      border-radius: var(--radius-control);
      font-weight: 760;
      cursor: pointer;
      transition: transform .12s ease, background-color .15s ease, opacity .15s ease;
    }
    button:active { transform: translateY(1px); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px var(--focus); }
    button:disabled { cursor: wait; opacity: .64; }
    .primary { color: #fff; background: var(--accent); }
    .primary:hover { background: var(--accent-press); }
    .success { color: #fff; background: var(--success); }
    .secondary { border-color: var(--border-strong) !important; color: var(--text); background: var(--surface-raised); }
    .secondary:hover { background: var(--surface); }
    .note { margin: 13px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .loading-card { padding: 4px 0 0; }
    .loading-head { display: flex; align-items: center; gap: 13px; }
    .loading-icon {
      display: block;
      flex: 0 0 auto;
      width: 52px;
      height: 52px;
      border: 1px solid var(--border);
      border-radius: 14px;
      object-fit: cover;
      box-shadow: 0 6px 16px rgba(25, 31, 45, .13);
    }
    .loading-copy { min-width: 0; }
    .loading-title { margin: 0; font-size: 18px; font-weight: 800; line-height: 1.25; }
    .loading-message { margin: 3px 0 0; color: var(--muted); font-size: 14px; }
    .loading-scan {
      height: 8px;
      margin: 20px 0 11px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-raised);
    }
    .loading-scan > span {
      display: block;
      width: 42%;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
      animation: scan 1.45s ease-in-out infinite;
    }
    .loading-scan.determinate > span { animation: none; transition: width .3s ease; }
    .loading-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 12px; }
    .loading-step { white-space: nowrap; }
    .loading-step::before {
      content: "";
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 7px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 14%, transparent);
    }
    .loading-card .buttons { margin-top: 17px; }
    .status-card, .finish { padding: 3px 0 1px; }
    .status-icon {
      display: grid;
      width: 40px;
      height: 40px;
      margin-bottom: 12px;
      place-items: center;
      border-radius: 12px;
      color: var(--purple);
      background: color-mix(in srgb, var(--purple) 12%, var(--surface));
      font-size: 21px;
      font-weight: 850;
    }
    .status-card h1, .finish h1 { margin: 0 0 7px; font-size: 21px; line-height: 1.25; }
    .status-card p, .finish p { margin: 0; color: var(--muted); }
    .result-score { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .result-score strong { color: var(--purple); font-size: 36px; line-height: 1; }
    .result-score span { color: var(--muted); font-weight: 650; }
    .finish .buttons { margin-top: 18px; }
    @keyframes scan {
      0% { transform: translateX(-115%); }
      50% { transform: translateX(72%); }
      100% { transform: translateX(245%); }
    }
    :root[data-compact="true"] .brandbar { min-height: 52px; padding-block: 9px 8px; }
    :root[data-compact="true"] .ezq-main { padding: 12px; }
    :root[data-compact="true"] .answer { min-height: 46px; padding: 10px 11px; }
    :root[data-compact="true"] h2 { margin-bottom: 13px; font-size: 18px; }
    @media (max-width: 460px) {
      body {
        padding:
          max(6px, var(--safe-top))
          max(6px, var(--safe-right))
          max(10px, var(--safe-bottom))
          max(6px, var(--safe-left));
      }
      .app { border-radius: 16px; }
      .brandbar { min-height: 54px; padding: 9px 12px 8px; }
      .brand-logo { width: min(142px, 49vw); max-height: 34px; }
      .tag { max-width: 128px; }
      .ezq-main { padding: 13px; }
      h2 { margin-bottom: 14px; font-size: 18px; }
      .answer { min-height: 49px; padding: 11px 12px; }
      .match { grid-template-columns: 1fr; }
      .loading-icon { width: 48px; height: 48px; }
    }
    @media (max-width: 360px) {
      .tag { display: none; }
      .brand-logo { width: 132px; }
      .ezq-main { padding: 12px; }
      .topline { margin-bottom: 8px; }
      .eyebrow, .score { font-size: 13px; }
      h2 { font-size: 17px; }
      .answer { gap: 9px; padding: 10px 11px; }
      .buttons { flex-direction: column; }
      .buttons > button { width: 100%; }
      .loading-meta { align-items: flex-start; flex-direction: column; gap: 5px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
      }
    }
  </style>
</head>
<body>
  <section class="app" aria-live="polite">
    <header class="brandbar">
      <img id="brandLogo" class="brand-logo" src="${BRAND_LOGO_LIGHT}" data-light-src="${BRAND_LOGO_LIGHT}" data-dark-src="${BRAND_LOGO_DARK}" alt="EZ Quiz">
      <div class="brand-actions">
        <span class="tag">Smart. Simple. Fast. EZ.</span>
        <button id="expand" class="icon-button" type="button" aria-label="Open quiz full screen" title="Open full screen" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>
        </button>
      </div>
    </header>
    <main id="root" class="ezq-main">
      <div class="loading-card">
        <div class="loading-head">
          <img class="loading-icon" src="${BRAND_ICON}" alt="">
          <div class="loading-copy"><p class="loading-title">Building your quiz...</p><p class="loading-message">Preparing the question plan.</p></div>
        </div>
        <div class="loading-scan" aria-hidden="true"><span></span></div>
        <div class="loading-meta"><span class="loading-step">Connecting</span><span>Creating your questions</span></div>
      </div>
    </main>
  </section>
  <script>
    (() => {
      const root = document.getElementById('root');
      const brandLogo = document.getElementById('brandLogo');
      const expandButton = document.getElementById('expand');
      const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
      const cancelFrame = window.cancelAnimationFrame || window.clearTimeout;
      const colorScheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      const pendingRequests = new Map();
      const terminalStatuses = new Set(['complete', 'partial', 'failed', 'stopped', 'canceled', 'expired']);
      let quiz = null;
      let index = 0;
      let score = 0;
      let checked = false;
      let nextRequestId = 1;
      let phaseTimer = null;
      let pollTimer = null;
      let pollController = null;
      let activeJob = null;
      let generationInput = {};
      let queuedPolls = 0;
      let pollingStartedAt = 0;
      let heightFrame = 0;
      const MAX_POLL_MS = 120000;

      const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));

      function request(method, params) {
        const id = nextRequestId++;
        window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        return new Promise((resolve, reject) => pendingRequests.set(id, { resolve, reject }));
      }

      function scheduleHeightReport() {
        if (heightFrame) cancelFrame(heightFrame);
        heightFrame = requestFrame(() => {
          heightFrame = 0;
          try { window.openai && window.openai.notifyIntrinsicHeight && window.openai.notifyIntrinsicHeight(); } catch {}
        });
      }

      function renderHtml(html) {
        root.innerHTML = html;
        scheduleHeightReport();
      }

      function numberInset(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      }

      function applyHostContext(globals) {
        const context = globals && typeof globals === 'object' ? globals : (window.openai || {});
        const requestedTheme = String(context.theme || '').toLowerCase();
        const theme = requestedTheme === 'dark' || requestedTheme === 'light'
          ? requestedTheme
          : (colorScheme && colorScheme.matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
        if (brandLogo) brandLogo.src = theme === 'dark' ? brandLogo.dataset.darkSrc : brandLogo.dataset.lightSrc;

        const safeArea = context.safeArea && typeof context.safeArea === 'object' ? context.safeArea : {};
        const insets = safeArea.insets && typeof safeArea.insets === 'object' ? safeArea.insets : safeArea;
        document.documentElement.style.setProperty('--safe-top', numberInset(insets.top) + 'px');
        document.documentElement.style.setProperty('--safe-right', numberInset(insets.right) + 'px');
        document.documentElement.style.setProperty('--safe-bottom', numberInset(insets.bottom) + 'px');
        document.documentElement.style.setProperty('--safe-left', numberInset(insets.left) + 'px');

        const maxHeight = Number(context.maxHeight || 0);
        document.documentElement.dataset.compact = maxHeight > 0 && maxHeight < 620 ? 'true' : 'false';
        expandButton.hidden = !(window.openai && typeof window.openai.requestDisplayMode === 'function')
          || String(context.displayMode || '').toLowerCase() === 'fullscreen';
        scheduleHeightReport();
      }

      function saveQuizState() {
        try {
          window.openai && window.openai.setWidgetState && window.openai.setWidgetState({ index, score, checked: false });
        } catch {}
      }

      function findMeta(value, depth) {
        if (!value || typeof value !== 'object' || depth > 4) return null;
        if (value._meta && typeof value._meta === 'object') return value._meta;
        for (const key of ['mcp_tool_result', 'call_tool_result', 'toolResult', 'result', 'params']) {
          const found = findMeta(value[key], depth + 1);
          if (found) return found;
        }
        return null;
      }

      function currentMetadata() {
        return findMeta(window.openai && window.openai.toolResponseMetadata, 0);
      }

      function structuredOutput(value) {
        if (!value || typeof value !== 'object') return value;
        if (value.structuredContent) return value.structuredContent;
        if (value.result && value.result.structuredContent) return value.result.structuredContent;
        if (value.mcp_tool_result && value.mcp_tool_result.structuredContent) return value.mcp_tool_result.structuredContent;
        return value;
      }

      function generationPrompt() {
        const topic = String(generationInput.topic || 'the same topic').trim() || 'the same topic';
        const count = Math.max(1, Math.min(20, Number(generationInput.count || 10) || 10));
        const difficulty = String(generationInput.difficulty || 'medium').toLowerCase();
        return 'Create a fresh ' + count + '-question ' + difficulty + '-difficulty EZ Quiz about ' + topic + '.';
      }

      async function startFresh() {
        const button = root.querySelector('[data-start-fresh]');
        if (button) {
          button.disabled = true;
          button.textContent = 'Starting...';
        }
        try {
          if (!window.openai || typeof window.openai.sendFollowUpMessage !== 'function') {
            throw new Error('Ask ChatGPT to create a new EZ Quiz in the composer below.');
          }
          await window.openai.sendFollowUpMessage({ prompt: generationPrompt(), scrollToBottom: true });
        } catch (error) {
          const note = root.querySelector('[data-recovery-note]');
          if (note) note.textContent = String(error && error.message || 'Ask ChatGPT to create a new EZ Quiz.');
          if (button) {
            button.disabled = false;
            button.textContent = 'Start fresh';
          }
        }
      }

      function statusCard(title, message, options) {
        const settings = options || {};
        const buttons = [];
        if (settings.primaryLabel) buttons.push('<button class="primary" type="button" data-primary>' + esc(settings.primaryLabel) + '</button>');
        if (settings.allowFresh !== false) buttons.push('<button class="' + (buttons.length ? 'secondary' : 'primary') + '" type="button" data-start-fresh>Start fresh</button>');
        renderHtml(
          '<div class="status-card"><div class="status-icon" aria-hidden="true">' + esc(settings.icon || '!') + '</div>' +
          '<h1>' + esc(title) + '</h1><p>' + esc(message) + '</p>' +
          (buttons.length ? '<div class="buttons">' + buttons.join('') + '</div>' : '') +
          '<p class="note" data-recovery-note>' + esc(settings.note || '') + '</p></div>'
        );
        const fresh = root.querySelector('[data-start-fresh]');
        if (fresh) fresh.addEventListener('click', startFresh);
        return root.querySelector('[data-primary]');
      }

      function showStaleSession() {
        clearGenerationTimers();
        statusCard('This quiz card expired', 'Its original generation session is no longer available, so repeating it would fail again.', {
          icon: '↻', note: 'Start fresh creates a new job instead of retrying this broken card.'
        });
      }

      function showFailure(message, title) {
        clearGenerationTimers();
        statusCard(title || 'Quiz generation stopped', message || 'EZ Quiz could not finish this generation job.', {
          icon: '!', note: 'Start fresh creates a new generation job.'
        });
      }

      function loadingMarkup(count, message, completed) {
        const requested = Math.max(1, Number(count || 10) || 10);
        const ready = Math.max(0, Number(completed || 0) || 0);
        const determinate = ready > 0;
        const percent = Math.max(4, Math.min(100, Math.round((ready / requested) * 100)));
        return '<div class="loading-card"><div class="loading-head"><img class="loading-icon" src="${BRAND_ICON}" alt="">' +
          '<div class="loading-copy"><p class="loading-title">Building your quiz...</p><p class="loading-message" id="loadingMessage">' +
          esc(message || 'Preparing the question plan.') + '</p></div></div>' +
          '<div class="loading-scan' + (determinate ? ' determinate' : '') + '" aria-hidden="true"><span style="' + (determinate ? 'width:' + percent + '%' : '') + '"></span></div>' +
          '<div class="loading-meta"><span class="loading-step">Generation in progress</span><span id="loadingCount">' +
          (determinate ? ready + ' of ' + requested + ' ready' : 'Creating ' + requested + ' questions') + '</span></div>' +
          '<div class="buttons"><button id="cancelGeneration" class="secondary" type="button">Cancel generation</button></div></div>';
      }

      function showLoading(count, message, completed) {
        renderHtml(loadingMarkup(count, message, completed));
        const cancel = document.getElementById('cancelGeneration');
        if (cancel) cancel.addEventListener('click', () => stopGeneration());
        const phases = ['Preparing the question plan.', 'Writing balanced questions.', 'Checking the quiz format.'];
        let phase = 0;
        clearInterval(phaseTimer);
        if (!message && !completed) {
          phaseTimer = setInterval(() => {
            phase = (phase + 1) % phases.length;
            const element = document.getElementById('loadingMessage');
            if (element) element.textContent = phases[phase];
          }, 2400);
        }
      }

      function clearGenerationTimers() {
        clearInterval(phaseTimer);
        clearTimeout(pollTimer);
        phaseTimer = null;
        pollTimer = null;
        if (pollController) pollController.abort();
        pollController = null;
      }

      function validHttpUrl(value) {
        try {
          const url = new URL(String(value || ''));
          return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
        } catch {
          return '';
        }
      }

      function normalizedJob(raw) {
        const value = raw && typeof raw === 'object' ? raw : {};
        const jobId = String(value.jobId || '');
        const workerToken = String(value.workerToken || '');
        const workerUrl = validHttpUrl(value.workerUrl);
        const statusUrl = validHttpUrl(value.statusUrl);
        const stopUrl = validHttpUrl(value.stopUrl);
        const workerStarted = value.workerStarted;
        if (!/^qj_[A-Za-z0-9_-]{24,96}$/.test(jobId)) return null;
        if (!/^[A-Za-z0-9_-]{24,96}$/.test(workerToken)) return null;
        if (typeof workerStarted !== 'boolean') return null;
        if (!statusUrl || !stopUrl || (!workerStarted && !workerUrl)) return null;
        return { jobId, workerToken, workerStarted, workerUrl, statusUrl, stopUrl, requestedCount: Math.max(1, Number(value.requestedCount || generationInput.count || 10) || 10) };
      }

      async function fetchJson(url, options) {
        const response = await fetch(url, { credentials: 'omit', cache: 'no-store', ...options });
        let body = {};
        try { body = await response.json(); } catch {}
        if (!response.ok && response.status !== 410) {
          const error = new Error(String(body.error || ('Request failed (' + response.status + ').')));
          error.status = response.status;
          throw error;
        }
        return body;
      }

      async function triggerWorker() {
        if (!activeJob) return;
        await fetchJson(activeJob.workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: activeJob.jobId, workerToken: activeJob.workerToken }),
        });
      }

      function parseLegacyQuestion(line) {
        const value = String(line || '').trim();
        let match = value.match(/^MC\\|(.*)\\|(.+?)\\|([A-Za-z](?:\\s*,\\s*[A-Za-z])*)$/i);
        if (match) {
          const options = match[2].split(';').map((item) => item.trim().replace(/^[A-D]\\)\\s*/i, '')).filter(Boolean);
          const correct = match[3].split(',').map((letter) => letter.trim().toUpperCase().charCodeAt(0) - 65)
            .filter((position, offset, values) => position >= 0 && position < options.length && values.indexOf(position) === offset)
            .sort((a, b) => a - b);
          return options.length >= 2 && correct.length ? { type: 'MC', prompt: match[1].trim(), options, correct } : null;
        }
        match = value.match(/^TF\\|(.*)\\|(T|F)$/i);
        if (match) return { type: 'TF', prompt: match[1].trim(), correct: /^T$/i.test(match[2]) };
        match = value.match(/^YN\\|(.*)\\|(Y|N)$/i);
        if (match) return { type: 'YN', prompt: match[1].trim(), correct: /^Y$/i.test(match[2]) };
        match = value.match(/^MT\\|(.*)\\|(.+?)\\|(.+?)\\|(.+?)$/i);
        if (match) {
          const left = match[2].split(';').map((item) => item.trim().replace(/^\\d+\\)\\s*/, '')).filter(Boolean);
          const right = match[3].split(';').map((item) => item.trim().replace(/^[A-Z]\\)\\s*/i, '')).filter(Boolean);
          const pairs = match[4].split(',').map((pair) => pair.trim().match(/^(\\d+)\\s*-\\s*([A-Z])$/i)).filter(Boolean)
            .map((pair) => [Number(pair[1]) - 1, pair[2].toUpperCase().charCodeAt(0) - 65]);
          const leftIndexes = new Set(pairs.map((pair) => pair[0]));
          const valid = left.length && right.length && pairs.length === left.length && leftIndexes.size === left.length
            && pairs.every((pair) => pair[0] >= 0 && pair[0] < left.length && pair[1] >= 0 && pair[1] < right.length);
          return valid ? { type: 'MT', prompt: match[1].trim(), left, right, matches: pairs } : null;
        }
        return null;
      }

      function quizFromStatus(status) {
        const lines = Array.isArray(status.questions)
          ? status.questions.map((line) => String(line || '').trim()).filter(Boolean)
          : String(status.lines || '').split('\\n').map((line) => line.trim()).filter(Boolean);
        const questions = lines.map(parseLegacyQuestion).filter(Boolean);
        if (!questions.length) return null;
        return {
          title: String(status.title || status.topic || generationInput.topic || 'EZ Quiz'),
          topic: String(status.topic || generationInput.topic || ''),
          lines: lines.join('\\n'), questions, questionCount: questions.length, aiGenerated: true,
          partial: questions.length < Number(status.requestedCount || questions.length),
        };
      }

      function finishGeneration(status) {
        const state = String(status.status || '').toLowerCase();
        const readyQuiz = quizFromStatus(status);
        clearGenerationTimers();
        activeJob = null;
        if ((state === 'complete' || state === 'partial') && readyQuiz) {
          loadQuiz(readyQuiz);
          return;
        }
        if ((state === 'stopped' || state === 'canceled') && readyQuiz) {
          const primary = statusCard('Generation stopped', readyQuiz.questionCount + ' question' + (readyQuiz.questionCount === 1 ? ' is' : 's are') + ' ready to use.', {
            icon: '■', primaryLabel: 'Use ready questions', note: 'You can continue with the completed questions or start a new job.'
          });
          if (primary) primary.addEventListener('click', () => loadQuiz(readyQuiz));
          return;
        }
        const firstError = status.errors && status.errors[0] && status.errors[0].message;
        const message = firstError || status.progressMessage || (state === 'expired' ? 'This generation job expired.' : 'No usable questions were created.');
        showFailure(message, state === 'expired' ? 'Quiz generation expired' : 'Quiz generation stopped');
      }

      async function pollJob() {
        if (!activeJob) return;
        if (Date.now() - pollingStartedAt > MAX_POLL_MS) {
          await stopGeneration('Generation took too long and was stopped.');
          return;
        }
        pollController = new AbortController();
        try {
          const separator = activeJob.statusUrl.includes('?') ? '&' : '?';
          const status = await fetchJson(activeJob.statusUrl + separator + 'jobId=' + encodeURIComponent(activeJob.jobId), {
            method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + activeJob.workerToken }, signal: pollController.signal,
          });
          if (!activeJob) return;
          const state = String(status.status || '').toLowerCase();
          const completed = Number(status.completedCount || 0);
          const requested = Number(status.requestedCount || activeJob.requestedCount);
          queuedPolls = state === 'queued' && completed === 0 ? queuedPolls + 1 : 0;
          if (terminalStatuses.has(state)) {
            finishGeneration(status);
            return;
          }
          showLoading(requested, status.progressMessage || (state === 'queued' ? 'Planning the quiz.' : 'Writing balanced questions.'), completed);
          if (queuedPolls === 4 && !activeJob.workerStarted) {
            try { await triggerWorker(); } catch {}
          }
          pollTimer = setTimeout(pollJob, 1400);
        } catch (error) {
          if (!activeJob || (error && error.name === 'AbortError')) return;
          showFailure(error && error.status === 404
            ? 'The generation job could not be found. Start a fresh quiz instead of retrying this card.'
            : 'Lost contact with the generation job. Start fresh to create a new session.');
          activeJob = null;
        } finally {
          pollController = null;
        }
      }

      async function startGeneration(rawJob, output) {
        const job = normalizedJob(rawJob);
        if (!job) {
          showStaleSession();
          return;
        }
        if (activeJob && activeJob.jobId === job.jobId) return;
        clearGenerationTimers();
        activeJob = job;
        queuedPolls = 0;
        pollingStartedAt = Date.now();
        showLoading(job.requestedCount, rawJob.progressMessage || output.progressMessage, 0);
        try {
          if (!job.workerStarted) await triggerWorker();
          await pollJob();
        } catch (error) {
          if (!activeJob || (error && error.name === 'AbortError')) return;
          activeJob = null;
          showFailure('The generation worker could not start. Start fresh to create a new job.');
        }
      }

      async function stopGeneration(timeoutMessage) {
        if (!activeJob) return;
        const job = activeJob;
        clearGenerationTimers();
        const cancel = document.getElementById('cancelGeneration');
        if (cancel) { cancel.disabled = true; cancel.textContent = 'Stopping...'; }
        try {
          const status = await fetchJson(job.stopUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + job.workerToken }, body: JSON.stringify({ jobId: job.jobId }),
          });
          finishGeneration({ ...status, progressMessage: timeoutMessage || status.progressMessage });
        } catch {
          activeJob = null;
          showFailure(timeoutMessage || 'The stop request could not be confirmed. The card will no longer keep polling.');
        }
      }

      function optionsFor(question) {
        if (question.type === 'MC') {
          return question.options.map((option, optionIndex) =>
            '<label class="answer"><input type="' + (question.correct.length > 1 ? 'checkbox' : 'radio') + '" name="answer" value="' + optionIndex + '"><span>' + esc(option) + '</span></label>'
          ).join('');
        }
        if (question.type === 'TF' || question.type === 'YN') {
          const labels = question.type === 'TF' ? ['True', 'False'] : ['Yes', 'No'];
          return labels.map((option, optionIndex) =>
            '<label class="answer"><input type="radio" name="answer" value="' + (optionIndex === 0 ? 'true' : 'false') + '"><span>' + option + '</span></label>'
          ).join('');
        }
        if (question.type === 'MT') {
          return '<div class="match-list">' + question.left.map((left, leftIndex) =>
            '<label class="match"><span>' + (leftIndex + 1) + '. ' + esc(left) + '</span><select data-left="' + leftIndex + '"><option value="">Choose a match</option>' +
            question.right.map((right, rightIndex) => '<option value="' + rightIndex + '">' + String.fromCharCode(65 + rightIndex) + '. ' + esc(right) + '</option>').join('') + '</select></label>'
          ).join('') + '</div>';
        }
        return '';
      }

      function hasSelection(question) {
        if (question.type === 'MC' || question.type === 'TF' || question.type === 'YN') return !!root.querySelector('input[name=answer]:checked');
        if (question.type === 'MT') {
          const fields = [...root.querySelectorAll('select[data-left]')];
          return fields.length > 0 && fields.every((field) => field.value !== '');
        }
        return false;
      }

      function isCorrect(question) {
        if (question.type === 'MC') {
          const chosen = [...root.querySelectorAll('input[name=answer]:checked')].map((element) => Number(element.value)).sort((a, b) => a - b);
          return JSON.stringify(chosen) === JSON.stringify([...question.correct].sort((a, b) => a - b));
        }
        if (question.type === 'TF' || question.type === 'YN') {
          const picked = root.querySelector('input[name=answer]:checked');
          return !!picked && String(question.correct) === picked.value;
        }
        if (question.type === 'MT') {
          const chosen = [...root.querySelectorAll('select[data-left]')].map((element) => [Number(element.dataset.left), Number(element.value)]);
          return chosen.length === question.matches.length && question.matches.every(([left, right]) => chosen.some(([chosenLeft, chosenRight]) => chosenLeft === left && chosenRight === right));
        }
        return false;
      }

      function answerText(question) {
        if (question.type === 'MC') return question.correct.map((position) => question.options[position]).join(', ');
        if (question.type === 'TF') return question.correct ? 'True' : 'False';
        if (question.type === 'YN') return question.correct ? 'Yes' : 'No';
        if (question.type === 'MT') return question.matches.map(([left, right]) => (left + 1) + '-' + String.fromCharCode(65 + right)).join(', ');
        return '';
      }

      function renderQuestion() {
        if (!quiz) return;
        const question = quiz.questions[index];
        const percent = Math.round(((index + 1) / quiz.questions.length) * 100);
        renderHtml(
          '<div class="topline"><span class="eyebrow">Question ' + (index + 1) + ' of ' + quiz.questions.length + '</span><span class="score">Score: ' + score + '</span></div>' +
          '<div class="progress" aria-label="Quiz progress"><span style="width:' + percent + '%"></span></div><h2>' + esc(question.prompt) + '</h2>' +
          '<div class="answers">' + optionsFor(question) + '</div><div id="feedback" class="feedback" role="status"></div>' +
          '<div class="buttons"><button id="check" class="primary" type="button">Check answer</button><button id="next" class="success" type="button" hidden>' +
          (index + 1 === quiz.questions.length ? 'See results' : 'Next question') + '</button></div>' +
          '<p class="note">' + (quiz.partial ? 'Partial AI-generated quiz. ' : 'AI-generated quiz. ') + 'Check important facts against your source.</p>'
        );
        root.querySelector('#check').addEventListener('click', () => {
          if (checked) return;
          const feedback = root.querySelector('#feedback');
          if (!hasSelection(question)) { feedback.className = 'feedback hint'; feedback.textContent = 'Choose an answer first.'; return; }
          const correct = isCorrect(question);
          checked = true;
          if (correct) score += 1;
          feedback.className = 'feedback ' + (correct ? 'good' : 'bad');
          feedback.textContent = correct ? 'Correct!' : 'Not quite. Correct answer: ' + answerText(question);
          root.querySelectorAll('input, select').forEach((element) => { element.disabled = true; });
          root.querySelector('#check').hidden = true;
          root.querySelector('#next').hidden = false;
          saveQuizState();
          scheduleHeightReport();
        });
        root.querySelector('#next').addEventListener('click', () => {
          if (index + 1 >= quiz.questions.length) { finishQuiz(); return; }
          index += 1;
          checked = false;
          saveQuizState();
          renderQuestion();
        });
      }

      function finishQuiz() {
        saveQuizState();
        const total = quiz.questions.length;
        const message = score === total ? 'Perfect score.' : (score >= Math.ceil(total * .7) ? 'Nice work.' : 'Review the misses and give it another run.');
        renderHtml('<div class="finish"><div class="result-score"><strong>' + score + '</strong><span>out of ' + total + '</span></div>' +
          '<h1>Quiz complete</h1><p>' + esc(message) + '</p><div class="buttons"><button id="retake" class="secondary" type="button">Retake quiz</button></div>' +
          '<p class="note">' + esc(quiz.title || 'EZ Quiz') + '</p></div>');
        root.querySelector('#retake').addEventListener('click', () => { index = 0; score = 0; checked = false; saveQuizState(); renderQuestion(); });
      }

      function loadQuiz(value) {
        const data = structuredOutput(value);
        if (!data || !Array.isArray(data.questions) || !data.questions.length) return false;
        clearGenerationTimers();
        activeJob = null;
        quiz = data;
        const prior = window.openai && window.openai.widgetState || {};
        index = Math.max(0, Math.min(data.questions.length - 1, Number(prior.index) || 0));
        score = Math.max(0, Math.min(data.questions.length, Number(prior.score) || 0));
        checked = false;
        renderQuestion();
        return true;
      }

      function loadToolResult(value, metadataSource) {
        const data = structuredOutput(value);
        const meta = findMeta(metadataSource, 0) || findMeta(value, 0) || currentMetadata() || {};
        generationInput = meta.generateRequest || window.openai && window.openai.toolInput || generationInput || {};
        if (loadQuiz(data)) return;
        if (data && (data.status === 'loading' || data.status === 'queued')) {
          if (meta.generation) startGeneration(meta.generation, data);
          else setTimeout(() => {
            const refreshed = currentMetadata();
            if (refreshed && refreshed.generation) startGeneration(refreshed.generation, data);
            else if (!activeJob && !quiz) showStaleSession();
          }, 350);
        }
      }

      expandButton.addEventListener('click', async () => { try { await window.openai.requestDisplayMode({ mode: 'fullscreen' }); } catch {} });
      brandLogo.addEventListener('load', scheduleHeightReport);

      window.addEventListener('openai:set_globals', (event) => {
        const globals = event && event.detail && event.detail.globals || {};
        applyHostContext({ ...(window.openai || {}), ...globals });
        if (globals.toolOutput !== undefined || globals.toolResponseMetadata !== undefined) {
          loadToolResult(window.openai && window.openai.toolOutput, window.openai && window.openai.toolResponseMetadata);
        }
      }, { passive: true });

      window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== '2.0') return;
        if (message.id !== undefined && pendingRequests.has(message.id)) {
          const pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          if (message.error) pending.reject(message.error); else pending.resolve(message.result);
          return;
        }
        if (message.method === 'ui/notifications/tool-input' && message.params && message.params.arguments) generationInput = message.params.arguments;
        if (message.method === 'ui/notifications/tool-result') loadToolResult(message.params, message.params);
        if (message.method === 'ui/notifications/host-context-changed') applyHostContext(message.params && (message.params.hostContext || message.params));
      });

      if (colorScheme && colorScheme.addEventListener) {
        colorScheme.addEventListener('change', () => { if (!window.openai || !window.openai.theme) applyHostContext(window.openai || {}); });
      }
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(scheduleHeightReport);
        observer.observe(document.body);
      }

      applyHostContext(window.openai || {});
      generationInput = window.openai && window.openai.toolInput || {};
      const initialOutput = window.openai && window.openai.toolOutput;
      if (initialOutput) loadToolResult(initialOutput, window.openai && window.openai.toolResponseMetadata);

      request('ui/initialize', {
        protocolVersion: '2025-11-21',
        appInfo: { name: 'ez-quiz-player', title: 'EZ Quiz', version: '3.0.0', websiteUrl: '${SITE_ORIGIN}' },
        appCapabilities: {},
      }).then((result) => {
        window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
        if (result && result.hostContext) applyHostContext(result.hostContext);
        if (!initialOutput && result && result.toolResult) loadToolResult(result.toolResult, result.toolResult);
      }).catch(() => {});
      scheduleHeightReport();
    })();
  </script>
</body>
</html>`;
}

module.exports = { QUIZ_WIDGET_ALIASES, QUIZ_WIDGET_MIME_TYPE, QUIZ_WIDGET_URI, quizWidgetHtml };
