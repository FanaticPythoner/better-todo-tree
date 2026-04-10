# Better Todo Tree Migration Notes

## Extension Identity

- New public extension ID: `FanaticPythoner.better-todo-tree`
- Legacy public extension ID: `Gruntfuggly.todo-tree`
- Stable hidden view IDs kept for layout compatibility:
  - `todo-tree-container`
  - `todo-tree-view`

## Settings Compatibility

Better Todo Tree keeps both configuration namespaces in the manifest during the `0.x` line:

- current namespace: `better-todo-tree.*`
- legacy namespace: `todo-tree.*`

Runtime reads resolve in this order:

1. explicit `better-todo-tree.*` value
2. explicit `todo-tree.*` value
3. current default

All writes go to `better-todo-tree.*`.

On activation, the extension copies legacy `todo-tree.*` values into the matching `better-todo-tree.*` key at the same scope when the new key is unset. Supported scopes:

- Global
- Workspace
- Workspace Folder

Manual re-import command:

- `Better Todo Tree: Import Legacy Settings`

## Command Compatibility

All legacy `todo-tree.*` command IDs remain registered as hidden aliases to the rebranded command handlers. Existing keybindings, macros, and scripts keep working while public menus and the command palette expose the `better-todo-tree.*` IDs.

## Export Compatibility

Both export schemes are registered:

- current: `better-todo-tree-export:`
- legacy: `todotree-export:`

## Non-Portable State

Extension storage keyed by the old extension identifier is not migrated. The compatibility guarantee covers:

- settings
- public command IDs
- stable hidden view/container IDs

It does not cover old extension-local cache state or global/workspace mementos stored under the previous publisher/name.

## GitHub Release Environment

The release workflow expects a protected GitHub environment named `release` with:

- required reviewer: `FanaticPythoner`
- environment secret: `VSCE_PAT`
- environment secret: `OVSX_PAT`

Recommended repository Actions settings:

- default `GITHUB_TOKEN` permissions: read-only
- allow GitHub-authored actions and local workflows only
- require full-length SHA pinning
- require approval for fork pull request workflow runs
- artifact/log retention: 14 days

## Licensing

The fork is distributed under `GPL-3.0-only`. The preserved upstream Todo Tree
Expat/MIT notice remains in [`UPSTREAM-NOTICE.md`](./UPSTREAM-NOTICE.md).
