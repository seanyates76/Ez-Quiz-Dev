# Security policy

## Scope and support

EZ Quiz 4.0 adds a local standalone path. The latest main remains the development baseline; the public mirror may lag. This is a preservation project with best-effort maintenance, not a guaranteed response-time or perpetual-update service.

## Standalone boundaries

- Only 127.0.0.1 is bound; the exact Host is checked to resist DNS rebinding.
- API writes require a same-origin JSON request and a random per-process token. No CORS allow headers are sent.
- Only public/ files are served, with path and realpath checks. Repository files and environment secrets are outside that root.
- CSP restricts browser connections to the local origin; code and assets are local. No remote donation image is loaded.
- The Node launcher contacts only fixed Gemini/OpenAI HTTPS API endpoints. Provider redirects are rejected.
- The browser saves keys in localStorage by default. Users can uncheck Remember key for tab-memory-only use or remove the saved key with Forget key.
- Provider keys are per-request, never process-global environment variables. Errors do not echo provider bodies, headers, URLs, or thrown messages that may contain keys.
- Request bodies, source text, file sizes, DOCX expansion, concurrency, and provider time are bounded.
- The service worker caches known static assets only. API responses, including local session tokens, are excluded.

## Hosted preview AI

The web preview also accepts user-supplied Gemini/OpenAI keys without a passphrase. Remember key is checked by default and stores the key in that browser's localStorage; Forget key removes it. Hosted requests pass through the same-origin standalone-ai Netlify function to the fixed provider endpoints. The function uses the key supplied with that request, or the server-only shared OpenAI key on Preview #84, does not log or persist its body, redacts provider errors, and returns no-store responses. The local launcher's Host/Origin/token boundary is unchanged; hosted requests instead require same-origin HTTPS JSON and have a 25-second provider deadline.

Shared preview access reads `ezq_bmok_shared` from the function runtime only. The function accepts shared-key requests only on `deploy-preview-84--ez-quiz.netlify.app`, the exact hostname Netlify routes to Preview #84. Production, branch deploys, and other PR previews cannot use this key. `/api/connection` exposes only availability, provider, and model. Visitors never receive or store the shared key.

## What these controls do not promise

Browser localStorage is not an encrypted credential vault. Same-origin scripts, sufficiently privileged extensions, and anyone with access to the browser profile may access saved keys. Forget key removes the saved key and clears this tab; other open tabs may retain their in-memory copy.

Forgetting a key does not revoke it upstream or recall a request already sent. Stopping generation does not guarantee that the provider stops billing work already accepted. Provider policies govern remote retention. Model output is untrusted text, not authoritative study material.

Local-only operation does not cover the separate ChatGPT plugin or historical Netlify functions. Those remain in the repository for the existing integration and have separate hosting, logging, job storage, and provider configurations.

## Reporting

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/seanyates76/Ez-Quiz-App/security/advisories/new), or email ez.quizapp@gmail.com with subject “EZ Quiz security.”

Include affected version, a minimal reproduction, and the concrete exposure. Do not include real API keys, private quiz material, or sensitive personal data. Avoid public disclosure before coordination, destructive tests, denial-of-service traffic, and excessive requests.

The repository's development dependencies are not required to run the standalone launcher; npm ci installs testing and legacy hosting tools. Report reachable exposures rather than only an advisory count.
