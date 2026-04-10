#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-versioning.sh
source "$script_dir/release-versioning.sh"

channel='stable'
release_tag=''
target_ref=''
target_branch=''
output_file=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      channel="$2"
      shift 2
      ;;
    --tag)
      release_tag="$2"
      shift 2
      ;;
    --target)
      target_ref="$2"
      shift 2
      ;;
    --target-branch)
      target_branch="$2"
      shift 2
      ;;
    --output)
      output_file="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument '$1'." >&2
      exit 1
      ;;
  esac
done

if [[ -z "$release_tag" ]]; then
  echo "A release tag or channel label is required." >&2
  exit 1
fi

if [[ -z "$target_ref" ]]; then
  target_ref="$release_tag"
fi

if [[ -z "$output_file" ]]; then
  echo "An output file is required." >&2
  exit 1
fi

target_sha="$(git rev-parse "$target_ref")"
previous_tag="$(previous_release_tag "$release_tag" || true)"
history_base=''
history_base_label=''
mkdir -p "$(dirname "$output_file")"

if [[ -n "$previous_tag" ]]; then
  history_base="$previous_tag"
  history_base_label="previous release"
else
  history_base="$(release_fork_point "$target_sha")"
  history_base_label='fork point'
fi

if [[ -n "$history_base" ]]; then
  mapfile -t commits < <(git log --reverse --format='%h%x09%s' "${history_base}..${target_sha}")
else
  mapfile -t commits < <(git log --reverse --format='%h%x09%s' "${target_sha}")
fi

{
  if [[ "$channel" == 'latest' ]]; then
    echo "# Better Todo Tree latest"
    echo
    if [[ -n "$target_branch" ]]; then
      echo "- branch: \`$target_branch\`"
    fi
    echo "- target commit: \`$target_sha\`"
    if [[ -n "$previous_tag" ]]; then
      echo "- base stable release: \`$previous_tag\`"
    else
      echo "- base stable release: none"
      echo "- fork point: \`$history_base\`"
    fi
    echo
    if [[ -n "$previous_tag" ]]; then
      echo "## Included commits since \`$previous_tag\`"
    elif [[ -n "$history_base" ]]; then
      echo "## Included commits since fork point"
    else
      echo "## Included commits"
    fi
  else
    echo "# Better Todo Tree ${release_tag#v}"
    echo
    echo "- release tag: \`$release_tag\`"
    echo "- target commit: \`$target_sha\`"
    if [[ -n "$previous_tag" ]]; then
      echo "- previous release: \`$previous_tag\`"
    else
      echo "- previous release: none"
      echo "- fork point: \`$history_base\`"
    fi
    echo
    if [[ -n "$previous_tag" ]]; then
      echo "## Included commits"
    elif [[ -n "$history_base" ]]; then
      echo "## Included commits since fork point"
    else
      echo "## Included commits"
    fi
  fi
  echo

  if [[ ${#commits[@]} -eq 0 ]]; then
    echo "- No commits beyond the previous release boundary."
  else
    for commit in "${commits[@]}"; do
      IFS=$'\t' read -r short_sha subject <<<"$commit"
      printf -- '- `%s` %s\n' "$short_sha" "$subject"
    done
  fi
} > "$output_file"
