#!/usr/bin/env bash
set -euo pipefail

release_semver_tag_pattern='^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$'

release_semver_tags()
{
  git tag --sort=-v:refname | while read -r tag; do
    if [[ "$tag" =~ $release_semver_tag_pattern ]]; then
      printf '%s\n' "$tag"
    fi
  done
}

latest_release_tag()
{
  local latest_tag=''

  while read -r tag; do
    latest_tag="$tag"
    break
  done < <(release_semver_tags)

  if [[ -n "$latest_tag" ]]; then
    printf '%s\n' "$latest_tag"
  fi
}

previous_release_tag()
{
  local current_tag="$1"
  local seen_current=0

  while read -r tag; do
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
  done < <(release_semver_tags)
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
