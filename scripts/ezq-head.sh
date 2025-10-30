#!/usr/bin/env bash
set -euo pipefail

# Wrapper to run the local Head CLI from ezq-dev-tools
# Usage examples:
#   ./scripts/ezq-head.sh run quick
#   ./scripts/ezq-head.sh codex "Tighten toolbar gaps"
#   EZQ_DEV_TOOLS_DIR=/abs/path/to/ezq-dev-tools ./scripts/ezq-head.sh run quick

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export EZQ_APP_DIR="${EZQ_APP_DIR:-$REPO_ROOT}"

# Default dev tools directory beside this repo
DEFAULT_DEVTOOLS_DIR="$REPO_ROOT/../ezq-dev-tools"
DEVTOOLS_DIR="${EZQ_DEV_TOOLS_DIR:-$DEFAULT_DEVTOOLS_DIR}"
HEAD_BIN="$DEVTOOLS_DIR/bin/ezq-head"

if [[ ! -x "$HEAD_BIN" ]]; then
  echo "ezq-head not found at: $HEAD_BIN" >&2
  echo "Set EZQ_DEV_TOOLS_DIR or place ezq-dev-tools beside this repo." >&2
  echo "Current EZQ_DEV_TOOLS_DIR=\"$DEVTOOLS_DIR\"" >&2
  exit 127
fi

exec "$HEAD_BIN" "$@"
