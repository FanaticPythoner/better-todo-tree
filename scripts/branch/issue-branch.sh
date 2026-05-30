#!/usr/bin/env bash
set -euo pipefail

remote_name='origin'
base_branch='master'
source_branch='master'
target_owner='FanaticPythoner'
target_repo='better-todo-tree'
target_repo_slug="$target_owner/$target_repo"
branch_name=''
no_wait=0
pr_mode='prompt'
issue_urls=()
parsed_owner=''
parsed_repo=''
parsed_number=''

usage()
{
  cat <<'EOF'
Usage:
  issue-branch.sh name [options] ISSUE_URL...
  issue-branch.sh create [options] ISSUE_URL...
  issue-branch.sh stage [options] ISSUE_URL...
  issue-branch.sh push [options] ISSUE_URL...
  issue-branch.sh pr [options] ISSUE_URL...
  issue-branch.sh flow [options] ISSUE_URL...

Options:
  --branch NAME        Override derived branch name.
  --remote NAME        Git remote for base fetch and branch push. Default: origin.
  --base NAME          Remote base branch. Only master is supported.
  --source NAME        Local source branch carrying pending changes. Default: master.
  --no-wait           Push without interactive Enter prompt.
  --pr                Create PR without prompt after push.
  --no-pr             Skip PR creation after push.
  -h, --help          Show usage.

Default branch:
  fix/issue-N-title-slug
  fix/issues-N-N-title-slugs
EOF
}

