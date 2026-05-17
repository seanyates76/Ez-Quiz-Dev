# Agenda: UI Visual Refresh + Source Import

## Goals
- Soften “outlined wrappers” across the app; move to lighter borders, subtle elevation, and cleaner spacing.
- Refresh CSS tokens for radius, shadows, neutral surface, and brand accents (consistent across light/dark).
- Introduce a new source import feature to import content from text, document, PDF, and image files (e.g., notes, study guides, syllabi snapshots) to seed quiz topics/questions.
- Keep changes incremental, reversible, and well‑tested (serverless safe; no new deps unless approved).

## Design Approach (Preview)
- Tokens: add `--surface`, `--surface-2`, `--outline`, `--shadow-soft`, `--shadow-strong`, `--radius-md`, `--radius-lg`.
- Replace heavy `outline`/borders on wrappers with: subtle `border-color: var(--outline)` + `box-shadow: var(--shadow-soft)`; balanced padding.
- Button states: soften focus ring and hover shadow; keep accessible contrast.
- Footer: keep current structure; ensure CTA stays centered with dynamic reserve (already done).

## Media Input Implementation
- The topic paperclip is production-facing and accepts text, Markdown, HTML, CSV, JSON, RTF, DOCX, PDF, and image files.
- Client guardrails validate size, sniff file bytes, reject MIME/extension mismatches, and cancel stale overlapping imports.
- `/.netlify/functions/ingest-media` extracts readable text from text/document files locally where practical and uses the configured provider for PDF/image extraction, then returns `{ text, metadata }`.
- Imported text is treated as source material for quiz generation. It is not parsed as quiz-line syntax.

## Serverless Guardrails
- The function accepts base64 source-import payloads for the supported text, document, PDF, and image formats.
- Guardrails: origin checks, direct-upload cap, extracted-text cap, DOCX XML expansion cap, per-IP rate limit, provider timeout, and typed error codes.
- Gemini supports PDF/image extraction. OpenAI supports image extraction in this build. Text, Markdown, HTML, CSV, JSON, RTF, and DOCX extraction uses deterministic local parsing.

## Acceptance Criteria
- Visual refresh: wrappers look lighter and more modern (consistent across states), no layout regressions on mobile.
- Media Input:
  - Drag‑drop zone visible; accepts files; shows a readable preview status.
  - Successful import shows the file name, extracted character count, and a remove action.
  - Generate sends the extracted source text to the quiz generator.
- Tests: pass; iterate checks: pass.
- No blocking console errors (CSP, SW, or network) in preview.

## Implementation Plan (Incremental)
1) Tokens & Shadows
   - Introduce tokens in `public/styles.css` (keep current tokens; add new; no breaking names).
   - Migrate wrappers (toolbar card, editor card, quiz card) to soft outline + elevation.
   - Tests: CSS token presence; screenshot‑less DOM sanity.

2) Media Input
   - File input + drag‑drop.
   - Show source summary and clear action.
   - Post to `ingest-media` and route extracted text into grounded quiz generation.
   - Tests: DOM ids present; accept attribute; size/type validation; overlapping imports; successful source generation.

3) Iterate & Polish
   - Run `ezq-head run iterate` and fix minor visual spacing regressions.
   - Add CSP allowances only if needed (no third‑party scripts).

## Tooling & Flow
- Use `ezq-head` tool adapter for proposal + iterate; commit via `pack` only after approval.
- Artifacts to inspect: `checks-summary.json`, `iterate-summary.json`, `ui-audit.md`.

## Risks & Mitigations
- SW cache: bump cache when touching `sw.js` or versioned assets.
- CSP drift: UI audit checks BMC connect/img; add new hosts only when necessary.
- Perf: prefer CSS‑only visual changes; no new runtime deps without approval.

## Timeline (suggested)
- PR A: Tokens + wrapper refresh + tests.
- PR B: Media Input UI + extraction endpoint + tests.
- PR C: Provider smoke tests and design polish.
