# Issue 59 VS Code Install Smoke

| Field | Value |
| --- | --- |
| VSIX | `artifacts/issue59-vsix/better-todo-tree-1.2.3-linux-x64.vsix` |
| VS Code | `1.123.0` |
| Installed extension | `fanaticpythoner.better-todo-tree@1.2.3` |
| Archive integrity | `unzip -t`: OK |

## Title Menu Entries

| Command | Context | Icon |
| --- | --- | --- |
| `better-todo-tree.expand` | `better-todo-tree-expanded == false` | `$(expand-all)` |
| `better-todo-tree.collapse` | `better-todo-tree-expanded == true` | `$(collapse-all)` |
| `better-todo-tree.treeStateBusy` | `better-todo-tree-expansion-busy == true` | `refresh-spin-light.svg`, `refresh-spin-dark.svg` |

## Commands

```bash
code --user-data-dir "$PWD/artifacts/issue59-vscode-user-data" --extensions-dir "$PWD/artifacts/issue59-vscode-extensions" --install-extension "$PWD/artifacts/issue59-vsix/better-todo-tree-1.2.3-linux-x64.vsix" --force
code --user-data-dir "$PWD/artifacts/issue59-vscode-user-data" --extensions-dir "$PWD/artifacts/issue59-vscode-extensions" --list-extensions --show-versions
```

## Output

```text
Extension 'better-todo-tree-1.2.3-linux-x64.vsix' was successfully installed.
fanaticpythoner.better-todo-tree@1.2.3
```