fail()
{
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command()
{
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is not available."
}

require_target_base()
{
  [[ "$base_branch" == 'master' ]] || fail "base branch '$base_branch' is unsupported. Expected master."
}

repo_root()
{
  git rev-parse --show-toplevel 2>/dev/null
}

current_branch()
{
  git symbolic-ref --quiet --short HEAD
}

parse_args()
{
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --branch)
        [[ $# -ge 2 ]] || fail '--branch requires a value.'
        branch_name="$2"
        shift 2
        ;;
      --remote)
        [[ $# -ge 2 ]] || fail '--remote requires a value.'
        remote_name="$2"
        shift 2
        ;;
      --base)
        [[ $# -ge 2 ]] || fail '--base requires a value.'
        base_branch="$2"
        shift 2
        ;;
      --source)
        [[ $# -ge 2 ]] || fail '--source requires a value.'
        source_branch="$2"
        shift 2
        ;;
      --no-wait)
        no_wait=1
        shift
        ;;
      --pr)
        pr_mode='yes'
        shift
        ;;
      --no-pr)
        pr_mode='no'
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        while [[ $# -gt 0 ]]; do
          issue_urls+=( "$1" )
          shift
        done
        ;;
      -*)
        fail "unknown option '$1'."
        ;;
      *)
        issue_urls+=( "$1" )
        shift
        ;;
    esac
  done
}

parse_issue_url()
{
  local url="$1"

  if [[ ! "$url" =~ ^https://github\.com/([^/]+)/([^/]+)/issues/([0-9]+)([/?#].*)?$ ]]; then
    fail "unsupported issue URL '$url'. Expected https://github.com/OWNER/REPO/issues/NUMBER."
  fi

  parsed_owner="${BASH_REMATCH[1]}"
  parsed_repo="${BASH_REMATCH[2]}"
  parsed_number="${BASH_REMATCH[3]}"

  [[ "$parsed_owner/$parsed_repo" == "$target_repo_slug" ]] \
    || fail "issue URL must target $target_repo_slug."
}

slugify_title()
{
  local title="$1"

  printf '%s' "$title" \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

read_issue_title()
{
  local url="$1"
  local metadata=''
  local title=''
  local viewed_number=''

  require_command gh
  metadata="$(env -u DEBUG -u GH_DEBUG GH_PROMPT_DISABLED=1 gh issue view "$url" --json number,title --jq '[.number, .title] | @tsv' 2>&1)" \
    || fail "could not read issue metadata for '$url': $metadata"

  viewed_number="${metadata%%$'\t'*}"
  title="${metadata#*$'\t'}"

  [[ "$viewed_number" == "$parsed_number" ]] || fail "metadata number mismatch for '$url'."
  [[ -n "$title" ]] || fail "issue '$url' has an empty title."

  printf '%s\n' "$title"
}

issue_records()
{
  local url=''
  local title=''
  local first_owner=''
  local first_repo=''

  [[ ${#issue_urls[@]} -gt 0 ]] || fail 'at least one GitHub issue URL is required.'

  for url in "${issue_urls[@]}"; do
    parse_issue_url "$url"

    if [[ -z "$first_owner" ]]; then
      first_owner="$parsed_owner"
      first_repo="$parsed_repo"
    elif [[ "$parsed_owner/$parsed_repo" != "$first_owner/$first_repo" ]]; then
      fail 'issue URLs must belong to one GitHub repository.'
    fi

    title="$(read_issue_title "$url")"
    printf '%s\t%s\n' "$parsed_number" "$title"
  done | sort -n -k1,1
}

derive_branch_name()
{
  local records=()
  local record=''
  local number=''
  local title=''
  local slug=''
  local joined_numbers=''
  local joined_slugs=''
  local records_output=''

  records_output="$(issue_records)"
  mapfile -t records <<< "$records_output"

  for record in "${records[@]}"; do
    number="${record%%$'\t'*}"
    title="${record#*$'\t'}"
    slug="$(slugify_title "$title")"
    [[ -n "$slug" ]] || fail "issue '$number' title cannot form a branch slug."

    if [[ -z "$joined_numbers" ]]; then
      joined_numbers="$number"
      joined_slugs="$slug"
    else
      joined_numbers="${joined_numbers}-${number}"
      joined_slugs="${joined_slugs}-${slug}"
    fi
  done

  if [[ ${#records[@]} -eq 1 ]]; then
    printf 'fix/issue-%s-%s\n' "$joined_numbers" "$joined_slugs"
  else
    printf 'fix/issues-%s-%s\n' "$joined_numbers" "$joined_slugs"
  fi
}

resolve_branch_name()
{
  if [[ -z "$branch_name" ]]; then
    branch_name="$(derive_branch_name)"
  fi

  git check-ref-format --branch "$branch_name" >/dev/null 2>&1 || fail "invalid branch name '$branch_name'."

  case "$branch_name" in
    "$base_branch"|"$source_branch"|master|main)
      fail "branch '$branch_name' is protected."
      ;;
  esac

  printf '%s\n' "$branch_name"
}

require_git_repo()
{
  local root=''

  require_command git
  root="$(repo_root)" || fail 'current directory is not inside a Git repository.'
  cd "$root"
}

require_remote()
{
  git remote get-url "$remote_name" >/dev/null 2>&1 || fail "remote '$remote_name' was not found."
}

fetch_base()
{
  require_remote
  git fetch --no-tags --force "$remote_name" "+refs/heads/$base_branch:refs/remotes/$remote_name/$base_branch"
  git rev-parse --verify "refs/remotes/$remote_name/$base_branch^{commit}" >/dev/null
}

fetch_branch()
{
  require_remote
  git fetch --no-tags --force "$remote_name" "+refs/heads/$branch_name:refs/remotes/$remote_name/$branch_name"
  git rev-parse --verify "refs/remotes/$remote_name/$branch_name^{commit}" >/dev/null
}

remote_branch_exists()
{
  local status=0

  set +e
  git ls-remote --exit-code --heads "$remote_name" "$branch_name" >/dev/null 2>&1
  status="$?"
  set -e

  case "$status" in
    0)
      return 0
      ;;
    2)
      return 1
      ;;
    *)
      fail "could not inspect remote branch '$remote_name/$branch_name'."
      ;;
  esac
}

require_no_branch_collision()
{
  if git rev-parse --verify "refs/heads/$branch_name" >/dev/null 2>&1; then
    fail "local branch '$branch_name' already exists."
  fi

  if remote_branch_exists; then
    fail "remote branch '$remote_name/$branch_name' already exists."
  fi
}

base_ref()
{
  printf 'refs/remotes/%s/%s\n' "$remote_name" "$base_branch"
}

branch_commit()
{
  git rev-parse --verify "$1^{commit}"
}

require_ref_at_base()
{
  local ref="$1"
  local label="$2"
  local base_commit=''
  local ref_commit=''

  base_commit="$(branch_commit "$(base_ref)")"
  ref_commit="$(branch_commit "$ref")"
  [[ "$ref_commit" == "$base_commit" ]] || fail "$label '$branch_name' is not at $remote_name/$base_branch."
}

create_local_branch_from_ref()
{
  local start_ref="$1"

  git branch --no-track "$branch_name" "$start_ref"
}

set_branch_upstream()
{
  git branch --set-upstream-to="$remote_name/$branch_name" "$branch_name" >/dev/null
}

push_branch_ref()
{
  git push "$remote_name" "refs/heads/$branch_name:refs/heads/$branch_name"
  set_branch_upstream
}

create_branch()
{
  require_git_repo
  require_target_base
  resolve_branch_name >/dev/null
  fetch_base
  require_no_branch_collision

  create_local_branch_from_ref "$(base_ref)"
  push_branch_ref

  printf 'created branch %s from %s/%s\n' "$branch_name" "$remote_name" "$base_branch"
}

ensure_flow_branch()
{
  local local_ref="refs/heads/$branch_name"
  local remote_ref="refs/remotes/$remote_name/$branch_name"

  require_git_repo
  require_target_base
  resolve_branch_name >/dev/null
  fetch_base

  if git rev-parse --verify "$local_ref" >/dev/null 2>&1; then
    require_ref_at_base "$local_ref" 'local branch'
    if remote_branch_exists; then
      fetch_branch >/dev/null
      require_ref_at_base "$remote_ref" 'remote branch'
      set_branch_upstream
    fi
    return 0
  fi

  if remote_branch_exists; then
    fetch_branch >/dev/null
    require_ref_at_base "$remote_ref" 'remote branch'
    create_local_branch_from_ref "$remote_ref"
    set_branch_upstream
    return 0
  fi

  create_local_branch_from_ref "$(base_ref)"
}

require_clean_merge_state()
{
  local unmerged=''

  unmerged="$(git diff --name-only --diff-filter=U)"
  [[ -z "$unmerged" ]] || fail "unmerged paths block branch preparation: $unmerged"
}

require_source_changes()
{
  local status=0

  set +e
  git diff --quiet --exit-code HEAD
  status="$?"
  set -e

  case "$status" in
    0)
      fail 'no tracked source changes to move.'
      ;;
    1)
      return 0
      ;;
    *)
      fail 'could not inspect tracked source changes.'
      ;;
  esac
}

require_no_untracked_source_changes()
{
  local untracked=''

  untracked="$(git ls-files --others --exclude-standard)"
  [[ -z "$untracked" ]] || fail "untracked paths are present; only tracked changes can move: $untracked"
}

apply_index_patch()
{
  local patch_file="$1"
  local mode="$2"

  case "$mode" in
    exact)
      git apply --index "$patch_file"
      ;;
    merge)
      git apply --3way --index "$patch_file"
      ;;
    *)
      fail "unsupported patch mode '$mode'."
      ;;
  esac
}

write_source_snapshot()
{
  local snapshot_dir="$1"
  local manifest_file="$2"
  local source_root="$snapshot_dir/files"
  local path=''

  mkdir -p "$source_root"
  : > "$manifest_file"

  while IFS= read -r -d '' path; do
    if [[ -e "$path" || -L "$path" ]]; then
      mkdir -p "$source_root/$(dirname "$path")"
      cp -pP "$path" "$source_root/$path"
      printf 'write\0%s\0' "$path" >> "$manifest_file"
    else
      printf 'delete\0%s\0' "$path" >> "$manifest_file"
    fi
  done < <(git diff --name-only -z --no-renames HEAD)
}

apply_source_snapshot_to_target()
{
  local snapshot_dir="$1"
  local manifest_file="$2"
  local source_root="$snapshot_dir/files"
  local action=''
  local path=''
  local changed_paths=()

  while IFS= read -r -d '' action && IFS= read -r -d '' path; do
    case "$action" in
      write)
        mkdir -p "$(dirname "$path")"
        cp -pP "$source_root/$path" "$path"
        git add -- "$path"
        changed_paths+=( "$path" )
        ;;
      delete)
        rm -f -- "$path"
        git rm --cached -q --ignore-unmatch -- "$path" >/dev/null
        changed_paths+=( "$path" )
        ;;
      *)
        fail "unsupported source snapshot action '$action'."
        ;;
    esac
  done < "$manifest_file"

  git diff --cached --quiet --exit-code && return 1

  printf 'resolved patch conflicts from source snapshot:\n'
  printf '  %s\n' "${changed_paths[@]}"
}

