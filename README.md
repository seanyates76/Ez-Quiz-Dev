Ez-Quiz Dev
===========

[![License](https://img.shields.io/github/license/seanyates76/Ez-Quiz-App)](LICENSE.txt)
![Mirror](https://img.shields.io/badge/Mirror-Ez--Quiz--App-blue)
![JavaScript](https://img.shields.io/badge/JavaScript-ES%20Modules-f7df1e?logo=javascript&logoColor=000&labelColor=f7df1e)
![Node.js](https://img.shields.io/badge/Node.js-Netlify%20Functions-3c873a?logo=nodedotjs&logoColor=fff)
[![Netlify Status](https://api.netlify.com/api/v1/badges/35b8697e-f228-4b5f-8065-6286e05246c8/deploy-status)](https://app.netlify.com/sites/ez-quiz/deploys)

Development repository for **Ez-Quiz**, a quiz app built with vanilla JavaScript and Netlify Functions. This repo is the working source of truth; the filtered production mirror lives at **`seanyates76/Ez-Quiz-App`**.

Ez-Quiz is designed to be:
- fast and lightweight
- accessible and keyboard-friendly
- privacy-respecting
- simple to run locally

Live app
--------
- https://ez-quiz.app/

What’s in this repo
-------------------
- quiz generation and play flow
- PWA/service worker support
- Netlify Functions for generation, feedback, and health endpoints
- tests, CI workflows, and maintainer tooling
- mirror workflow to the production mirror

Quick start
-----------
```bash
# Install dependencies
npm install

# Static preview (no functions)
cd public && python3 -m http.server 8000

# Full stack local dev (Netlify functions)
cd ..
netlify dev
# Tip: set AI_PROVIDER=echo to run without provider keys

# Tests
npm test
npm run ui:check
```

Repository model
----------------
This is the **development repo**.

- **Dev repo:** `seanyates76/Ez-Quiz-Dev`
- **Production mirror:** `seanyates76/Ez-Quiz-App`

The production mirror is produced from this repo through a filtered sync defined by `.publicignore`, so internal files like workflow notes, test artifacts, scripts, and local tooling do not automatically flow downstream.

Syncing with the production mirror
----------------------------
- **Pull production mirror → dev:** `npm run sync:public`
- **Push dev → production mirror:** `.github/workflows/publish.yml` or `files/scripts/mirror.sh`
- Always review the resulting diff before committing or opening a PR

Architecture
------------
- **Front end:** HTML, CSS, vanilla JS ES modules under `public/`
- **Back end:** Netlify Functions under `netlify/functions/`
- **Core entry point:** `public/index.html`
- **Client modules:** `public/js/*`
- **Provider selection:** `netlify/functions/lib/providers.js`

Key endpoints
-------------
- `/.netlify/functions/generate-quiz` — generate from topic or seed text
- `/.netlify/functions/send-feedback` — feedback mailer
- `/.netlify/functions/health` — health probe

Environment
-----------
See `ENV.md` for full setup details.

Common variables:
- `AI_PROVIDER` = `gemini` | `openai` | `echo`
- provider API keys as needed
- feedback mailer variables for Netlify Functions

Contributing & policies
-----------------------
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `CHANGELOG.md`
- License: MIT (`LICENSE.txt`)

Contact
-------
Open an issue or email **ez.quizapp@gmail.com**.

**Trust matters**  
Zero tracking. Zero data sales. AI runs only when explicitly invoked.
