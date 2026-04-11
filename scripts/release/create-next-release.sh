#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-versioning.sh
source "$script_dir/release-versioning.sh"
release_activate_node_runtime

bump='patch'
push_release=0

require_clean_worktree()
{
  local status_output

  status_output="$(git status --short)"
  if [[ -n "$status_output" ]]; then
    echo 'The working tree must be clean before creating a release.' >&2
    echo 'Commit or stash the pending changes first:' >&2
    printf '%s\n' "$status_output" >&2
    return 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --bump)
      bump="$2"
      shift 2
      ;;
    --push)
      push_release=1
      shift
      ;;
    *)
      echo "Unknown argument '$1'." >&2
      exit 1
      ;;
  esac
done

require_clean_worktree

latest_tag="$(latest_release_tag)"
if [[ -z "$latest_tag" ]]; then
  echo "No prior release tag was found." >&2
  exit 1
fi

latest_version="${latest_tag#v}"
next_version="$(increment_release_version "$latest_version" "$bump")"
next_tag="v${next_version}"

if git rev-parse "$next_tag" >/dev/null 2>&1; then
  echo "Tag '$next_tag' already exists." >&2
  exit 1
fi

node - "$next_version" <<'NODE'
const fs = require('fs');
const nextVersion = process.argv[2];
const files = [ 'package.json', 'package-lock.json' ];

for ( const file of files )
{
    if( !fs.existsSync( file ) )
    {
        continue;
    }

    const contents = JSON.parse( fs.readFileSync( file, 'utf8' ) );
    contents.version = nextVersion;

    if( contents.packages && contents.packages[ '' ] )
    {
        contents.packages[ '' ].version = nextVersion;
    }

    fs.writeFileSync( file, JSON.stringify( contents, null, 4 ) + '\n' );
}
NODE

git add package.json package-lock.json
git commit -m "release: ${next_tag}"
git tag -a "$next_tag" -m "Release ${next_tag}"

notes_file="artifacts/release-notes/${next_tag}.md"
bash "$script_dir/write-release-notes.sh" \
  --channel stable \
  --tag "$next_tag" \
  --target "$next_tag" \
  --output "$notes_file"

if [[ "$push_release" -eq 1 ]]; then
  git push origin master
  git push origin "$next_tag"
fi

printf 'Created %s from %s.\n' "$next_tag" "$latest_tag"
printf 'Release notes: %s\n' "$notes_file"
