#!/usr/bin/env bash
set -euo pipefail

release_artifact_files()
{
  local artifacts_dir="${1:-artifacts/release}"
  local -a files

  if [[ ! -d "$artifacts_dir" ]]; then
    echo "Release artifact directory '$artifacts_dir' was not found." >&2
    return 1
  fi

  mapfile -t files < <(find "$artifacts_dir" -maxdepth 1 -type f -name '*.vsix' | LC_ALL=C sort)
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "No VSIX artifacts were found in '$artifacts_dir'." >&2
    return 1
  fi

  printf '%s\n' "${files[@]}"
}
