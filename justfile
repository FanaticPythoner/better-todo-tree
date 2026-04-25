set shell := ["bash", "-euo", "pipefail", "-c"]

node_bootstrap := '''
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# Under sudo, $HOME is root's home and the user's nvm is invisible.
# Re-anchor NVM_DIR onto $SUDO_USER's real home directory whenever the
# default location does not contain an nvm install.
if [[ -n "${SUDO_USER:-}" ]] && [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  sudo_user_home="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6)"
  if [[ -n "$sudo_user_home" ]] && [[ -s "$sudo_user_home/.nvm/nvm.sh" ]]; then
    export NVM_DIR="$sudo_user_home/.nvm"
  fi
fi

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

# Linuxbrew installs Node at a deterministic system-wide path; surface it
# whenever PATH is otherwise stripped (e.g. sudo's secure_path).
if ! command -v node >/dev/null 2>&1 && [[ -x /home/linuxbrew/.linuxbrew/bin/node ]]; then
  export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"
fi

command -v node >/dev/null 2>&1 || { echo "error: Node.js was not found in PATH or $NVM_DIR." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "error: npm was not found after activating Node.js." >&2; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "error: npx was not found after activating Node.js." >&2; exit 1; }
'''

actions_bootstrap := '''
tools_root="$PWD/.tools"
bin_dir="$tools_root/bin"
downloads_dir="$tools_root/downloads"

mkdir -p "$bin_dir" "$downloads_dir"

if [[ ! -x "$bin_dir/actionlint" ]]; then
  curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz" -o "$downloads_dir/actionlint_1.7.12_linux_amd64.tar.gz"
  tar -xzf "$downloads_dir/actionlint_1.7.12_linux_amd64.tar.gz" -C "$bin_dir" actionlint
  chmod +x "$bin_dir/actionlint"
fi

if [[ ! -x "$bin_dir/act" ]]; then
  curl -fsSL "https://github.com/nektos/act/releases/download/v0.2.87/act_Linux_x86_64.tar.gz" -o "$downloads_dir/act_Linux_x86_64.tar.gz"
  tar -xzf "$downloads_dir/act_Linux_x86_64.tar.gz" -C "$bin_dir" act
  chmod +x "$bin_dir/act"
fi

export PATH="$bin_dir:$PATH"

command -v actionlint >/dev/null 2>&1 || { echo "error: actionlint is not available." >&2; exit 1; }
command -v act >/dev/null 2>&1 || { echo "error: act is not available." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "error: docker is required for workflow verification." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "error: curl is required for workflow verifier bootstrap." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "error: tar is required for workflow verifier bootstrap." >&2; exit 1; }
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

perf *args:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}
  node --expose-gc scripts/perf/run-all.js {{args}}

bootstrap-release-env:
  #!/usr/bin/env bash
  set -euo pipefail
  bash scripts/release/bootstrap-release-environment.sh

next-release *args:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}
  bash scripts/release/create-next-release.sh {{args}}

lint-actions:
  #!/usr/bin/env bash
  set -euo pipefail
  {{actions_bootstrap}}
  actionlint .github/workflows/*.yml

test-actions-ci:
  #!/usr/bin/env bash
  set -euo pipefail
  {{actions_bootstrap}}
  rm -rf .act-artifacts
  mkdir -p .act-artifacts
  act pull_request \
    -W .github/workflows/ci.yml \
    -j test-build \
    -P ubuntu-24.04=ghcr.io/catthehacker/ubuntu:act-24.04 \
    --container-architecture linux/amd64 \
    --artifact-server-path .act-artifacts

test-actions-release-build:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}

  temp_root="$(mktemp -d)"
  trap 'rm -rf "$temp_root"' EXIT

  temp_repo="$temp_root/repo"

  git clone --quiet --no-local --shared --branch master "$PWD" "$temp_repo"

  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'artifacts' \
    --exclude '.tools' \
    --exclude '.act-artifacts' \
    ./ "$temp_repo/"

  (
    cd "$temp_repo"
    temp_remote="$temp_repo/.act-origin.git"
    release_version="$(node -p "require('./package.json').version")"
    expected_count="$(node -e "console.log(require('./scripts/release/targets.json').length)")"
    git config user.name Codex
    git config user.email codex@example.invalid
    if [[ -n "$(git status --porcelain)" ]]; then
      git add .
      git commit -m 'test release workflow' >/dev/null
    fi
    git tag -d "v$release_version" >/dev/null 2>&1 || true
    git tag -a "v$release_version" -m "release"
    git init --bare "$temp_remote" >/dev/null
    git remote remove origin >/dev/null 2>&1 || true
    git remote remove github >/dev/null 2>&1 || true
    git remote add origin "$temp_remote"
    git remote add github https://github.com/FanaticPythoner/better-todo-tree
    git push -u origin master >/dev/null
    git push origin --tags >/dev/null
    GITHUB_OUTPUT="$temp_root/release-meta.out" \
      INPUT_TAG="v$release_version" \
      REF_NAME=master \
      REF_TYPE=branch \
      bash scripts/release/resolve-release-metadata.sh
    rm -rf "$temp_remote"
    npm ci
    npm test
    npm run vscode:prepublish
    rm -rf artifacts/vsix
    node scripts/release/build-vsix.mjs
    actual_count="$(find artifacts/vsix -maxdepth 1 -type f -name '*.vsix' | wc -l | tr -d '[:space:]')"
    [[ "$actual_count" == "$expected_count" ]]
    unzip -l "artifacts/vsix/better-todo-tree-${release_version}-linux-x64.vsix" | grep -q 'extension/readme.md'
    if unzip -l "artifacts/vsix/better-todo-tree-${release_version}-linux-x64.vsix" | grep -Eq 'extension/(\\.tools|MIGRATION\\.md|OPEN_VSX_CERTIFICATE_REPORT\\.md|\\.act-origin\\.git)'; then
      echo 'error: release VSIX contains local workflow tooling or migration-only documents.' >&2
      exit 1
    fi
  )

test-actions-latest-build:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}
  npx qunit test/workflows.github.test.js test/release.workflow-scripts.test.js

test-actions:
  #!/usr/bin/env bash
  set -euo pipefail
  just test
  just lint-actions
  just test-actions-ci
  just test-actions-release-build
  just test-actions-latest-build

build-ext *platforms:
  #!/usr/bin/env bash
  set -euo pipefail
  {{node_bootstrap}}
  node scripts/release/build-vsix.mjs {{platforms}}

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
