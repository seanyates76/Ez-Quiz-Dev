# EZ-Quiz DB Notes

Env
- `DATABASE_URL` must be set in Netlify (Neon connection string).

Local migrations
- Export `DATABASE_URL`, then run:
  - `bash scripts/setup-db.sh`

Endpoints
- POST `/.netlify/functions/save-quiz`
  - Body: `{ title, questions: [...], answers: [...] }`
  - Returns: `{ ok, id, path }` where `path` is `/q/:id`
- GET `/.netlify/functions/get-quiz?id=:id`
  - Redirected from `/q/:id` via `netlify.toml`

Security
- Answers never returned by GET.
- Body size limited to ~200KB.
- Add auth or rate limiting later if needed.

