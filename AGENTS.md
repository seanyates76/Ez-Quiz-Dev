# Maintainer Guide — Ez-Quiz Dev

This file is for future maintainers, coding agents, and helper instances working inside **Ez-Quiz-Dev**.

It should stay practical, current, and boring in a good way.

## What this repo is

`Ez-Quiz-Dev` is the **development repository** for Ez-Quiz.

- **Live app:** <https://ez-quiz.app>
- **Production mirror:** `seanyates76/Ez-Quiz-App`
- **Current role of this repo:** source of truth for implementation, CI, tests, and internal tooling

The production mirror is a filtered mirror, not the main workshop.

## Core architecture

### Front end
- Main HTML shell: `public/index.html`
- Styling: `public/styles.css`, `public/styles.tokens.css`, `public/styles.backdrop.css`
- Client modules: `public/js/*`

Key client modules:
- `public/js/main.js` — bootstraps the app
- `public/js/state.js` — shared client state
- `public/js/generator.js` — generation flow wiring
- `public/js/api.js` — client API/fallback handling
- `public/js/quiz.js` — quiz runner behavior
- `public/js/settings.js` — settings modal/state
- `public/js/editor.gui.js` — quiz editor UI
- `public/js/flags.js` / `public/js/boot-beta.js` — runtime beta feature handling
- `public/js/veil.js` — busy overlay handling

### Back end
Netlify Functions live under `netlify/functions/`.

Important functions:
- `generate-quiz.js` — quiz generation endpoint
- `generate-quiz-start.js` — validates, plans, and stores a queued async generation job
- `generate-quiz-worker-background.js` — processes planned async generation batches
- `generate-quiz-status.js` — returns public job progress and completed questions
- `generate-quiz-stop.js` — stops a job while preserving completed questions
- `send-feedback.js` — feedback mailer
- `health.js` — simple health probe
- `ingest-media.js` — media import path
- `mcp.js` — public MCP endpoint and ChatGPT plugin tool surface
- `lib/mcpQuizWidget.js` — self-contained MCP Apps quiz player returned to ChatGPT

Supporting modules:
- `netlify/functions/lib/asyncGenerationPlanner.js` — quiz lanes, scenario budgets, and batch planning
- `netlify/functions/lib/asyncGenerationWorker.js` — batch execution, filtering, recovery, and terminal states
- `netlify/functions/lib/asyncJobStore.js` — file-backed local jobs and Netlify Blobs production jobs
- `netlify/functions/lib/asyncHttp.js` — shared async endpoint HTTP/CORS helpers
- `netlify/functions/lib/generationRequest.js` — shared request normalization for sync and async generation
- `netlify/functions/lib/providers.js` — provider selection and generation logic
- `netlify/functions/lib/providers.explain.js` — explanation provider helpers
- `netlify/functions/lib/normalizer.js` — quiz normalization/parsing support
- `netlify/functions/lib/betaGuard.js` — server-side beta gating
- `netlify/functions/lib/quizSchema.js` — structured quiz schema helpers

## Local development

### Install
```bash
npm install
```

### Full stack local dev
```bash
netlify dev
```

Tips:
- use `AI_PROVIDER=echo` for local work when you do not want to depend on provider keys
- local dev normally serves on `http://localhost:8888`
- `Ez-Quiz-Dev` is the active development repo, but the linked Netlify project/environment is tied to `Ez-Quiz-App`
- normal `netlify dev` may inject App-linked project env while running Dev-repo code; this can make provider smoke results misleading
- if Netlify AI Gateway is enabled, normal `netlify dev` can also inject internal `GEMINI_API_KEY`/`OPENAI_API_KEY` values that override local `.env`; these are not direct provider keys for the current SDK calls
- for direct-provider smoke from this repo, use local `.env` plus offline Netlify dev:
  ```bash
  set -a; source .env; set +a
  netlify dev --offline --port 8888
  ```
- known provider-smoke path: Gemini generation, lazy explanations, and media import passed from `Ez-Quiz-Dev` using local `.env` with `netlify dev --offline`

