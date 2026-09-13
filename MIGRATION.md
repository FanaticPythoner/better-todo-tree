# Better Todo Tree Migration Notes

## Extension Identity

- New public extension ID: `FanaticPythoner.better-todo-tree`
- Source extension ID: `Gruntfuggly.todo-tree`
- View IDs:
  - `todo-tree-container`
  - `todo-tree-view`

## Todo Tree settings compatibility

Todo Tree settings are supported directly. Activation reads configuration without rewriting settings files.

| Contract | Behavior |
| --- | --- |
| Recognized settings | `better-todo-tree.*`, grouped `todo-tree.*`, historical flat Todo Tree keys |
| Live edits | Changes under either namespace refresh the affected scanners, highlights and tree controls |
| Scope | User, workspace, workspace folder and language overrides |
| Precedence | VS Code scope order; at the same scope: explicit current setting, grouped Todo Tree setting, historical flat key |
| Empty values | Explicit `false`, `0`, empty arrays and empty objects remain configured values |
| Object inheritance | Properties merge across scopes using VS Code object-setting semantics |
| Palette | `highlights.useColourScheme` defaults to `false` under both namespaces |
| Import command | `Better Todo Tree: Import Todo Tree Settings` copies recognized source values into unset destinations at the original scope |
| Source preservation | Import preserves every source key, unknown setting, retained historical setting and unrelated setting |
| Language import | Exact single-language and combined-language selector blocks remain intact |
| Failed write | Typed error; source retained; destination propagation verified before completion |
| Retry | Existing destination values remain intact; repeated import performs no writes |
| New workspace folder | Todo Tree settings work immediately; manual import includes the added folder |

Explicit import creates `better-todo-tree.*` overrides. Subsequent Todo Tree edits follow the same
scope and namespace precedence rules.

| Historical setting | Current behavior |
| --- | --- |
| `todo-tree.tree.showTagsFromOpenFilesOnly` | Maps `true` to `open files`, `false` to `workspace` |
| `todo-tree.tree.showScanOpenFilesOrWorkspaceButton` | Maps to `tree.buttons.scanMode` |
| `todo-tree.highlights.schemes` | Maps to `general.schemes` |
| `todo-tree.general.enableFileWatcher` | Enables external-file refresh in workspace scan modes |
| `todo-tree.general.fileWatcherGlob` | Selects file events that trigger the optional watcher |
| `todo-tree.ripgrep.ripgrepMaxBuffer`, `todo-tree.ripgrepMaxBuffer` | Preserved; streaming output has no aggregate output buffer |
| `todo-tree.tree.showInExplorer` | Preserved; VS Code owns view placement through Move View |

Extension storage owned by `Gruntfuggly.todo-tree` is separate from settings and is not read or copied.
Setting aliases are generated from current schemas by `npm run settings:sync` and checked during packaging.

## Commands and exports

- Command IDs: `better-todo-tree.*`.
- Export scheme: `better-todo-tree-export:`.
- Removed command aliases: `todo-tree.*`.
- Removed export alias: `todotree-export:`.
- Existing keybindings and macros must reference the current command IDs.
- View identifiers remain `todo-tree-container` and `todo-tree-view`.

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