apply_source_patch_to_target()
{
  local patch_file="$1"
  local snapshot_dir="$2"
  local manifest_file="$3"

  if apply_index_patch "$patch_file" exact; then
    return 0
  fi

  git reset --hard HEAD >/dev/null || return 1

  if apply_index_patch "$patch_file" merge; then
    return 0
  fi

  git reset --hard HEAD >/dev/null || return 1

  if apply_source_snapshot_to_target "$snapshot_dir" "$manifest_file"; then
    return 0
  fi

  git reset --hard HEAD >/dev/null || return 1
  return 1
}

apply_patch_file_if_present()
{
  local patch_file="$1"
  local mode="$2"

  [[ -s "$patch_file" ]] || return 0

  case "$mode" in
    index)
      apply_index_patch "$patch_file" exact
      ;;
    worktree)
      git apply "$patch_file"
      ;;
    *)
      fail "unsupported source restore mode '$mode'."
      ;;
  esac
}

restore_source_changes()
{
  local staged_patch_file="$1"
  local unstaged_patch_file="$2"
  local retained_patch_file="$3"

  git switch "$source_branch" >/dev/null || fail "tracked patch apply failed on '$branch_name'. Retained patch: $retained_patch_file"
  git reset --hard HEAD >/dev/null || fail "tracked patch apply failed on '$branch_name'. Source reset failed. Retained patch: $retained_patch_file"
  apply_patch_file_if_present "$staged_patch_file" index \
    || fail "tracked patch apply failed on '$branch_name'. Source index restore failed. Retained patch: $retained_patch_file"
  apply_patch_file_if_present "$unstaged_patch_file" worktree \
    || fail "tracked patch apply failed on '$branch_name'. Source worktree restore failed. Retained patch: $retained_patch_file"
  fail "tracked patch apply failed on '$branch_name'. Source changes restored. Retained patch: $retained_patch_file"
}

