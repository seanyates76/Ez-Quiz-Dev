# Product hardening follow-ups — 2026-05-14

This pass handled safe synchronous fixes only. Larger work should be deliberate:

- Source model: split short topic, pasted notes/source material, imported source, and manual quiz lines into explicit modes instead of overloading the topic field and hidden editor.
- 50-question reliability: current sync flow now uses smaller batches, but true reliability needs async/job-style generation with progress, partial results, retry/backfill, and resume.
- Reset/New Quiz UX: rename and copy are improved, but the active-quiz state should eventually lock or gate source controls so changes clearly create a new quiz draft.
- Info/landing panel: fake window controls were removed; a future pass can make the panel dismissible or preference-backed if it still occupies too much space.
- DOCX import: deterministic extraction reads `word/document.xml`; richer Word features such as comments, footnotes, tables, and embedded images remain out of scope.
