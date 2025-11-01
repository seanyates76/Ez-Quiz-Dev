Ez-Quiz App

      

Create and play quizzes in seconds with a clean, responsive interface. Keyboard-friendly and offline-ready.

Features

Generate from a topic or create your own quiz

Multiple formats: Multiple Choice, True/False, Yes/No, Matching

Clear results with retake options (full or missed)

Installable PWA with cache-safe updates

Accessibility by default

Privacy first: no tracking, AI only when you choose


Live

https://ez-quiz.app/


Quick Start

# Static preview (no functions)
cd public && python3 -m http.server 8000

# Full stack dev (Netlify functions)
netlify dev
# Tip: set AI_PROVIDER=echo to run without provider keys

# Tests and UI snapshots
npm install
npm test
npm run ui:check

Key Endpoints

/.netlify/functions/generate-quiz — generate from topic or seed text

/.netlify/functions/send-feedback — email feedback (nodemailer)

/.netlify/functions/health — health probe


Environment

AI_PROVIDER = gemini | openai | echo

Provider keys as needed. See ENV.md for details.


Tech Stack

Front end: HTML/CSS/vanilla JS (ES modules), PWA service worker

Back end: Netlify Functions (Node, esbuild)

CI/Security: GitHub Actions, CodeQL, OpenSSF Scorecard, Dependabot


Under the Hood

Lightweight, framework-free front end

Versioned service worker with safe updates

Beta flags: server requireBeta, client flags.js

Provider selection in netlify/functions/lib/providers.js


Contributing & Policies

See CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, SUPPORT.md

Conventional Commits encouraged; commit lint on PRs

License: MIT (LICENSE)


Future Updates

Full UI overhaul: clearer layout, balanced spacing, refined theming

Explain feature: AI-powered, non-blocking answer explanations

Media input (PDF/image) with resilient fallbacks

Expanded DOM/CSS regression checks for toolbar and results


Contact

Open an issue or email ez.quizapp@gmail.com.

Trust Matters
Zero tracking. Zero data sales. AI works on your terms — never in the background.