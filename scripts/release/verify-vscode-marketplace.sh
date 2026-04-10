#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${RELEASE_TAG:?RELEASE_TAG must be set.}"

runner_temp="${RUNNER_TEMP:-$(mktemp -d)}"
cleanup_runner_temp=0

if [[ -z "${RUNNER_TEMP:-}" ]]; then
  cleanup_runner_temp=1
fi

if [[ "$cleanup_runner_temp" -eq 1 ]]; then
  trap 'rm -rf "$runner_temp"' EXIT
fi

expected_changelog="${EXPECTED_CHANGELOG_FILE:-$runner_temp/expected-marketplace-changelog.md}"
python_args=(
  --tag "$RELEASE_TAG"
  --package-json package.json
  --targets scripts/release/targets.json
  --expected-changelog "$expected_changelog"
  --interval-seconds "${MARKETPLACE_VERIFY_INTERVAL_SECONDS:-15}"
  --timeout-seconds "${MARKETPLACE_VERIFY_TIMEOUT_SECONDS:-600}"
)

bash "$script_dir/render-marketplace-changelog.sh" \
  --through-tag "$RELEASE_TAG" \
  --output "$expected_changelog"

if [[ -n "${MARKETPLACE_QUERY_URL:-}" ]]; then
  python_args+=( --query-url "$MARKETPLACE_QUERY_URL" )
fi

python3 "$script_dir/verify-vscode-marketplace.py" "${python_args[@]}"
