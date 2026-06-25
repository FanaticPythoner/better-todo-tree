# Issue 57 77 VSIX Package Check

## Command

`VSIX_OUTDIR=artifacts/vsix/issue57-77 node scripts/release/build-vsix.mjs`

`SKIP_PREPUBLISH=1 VSIX_OUTDIR=artifacts/vsix/issue57-77 node scripts/release/build-vsix.mjs`

## Payload Contract

| Check | Expected |
| --- | --- |
| Package count | 10 |
| Targets | alpine-arm64, alpine-x64, darwin-arm64, darwin-x64, linux-arm64, linux-armhf, linux-x64, web, win32-arm64, win32-x64 |
| Current setting | `better-todo-tree.general.showScanningProgress` |
| Legacy setting | `todo-tree.general.showScanningProgress` |
| Default | `status bar` |
| Modes | `none`, `status bar`, `notification`, `tree`, `all` |
| NLS files | `extension/package.nls.json`, `extension/package.nls.zh-cn.json` |
| Required runtime files | `extension/package.json`, `extension/readme.md`, `extension/dist/extension.js`, `extension/dist/extension.js.LICENSE.txt` |
| Excluded paths | `extension/test/`, `extension/test-files/`, `extension/scripts/`, `extension/artifacts/`, `extension/TODOS_LISTS/`, `extension/src/`, `extension/dist/extension.js.map` |
| Ripgrep payload | Native targets include `extension/dist/ripgrep/`; web target excludes native ripgrep. |

## Package Rows

| Target | Files | Bytes | Ripgrep |
| --- | ---: | ---: | --- |
| alpine-arm64 | 55 | 2692405 | yes |
| alpine-x64 | 55 | 2974462 | yes |
| darwin-arm64 | 55 | 2527274 | yes |
| darwin-x64 | 55 | 2617002 | yes |
| linux-arm64 | 55 | 2692399 | yes |
| linux-armhf | 55 | 2380839 | yes |
| linux-x64 | 55 | 2974456 | yes |
| web | 51 | 674284 | no |
| win32-arm64 | 55 | 2567652 | yes |
| win32-x64 | 55 | 2719037 | yes |

## Result

| Assertion Group | Result |
| --- | --- |
| Package target coverage | pass |
| Setting schema inside packaged `extension/package.json` | pass |
| English and Chinese NLS entries inside package | pass |
| Local workflow and audit paths excluded from package | pass |
| Native versus web ripgrep payload split | pass |
