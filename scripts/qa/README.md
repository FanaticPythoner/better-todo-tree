# Native editor acceptance

The suites install the packaged extension into an isolated native editor profile.
Methodical QA executes the flows and retains deterministic comparisons, screenshots,
configuration inputs, document text, host versions and the VSIX SHA-256 digest.

## Runtime

| Dependency | Purpose |
| --- | --- |
| Methodical QA Python environment | CLI, executor plugins and deterministic assertions |
| Native VS Code or VSCodium | Installed extension host and workbench |
| Xvfb | Isolated Linux X11 display |
| Playwright | Observe the native workbench through CDP |
| System Python with libX11 | Focus and keyboard interactions |
| ImageMagick `import` | X11 screenshots for the minimum supported editor |
| Tesseract | Native X11 notebook label readiness before screenshot capture |
| Pillow | Contact sheets with source-image digests |

All profile, extension, workspace and evidence writes belong to the supplied output
directory. `PYTHONDONTWRITEBYTECODE=1` prevents changes to the Methodical QA checkout.
The Linux executor owns its process groups, including detached Electron descendants.
An explicit shared-data directory contains storage used by newer editor versions.
Exact temporary-directory environment entries identify owned Electron processes even
when the process replaces its argument vector with a single process-title string.
Resume reclaims those processes before installing and launching the editor.

## Suites

| Configuration | Contract |
| --- | --- |
| `highlights.yaml` | 4 themes × 9 highlight modes × 8 configuration profiles = 288 cases |
| `codicons.yaml` | Overlay restricting the highlight matrix to requested glyph identity checks |
| `customer.yaml` | Contributed commands, filters, exports, settings diagnostics and editor lifecycle |
| `settings.yaml` | Live Todo Tree grouped/flat settings, source-preserving import, precedence, schema controls and file watching |
| `migration.yaml` | Global, workspace, folder, combined language blocks, JSONC, source preservation and added folders |
| `native-smoke.yaml` | Native renderer attachment and retained editor evidence |

Highlight profiles cover default opt-in, explicit opt-out, enabled palettes,
background colors, opacity and font styles, theme colors, disabled highlighting, and codicon gutters.
Fixtures include `constructor`, `__proto__`, `toString`, and a separately styled subtag.
Modes cover tag, text, comment combinations, subtag, line, whole-line,
`capture-groups:1,3`, and none.

The highlight oracle compares decorated columns, computed styles, gutter counts,
overlay counts and rectangle geometry. Geometry tolerance is one CSS pixel.
Initial fixture decoration establishes extension activation before case settings change.
Codicon checks compare each native SVG digest with the requested canonical glyph.
The `__proto__` source tag uses a named tag group because VS Code omits that exact settings-object key.
Configured foreground/background pairs require contrast ≥ 4.5 after alpha compositing.
The oracle does not assert readability for arbitrary user-selected color pairs.

`executor.options.settings_namespace=todo-tree` executes the complete 288-case matrix
through Todo Tree aliases. The expected decoration contract remains independent of the
settings namespace. The paired namespace runs cover 576 rendered cases.

The customer probe executes actual VS Code APIs against the installed extension.
Negative Settings JSON controls establish that schema diagnostics are active before
accepting valid capture-group, theme-color and RGBA settings. The probe toggles the
native JSON diagnostics preference to request a fresh diagnostic pull after migration
has loaded Settings JSON. Both schema controls retain screenshots at startup and after commands. Native notebook cases
open two same-line cells, edit and save one cell, and close all editors. Exported
records must preserve both cell identities and remove closed-editor results.
CDP notebook checks require two gutter icons and two tree icons. Referenced SVG files
must exist and decode through the native renderer after Reset Cache.
After all editors close, the native tree must remove the notebook entries before final capture.

## Invocation

Run from the Better Todo Tree repository root. Explicit `--set` values select the
editor and exact packaged artifact; configuration files contain local QA defaults.

```bash
PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/TODOS_LISTS/qa-pr178-todo-tree-settings/tmp" \
  /home/n00ne/Documents/GitHub/methodical-qa/.venv/bin/methodical-qa run \
  scripts/qa/customer.yaml \
  --set executor.options.vsix=TODOS_LISTS/qa-pr178-todo-tree-settings/vsix-final/better-todo-tree-settings-final-linux-x64.vsix \
  --output TODOS_LISTS/qa-pr178-todo-tree-settings/customer
```

Replace `customer.yaml` with `highlights.yaml` for the complete visual matrix.
The minimum-version customer run selects `executor.options.observer=x11` and an
explicit `executor.options.code` path. The X11 observer uses native screenshots;
the visual matrix requires CDP. No editor protocol methods are patched.
Notebook OCR preserves native colors when scaling; monochrome workbench-label OCR
uses a background-relative threshold. Retained screenshots preserve original pixels.
The native window is positioned at the display origin and sized from the X11 display
dimensions. Import interactions wait for the visible completion notification before dismissal.
Settings captures expand the native tree through its public command. CDP captures wait
for expected visible tree labels and two rendered frames. X11 captures require the fixture
label counts in the editor and tree through OCR. Both observers receive direct image inspection.

```bash
python scripts/qa/render-gallery.py \
  TODOS_LISTS/qa-pr178-todo-tree-settings/final-highlights-todo-tree/run_20260912_184156_618442 \
  --output TODOS_LISTS/qa-pr178-todo-tree-settings/visual-todo-tree
```

## Evidence interpretation

| Artifact | Meaning |
| --- | --- |
| `host.json` | Native editor identity, observation method and installed VSIX digest |
| `initial-highlight-ready.json` | Initial native decoration readiness and measured wait |
| `flow_results.jsonl` | Methodical flow outcomes and parameters |
| `action_results.jsonl` | Action outcomes and deterministic comparison evidence |
| `evidence/<flow>/contract.json` | Independent expected state and measured state |
| `evidence/<flow>/workbench.png` | Native workbench screenshot |
| `evidence/<flow>/highlights.png` | Native editor crop |
| `evidence/<flow>/notebook-*.png` | Notebook before/after edit screenshots |
| `gallery/manifest.json` | Contact-sheet membership and source-image digests |
| `ruler-gallery/manifest.json` | Native ruler canvases rotated 90 degrees without resampling; original PNG digests |
| `visual-review.json` | Recorded visual inspection with reviewed image digests |
| `selection.json` | Gallery input receipts and explicitly selected source evidence |
| `customer.json` | Command coverage, settings, exports and lifecycle assertions |
| `cleanup.json` | Owned process groups terminated during teardown |

Automated comparisons and screenshot inspection are separate acceptance steps.
Interrupted runs and failed controls remain evidence of those executions.
Only completed receipts with the matching artifact digest support acceptance.
Native execution here covers Linux x64 hosts. Other packaged targets require native
execution on their corresponding operating systems and architectures.

The repository test files `issue-branch-script.test.js` and
`release.workflow-scripts.test.js` create commits, branches, tags or pushes in fixtures.
The recorded QA test selection excludes them under the Git-action prohibition.
