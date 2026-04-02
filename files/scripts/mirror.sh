#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR/../.." rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PUBLIC_GH_SSH="${PUBLIC_GH_SSH:-git@github.com:seanyates76/Ez-Quiz-App.git}"
PUB_DIR_INPUT="${PUB_DIR:-.mirror-push}"
case "$PUB_DIR_INPUT" in
  /*)
    PUB_DIR="$PUB_DIR_INPUT"
    ;;
  *)
    PUB_DIR="$REPO_ROOT/$PUB_DIR_INPUT"
    ;;
esac

# 1) Build a clean export of the current tree
rm -rf "$PUB_DIR"
mkdir -p "$PUB_DIR"
git archive --format=tar HEAD | tar -x -C "$PUB_DIR"

# 2) Optional: remove private-only paths from the export
# Uncomment to exclude private stuff from the mirror
# rm -rf "$PUB_DIR/ops" "$PUB_DIR/notes" "$PUB_DIR/.github/ISSUE_TEMPLATE/internal"

# 2b) Keep workflow export explicit. The repo excludes all workflows from the
# public mirror by default; copy back only the public-safe shared ones.
rm -rf "$PUB_DIR/.github/workflows"
while IFS= read -r workflow_path; do
  mkdir -p "$PUB_DIR/$(dirname "$workflow_path")"
  cp "$workflow_path" "$PUB_DIR/$workflow_path"
done < <("$SCRIPT_DIR/public-workflows.sh" "$REPO_ROOT")

# 3) Initialize mirror repo and push force to main
pushd "$PUB_DIR" >/dev/null
git init
git remote add origin "$PUBLIC_GH_SSH"
git add .
git commit -m "Sync from private repo"
git branch -M main
git push -f origin main
popd >/dev/null

# 4) Push tags from private to public
# Create a temp remote that points to the public repo and push tags
if git ls-remote --tags "$PUBLIC_GH_SSH" >/dev/null 2>&1; then
  git remote remove public 2>/dev/null || true
  git remote add public "$PUBLIC_GH_SSH"
  git push --tags public
fi

echo "Mirror completed."