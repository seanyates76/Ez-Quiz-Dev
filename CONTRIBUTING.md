# Contributing to Ez-Quiz Dev

Thanks for contributing.

This repository is the **development repo** for Ez-Quiz. The filtered production mirror lives at [`seanyates76/Ez-Quiz-App`](https://github.com/seanyates76/Ez-Quiz-App), but active implementation work happens here.

## Project overview

- **Development repo:** `Ez-Quiz-Dev`
- **Production mirror:** `Ez-Quiz-App`
- **Live app:** <https://ez-quiz.app>
- **License:** MIT

Structure overview:
- `public/index.html` → main UI shell
- `public/styles.css` → tokens, theme, layout, and component styling
- `public/js/*` → client-side modules
- `netlify/functions/` → quiz generation, feedback, and support endpoints

## Development setup

```bash
npm install
netlify dev
```

Tips:
- use `AI_PROVIDER=echo` if you do not want to rely on external provider keys during local work
- static preview without functions: `cd public && python3 -m http.server 8000`

## How to contribute

### 1. Branch clearly
Create a focused branch from `main`.

Examples:
- `fix/theme-token-regression`
- `feat/share-editor-page`
- `docs/readme-polish`

### 2. Keep scope readable
Small, deliberate PRs are easier to review and safer to mirror downstream.

Try to avoid mixing unrelated work such as:
- UI polish
- server behavior changes
- workflow edits
- docs cleanup

unless they are tightly coupled.

### 3. Follow project conventions
- Vanilla JS only — no front-end framework
- Prefer small, explicit modules under `public/js/`
- Keep accessibility intact: focus states, keyboard navigation, labeling, and visible state changes
- Avoid introducing console noise or silent failures
- Keep service worker/cache-buster updates in sync when front-end assets truly require it

### 4. Test before opening a PR
Run the checks that match your changes.

Typical baseline:

```bash
npm test
npm run ui:check
```

For manual verification, at minimum:
- load the app locally
- verify core quiz flow still works
- confirm keyboard navigation still behaves correctly
- confirm no obvious layout regressions at mobile and desktop sizes

### 5. Open a useful PR
Include:
- what changed
- why it changed
- files or areas touched
- test steps you ran
- screenshots or notes if the change is visual

## Acceptance checklist

Before requesting review:
- [ ] No obvious console errors introduced
- [ ] Relevant tests pass locally
- [ ] Accessibility behavior still works
- [ ] Theme/token changes remain consistent
- [ ] PR description explains scope and validation clearly

## Production mirror notes

This repo syncs selectively to the production mirror.

That means:
- not every dev-repo file is intended to flow downstream
- internal scripts, local tooling, and some documentation are intentionally filtered out
- review mirror-sensitive changes carefully

## Communication

- Open an issue for bugs, ideas, or design discussion
- Keep feedback specific and respectful
- Follow `CODE_OF_CONDUCT.md`

## Maintainer contact

- GitHub: <https://github.com/seanyates76>
- Email: **ez.quizapp@gmail.com**
