set shell := ["bash", "-euo", "pipefail", "-c"]

package_name := `sed -nE 's/^ *"name": *"([^"]+)".*/\1/p' package.json | head -n 1`
package_version := `sed -nE 's/^ *"version": *"([^"]+)".*/\1/p' package.json | head -n 1`
vsix_dir := "artifacts/vsix"
all_platforms := "win32-x64 win32-arm64 linux-x64 linux-arm64 linux-armhf darwin-x64 darwin-arm64 alpine-x64 alpine-arm64 web"

node_bootstrap := '''
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    . "$NVM_DIR/nvm.sh"
    nvm use --silent default >/dev/null 2>&1 || nvm use --silent >/dev/null 2>&1 || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  latest_nvm_node="$(find "$NVM_DIR/versions/node" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
  if [[ -n "$latest_nvm_node" ]]; then
    export PATH="$latest_nvm_node/bin:$PATH"
  fi
fi

command -v node >/dev/null 2>&1 || { echo "error: Node.js was not found in PATH or $NVM_DIR." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "error: npm was not found after activating Node.js." >&2; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "error: npx was not found after activating Node.js." >&2; exit 1; }
'''

default:
  @just --list --unsorted

setup:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}
  npm ci

test:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}
  npm test

build-ext *platforms:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}

  readonly package_name="{{package_name}}"
  readonly package_version="{{package_version}}"
  readonly vsix_dir="{{vsix_dir}}"
  readonly all_platforms_string="{{all_platforms}}"
  readonly requested_platforms_raw="{{platforms}}"

  mkdir -p "$vsix_dir"

  read -r -a supported_platforms <<< "$all_platforms_string"
  declare -A supported_lookup=()
  declare -A selected_lookup=()
  selected_platforms=()

  for platform in "${supported_platforms[@]}"; do
    supported_lookup["$platform"]=1
  done

  normalized_requested_platforms="${requested_platforms_raw//,/ }"

  if [[ -z "$normalized_requested_platforms" ]]; then
    selected_platforms=("${supported_platforms[@]}")
  else
    read -r -a requested_platforms <<< "$normalized_requested_platforms"

    for requested_platform in "${requested_platforms[@]}"; do
      normalized_platform="${requested_platform#--}"

      if [[ "$normalized_platform" == "all" ]]; then
        selected_platforms=("${supported_platforms[@]}")
        selected_lookup=()
        for platform in "${selected_platforms[@]}"; do
          selected_lookup["$platform"]=1
        done
        continue
      fi

      if [[ -z "${supported_lookup[$normalized_platform]+x}" ]]; then
        echo "error: unsupported platform '$requested_platform'. Supported platforms: $all_platforms_string" >&2
        exit 1
      fi

      if [[ -z "${selected_lookup[$normalized_platform]+x}" ]]; then
        selected_lookup["$normalized_platform"]=1
        selected_platforms+=("$normalized_platform")
      fi
    done
  fi

  for platform in "${selected_platforms[@]}"; do
    output_path="$vsix_dir/$package_name-$package_version-$platform.vsix"
    npx --yes @vscode/vsce package --no-dependencies --target "$platform" --out "$output_path"
    echo "$output_path"
  done

clean *flags:
  #!/usr/bin/env bash
  set -euo pipefail

  force=0

  for flag in {{flags}}; do
    case "$flag" in
      force|--force|-f)
        force=1
        ;;
      *)
        echo "error: unsupported clean flag '$flag'. Supported flag: force" >&2
        exit 1
        ;;
    esac
  done

  rm -rf dist artifacts

  if [[ "$force" -eq 1 ]]; then
    rm -rf node_modules
  fi