### Static-only preview
```bash
cd public && python3 -m http.server 8000
```

## Testing and verification

### Baseline test suite
```bash
npm test
```

### UI/layout sweep
```bash
npm run ui:check
```

### Public sync helper
```bash
npm run sync:public
```

## Dependency notes

Current package roles are intentional:

### Runtime dependencies
- `@google/generative-ai`
- `@netlify/blobs`
- `nodemailer`
- `yauzl`

### Dev dependencies
- `netlify-cli`
- `jest`
- `jest-environment-jsdom`
- `jsdom`
- `puppeteer`

Do not move `netlify-cli` back into runtime dependencies unless there is a very explicit reason.

## Netlify / deployment notes

See:
- `netlify.toml`
- `ENV.md`

Important points:
- publish directory: `public`
- functions directory: `netlify/functions`
- Node bundler: `esbuild`
- external runtime modules: `@google/generative-ai`, `@netlify/blobs`, `nodemailer`

Key redirects:
- `/api/generate` → `/.netlify/functions/generate-quiz`
- `/api/health` → `/.netlify/functions/health`
- `/api/mcp` → `/.netlify/functions/mcp`
- `/mcp` → `/.netlify/functions/mcp` (stable ChatGPT plugin URL)

Async generation uses the direct Netlify Function paths for `generate-quiz-start`, `generate-quiz-worker-background`, `generate-quiz-status`, and `generate-quiz-stop`.

Promotion note:
- do not treat a normal `netlify dev` provider failure as proof that Dev-repo code is broken until you confirm which Netlify env supplied the key
- if local `.env` plus `netlify dev --offline` passes but normal `netlify dev` fails, check the App-linked Netlify project env before changing code
- if normal `netlify dev` shows a ~400-char `GEMINI_API_KEY` and matching `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` hashes, suspect Netlify AI Gateway injection rather than repo code or `.env` syntax
- AI feature disabling is team-level in Netlify; do not toggle it casually because it affects all team projects and Agent Runner/Gateway behavior
- before promoting provider-backed work, make the App-linked Netlify env match the known-good local provider keys, then rerun a normal Netlify/App smoke or deploy smoke

## Mirror workflow model

This repo syncs selectively to the production mirror.

### Dev → public
- workflow: `.github/workflows/publish.yml`
- local helper: `files/scripts/mirror.sh`

### Public → dev
- local helper: `files/scripts/pull-public.sh`
- npm wrapper: `npm run sync:public`

### Guardrails
- `.publicignore` defines what should not flow downstream
- internal tooling, workflow details, tests, scripts, and local-only files should remain filtered

## CI and workflow notes

Important workflows live in `.github/workflows/`.

Current expectations:
- CI uses **Node 25** to match the working lockfile generation environment
- Scorecard workflow is fixed structurally, but SARIF upload/code scanning still depends on repository code-scanning availability
- dependency review is intentionally gated to public visibility

## Known repo conventions

- front end is vanilla JS, no framework
- prefer explicit modules over magic
- keep accessibility intact when changing UI
- if front-end assets change meaningfully, verify cache-buster/service-worker implications
- `.netlify/state.json` and `.netlify/plugins/package-lock.json` are local working files and should not be re-tracked casually

## High-value files to read before large changes

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `ENV.md`
- `netlify.toml`
- `package.json`

If touching mirror behavior, also read:
- `.publicignore`
- `.github/workflows/publish.yml`
- `files/scripts/mirror.sh`
- `files/scripts/pull-public.sh`

## If you are making changes

Before handing work off or opening a PR:
1. run relevant tests
2. confirm the scope is intentional
3. avoid bundling unrelated cleanup into one commit
4. leave short, useful commit messages
5. update this file only if the repo’s actual operating model changed

## What this file should not become

Do not turn this into:
- a diary
- a branch-specific memo
- a changelog duplicate
- a giant stale handoff log

If information is temporary, put it in a PR, issue, or commit message instead.
