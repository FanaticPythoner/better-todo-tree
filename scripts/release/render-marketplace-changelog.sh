#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-versioning.sh
source "$script_dir/release-versioning.sh"

output_file='CHANGELOG.md'
through_tag=''
upstream_history_file='CHANGELOG.upstream.md'

ensure_release_tag_available()
{
  local requested_tag="$1"

  if git rev-parse --verify "refs/tags/$requested_tag" >/dev/null 2>&1; then
    return 0
  fi

  if git config --get remote.origin.url >/dev/null 2>&1; then
    git fetch --tags origin >/dev/null 2>&1
  fi

  git rev-parse --verify "refs/tags/$requested_tag" >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --through-tag)
      through_tag="$2"
      shift 2
      ;;
    --upstream-history)
      upstream_history_file="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument '$1'." >&2
      exit 1
      ;;
  esac
done

if [[ -z "$through_tag" ]]; then
  through_tag="$(latest_release_tag)"
fi

if [[ -z "$through_tag" ]]; then
  echo 'No release tags were found for Marketplace changelog rendering.' >&2
  exit 1
fi

if ! ensure_release_tag_available "$through_tag"; then
  echo "Release tag '$through_tag' was not found." >&2
  exit 1
fi

all_release_tags=()
release_semver_tags_array all_release_tags

include_tags=0
selected_tags=()

for tag in "${all_release_tags[@]}"; do
  if [[ "$tag" == "$through_tag" ]]; then
    include_tags=1
  fi

  if [[ "$include_tags" -eq 1 ]]; then
    selected_tags+=( "$tag" )
  fi
done

if [[ "${#selected_tags[@]}" -eq 0 ]]; then
  echo "Release tag '$through_tag' was not found." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$(dirname "$output_file")"

{
  echo '# Better Todo Tree Change Log'
  echo
  echo 'Stable release notes published to GitHub are mirrored here for Marketplace version history.'
  echo

  for tag in "${selected_tags[@]}"; do
    section_file="$tmp_dir/${tag}.md"
    release_date="$(git for-each-ref --format='%(creatordate:short)' "refs/tags/$tag")"

    bash "$script_dir/write-release-notes.sh" \
      --channel stable \
      --tag "$tag" \
      --target "$tag" \
      --output "$section_file"

    printf '## %s - %s\n' "$tag" "$release_date"
    echo
    tail -n +3 "$section_file"
    echo
  done

  if [[ -f "$upstream_history_file" ]]; then
    echo '## Upstream Todo Tree history'
    echo
    echo 'The entries below are preserved from the upstream Todo Tree changelog.'
    echo
    sed '1{/^# /d;};1{/^$/d;}' "$upstream_history_file"
  fi
} > "$output_file"
