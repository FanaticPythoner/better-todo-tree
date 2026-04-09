#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-artifacts.sh
source "$script_dir/release-artifacts.sh"

mapfile -t files < <(release_artifact_files)

for file in "${files[@]}"; do
  npx --no-install ovsx publish --packagePath "$file" -p "$OVSX_PAT" --skip-duplicate
done
