# Security policy

## Scope and support

EZ Quiz 4.0 adds a local standalone path. The latest main remains the development baseline; the public mirror may lag. This is a preservation project with best-effort maintenance, not a guaranteed response-time or perpetual-update service.

## Standalone boundaries

- Only 127.0.0.1 is bound; the exact Host is checked to resist DNS rebinding.
- API writes require a same-origin JSON request and a random per-process token. No CORS allow headers are sent.
- Only public/ files are served, with path and realpath checks. Repository files and environment secrets are outside that root.
- CSP restricts browser connections to the local origin; code and assets are local. No remote donation image is loaded.
- The Node launcher contacts only fixed Gemini/OpenAI HTTPS API endpoints. Provider redirects are rejected.
- Provider keys are per-request, never process-global environment variables. Errors do not echo provider bodies, headers, URLs, or thrown messages that may contain keys.
- Request bodies, source text, file sizes, DOCX expansion, concurrency, and provider time are bounded.
- The service worker caches known static assets only. API responses, including local session tokens, are excluded.

## What these controls do not promise

Remember on this device stores a readable key in browser localStorage. It is opt-in and is not an encrypted credential vault. Same-origin script, sufficiently privileged extensions, a modified application, malware, or access to the browser profile may expose it.

Forgetting a key does not revoke it upstream or recall a request already sent. Stopping generation does not guarantee that the provider stops billing work already accepted. Provider policies govern remote retention. Model output is untrusted text, not authoritative study material.

Local-only operation does not cover the separate ChatGPT plugin or historical Netlify functions. Those remain in the repository for the existing integration and have separate hosting, logging, job storage, and provider configurations.

## Reporting

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/seanyates76/Ez-Quiz-App/security/advisories/new), or email ez.quizapp@gmail.com with subject “EZ Quiz security.”

Include affected version, a minimal reproduction, and the concrete exposure. Do not include real API keys, private quiz material, or sensitive personal data. Avoid public disclosure before coordination, destructive tests, denial-of-service traffic, and excessive requests.

The repository's development dependencies are not required to run the standalone launcher; npm ci installs testing and legacy hosting tools. Report reachable exposures rather than only an advisory count.
