#!/usr/bin/env bash
set -euo pipefail
PUBLIC_GH_SSH="${PUBLIC_GH_SSH:-git@github.com:seanyates76/Ez-Quiz-App.git}"
PUB_DIR="${PUB_DIR:-.mirror-push}"
# Push the export to a dedicated mirror branch on the public repo so we don't
# blast its default branch. Override by exporting `MIRROR_BRANCH`.
MIRROR_BRANCH="${MIRROR_BRANCH:-mirror/main}"

# 1) Build a clean export of the current tree
rm -rf "$PUB_DIR"
mkdir -p "$PUB_DIR"
git archive --format=tar HEAD | tar -x -C "$PUB_DIR"

# 2) Optional: remove private-only paths from the export
# Uncomment to exclude private stuff from the mirror
# rm -rf "$PUB_DIR/ops" "$PUB_DIR/notes" "$PUB_DIR/.github/ISSUE_TEMPLATE/internal"

# 3) Initialize mirror repo and push force to main
pushd "$PUB_DIR" >/dev/null
git init
git remote add origin "$PUBLIC_GH_SSH"
git add .
git commit -m "Sync from private repo"
git branch -M main
echo "Pushing mirror export to ${MIRROR_BRANCH} on ${PUBLIC_GH_SSH}"
git push -f origin "main:${MIRROR_BRANCH}"
popd >/dev/null

# 4) Push tags from private to public
# Create a temp remote that points to the public repo and push tags
if git ls-remote --tags "$PUBLIC_GH_SSH" >/dev/null 2>&1; then
  git remote remove public 2>/dev/null || true
  git remote add public "$PUBLIC_GH_SSH"
  git push --tags public
fi

echo "Mirror completed."