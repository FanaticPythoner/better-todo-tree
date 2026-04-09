#!/usr/bin/env bash
set -euo pipefail

if [[ "${REF_TYPE:-}" == "tag" ]]; then
  tag="${REF_NAME:-}"
else
  tag="${INPUT_TAG:-}"
fi

if [[ -z "$tag" ]]; then
  echo "A tag is required for manual releases." >&2
  exit 1
fi

if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "Tag '$tag' is not a supported release tag." >&2
  exit 1
fi

package_version="$(node -p "require('./package.json').version")"
if [[ "$tag" != "v${package_version}" ]]; then
  echo "Tag '$tag' does not match package.json version '${package_version}'." >&2
  exit 1
fi

git fetch --force --tags origin "refs/tags/${tag}:refs/tags/${tag}"
release_sha="$(git rev-list -n 1 "$tag")"

git fetch --no-tags --force origin master:refs/remotes/origin/master
git merge-base --is-ancestor "$release_sha" refs/remotes/origin/master

prerelease=false
if [[ "$tag" == *-* ]]; then
  prerelease=true
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "tag=$tag"
    echo "prerelease=$prerelease"
    echo "release_ref=$tag"
    echo "release_sha=$release_sha"
  } >> "$GITHUB_OUTPUT"
else
  printf 'tag=%s\n' "$tag"
  printf 'prerelease=%s\n' "$prerelease"
  printf 'release_ref=%s\n' "$tag"
  printf 'release_sha=%s\n' "$release_sha"
fi