stage_branch_changes()
{
  local apply_status=0
  local active_branch=''
  local tracked_patch_file=''
  local staged_patch_file=''
  local unstaged_patch_file=''
  local snapshot_dir=''
  local manifest_file=''

  require_git_repo
  branch_name="$(resolve_branch_name)"
  require_clean_merge_state

  active_branch="$(current_branch)" || fail 'detached HEAD cannot supply source changes.'
  [[ "$active_branch" == "$source_branch" ]] || fail "current branch '$active_branch' does not match source '$source_branch'."
  git rev-parse --verify "refs/heads/$branch_name" >/dev/null 2>&1 || fail "local branch '$branch_name' was not found."
  require_source_changes
  require_no_untracked_source_changes

  tracked_patch_file="$(mktemp "${TMPDIR:-/tmp}/issue-branch-tracked.XXXXXX.patch")"
  staged_patch_file="$(mktemp "${TMPDIR:-/tmp}/issue-branch-index.XXXXXX.patch")"
  unstaged_patch_file="$(mktemp "${TMPDIR:-/tmp}/issue-branch-worktree.XXXXXX.patch")"
  snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/issue-branch-source.XXXXXX")"
  manifest_file="$snapshot_dir/manifest"

  write_source_snapshot "$snapshot_dir" "$manifest_file"
  git diff --binary HEAD > "$tracked_patch_file"
  git diff --cached --binary > "$staged_patch_file"
  git diff --binary > "$unstaged_patch_file"
  git reset --hard HEAD >/dev/null
  git switch "$branch_name" >/dev/null

  set +e
  apply_source_patch_to_target "$tracked_patch_file" "$snapshot_dir" "$manifest_file"
  apply_status="$?"
  set -e

  if [[ "$apply_status" -eq 0 ]]; then
    rm -f "$tracked_patch_file" "$staged_patch_file" "$unstaged_patch_file"
    rm -rf "$snapshot_dir"
  else
    restore_source_changes "$staged_patch_file" "$unstaged_patch_file" "$tracked_patch_file"
  fi

  printf 'staged changes on %s\n' "$branch_name"
}

