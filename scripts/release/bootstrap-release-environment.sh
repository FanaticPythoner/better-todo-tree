#!/usr/bin/env bash
set -euo pipefail

require_command()
{
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "error: required command '$command_name' is not available." >&2
    exit 1
  }
}

require_command gh

: "${VSCE_PAT:?error: VSCE_PAT must be set to your Visual Studio Marketplace Personal Access Token.}"

environment_name="${ENV_NAME:-release}"
reviewer="${REVIEWER:-}"
owner="${OWNER:-}"
repo="${REPO:-}"

if [[ -z "$owner" || -z "$repo" ]]; then
  mapfile -t repository_parts < <(gh repo view --json owner,name --jq '.owner.login, .name')
  if [[ ${#repository_parts[@]} -ne 2 ]]; then
    echo "error: could not resolve the current GitHub repository owner/name." >&2
    exit 1
  fi

  owner="${owner:-${repository_parts[0]}}"
  repo="${repo:-${repository_parts[1]}}"
fi

repository="${owner}/${repo}"

if [[ -n "$reviewer" ]]; then
  reviewer_id="$(gh api "users/$reviewer" --jq '.id')"
  payload_file="$(mktemp)"
  trap 'rm -f "$payload_file"' EXIT

  cat >"$payload_file" <<EOF
{
  "prevent_self_review": false,
  "reviewers": [
    { "type": "User", "id": $reviewer_id }
  ]
}
EOF

  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$repository/environments/$environment_name" \
    --input "$payload_file" \
    >/dev/null
else
  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$repository/environments/$environment_name" \
    >/dev/null
fi

gh secret set VSCE_PAT --env "$environment_name" --repo "$repository" --body "$VSCE_PAT"

if [[ -n "${OVSX_PAT:-}" ]]; then
  gh secret set OVSX_PAT --env "$environment_name" --repo "$repository" --body "$OVSX_PAT"
fi

printf "Configured environment '%s' for %s.\n" "$environment_name" "$repository"
printf "Stored environment secrets: VSCE_PAT%s\n" "${OVSX_PAT:+, OVSX_PAT}"
