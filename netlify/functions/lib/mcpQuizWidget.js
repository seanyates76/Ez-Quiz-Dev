'use strict';

const { BRAND_WORDMARK_DATA_URI } = require('./mcpQuizBrand.js');

// Widget template URIs are cache keys. Publish breaking layout revisions under
// a fresh URI while continuing to serve old aliases for cached tool descriptors.
const QUIZ_WIDGET_VERSION = 8;
const QUIZ_WIDGET_URI = `ui://ez-quiz/quiz-v${QUIZ_WIDGET_VERSION}.html`;
const QUIZ_WIDGET_ALIASES = Object.freeze([
  'ui://ez-quiz/quiz-v1.html',
  'ui://ez-quiz/quiz-v2.html',
  'ui://ez-quiz/quiz-v3.html',
  'ui://ez-quiz/quiz-v4.html',
  'ui://ez-quiz/quiz-v5.html',
  'ui://ez-quiz/quiz-v6.html',
  'ui://ez-quiz/quiz-v7.html',
  QUIZ_WIDGET_URI,
]);
const QUIZ_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';
const SITE_ORIGIN = 'https://ez-quiz.app';

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
      --surface-raised: #f6f7f9;
      --surface-selected: #eef4ff;
      --surface-muted: #eceef2;
      --text: #202124;
      --muted: #676b75;
      --border: #dcdfe5;
      --border-strong: #c9ced7;
      --accent: #3478f6;
      --accent-press: #2867d8;
      --purple: #7133d4;
      --success: #16885a;
      --success-soft: #e9f7f1;
      --danger: #b83246;
      --danger-soft: #fceef0;
      --warning: #9a6500;
      --focus: rgba(52, 120, 246, .25);
      --shadow: 0 10px 30px rgba(25, 31, 45, .1);
      --safe-top: 0px;
      --safe-right: 0px;
      --safe-bottom: 0px;
      --safe-left: 0px;
      --content-pad-x: clamp(18px, 4vw, 24px);
      --radius-card: 19px;
      --radius-control: 14px;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --surface: #202124;
      --surface-raised: #292b30;
      --surface-selected: #263750;
      --surface-muted: #31343a;
      --text: #f3f4f6;
      --muted: #adb2bd;
      --border: #3b3e45;
      --border-strong: #4b4f58;
      --accent: #6c9cff;
      --accent-press: #80aaff;
      --purple: #b184ff;
      --success: #42cf8c;
      --success-soft: #1d3a30;
      --danger: #ff8491;
      --danger-soft: #45272e;
      --warning: #f2bd55;
      --focus: rgba(108, 156, 255, .3);
      --shadow: 0 11px 32px rgba(0, 0, 0, .28);
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme]) {
        color-scheme: dark;
        --surface: #202124;
        --surface-raised: #292b30;
        --surface-selected: #263750;
        --surface-muted: #31343a;
        --text: #f3f4f6;
        --muted: #adb2bd;
        --border: #3b3e45;
        --border-strong: #4b4f58;
        --accent: #6c9cff;
        --accent-press: #80aaff;
        --purple: #b184ff;
        --success: #42cf8c;
        --success-soft: #1d3a30;
        --danger: #ff8491;
        --danger-soft: #45272e;
        --warning: #f2bd55;
        --focus: rgba(108, 156, 255, .3);
        --shadow: 0 11px 32px rgba(0, 0, 0, .28);
      }
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; margin: 0; }
    body {
      overflow: hidden;
      padding:
        calc(10px + var(--safe-top))
        calc(10px + var(--safe-right))
        calc(12px + var(--safe-bottom))
        calc(10px + var(--safe-left));
      color: var(--text);
      background: transparent;
      font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-text-size-adjust: 100%;
      text-rendering: optimizeLegibility;
    }
    button, input, select { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    .app {
      display: flex;
      width: 100%;
      max-width: 700px;
      min-height: 220px;
      margin: 0 auto;
      overflow: hidden;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .brandbar {
      position: relative;
      z-index: 2;
      display: flex;
      flex: 0 0 auto;
      min-height: 56px;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 16px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, .1);
      background: linear-gradient(135deg, #17131d 0%, #24183b 55%, #321c55 100%);
      box-shadow: inset 0 3px 0 #6e32ca;
    }
    .brand-logo {
      display: block;
      width: min(158px, 47vw);
      height: auto;
      max-height: 38px;
      object-fit: contain;
      object-position: left center;
    }
    .brand-actions { display: flex; min-width: 0; align-items: center; gap: 8px; }
    .tag {
      overflow: hidden;
      color: rgba(255, 255, 255, .76);
      font-size: 11px;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .ezq-main {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      flex-direction: column;
      padding: 0;
      overflow: visible;
    }
    .ezq-main:focus { outline: none; }
    .app[data-view="results"] .ezq-main {
      display: block;
      padding: 0;
      overflow: visible;
    }
    .app[data-view="status"] .ezq-main {
      display: block;
      padding: 18px var(--content-pad-x);
    }
    .question-layout {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      flex-direction: column;
    }
    .question-content {
      flex: 1 1 auto;
      min-height: 0;
      padding: 16px var(--content-pad-x) 8px;
      overflow: visible;
    }
    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 7px;
    }
    .eyebrow { color: var(--purple); font-size: 14px; font-weight: 800; }
    .timer { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .progress {
      height: 7px;
      margin-bottom: 14px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-raised);
    }
    .progress > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--purple));
      transition: width .2s ease;
    }
    h1, h2, h3, p { overflow-wrap: anywhere; }
    h1 { margin: 0; font-size: 23px; line-height: 1.24; letter-spacing: -.015em; }
    h2 { margin: 0 0 14px; font-size: 18px; line-height: 1.3; letter-spacing: -.012em; }
    .answers, .match-list { display: grid; gap: 8px; }
    .answer {
      display: flex;
      min-height: 48px;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
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
      width: 20px;
      height: 20px;
      margin: 1px 0 0;
      accent-color: var(--accent);
    }
    .answer span { min-width: 0; line-height: 1.34; }
    .match {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(148px, .82fr);
      align-items: center;
      gap: 12px;
      padding: 12px 13px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-control);
      background: var(--surface-raised);
    }
    .match select {
      width: 100%;
      min-width: 0;
      padding: 10px 31px 10px 11px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      color: var(--text);
      background: var(--surface);
    }
    .match select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .runner-actions {
      position: relative;
      z-index: 2;
      display: grid;
      flex: 0 0 auto;
      grid-template-columns: minmax(0, .78fr) minmax(0, 1.22fr);
      gap: 10px;
      margin: 0;
      padding: 9px var(--content-pad-x) 14px;
      border-top: 1px solid var(--border);
      background: var(--surface);
      box-shadow: 0 -8px 18px color-mix(in srgb, var(--surface) 86%, transparent);
    }
    button:not(.icon-button) {
      min-height: 44px;
      padding: 10px 16px;
      border: 1px solid transparent;
      border-radius: var(--radius-control);
      font-weight: 780;
      cursor: pointer;
      transition: transform .12s ease, background-color .15s ease, opacity .15s ease;
    }
    button:active { transform: translateY(1px); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px var(--focus); }
    button:disabled { cursor: default; opacity: .48; }
    .primary { color: #fff; background: var(--accent); }
    .primary:hover { background: var(--accent-press); }
    .secondary { border-color: var(--border-strong) !important; color: var(--text); background: var(--surface-raised); }
    .secondary:hover { background: var(--surface-muted); }
    .mounting {
      display: flex;
      min-height: 116px;
      align-items: center;
      gap: 14px;
      color: var(--muted);
    }
    .mounting-bolt {
      display: grid;
      flex: 0 0 auto;
      width: 48px;
      height: 48px;
      place-items: center;
      border-radius: 14px;
      color: #ffcc00;
      background: #271a3b;
      font-size: 26px;
    }
    .mounting strong { display: block; margin-bottom: 2px; color: var(--text); font-size: 17px; }
    .status-card { padding: 3px 0 2px; }
    .status-icon {
      display: grid;
      width: 42px;
      height: 42px;
      margin-bottom: 13px;
      place-items: center;
      border-radius: 13px;
      color: var(--purple);
      background: color-mix(in srgb, var(--purple) 13%, var(--surface));
      font-size: 21px;
      font-weight: 850;
    }
    .status-card p { margin: 8px 0 0; color: var(--muted); }
    .results-view { padding: 20px 22px 22px; }
    .results-head { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 16px; }
    .score-orb {
      display: grid;
      width: 82px;
      height: 82px;
      place-items: center;
      border: 7px solid color-mix(in srgb, var(--purple) 22%, var(--surface-raised));
      border-radius: 50%;
      color: var(--purple);
      background: var(--surface-raised);
      font-size: 22px;
      font-weight: 850;
      font-variant-numeric: tabular-nums;
    }
    .results-copy p { margin: 5px 0 0; color: var(--muted); }
    .result-progress { margin: 18px 0 15px; }
    .result-progress .progress { margin: 0; }
    .result-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
    .result-stat {
      display: grid;
      min-width: 0;
      padding: 10px 8px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-raised);
      text-align: center;
    }
    .result-stat strong { color: var(--text); font-size: 18px; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .result-stat span { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .result-stat.correct strong { color: var(--success); }
    .result-stat.missed strong { color: var(--danger); }
    .result-summary {
      min-height: 48px;
      padding: 11px 13px;
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      color: var(--muted);
      background: var(--surface-raised);
      font-size: 13px;
    }
    .result-summary strong { color: var(--text); }
    .result-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
    .result-note { margin: 13px 0 0; color: var(--muted); font-size: 12px; text-align: center; }
    .widget-build { margin-left: 5px; font-size: 9px; letter-spacing: .04em; opacity: .55; }
    .ezq-main[data-density="tight"] .question-content { padding-top: 10px; padding-bottom: 6px; }
    .ezq-main[data-density="tight"] .topline { margin-bottom: 4px; }
    .ezq-main[data-density="tight"] .eyebrow,
    .ezq-main[data-density="tight"] .timer { font-size: 12px; }
    .ezq-main[data-density="tight"] .progress { height: 5px; margin-bottom: 8px; }
    .ezq-main[data-density="tight"] h2 { margin-bottom: 8px; font-size: 16px; line-height: 1.22; }
    .ezq-main[data-density="tight"] .answers,
    .ezq-main[data-density="tight"] .match-list { gap: 5px; }
    .ezq-main[data-density="tight"] .answer { min-height: 40px; gap: 10px; padding: 7px 12px; }
    .ezq-main[data-density="tight"] .answer span { font-size: 13px; line-height: 1.25; }
    .ezq-main[data-density="tight"] .match { gap: 7px; padding: 7px 10px; font-size: 13px; }
    .ezq-main[data-density="tight"] .match select { padding-top: 7px; padding-bottom: 7px; }
    :root[data-display-mode="fullscreen"] body {
      min-height: 100svh;
      padding:
        calc(16px + var(--safe-top))
        calc(16px + var(--safe-right))
        calc(20px + var(--safe-bottom))
        calc(16px + var(--safe-left));
      background: var(--surface);
    }
    :root[data-display-mode="fullscreen"] .app {
      width: 100%;
      max-width: 760px;
    }
    @media (max-width: 460px) {
      body {
        padding:
          calc(10px + var(--safe-top))
          calc(10px + var(--safe-right))
          calc(12px + var(--safe-bottom))
          calc(10px + var(--safe-left));
      }
      .app { min-height: 210px; border-radius: 17px; }
      .brandbar { min-height: 52px; padding: 7px 14px 6px; }
      .brand-logo { width: min(146px, 48vw); max-height: 34px; }
      .tag { max-width: 126px; }
      h2 { font-size: 17px; }
      .answer { min-height: 46px; padding: 9px 11px; }
      .match { grid-template-columns: 1fr; }
      .results-head { gap: 13px; }
      .score-orb { width: 72px; height: 72px; border-width: 6px; font-size: 20px; }
    }
    @media (max-width: 360px) {
      body {
        padding:
          calc(8px + var(--safe-top))
          calc(8px + var(--safe-right))
          calc(10px + var(--safe-bottom))
          calc(8px + var(--safe-left));
      }
      .tag { display: none; }
      .brand-logo { width: 142px; }
      .eyebrow, .timer { font-size: 12px; }
      h2 { font-size: 16px; }
      .answer { gap: 9px; padding: 8px 10px; }
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
  <section id="app" class="app" data-view="status" aria-label="EZ Quiz">
    <header class="brandbar">
      <img id="brandLogo" class="brand-logo" src="${BRAND_WORDMARK_DATA_URI}" alt="EZ Quiz">
      <div class="brand-actions">
        <span class="tag">Smart. Simple. Fast. EZ.</span>
      </div>
    </header>
    <main id="root" class="ezq-main" tabindex="-1">
      <div class="mounting"><span class="mounting-bolt" aria-hidden="true">⚡</span><div><strong>Opening your quiz…</strong><span>Loading the runner.</span></div></div>
    </main>
  </section>
  <script>
    (() => {
      const app = document.getElementById('app');
      const root = document.getElementById('root');
      const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
      const cancelFrame = window.cancelAnimationFrame || window.clearTimeout;
      const colorScheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      const pendingRequests = new Map();
      let nextRequestId = 1;
      let heightFrame = 0;
      let lastReportedHeight = 0;
      let bridgeInitialized = false;
      let hostLayoutKey = '';
      let hostContextState = {};
      let timerHandle = null;
      let quiz = null;
      let quizKey = '';
      let mode = 'quiz';
      let attemptIndexes = [];
      let answers = [];
      let index = 0;
      let startedAt = 0;
      let finishedAt = 0;
      let attemptNumber = 1;

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
          try {
            if (window.openai && typeof window.openai.notifyIntrinsicHeight === 'function') {
              window.openai.notifyIntrinsicHeight();
              return;
            }
            if (!bridgeInitialized) return;
            const bodyStyle = window.getComputedStyle ? window.getComputedStyle(document.body) : null;
            const verticalPadding = bodyStyle
              ? (Number.parseFloat(bodyStyle.paddingTop) || 0) + (Number.parseFloat(bodyStyle.paddingBottom) || 0)
              : 0;
            const appHeight = Math.max(
              app.scrollHeight || 0,
              app.offsetHeight || 0,
              app.getBoundingClientRect ? app.getBoundingClientRect().height : 0,
              220
            );
            const height = Math.ceil(appHeight + verticalPadding);
            if (Math.abs(height - lastReportedHeight) <= 1) return;
            lastReportedHeight = height;
            window.parent.postMessage({
              jsonrpc: '2.0',
              method: 'ui/notifications/size-changed',
              params: { height },
            }, '*');
          } catch {}
        });
      }

      function renderHtml(html, view) {
        app.dataset.view = view || 'status';
        root.dataset.density = '';
        root.innerHTML = html;
        root.scrollTop = 0;
        scheduleHeightReport();
      }

      function fitQuestionToViewport(question) {
        const optionText = question.type === 'MC'
          ? question.options.join(' ')
          : (question.type === 'MT' ? question.left.concat(question.right).join(' ') : '');
        const complexity = question.text.length + optionText.length;
        const shouldStartTight = complexity > 320 || (question.options && question.options.length > 4);
        root.dataset.density = shouldStartTight ? 'tight' : '';
        requestFrame(() => {
          const content = root.querySelector('.question-content');
          if (!content || content.clientHeight <= 0) return;
          if (content.scrollHeight > content.clientHeight + 1) {
            root.dataset.density = 'tight';
          }
          scheduleHeightReport();
        });
      }

      function numberInset(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      }

      function applyHostContext(globals) {
        const update = globals && typeof globals === 'object' ? globals : {};
        hostContextState = { ...hostContextState, ...update };
        const context = hostContextState;
        const requestedTheme = String(context.theme || '').toLowerCase();
        const theme = requestedTheme === 'dark' || requestedTheme === 'light'
          ? requestedTheme
          : (colorScheme && colorScheme.matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;

        const safeArea = context.safeAreaInsets && typeof context.safeAreaInsets === 'object'
          ? context.safeAreaInsets
          : (context.safeArea && typeof context.safeArea === 'object' ? context.safeArea : {});
        const insets = safeArea.insets && typeof safeArea.insets === 'object' ? safeArea.insets : safeArea;
        const top = numberInset(insets.top);
        const right = numberInset(insets.right);
        const bottom = numberInset(insets.bottom);
        const left = numberInset(insets.left);
        document.documentElement.style.setProperty('--safe-top', top + 'px');
        document.documentElement.style.setProperty('--safe-right', right + 'px');
        document.documentElement.style.setProperty('--safe-bottom', bottom + 'px');
        document.documentElement.style.setProperty('--safe-left', left + 'px');

        const displayMode = String(context.displayMode || 'inline').toLowerCase();
        document.documentElement.dataset.displayMode = displayMode;
        const layoutKey = [theme, displayMode, top, right, bottom, left].join('|');
        if (layoutKey === hostLayoutKey) return;
        hostLayoutKey = layoutKey;
        if (mode === 'quiz' && quiz) fitQuestionToViewport(quiz.questions[currentOriginalIndex()]);
        scheduleHeightReport();
      }

      function formatDuration(milliseconds) {
        const total = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
      }

      function stopTimer() {
        clearInterval(timerHandle);
        timerHandle = null;
      }

      function updateTimer() {
        const timer = document.getElementById('timer');
        if (timer) timer.textContent = formatDuration((finishedAt || Date.now()) - startedAt);
      }

      function startTimer() {
        stopTimer();
        updateTimer();
        if (mode === 'quiz') timerHandle = setInterval(updateTimer, 1000);
      }

      function snapshot() {
        return {
          version: 2,
          quizId: quizKey,
          mode,
          attemptIndexes: attemptIndexes.slice(),
          answers: answers.slice(),
          index,
          startedAt,
          finishedAt,
          attemptNumber,
        };
      }

      function saveQuizState() {
        try {
          if (window.openai && typeof window.openai.setWidgetState === 'function') {
            window.openai.setWidgetState(snapshot());
          }
        } catch {}
      }

      function structuredOutput(value) {
        if (!value || typeof value !== 'object') return value;
        if (value.structuredContent) return value.structuredContent;
        if (value.result && value.result.structuredContent) return value.result.structuredContent;
        if (value.mcp_tool_result && value.mcp_tool_result.structuredContent) return value.mcp_tool_result.structuredContent;
        if (value.call_tool_result && value.call_tool_result.structuredContent) return value.call_tool_result.structuredContent;
        return value;
      }

      function hostToolResult(globals) {
        if (globals && globals.toolOutput !== undefined) return globals.toolOutput;
        const openai = window.openai || {};
        if (openai.toolOutput !== undefined) return openai.toolOutput;
        const metadata = openai.toolResponseMetadata;
        if (!metadata || typeof metadata !== 'object') return null;
        return metadata.mcp_tool_result || metadata.call_tool_result || null;
      }

      function simpleHash(value) {
        const text = JSON.stringify(value);
        let hash = 2166136261;
        for (let offset = 0; offset < text.length; offset += 1) {
          hash ^= text.charCodeAt(offset);
          hash = Math.imul(hash, 16777619);
        }
        return 'legacy-' + (hash >>> 0).toString(16);
      }

      function normalizeQuestion(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const type = String(raw.type || '').toUpperCase();
        const text = String(raw.text || raw.prompt || '').trim();
        if (!text || !['MC', 'TF', 'YN', 'MT'].includes(type)) return null;
        if (type === 'MC') {
          const options = Array.isArray(raw.options) ? raw.options.map(String) : [];
          const correct = Array.isArray(raw.correct) ? raw.correct.filter(Number.isInteger) : [];
          return options.length >= 2 && correct.length ? { type, text, options, correct } : null;
        }
        if (type === 'TF' || type === 'YN') {
          return typeof raw.correct === 'boolean' ? { type, text, correct: raw.correct } : null;
        }
        const left = Array.isArray(raw.left) ? raw.left.map(String) : [];
        const right = Array.isArray(raw.right) ? raw.right.map(String) : [];
        const pairsSource = Array.isArray(raw.pairs) ? raw.pairs : raw.matches;
        const pairs = Array.isArray(pairsSource) ? pairsSource.filter((pair) => Array.isArray(pair) && pair.length === 2) : [];
        return left.length && right.length && pairs.length ? { type, text, left, right, pairs } : null;
      }

      function normalizeQuiz(value) {
        const data = structuredOutput(value);
        if (!data || !Array.isArray(data.questions)) return null;
        const questions = data.questions.map(normalizeQuestion).filter(Boolean);
        if (!questions.length || questions.length !== data.questions.length) return null;
        const normalized = {
          quizId: String(data.quizId || ''),
          title: String(data.title || data.topic || 'EZ Quiz'),
          topic: String(data.topic || ''),
          difficulty: String(data.difficulty || 'medium'),
          questions,
        };
        if (!normalized.quizId) normalized.quizId = simpleHash(normalized);
        return normalized;
      }

      function validAttemptIndexes(value, size) {
        if (!Array.isArray(value) || !value.length) return null;
        const indexes = value.filter((item) => Number.isInteger(item) && item >= 0 && item < size);
        return indexes.length === value.length && new Set(indexes).size === indexes.length ? indexes : null;
      }

      function validAttemptNumber(value) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
      }

      function restoreState(data) {
        const prior = window.openai && window.openai.widgetState;
        if (!prior || prior.version !== 2 || String(prior.quizId || '') !== data.quizId) return false;
        const restoredIndexes = validAttemptIndexes(prior.attemptIndexes, data.questions.length);
        if (!restoredIndexes || !Array.isArray(prior.answers) || prior.answers.length !== data.questions.length) return false;
        attemptIndexes = restoredIndexes;
        answers = prior.answers.slice();
        index = Math.max(0, Math.min(attemptIndexes.length - 1, Number(prior.index) || 0));
        mode = prior.mode === 'results' ? 'results' : 'quiz';
        startedAt = Number(prior.startedAt) > 0 ? Number(prior.startedAt) : Date.now();
        finishedAt = mode === 'results' && Number(prior.finishedAt) > 0 ? Number(prior.finishedAt) : 0;
        attemptNumber = validAttemptNumber(prior.attemptNumber);
        return true;
      }

      function currentOriginalIndex() {
        return attemptIndexes[index];
      }

      function compareAnswer(question, answer) {
        if (question.type === 'MC') {
          if (!Array.isArray(answer) || !answer.length) return false;
          const selected = answer.slice().sort((a, b) => a - b);
          const correct = question.correct.slice().sort((a, b) => a - b);
          return selected.length === correct.length && selected.every((value, offset) => value === correct[offset]);
        }
        if (question.type === 'TF' || question.type === 'YN') {
          return typeof answer === 'boolean' && answer === question.correct;
        }
        if (question.type === 'MT') {
          if (!Array.isArray(answer) || answer.length !== question.left.length) return false;
          const target = new Array(question.left.length).fill(-1);
          question.pairs.forEach(([left, right]) => { target[left] = right; });
          return answer.every((value, offset) => value === target[offset]);
        }
        return false;
      }

      function scoreQuiz() {
        return quiz.questions.reduce((score, question, questionIndex) => (
          score + (compareAnswer(question, answers[questionIndex]) ? 1 : 0)
        ), 0);
      }

      function missedIndexes() {
        const missed = [];
        quiz.questions.forEach((question, questionIndex) => {
          if (!compareAnswer(question, answers[questionIndex])) missed.push(questionIndex);
        });
        return missed;
      }

      function optionsFor(question, answer) {
        if (question.type === 'MC') {
          const selected = Array.isArray(answer) ? answer : [];
          const inputType = question.correct.length > 1 ? 'checkbox' : 'radio';
          return question.options.map((option, optionIndex) => (
            '<label class="answer"><input type="' + inputType + '" name="answer" value="' + optionIndex + '" ' +
            (selected.includes(optionIndex) ? 'checked' : '') + '><span>' + esc(option) + '</span></label>'
          )).join('');
        }
        if (question.type === 'TF' || question.type === 'YN') {
          const labels = question.type === 'TF' ? ['True', 'False'] : ['Yes', 'No'];
          return labels.map((option, optionIndex) => {
            const value = optionIndex === 0;
            return '<label class="answer"><input type="radio" name="answer" value="' + value + '" ' +
              (answer === value ? 'checked' : '') + '><span>' + option + '</span></label>';
          }).join('');
        }
        if (question.type === 'MT') {
          const selected = Array.isArray(answer) ? answer : new Array(question.left.length).fill(-1);
          return '<div class="match-list">' + question.left.map((left, leftIndex) => (
            '<label class="match"><span>' + (leftIndex + 1) + '. ' + esc(left) + '</span><select data-left="' + leftIndex + '">' +
            '<option value="">Choose a match</option>' + question.right.map((right, rightIndex) => (
              '<option value="' + rightIndex + '" ' + (selected[leftIndex] === rightIndex ? 'selected' : '') + '>' +
              String.fromCharCode(65 + rightIndex) + '. ' + esc(right) + '</option>'
            )).join('') + '</select></label>'
          )).join('') + '</div>';
        }
        return '';
      }

      function bindAnswerInputs(question, originalIndex) {
        if (question.type === 'MC') {
          root.querySelectorAll('input[name="answer"]').forEach((input) => {
            input.addEventListener('change', () => {
              if (question.correct.length > 1) {
                answers[originalIndex] = [...root.querySelectorAll('input[name="answer"]:checked')]
                  .map((element) => Number(element.value)).sort((a, b) => a - b);
              } else {
                answers[originalIndex] = [Number(input.value)];
              }
              saveQuizState();
            });
          });
          return;
        }
        if (question.type === 'TF' || question.type === 'YN') {
          root.querySelectorAll('input[name="answer"]').forEach((input) => {
            input.addEventListener('change', () => {
              answers[originalIndex] = input.value === 'true';
              saveQuizState();
            });
          });
          return;
        }
        root.querySelectorAll('select[data-left]').forEach((select) => {
          select.addEventListener('change', () => {
            const current = Array.isArray(answers[originalIndex])
              ? answers[originalIndex].slice()
              : new Array(question.left.length).fill(-1);
            current[Number(select.dataset.left)] = select.value === '' ? -1 : Number(select.value);
            answers[originalIndex] = current;
            saveQuizState();
          });
        });
      }

      function goPrevious() {
        if (index <= 0) return;
        index -= 1;
        saveQuizState();
        renderQuestion();
      }

      function goNext() {
        if (index + 1 >= attemptIndexes.length) {
          finishQuiz();
          return;
        }
        index += 1;
        saveQuizState();
        renderQuestion();
      }

      function renderQuestion() {
        if (!quiz || !attemptIndexes.length) return;
        mode = 'quiz';
        finishedAt = 0;
        const originalIndex = currentOriginalIndex();
        const question = quiz.questions[originalIndex];
        const percent = Math.round(((index + 1) / attemptIndexes.length) * 100);
        renderHtml(
          '<section class="question-layout"><div class="question-content"><div class="topline"><span class="eyebrow">Question ' + (index + 1) + ' of ' + attemptIndexes.length + '</span>' +
          '<span id="timer" class="timer" aria-label="Elapsed time"></span></div>' +
          '<div class="progress" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '">' +
          '<span style="width:' + percent + '%"></span></div><h2>' + esc(question.text) + '</h2>' +
          '<div class="answers">' + optionsFor(question, answers[originalIndex]) + '</div></div>' +
          '<div class="runner-actions"><button id="previous" class="secondary" type="button" ' + (index === 0 ? 'disabled' : '') + '>Previous</button>' +
          '<button id="next" class="primary" type="button">' + (index + 1 === attemptIndexes.length ? 'Finish' : 'Next') + '</button></div></section>',
          'quiz'
        );
        fitQuestionToViewport(question);
        bindAnswerInputs(question, originalIndex);
        document.getElementById('previous').addEventListener('click', goPrevious);
        document.getElementById('next').addEventListener('click', goNext);
        startTimer();
      }

      function beginRetake(indexes) {
        if (mode !== 'results' || !quiz) return;
        const nextIndexes = validAttemptIndexes(indexes, quiz.questions.length);
        if (!nextIndexes) return;
        mode = 'quiz';
        attemptNumber += 1;
        nextIndexes.forEach((questionIndex) => { answers[questionIndex] = null; });
        attemptIndexes = nextIndexes;
        index = 0;
        startedAt = Date.now();
        finishedAt = 0;
        saveQuizState();
        renderQuestion();
      }

      function renderResults() {
        if (!quiz) return;
        stopTimer();
        mode = 'results';
        const score = scoreQuiz();
        const missed = missedIndexes();
        const percent = Math.round((score / quiz.questions.length) * 100);
        const message = score === quiz.questions.length
          ? 'Perfect score.'
          : (score >= Math.ceil(quiz.questions.length * .7) ? 'Nice work.' : 'Review the misses and give it another run.');
        const missedSummary = missed.length
          ? '<strong>Review next:</strong> ' + missed.map((questionIndex) => 'Question ' + (questionIndex + 1)).join(', ')
          : '<strong>All correct.</strong> You are ready for a harder round.';
        renderHtml(
          '<section class="results-view" data-widget-version="${QUIZ_WIDGET_VERSION}" style="padding:20px 22px 22px"><div class="results-head"><div class="score-orb" aria-label="' + score + ' out of ' + quiz.questions.length + '">' + score + '/' + quiz.questions.length + '</div>' +
          '<div class="results-copy"><h1>Quiz complete</h1><p>' + esc(message) + ' · Attempt ' + attemptNumber + ' · ' + formatDuration(finishedAt - startedAt) + '</p></div></div>' +
          '<div class="result-progress"><div class="progress" role="progressbar" aria-label="Final score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '">' +
          '<span style="width:' + percent + '%"></span></div></div>' +
          '<div class="result-stats" aria-label="Quiz results"><div class="result-stat correct"><strong>' + score + '</strong><span>Correct</span></div>' +
          '<div class="result-stat missed"><strong>' + missed.length + '</strong><span>Missed</span></div>' +
          '<div class="result-stat"><strong>' + percent + '%</strong><span>Score</span></div></div>' +
          '<div class="result-summary">' + missedSummary + '</div>' +
          '<div class="result-actions"><button id="retakeMissed" class="primary" type="button" ' + (!missed.length ? 'disabled' : '') + '>Retake missed</button>' +
          '<button id="retakeAll" class="secondary" type="button">Retake all</button></div>' +
          '<p class="result-note">' + esc(quiz.title) + '<span class="widget-build">v${QUIZ_WIDGET_VERSION}</span></p></section>',
          'results'
        );
        document.getElementById('retakeMissed').addEventListener('click', () => beginRetake(missed));
        document.getElementById('retakeAll').addEventListener('click', () => (
          beginRetake(quiz.questions.map((_, questionIndex) => questionIndex))
        ));
        saveQuizState();
      }

      function finishQuiz() {
        if (mode !== 'quiz') return;
        finishedAt = Date.now();
        mode = 'results';
        saveQuizState();
        renderResults();
      }

      function showUnavailable() {
        stopTimer();
        renderHtml('<div class="status-card"><div class="status-icon" aria-hidden="true">!</div><h1>Quiz unavailable</h1>' +
          '<p>ChatGPT did not provide a complete question set for this card. Ask for a new EZ Quiz in the conversation.</p></div>', 'status');
      }

      function loadQuiz(value) {
        const data = normalizeQuiz(value);
        if (!data) return false;
        if (quiz && quizKey === data.quizId) return true;
        quiz = data;
        quizKey = data.quizId;
        if (!restoreState(data)) {
          mode = 'quiz';
          attemptIndexes = data.questions.map((_, questionIndex) => questionIndex);
          answers = new Array(data.questions.length).fill(null);
          index = 0;
          startedAt = Date.now();
          finishedAt = 0;
          attemptNumber = 1;
        }
        if (mode === 'results') renderResults(); else renderQuestion();
        return true;
      }

      function loadToolResult(value) {
        if (value == null) return;
        if (!loadQuiz(value)) showUnavailable();
      }

      document.addEventListener('keydown', (event) => {
        if (mode !== 'quiz') return;
        const active = document.activeElement;
        const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'select' || tag === 'textarea' || (active && active.isContentEditable)) return;
        if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); goPrevious(); }
        if ((event.key === 'ArrowRight' || event.key === 'Enter')) { event.preventDefault(); goNext(); }
      });

      window.addEventListener('openai:set_globals', (event) => {
        const globals = event && event.detail && event.detail.globals || {};
        applyHostContext({ ...(window.openai || {}), ...globals });
        const nextOutput = hostToolResult(globals);
        if (nextOutput != null) loadToolResult(nextOutput);
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
        if (message.method === 'ui/notifications/tool-result') loadToolResult(message.params);
        if (message.method === 'ui/notifications/host-context-changed') {
          applyHostContext(message.params && (message.params.hostContext || message.params));
        }
      });

      if (colorScheme && colorScheme.addEventListener) {
        colorScheme.addEventListener('change', () => {
          if (!window.openai || !window.openai.theme) applyHostContext(window.openai || {});
        });
      }
      document.getElementById('brandLogo').addEventListener('load', scheduleHeightReport, { once: true });

      applyHostContext(window.openai || {});
      const initialOutput = hostToolResult(window.openai || {});
      if (initialOutput) loadToolResult(initialOutput);

      request('ui/initialize', {
        protocolVersion: '2026-01-26',
        appInfo: { name: 'ez-quiz-player', title: 'EZ Quiz', version: '4.2.0', websiteUrl: '${SITE_ORIGIN}' },
        appCapabilities: {},
      }).then((result) => {
        bridgeInitialized = true;
        window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
        if (result && result.hostContext) applyHostContext(result.hostContext);
        if (!initialOutput && result && result.toolResult) loadToolResult(result.toolResult);
        scheduleHeightReport();
      }).catch(() => {});
      scheduleHeightReport();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  QUIZ_WIDGET_ALIASES,
  QUIZ_WIDGET_MIME_TYPE,
  QUIZ_WIDGET_URI,
  quizWidgetHtml,
};