commits_ahead_of()
{
  git rev-list --count "$1"..HEAD
}

remote_branch_ref_exists()
{
  if remote_branch_exists; then
    fetch_branch >/dev/null
    return 0
  fi

  return 1
}

push_current_branch()
{
  git push "$remote_name" "HEAD:refs/heads/$branch_name"
  set_branch_upstream
}

push_after_commit()
{
  local active_branch=''
  local ahead_count='0'
  local compare_ref=''

  require_git_repo
  branch_name="$(resolve_branch_name)"
  fetch_base

  while true; do
    active_branch="$(current_branch)" || fail 'detached HEAD cannot be pushed.'
    [[ "$active_branch" == "$branch_name" ]] || fail "current branch '$active_branch' does not match target '$branch_name'."

    if remote_branch_ref_exists; then
      compare_ref="$remote_name/$branch_name"
    else
      compare_ref="$(base_ref)"
    fi

    ahead_count="$(commits_ahead_of "$compare_ref")"
    if [[ "$ahead_count" != '0' ]]; then
      push_current_branch
      printf 'pushed %s commit(s) to %s/%s\n' "$ahead_count" "$remote_name" "$branch_name"
      return 0
    fi

    [[ "$no_wait" -eq 0 ]] || fail "branch '$branch_name' has no local commits ahead of '$remote_name/$branch_name'."

    printf "Commit staged changes on '%s' in another terminal. Press Enter to push '%s/%s' after commit." "$branch_name" "$remote_name" "$branch_name"
    read -r _
  done
}

create_pr()
{
  require_git_repo
  require_command gh
  require_target_base
  branch_name="$(resolve_branch_name)"
  env -u DEBUG -u GH_DEBUG GH_PROMPT_DISABLED=1 gh pr create \
    --repo "$target_repo_slug" \
    --base 'master' \
    --head "$target_owner:$branch_name" \
    --fill
}

prompt_pr()
{
  local answer=''

  case "$pr_mode" in
    yes)
      create_pr
      ;;
    no)
      printf 'pull request creation skipped\n'
      ;;
    prompt)
      [[ -t 0 ]] || fail 'TTY required for PR prompt. Use --pr or --no-pr.'
      printf 'Create pull request into %s master for %s? [Y/n] ' "$target_repo_slug" "$branch_name"
      read -r answer
      case "$answer" in
        ''|y|Y|yes|YES)
          create_pr
          ;;
        n|N|no|NO)
          printf 'pull request creation skipped\n'
          ;;
        *)
          fail "unsupported answer '$answer'."
          ;;
      esac
      ;;
    *)
      fail "unsupported PR mode '$pr_mode'."
      ;;
  esac
}

flow()
{
  branch_name="$(resolve_branch_name)"
  ensure_flow_branch
  stage_branch_changes
  push_after_commit
  prompt_pr
}

main()
{
  local command_name="${1:-flow}"

  if [[ $# -gt 0 ]]; then
    shift
  fi

  parse_args "$@"

  case "$command_name" in
    name)
      require_command git
      resolve_branch_name
      ;;
    create)
      create_branch
      ;;
    stage)
      stage_branch_changes
      ;;
    push)
      push_after_commit
      ;;
    pr)
      create_pr
      ;;
    flow)
      flow
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      fail "unknown command '$command_name'."
      ;;
  esac
}

main "$@"
