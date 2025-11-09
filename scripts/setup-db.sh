#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL not set. Set it in Netlify or export it locally." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found; skipping migrations. Install PostgreSQL client to run locally." >&2
  exit 0
fi

psql "$DATABASE_URL" -f db/migrations/001_init.sql
echo "✅ migrations applied"

