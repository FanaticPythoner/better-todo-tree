#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-artifacts.sh
source "$script_dir/release-artifacts.sh"

: "${RELEASE_TAG:?RELEASE_TAG must be set.}"

release_target_sha="${RELEASE_TARGET_SHA:-$(git rev-list -n 1 "$RELEASE_TAG")}"
release_notes_file="$(mktemp)"
trap 'rm -f "$release_notes_file"' EXIT

bash "$script_dir/write-release-notes.sh" \
  --channel stable \
  --tag "$RELEASE_TAG" \
  --target "$release_target_sha" \
  --output "$release_notes_file"

release_title="Better Todo Tree ${RELEASE_TAG#v}"

mapfile -t files < <(release_artifact_files)

if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  release_id="$(gh api "repos/{owner}/{repo}/releases/tags/$RELEASE_TAG" --jq '.id')"
  gh api \
    --method PATCH \
    "repos/{owner}/{repo}/releases/$release_id" \
    -f name="$release_title" \
    -F prerelease="$PRERELEASE" \
    -F body=@"$release_notes_file" \
    >/dev/null
  gh release upload "$RELEASE_TAG" "${files[@]}" --clobber
  exit 0
fi

args=("$RELEASE_TAG" "${files[@]}" --title "$release_title" --notes-file "$release_notes_file" --verify-tag)
if [[ "$PRERELEASE" == "true" ]]; then
  args+=(--prerelease)
fi

gh release create "${args[@]}"
