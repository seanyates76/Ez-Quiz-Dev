#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:-$(git rev-parse --show-toplevel)}"
repo_root="$(cd "$repo_root" && pwd)"
publicworkflows_file="$repo_root/.publicworkflows"
workflows_root="$repo_root/.github/workflows"

if [ ! -f "$publicworkflows_file" ]; then
  echo "Missing .publicworkflows. Refusing to mirror workflows without an explicit allowlist." >&2
  exit 1
fi

if [ ! -d "$workflows_root" ]; then
  echo "Missing .github/workflows directory under repo root: $workflows_root" >&2
  exit 1
fi

found_any=false
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  workflow_path="$(printf '%s' "$raw_line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  case "$workflow_path" in
    ''|'#'*)
      continue
      ;;
  esac

  case "$workflow_path" in
    /*)
      echo "Shared public workflow entries must be repo-relative, not absolute: $workflow_path" >&2
      exit 1
      ;;
  esac

  workflow_path="${workflow_path#./}"

  case "$workflow_path" in
    *".."*)
      echo "Shared public workflow entries must not contain '..': $workflow_path" >&2
      exit 1
      ;;
    .github/workflows/*)
      ;;
    *)
      echo "Shared public workflow entries must stay under .github/workflows/: $workflow_path" >&2
      exit 1
      ;;
  esac

  source_path="$repo_root/$workflow_path"
  if [ ! -f "$source_path" ]; then
    echo "Shared public workflow '$workflow_path' is listed in .publicworkflows but missing." >&2
    exit 1
  fi

  resolved_source="$(realpath "$source_path")"
  case "$resolved_source" in
    "$workflows_root"/*)
      ;;
    *)
      echo "Resolved workflow path escapes .github/workflows/: $workflow_path -> $resolved_source" >&2
      exit 1
      ;;
  esac

  found_any=true
  printf '%s\n' "${resolved_source#$repo_root/}"
done < "$publicworkflows_file"

if [ "$found_any" != true ]; then
  echo ".publicworkflows must list at least one public-safe workflow. Refusing to mirror an implicit default." >&2
  exit 1
fi
