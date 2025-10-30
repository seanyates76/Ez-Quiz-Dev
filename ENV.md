Environment Configuration
=========================

Netlify Functions
-----------------

Required for feedback mailer:
- FEEDBACK_EMAIL: Gmail address used to send/receive feedback
- FEEDBACK_PASS: App password for the Gmail account (not your login password)

Optional security:
- ALLOWED_ORIGINS: Comma‑separated list of allowed origins for CORS, e.g.
  - `https://ez-quiz.app,https://staging.ez-quiz.app`
  - Leave empty to allow all origins (not recommended).
  - Applied to both quiz generation and feedback mailer functions.
- GENERATE_LIMIT: Per-IP request cap for `generate-quiz` (default `60`).
- GENERATE_WINDOW_MS: Sliding window size in milliseconds for the rate limiter (default `900000`, i.e. 15 minutes).
  - `Retry-After` responses are derived from this window; shorten it to offer quicker retries.
- GENERATE_BEARER_TOKEN: Optional shared secret required in the `Authorization: Bearer <token>` header for quiz generation.
  - Combine with Netlify redirects or an API gateway to keep the token private in zero-trust setups.

AI Generation providers (optional):
- AI_PROVIDER: `gemini`, `openai`, or `echo`
- GEMINI_API_KEY: Google Generative AI key
- GEMINI_MODEL: e.g. `gemini-2.5-flash-lite-preview-09-2025`
- OPENAI_API_KEY: OpenAI API key
- OPENAI_MODEL: e.g. `gpt-4o-mini`

Notes
- Update Netlify env vars under Site Settings → Environment.
- After changing env vars, trigger a redeploy.

Local Dev Tools
---------------
- EZQ_DEV_TOOLS_DIR: path to ezq-dev-tools (default: ../ezq-dev-tools)
- EZQ_APP_DIR: path to this repo when running tools (default: repo root)

Usage:
- `./scripts/ezq-head.sh run quick`
- `EZQ_DEV_TOOLS_DIR=/home/arch-bean/Projects/ezq-dev-tools ./scripts/ezq-head.sh run quick`
