Ez-Quiz App
===========

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/seanyates76/Ez-Quiz-App/badge?style=flat)](https://securityscorecards.dev/viewer/?uri=github.com/seanyates76/Ez-Quiz-App)
[![License](https://img.shields.io/github/license/seanyates76/Ez-Quiz-App)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/seanyates76/Ez-Quiz-App?include_prereleases)](https://github.com/seanyates76/Ez-Quiz-App/releases)
![Upstream Synced](https://img.shields.io/badge/Mirror-Upstream%20Synced-blue)
![JavaScript](https://img.shields.io/badge/JavaScript-ES%20Modules-f7df1e?logo=javascript&logoColor=000&labelColor=f7df1e)
![Node.js](https://img.shields.io/badge/Node.js-Functions-3c873a?logo=nodedotjs&logoColor=fff)
[![Netlify Status](https://api.netlify.com/api/v1/badges/35b8697e-f228-4b5f-8065-6286e05246c8/deploy-status)](https://app.netlify.com/sites/ez-quiz/deploys)

Create and play quizzes in seconds with a clean, responsive interface. Keyboard-friendly and offline-ready.

Features
--------
- Generate from a topic or create your own quiz
- Multiple formats: Multiple Choice, True/False, Yes/No, Matching
- Clear results with retake options (full or missed)
- Installable PWA with cache-safe updates
- Accessibility by default
- Privacy first: no tracking, AI only when you choose

Live
----
- https://ez-quiz.app/

Quick Start
-----------
```bash
# Static preview (no functions)
cd public && python3 -m http.server 8000

# Full stack dev (Netlify functions)
netlify dev
# Tip: set AI_PROVIDER=echo to run without provider keys

# Tests and UI snapshots
npm install
npm test
npm run ui:check
```

Key Endpoints
-------------
- `/.netlify/functions/generate-quiz` — generate from topic or seed text
- `/.netlify/functions/send-feedback` — email feedback (nodemailer)
- `/.netlify/functions/health` — health probe

Environment
-----------
- `AI_PROVIDER` = `gemini` | `openai` | `echo`
- Provider keys as needed. See `ENV.md` for details.

Tech Stack
----------
- Front end: HTML/CSS/vanilla JS (ES modules), PWA service worker
- Back end: Netlify Functions (Node, esbuild)
- CI/Security: GitHub Actions, CodeQL, OpenSSF Scorecard, Dependabot

Under the Hood
--------------
- Lightweight, framework-free front end
- Versioned service worker with safe updates
- Beta flags: server `requireBeta`, client `flags.js`
- Provider selection in `netlify/functions/lib/providers.js`

Contributing & Policies
-----------------------
- See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`
- Conventional Commits encouraged; commit lint on PRs
- License: MIT (`LICENSE`)

Future Updates
--------------
- Full UI overhaul: clearer layout, balanced spacing, refined theming
- Explain feature: AI-powered, non-blocking answer explanations
- Media input (PDF/image) with resilient fallbacks
- Expanded DOM/CSS regression checks for toolbar and results

Contact
-------
Open an issue or email ez.quizapp@gmail.com.

**Trust Matters**  
Zero tracking. Zero data sales. AI works on your terms — never in the background.
