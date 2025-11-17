#!/usr/bin/env bash
set -euo pipefail

# Sync Ez-Quiz-App (public) main back into this repo.
# Usage:
#   files/scripts/pull-public.sh
# Environment overrides:
#   PUBLIC_GH_URL   Remote to clone (default https://github.com/seanyates76/Ez-Quiz-App.git)
#   PUBLIC_BRANCH   Branch to sync (default main)
#   PULL_DIR        Temp directory to clone into (default .mirror-pull)
#   CLEAN_SYNC      When "true", delete files missing from the public export
#   PUBLIC_IGNORE   Pattern file to protect private-only paths (default .publicignore)

PUBLIC_GH_URL="${PUBLIC_GH_URL:-https://github.com/seanyates76/Ez-Quiz-App.git}"
PUBLIC_BRANCH="${PUBLIC_BRANCH:-main}"
PULL_DIR="${PULL_DIR:-.mirror-pull}"
CLEAN_SYNC="${CLEAN_SYNC:-false}"
PUBLIC_IGNORE="${PUBLIC_IGNORE:-.publicignore}"

if [ ! -d .git ]; then
  echo "Run this script from the repository root." >&2
  exit 1
fi

rm -rf "$PULL_DIR"
git clone --depth=1 --branch "$PUBLIC_BRANCH" "$PUBLIC_GH_URL" "$PULL_DIR"

RSYNC_ARGS=(-a)
if [ "$CLEAN_SYNC" = "true" ]; then
  RSYNC_ARGS+=("--delete")
fi

# Always protect git metadata.
RSYNC_ARGS+=("--exclude=.git/")

# Keep private-only paths intact (mirrors .publicignore by default).
if [ -f "$PUBLIC_IGNORE" ]; then
  while IFS= read -r pattern; do
    RSYNC_ARGS+=("--exclude=$pattern")
  done < <(awk '!/^[[:space:]]*(#|$)/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); print }' "$PUBLIC_IGNORE")
fi

rsync "${RSYNC_ARGS[@]}" "$PULL_DIR"/ ./

rm -rf "$PULL_DIR"

echo "Public branch '$PUBLIC_BRANCH' pulled into the working tree."
