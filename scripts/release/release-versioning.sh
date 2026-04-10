#!/usr/bin/env bash
set -euo pipefail

release_semver_tag_pattern='^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$'
release_upstream_repository_default='https://github.com/Gruntfuggly/todo-tree.git'
release_upstream_branch_default='master'
release_upstream_ref_default='refs/remotes/release-upstream/master'

release_semver_tags_array()
{
  local output_name="$1"
  local -n output_ref="$output_name"
  local tag=''

  output_ref=()

  while read -r tag; do
    if [[ "$tag" =~ $release_semver_tag_pattern ]]; then
      output_ref+=( "$tag" )
    fi
  done < <(git tag --sort=-v:refname)
}

release_semver_tags()
{
  local tags=()
  local tag=''

  release_semver_tags_array tags

  for tag in "${tags[@]}"; do
    printf '%s\n' "$tag"
  done
}

latest_release_tag()
{
  local tags=()
  release_semver_tags_array tags

  if [[ "${#tags[@]}" -gt 0 ]]; then
    printf '%s\n' "${tags[0]}"
  fi
}

previous_release_tag()
{
  local current_tag="$1"
  local seen_current=0
  local tags=()
  local tag=''

  release_semver_tags_array tags

  for tag in "${tags[@]}"; do
    if [[ "$current_tag" == "latest" ]]; then
      printf '%s\n' "$tag"
      return 0
    fi

    if [[ "$seen_current" -eq 1 ]]; then
      printf '%s\n' "$tag"
      return 0
    fi

    if [[ "$tag" == "$current_tag" ]]; then
      seen_current=1
    fi
  done
}

increment_release_version()
{
  local version="$1"
  local bump="${2:-patch}"
  local major
  local minor
  local patch

  IFS='.' read -r major minor patch <<<"$version"

  case "$bump" in
    patch)
      patch=$((patch + 1))
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    *)
      echo "Unsupported bump type '$bump'. Use patch, minor, or major." >&2
      return 1
      ;;
  esac

  printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

resolve_release_upstream_ref()
{
  local configured_ref="${RELEASE_UPSTREAM_REF:-}"
  local upstream_branch="${RELEASE_UPSTREAM_BRANCH:-$release_upstream_branch_default}"
  local upstream_ref="$release_upstream_ref_default"
  local upstream_repository="${RELEASE_UPSTREAM_REPOSITORY:-$release_upstream_repository_default}"

  if [[ -n "$configured_ref" ]]; then
    git rev-parse --verify "$configured_ref" >/dev/null 2>&1
    printf '%s\n' "$configured_ref"
    return 0
  fi

  if git rev-parse --verify "refs/remotes/upstream/${upstream_branch}" >/dev/null 2>&1; then
    printf 'refs/remotes/upstream/%s\n' "$upstream_branch"
    return 0
  fi

  git fetch --no-tags "$upstream_repository" "${upstream_branch}:${upstream_ref}" >/dev/null 2>&1
  git rev-parse --verify "$upstream_ref" >/dev/null 2>&1
  printf '%s\n' "$upstream_ref"
}

release_fork_point()
{
  local target_ref="${1:-HEAD}"
  local upstream_ref

  upstream_ref="$(resolve_release_upstream_ref)"
  git merge-base "$target_ref" "$upstream_ref"
}

release_repository_url()
{
  local remote_url

  if [[ -n "${RELEASE_REPOSITORY_URL:-}" ]]; then
    printf '%s\n' "${RELEASE_REPOSITORY_URL%/}"
    return 0
  fi

  remote_url="$(git config --get remote.origin.url)"

  if [[ "$remote_url" =~ ^https?:// ]]; then
    printf '%s\n' "${remote_url%.git}"
    return 0
  fi

  if [[ "$remote_url" =~ ^git@([^:]+):(.+)$ ]]; then
    printf 'https://%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]%.git}"
    return 0
  fi

  if [[ "$remote_url" =~ ^ssh://git@([^/]+)/(.+)$ ]]; then
    printf 'https://%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]%.git}"
    return 0
  fi

  echo "Unsupported remote.origin.url '$remote_url'." >&2
  return 1
}
