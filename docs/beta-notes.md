# QUIZ_RESPONSE Branch Notes

This branch gates the structured quiz response pipeline behind the `QUIZ_RESPONSE` environment flag so we can validate v2 without affecting production.

## Enabling the flag

| Scenario            | Steps |
|---------------------|-------|
| **Netlify branch deploy** | Set `QUIZ_RESPONSE=v2` in the branch context. Example: `netlify env:set QUIZ_RESPONSE v2 --context=branch:mcp-implementation`. |
| **Local Netlify dev** | Run `QUIZ_RESPONSE=v2 netlify dev` (or add it to `.env`). |
| **One-off CLI call**  | Prefix the function invocation: `QUIZ_RESPONSE=v2 curl http://localhost:8888/.netlify/functions/generate-quiz`. |

Request structured output by adding `format=quiz-json` (query parameter, request body field, or `x-quiz-format` header). Without it, the function continues to emit legacy lines even when the environment flag is present.

The existing `/beta` edge route still sets the `FEATURE_FLAGS=beta` cookie for UI affordances, but the structured response path is controlled solely by the environment variable above.

## Legacy fallback (`format=legacy-lines`)

- `?format=legacy-lines` (or `x-quiz-format: legacy-lines`) forces the legacy payload. This remains the default when no explicit format is provided.
- `?format=quiz-json` (or `x-quiz-format: quiz-json`) returns both the structured `quiz` object and the legacy `title/lines` pair so current clients stay compatible.
- Prefer this when coordinating with consumers that have not yet adopted the JSON schema.
- Log `{ error, details, fallback: { tried: 'legacy' } }` with a `[quiz-v2][fallback]` prefix so we can audit usage.

## Release-prep checklist

1. Enable the flag only on the `mcp-implementation` branch context until QA signs off.
2. Shadow traffic: fetch both JSON and legacy formats and compare normalized results using `normalizeQuizV2`.
3. Monitor Netlify logs for `[quiz-v2]` warnings (validation failures, fallbacks, chunk exhaustion).
4. When ready to graduate, add `QUIZ_RESPONSE=v2` to production context and remove the branch override.
5. Update `AGENTS.md` and release notes to announce the schema once the beta flag is removed.

## Backout runbook

If the beta soak surfaces issues, take these steps to revert to the legacy behaviour:

1. **Unset the flag.** Remove the environment variable in every Netlify context where it was enabled:
   - Production: `netlify env:unset QUIZ_RESPONSE --context=production`
   - Branch deploys / previews: repeat the command for each affected context (e.g., `--context=branch:mcp-implementation`).
   - Local overrides: remove the entry from `.env` or stop prefixing commands with `QUIZ_RESPONSE=v2`.
2. **Redeploy** the site/functions so the change propagates (trigger a fresh build or use `netlify deploy --prod` as appropriate).
3. **Confirm legacy prompt usage.** With `QUIZ_RESPONSE` unset, the function automatically falls back to the original line-based prompt (`buildPrompt(...)`). Hit `/.netlify/functions/generate-quiz` and verify the response payload contains `title` + `lines` rather than the structured JSON.

## Roll-forward after soak

Once the beta window completes successfully, promote v2 to the default experience:

1. Set `QUIZ_RESPONSE=v2` in the production context: `netlify env:set QUIZ_RESPONSE v2 --context=production`.
2. Remove any temporary branch/preview overrides that forced the flag on/off to avoid drift.
3. Trigger a production deploy and smoke-test both the UI and the `/.netlify/functions/generate-quiz` endpoint to confirm structured responses are flowing.
4. Update external documentation (README/help copy) and notify support/ops that v2 is now the baseline.
