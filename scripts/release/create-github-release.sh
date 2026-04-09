#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-artifacts.sh
source "$script_dir/release-artifacts.sh"

mapfile -t files < <(release_artifact_files)

if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  gh release upload "$RELEASE_TAG" "${files[@]}" --clobber
  exit 0
fi

args=("$RELEASE_TAG" "${files[@]}" --generate-notes --verify-tag)
if [[ "$PRERELEASE" == "true" ]]; then
  args+=(--prerelease)
fi

gh release create "${args[@]}"
