#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-artifacts.sh
source "$script_dir/release-artifacts.sh"

: "${RELEASE_TAG:?RELEASE_TAG must be set.}"
: "${RELEASE_TITLE:?RELEASE_TITLE must be set.}"
: "${RELEASE_TARGET_SHA:?RELEASE_TARGET_SHA must be set.}"
: "${RELEASE_TARGET_BRANCH:?RELEASE_TARGET_BRANCH must be set.}"

release_notes_file="$(mktemp)"
trap 'rm -f "$release_notes_file"' EXIT

bash "$script_dir/write-release-notes.sh" \
  --channel latest \
  --tag "$RELEASE_TAG" \
  --target "$RELEASE_TARGET_SHA" \
  --target-branch "$RELEASE_TARGET_BRANCH" \
  --output "$release_notes_file"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git tag -f "$RELEASE_TAG" "$RELEASE_TARGET_SHA"
git push --force origin "refs/tags/$RELEASE_TAG"

mapfile -t files < <(release_artifact_files)

if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  gh release delete "$RELEASE_TAG" --yes
fi

gh release create \
  "$RELEASE_TAG" \
  "${files[@]}" \
  --title "$RELEASE_TITLE" \
  --notes-file "$release_notes_file" \
  --prerelease \
  --target "$RELEASE_TARGET_SHA"
