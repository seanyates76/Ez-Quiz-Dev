# Beta Route Documentation

## Overview

The `/beta` edge route grants temporary access to experimental endpoints by setting a feature-flag cookie (`FEATURE_FLAGS=beta`). The cookie lasts for 24 hours and allows server code to detect beta status. Append `?off=1` to clear the flag.

Study-material import and Results explanations have been promoted into the production-facing flow. Do not require the beta cookie for those features.

## Flow Summary

1. **Opt-in** — Visiting `/beta` serves the app with `FEATURE_FLAGS=beta; Max-Age=86400; SameSite=Lax`.
2. **Opt-out** — Visiting `/beta?off=1` clears the cookie via `Max-Age=0`.
3. **Client flags** — `public/js/flags.js` merges the cookie with `EZQ_FLAGS` in `localStorage` for lightweight feature checks (`has('beta')`).
4. **Server guard** — `netlify/functions/lib/betaGuard.js` inspects the cookie (or `x-ezq-beta: 1` header in dev/CI) to allow/deny endpoints that are still beta-only.

## Netlify Configuration

```toml
[edge_functions]
directory = "netlify/edge-functions"

[[edge_functions]]
function = "beta"
path = "/beta"

[[redirects]]
from = "/api/mcp"
to = "/.netlify/functions/mcp"
status = 200
force = true
```

## Client Integration

- Import `has` from `./js/flags.js` only for features that are still beta-only.
- Optional power-user toggle can call `setFlag('beta', true/false)`; this only affects local flags, not the cookie.
- Keep beta UI accessible and fail-safe if the cookie expires mid-session.
- Do not hide promoted production features behind `beta-only` classes.

## Server Integration

```js
import { requireBeta, betaForbiddenResponse } from './lib/betaGuard.js';

if (!requireBeta(request)) {
  return betaForbiddenResponse();
}
```

Add the guard to Netlify Functions that should be beta-only (e.g., MCP, experimental APIs). The helper returns a `403` JSON response with guidance for opt-in.

## Local Development

- Run `netlify dev` to exercise Functions/Edge locally.
- Call `http://localhost:8888/api/mcp` with `-H 'x-ezq-beta: 1'` to simulate beta access without cookies.
- Visit `http://localhost:8888/beta` to set the cookie in the dev server.

## MCP (beta)

- **Endpoint:** `POST /api/mcp` → proxied to `/.netlify/functions/mcp`.
- **Opt in:** Visit `/beta` (cookie) or add `x-ezq-beta: 1` header in dev/CI.
- **Opt out:** `/beta?off=1` clears the cookie and later requests return `403` until re-enabled.

## Results Explanations

- Explain buttons are production-facing.
- The explainer endpoint remains rate-limited and uses generic provider-failure copy for user-facing errors.

## Media Import

- Media import posts to `/.netlify/functions/ingest-media`. The endpoint extracts text from PDFs/images through the configured provider, then the UI uses that source text for quiz generation.
- Text-like imports are handled deterministically when possible; binary PDF/image extraction still uses the configured provider path.

## Troubleshooting

- If a beta-only endpoint such as MCP keeps returning `403`, confirm the cookie exists and is not blocked.
- Ensure CSP `connect-src` includes your own origin (the default config already allows `self`).
- Clear site data or visit `/beta?off=1` if testing multiple states quickly.
