#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-artifacts.sh
source "$script_dir/release-artifacts.sh"

: "${OVSX_PAT:?OVSX_PAT must be set.}"

retry_interval_seconds="${OPEN_VSX_RETRY_INTERVAL_SECONDS:-300}"
max_wait_seconds="${OPEN_VSX_MAX_WAIT_SECONDS:-0}"
retryable_exit_code=75

require_non_negative_integer()
{
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "$name must be a non-negative integer." >&2
    exit 1
  fi
}

require_positive_integer()
{
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "$name must be a positive integer." >&2
    exit 1
  fi
}

is_open_vsx_retryable_output()
{
  local output_file="$1"

  LC_ALL=C grep -Eiq \
    'registry is in read-only mode|read-only mode|read only mode|status (408|425|429|500|502|503|504)|Service Unavailable|Bad Gateway|Gateway Timeout|Too Many Requests|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ENETUNREACH|socket hang up|network timeout|request timed out' \
    "$output_file"
}

publish_package_once()
{
  local file="$1"
  local attempt="$2"
  local output_file=''
  local status=0
  local -a ovsx_args=(--no-install ovsx)

  if [[ -n "${OPEN_VSX_REGISTRY_URL:-}" ]]; then
    ovsx_args+=(--registryUrl "$OPEN_VSX_REGISTRY_URL")
  fi

  ovsx_args+=(publish --packagePath "$file" -p "$OVSX_PAT" --skip-duplicate)
  output_file="$(mktemp)"

  printf 'Open VSX publish attempt: package=%s attempt=%s\n' "$file" "$attempt"

  if npx "${ovsx_args[@]}" >"$output_file" 2>&1; then
    cat "$output_file"
    rm -f "$output_file"
    return 0
  else
    status="$?"
  fi

  cat "$output_file"

  if is_open_vsx_retryable_output "$output_file"; then
    rm -f "$output_file"
    return "$retryable_exit_code"
  fi

  rm -f "$output_file"
  return "$status"
}

publish_package_with_retry()
{
  local file="$1"
  local started_at=0
  local elapsed=0
  local attempt=1
  local status=0
  local sleep_seconds=0

  started_at="$(date +%s)"

  while true; do
    set +e
    publish_package_once "$file" "$attempt"
    status="$?"
    set -e

    if [[ "$status" -eq 0 ]]; then
      printf 'Open VSX publish succeeded: package=%s attempts=%s\n' "$file" "$attempt"
      return 0
    fi

    if [[ "$status" -ne "$retryable_exit_code" ]]; then
      echo "Open VSX publish failed: package=$file exit_code=$status" >&2
      return "$status"
    fi

    elapsed=$(( $(date +%s) - started_at ))
    if [[ "$max_wait_seconds" -gt 0 && "$elapsed" -ge "$max_wait_seconds" ]]; then
      echo "Open VSX publish remained retryable for ${elapsed}s: package=$file" >&2
      return 1
    fi

    sleep_seconds="$retry_interval_seconds"
    if [[ "$max_wait_seconds" -gt 0 && $(( elapsed + sleep_seconds )) -gt "$max_wait_seconds" ]]; then
      sleep_seconds=$(( max_wait_seconds - elapsed ))
    fi

    if [[ "$sleep_seconds" -le 0 ]]; then
      echo "Open VSX publish remained retryable for ${elapsed}s: package=$file" >&2
      return 1
    fi

    printf 'Open VSX publish retryable: package=%s attempt=%s elapsed_seconds=%s retry_in_seconds=%s\n' \
      "$file" "$attempt" "$elapsed" "$sleep_seconds"
    sleep "$sleep_seconds"
    attempt=$(( attempt + 1 ))
  done
}

require_positive_integer OPEN_VSX_RETRY_INTERVAL_SECONDS "$retry_interval_seconds"
require_non_negative_integer OPEN_VSX_MAX_WAIT_SECONDS "$max_wait_seconds"

mapfile -t files < <(release_artifact_files)

for file in "${files[@]}"; do
  publish_package_with_retry "$file"
done
