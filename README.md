EZ Quiz Web
===========

[![Netlify Status](https://api.netlify.com/api/v1/badges/35b8697e-f228-4b5f-8065-6286e05246c8/deploy-status)](https://app.netlify.com/projects/eq-quiz/deploys)

Fast, offline web quiz supporting MC, TF, YN and MT. No backend. Installable PWA. Keyboard friendly.

Links
- Live: https://ez-quiz.app/
- Support: https://www.buymeacoffee.com/seanyates78

Quick Start
- Open `public/index.html` directly, or
- Serve `public/` locally for SW/PWA features: `cd public && python3 -m http.server`

Testing
-------
- Install dependencies: `npm install`
- Run the unit suite: `npm test`
 - UI layout sweep (toolbar): `npm run ui:check` (artifacts in `.artifacts/ui`) — set `UI_CHECK_WIDTHS=320,375,414,600` to target specific widths.
 - DOM tests run under jsdom (`jest-environment-jsdom`). HTML parsing is hardened in test helpers to avoid parse5 ESM path issues.

Automation & Head CLI (local)
-----------------------------
-----------------------------

Dev Tools Wrapper
------------------
- Default path: /home/arch-bean/Projects/ezq-dev-tools
- Run via wrapper: `./scripts/ezq-head.sh run quick`
- Override path: `EZQ_DEV_TOOLS_DIR=/custom/path ./scripts/ezq-head.sh run quick`

- Tools live in `../ezq-dev-tools`. Install and run quick checks:
  - `cd ../ezq-dev-tools && ./scripts/install.sh`
  - `./bin/ezq-head run quick` (smoke, lint, ui, parser, repo, audit)
- Propose + iterate (dry):
  - `printf '%s' '{"action":"run_extensive","brief":"<one-line goal>","iterations":3}' | ./bin/ezq-head tool`
- Artifacts and reports live under `../ezq-dev-tools/.ezq/runs/<run_id>/artifacts`.
- Default is dry-run; committing/pushing is always explicit and confirmed.

Features
- Generate + Quiz Editor with Mirror; import `.txt` or paste.
- Keyboard: Enter to start/advance; Backspace to go back.
- Timer (elapsed or countdown); theme toggle (dark/light).
- Results: Missed or All, color‑coded answers, Retake (full) + Missed only.
- PWA: offline shell, maskable icons, safe‑area‑aware layout.
- Floating actions: Feedback panel + Support link.
- Help & FAQ: Sleek modal with concise Q/A format; smooth transitions; opening a new modal replaces the current one.
 - Explain (beta): Tapping Explain shows a small localized toast near the result item. Full explanations are coming; non‑beta does not make network calls.
 - Topic Import UI: Topic input and the paperclip import button act as a single, tidy control with one soft focus border, and no redundant hover/autofill highlights.

Interactive Editor (beta)
-------------------------
- Opt‑in, card‑based authoring for MC/TF/YN/MT (Add MT button or Shift+M).
- Enable via Options → Quiz Editor → “Interactive Editor (beta)”.
- Edits stay in sync with the raw Editor/Mirror; the raw parser format remains the source of truth.
- Inline validation ensures each question has a prompt and a marked correct answer or completed matches.
- Default off for now to keep the classic editor front‑and‑center.

Note: A separate smoke-test page is no longer needed; test directly in Options → Quiz Editor inside the main app.

Appearance and options
- Theme supports Dark, Light, and System (follows OS).
- Question Types are spelled out (Multiple Choice, True/False, Yes/No, Matching) and render as mobile‑friendly chips.

Question Format
Each line uses pipes and semicolons: `TYPE|Question|Options|Answer`

Parsable examples (copy as-is):
```
MC|Which shape has three sides?|A) Triangle;B) Square|A
MC|Which numbers are prime?|A) 2;B) 4;C) 5;D) 9|A,C
TF|The Sun is a star.|T
YN|Is 0 an even number?|Y
MT|Match.|1) L1;2) L2|A) R1;B) R2|1-A,2-B
```
Tip: For multiple correct answers in MC, separate letters with commas (e.g., `A,C`).

Deploy (Netlify)
- Repo includes `netlify.toml` for headers/caching.
- Build: none. Publish dir: `public/`.
- Use a custom domain and enable HTTPS.
- **Beta Route**: Edge function at `/beta` provides access to beta features. See [BETA_DOCUMENTATION.md](BETA_DOCUMENTATION.md) for details.
 - UI changes: when shipping visible UI changes, bump the service worker cache name (in `public/sw.js`) and the versioned query strings in `index.html` and related module imports (`public/js/*`) to prevent stale clients.

Troubleshooting Updates (Mobile/PWA)
- If stuck on an old version: open with `?clear=1` (or `#clear-cache`).
- Or Settings → Reset App: clears caches and unregisters service workers.
- On iOS/Safari, you may need to remove site data and reopen once.

Dev Tips
- Beta Explain renders only in beta mode. Enable via Settings → Beta features, or visit `/beta` to set `FEATURE_FLAGS=beta` (sets a cookie) — the app also reflects beta via `body[data-beta]`.
- Primary button mode debug: set `localStorage.setItem('EZQ_DEBUG','1')` to log primary action mode transitions in the console.

Changelog Highlights
- 1.5.0-beta.12: Explain (beta) localized toast; Topic+paperclip unified with single soft focus border and de‑noised hover/autofill; test environment stabilized with jsdom.
- 1.5.0-beta.9: AI fallback chain covers `/.netlify/functions/generate-quiz`, `/api/generate`, and the Netlify hosts (`https://ez-quiz.netlify.app`, `https://eq-quiz.netlify.app`); CSP `connect-src` allows those domains; backend defaults to `gemini-2.5-flash-lite-preview-09-2025`; cache-buster v1.5.17 (SW cache v125).
- 1.5.0-beta.8: AI hotfix — client points at `/.netlify/functions/generate-quiz` first plus cache-buster v1.5.13 (SW cache v122).
- 1.5.0-beta.7: Softer borders/focus ring tokens, roomy generator toolbar on wide phones, and cache-buster v1.5.12.
- 1.5.0-beta.5: Generator slider rebuilt with inline steppers; Interactive Editor now default with pill toggle; Options/Settings split refined.
- Earlier: header wordmark; improved import; single‑scrollbar Help; progress bar; retake polish.

License
MIT — see `LICENSE.txt`.

Contributing & Support
- See `CONTRIBUTING.md` to file issues and PRs.
- If this project helps you, consider coffee: https://www.buymeacoffee.com/seanyates78
