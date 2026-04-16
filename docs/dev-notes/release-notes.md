EZ Quiz Web v3.3
================

Release date: 2025-09-30

Highlights
- Stable AI fallback loop now protects Generate/Start for everyone.
- Recent beta UI polish is standard across the app.
- Cache busts (`v1.5.17`, SW cache `v125`) ship the update quickly.

EZ Quiz Web v1.0.0
===================

Release date: 2025-08-28

Highlights
- Fresh header wordmark, adaptive mobile layout, and refined light‑mode backdrop
- Import UX: drag‑drop .txt, Clear button, right‑aligned tip
- Keyboard shortcuts: Enter to start/advance, Backspace to go back
- Results polish: centered actions; Retake Missed Only from Missed view
- New ratio bar (correct vs incorrect) with accessible legend
- In‑quiz progress bar near timer/counter
- FAQ modal: single scrollbar; Close button always visible
- Color‑coded status (Ready/Info/Warning/Error)
- PWA + hosting: Netlify headers, HTTPS redirects, relative paths, SW versioning
- Security: user content rendered safely (no innerHTML), tightened CSP (no inline scripts)

Getting started
- Paste or import a `.txt` quiz and press Enter to start
- Use Settings for timer and theme
- During quiz: Enter advances or finishes; Backspace goes back
- After finishing: Review Missed or All; optionally Retake Missed Only

Known notes
- Service worker updates require a hard refresh on first deploy (Shift+Reload)
 - If the header wordmark source is changed, use `icons/brand-title-source.png`

EZ Quiz Web v1.5.0-beta.12
==========================

Release date: 2025-10-22

Highlights
- Explain (beta): Localized toast near the result item; inline block removed. Full explanations will arrive in a future release.
- Topic input polish: Topic + paperclip unified as a single control with one soft focus border; hover/autofill no longer cause double highlights.
- Tests: Stabilized jsdom environment; hardened HTML parsing for DOM tests; header‑byte tests use Node Blob.
EZ Quiz Web v1.1.0
===================

Release date: 2025-08-29

Highlights
- ✨ Prompt builder popover with Topic/Length, copy‑to‑clipboard, and Ctrl/Cmd+P shortcut
- Cursor‑positioned toasts for instant feedback
- Settings modal polish: sticky header/footer, grouped sections, small‑screen scrolling
- Header buttons refreshed: grey ⚙, cosmic purple ✨, cooler blue ?
- Support options: desktop Buy Me a Coffee widget; mobile/tablet floating ☕ FAB; footer Support link
- Footer anchored to bottom across devices; safe‑area aware
- Textarea made non‑resizable to protect layout

Docs & security
- README/FAQ updated for the new prompt builder and support info
- CSP updated to allow BMC widget domains and inline styles required by the widget

Notes
- On mobile and tablets the widget is hidden in favor of a native FAB
- If an ad blocker hides the widget on desktop, the Support FAB may appear as fallback
EZ Quiz Web v1.1.1
===================

Release date: 2025-08-29

Fixes & polish
- Modals: stabilized visibility and CSS parsing so Settings/FAQ open reliably
- FAQ: updated AI section to prioritize the ✨ Prompt Builder; manual prompt moved to an advanced section
- Menu: textarea placeholder now reads “Paste text or load file here...”
- Support FAB: removed transform on hover/active to prevent position jump on mobile; subtle brightness feedback only
- Button colors: replaced color-mix fallbacks for broader browser support (grey ⚙, blue ?, purple ✨ retained)
- Tip/Ready: compact, wrapped row under the textarea; button row spacing adjusted
EZ Quiz Web v1.1.2
===================

Release date: 2025-08-29

PWA cache bump
- Service worker cache version bumped to v48 to force fresh assets
- Offline navigation fallback now resolves index.html relative to SW scope for robust subpath hosting

Versioned assets
- index.html now references `style.css?v=1.1.3` and `app.js?v=1.1.3` to bypass long-lived CDN/browser caches
- SW fetch handler serves versioned .css/.js from cached base files when offline
EZ Quiz Web v1.2.0-beta.1
==========================

Release date: 2025-09-07

Highlights
- Clean default face: inline Topic, Length, Difficulty with responsive layout.
- Options hub: new drop-down with Timer, Theme, Question Types, and Save default.
- Quiz Editor only when you want it: disclosure row with caret, ARIA + keyboard friendly, ESC to close.
  - Editor + Mirror: 66/34 side-by-side with shared headers and balanced heights; stacks under 768px.
  - Smarter generation: types and difficulty flow through to API; providers instructed to use only selected types.
  - Support: always-visible Support button; Buy Me a Coffee banner after 1st and every 4th completion; async load; ESC to dismiss; persistent suppression after click.
  - Settings: “Always show advanced options” and “Reset support prompts”; Beta indicator at the bottom.

Notes
- Banner cadence does not show again once clicked on that device (can be reset in Settings).
- Question Types currently constrain generation; they do not filter manually pasted lines.
- CSP allows buymeacoffee widget/script domains; widget loads only when needed.

