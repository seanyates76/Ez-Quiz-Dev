# Beta Route Documentation

## Overview

The `/beta` edge route grants temporary access to beta-only features by setting a feature-flag cookie (`FEATURE_FLAGS=beta`). The cookie lasts for 24 hours and applies across the app, allowing both client and server code to detect beta status. Append `?off=1` to clear the flag.

## Flow Summary

1. **Opt-in** — Visiting `/beta` issues a `302` redirect back to `/` and sets `FEATURE_FLAGS=beta; Max-Age=86400; SameSite=Lax`.
2. **Opt-out** — Visiting `/beta?off=1` clears the cookie via `Max-Age=0` and redirects home.
3. **Client flags** — `public/js/flags.js` merges the cookie with `EZQ_FLAGS` in `localStorage` for lightweight feature checks (`has('beta')`).
4. **Server guard** — `netlify/functions/lib/betaGuard.js` inspects the cookie (or `x-ezq-beta: 1` header in local dev) to allow/deny beta endpoints.

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

- Import `has` from `./js/flags.js` to toggle beta UI affordances.
- Optional power-user toggle can call `setFlag('beta', true/false)`; this only affects local flags, not the cookie.
- Keep beta UI accessible and fail-safe if the cookie expires mid-session.

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
- **Opt out:** `/beta?off=1` clears the cookie and future requests return `403` until re-enabled.

## Explain (beta)

- In beta builds, Explain buttons show a small localized toast near the result item.
- Full explanation plumbing (server + UI) remains experimental and may change. Non‑beta builds do not make any explanation network calls.

## Media Import (beta)

- Media import posts to `/.netlify/functions/ingest-media`. If the function is not deployed or disabled, the UI shows friendly hints (403/404/501).
- Enable via Settings → Beta features or visit `/beta` to set the cookie.

## Troubleshooting

- If the browser keeps returning `403`, confirm the cookie exists and is not blocked.
- Ensure CSP `connect-src` includes your own origin (the default config already allows `self`).
- Clear site data or visit `/beta?off=1` if testing multiple states quickly.