EZ Quiz Web v1.2.0-beta.4
==========================

Release date: 2025-09-11

Fixes & improvements
- Retake behavior: Main “Retake” always restarts the full quiz, regardless of whether “Missed” or “All” is selected in Results.
- Missed-only option: “Take missed quiz” (under the Retake caret) continues to run only the missed questions from the last attempt.
- Original set preserved: The original question set is stored when a quiz is parsed; full retakes restore from this source even after taking a missed-only run.
- Footer link: The version label is now clickable and links to the full CHANGELOG for quick tester review.
- Offline update: Service worker cache bumped to v58 to pick up the latest JS changes offline.

Tester tips
- To retake the full quiz, click “Retake”. To retake only missed questions, use the caret next to Retake and choose “Take missed quiz”.
- If you previously ran “missed-only”, “Retake” will still restore and run the complete original set.

EZ Quiz Web v1.5.0-beta.9
==========================

Release date: 2025-09-26

Highlights
- Resilient AI calls: client now cycles through `/.netlify/functions/generate-quiz`, `/api/generate`, and the Netlify hosts (`https://ez-quiz.netlify.app`, `https://eq-quiz.netlify.app`) so Start/Generate survive missing rewrites or external proxies.
- Cache bust: Asset query strings bumped to v1.5.17 with service worker cache v125 to guarantee the new fallback ships instantly.
- Security: CSP `connect-src` now whitelists the Netlify hosts (including `https://ez-quiz.netlify.app`) so browser policies allow the fallback calls.
- Gemini update: default backend model is now `gemini-2.5-flash-lite-preview-09-2025`; override `GEMINI_MODEL` only if you have access to a different version.
- Reminder: All UI polish from beta.7 (softened surfaces, roomy toolbar, consistent spacing) remains in place.

Notes
- Still seeing the old build? Refresh with `?clear=1` or use Settings → Reset App to clear cached assets/service workers.

EZ Quiz Web v1.5.0-beta.8
==========================

Release date: 2025-09-26

Highlights
- Hotfix: Start/Generate now target `/.netlify/functions/generate-quiz` first, sidestepping missing `/api/generate` rewrites in production.
- Cache bust: Asset query strings bumped to v1.5.13 and service worker cache advanced to v122 so the fix reaches every client instantly.
- Reminder: All UI polish from beta.7 (softened surfaces, roomy toolbar, consistent spacing) remains in place.

Notes
- If the app still feels stale, refresh with `?clear=1` or use Settings → Reset App to clear caches/service workers.

EZ Quiz Web v1.5.0-beta.7
==========================

Release date: 2025-09-25

Highlights
- Softer UI tokens: inputs, cards, and buttons now use subtle 1px borders with a calm blue-violet focus halo for accessible contrast without the neon glow.
- Generator breathing space: the toolbar switches to a roomy two-column layout on 430–720px screens, making wide phones like the Pixel 9 Pro XL feel less cramped.
- Consistent spacing: section labels, modal groups, and results chips share the same relaxed gaps and radius tokens for a tidier rhythm across the app.
- Cache bust: CSS/JS query strings bumped to v1.5.12 with service worker cache v121 so the polish ships immediately.

Notes
- If highlights still look heavy, refresh or use Settings → Reset App to clear older assets.

EZ Quiz Web v1.5.0-beta.6
==========================

Release date: 2025-09-24

Highlights
- Generator polish: browser autofill now keeps the Topic field styled with our dark fill, smoothed corners, and consistent focus border.
- Layout: footer reserve is handled with an `::after` spacer so the background stays on-brand even when FAB space is reserved.
- Interactive Editor: keyboard shortcut listener now ignores events without a `key` value, preventing console errors during load.
- Cache bust: CSS/JS query strings bumped to v1.5.11 with service worker cache v120 to ensure the fixes ship immediately.

Notes
- If you still see the pale autofill box or footer bar, hard refresh or use Settings → Reset App to clear older caches.

EZ Quiz Web v1.5.0-beta.5
==========================

Release date: 2025-09-17

Highlights
- Generator polish: inline steppers built into the Length field, a custom difficulty slider with aligned ticks, and rounded toolbar corners.
- Interactive Editor default: visual editor loads first with an Interactive/Manual pill toggle; question type buttons and dropdowns now spell out the full names.
- Quiz Editor layout: question type checkboxes shed chip styling, Debug/Mirror toggle sits to the right inside its pill, manual textarea stays hidden while IE mode is active.
- Options vs Settings: theme choices live strictly in the Settings modal, Options focuses on timer/types/count defaults, and the Quiz Behavior section moved out.
- Prompt guidance: AI prompt now clarifies the Very Easy → Expert scale for providers.
- Cache bust: CSS/JS query strings bumped to v1.5.10 so the refreshed UI ships immediately to clients.

Notes
- Manual editor content still syncs with the Interactive Editor when you switch modes.
- Use Settings → Reset App or the `?clear=1` URL param if assets ever feel stale.
