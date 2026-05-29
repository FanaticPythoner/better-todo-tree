# Runtime Benchmarks

- Baseline ref: `a6f60e0ce830c4649ac34fc05e5a1799ec91d151`
- Current source: working tree
- Node: `v25.2.0`
- Selection mode: `suite`
- Declared suite: `user-flow`
- Result-count validation: `12 rows, suite-consistent=true, all-user-flow=true`

## Machine Profile

| Category | Field | Value |
| --- | --- | --- |
| Host | Hostname | n00ne-AERO-17-YD |
| Host | OS | Ubuntu 22.04.5 LTS |
| Host | Kernel | 6.8.0-117-generic |
| Host | Architecture | x64 |
| Host | Load Average | 2.68, 2.68, 2.62 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,767,552 bytes`) |
| Memory | Available At Collection | 29.79 GiB (`31,985,217,536 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 111 GiB (`119,200,763,904 bytes`) |
| Memory | DMI / SPD | Unavailable: /sys/firmware/dmi/tables/smbios_entry_point: Permission denied /dev/mem: Permission denied |
| Storage | Root Device | nvme0n1 (Samsung SSD 9100 PRO 4TB), 3.64 TiB (`4,000,787,030,016 bytes`), transport nvme, rotational=false, readOnly=false |

## Scenario Model

| Scenario | Kind | User flow | Measurement scope | Input model |
| --- | --- | --- | --- | --- |
| open-file-default-save-rescan-visible-tree | user-flow | Save an already-open file that uses default tag scanning and redraw the visible tree. | Document save listener, document rescan, search-result replacement, and visible-tree render. | Real document text in a VS Code event harness. |
| open-file-custom-save-rescan-visible-tree | user-flow | Save an already-open file that uses custom regex scanning and redraw the visible tree. | Document save listener, custom-regex document rescan, search-result replacement, and visible-tree render. | Real document text in a VS Code event harness. |
| tree-view-cycle-visible-tree | user-flow | Cycle the tree between flat, tags-only, and tree views and redraw the visible tree each time. | View-mode commands, workspace-state mutation, and visible-tree rebuild/render. | Fixture workspace tree in a VS Code event harness. |
| tree-group-toggle-tags-view | user-flow | Toggle tag grouping on and off while in tags view and redraw the visible tree. | Grouping commands, workspace-state mutation, and visible-tree rebuild/render. | Fixture workspace tree in a VS Code event harness. |
| tree-filter-visible-tree | user-flow | Apply a tree filter and clear it again while the tree is visible. | Filter command handling, tree filtering, and visible-tree render. | Fixture workspace tree in a VS Code event harness. |
| tree-view-repeat-click-burst | user-flow | Repeatedly click the same view button while the tree state is still mutating. | Overlapping command handling and workspace-state writes. | Command burst against the extension command handlers in a VS Code event harness. |
| tree-expansion-toggle-visible-tree | user-flow | Expand and then collapse the visible tree. | Expansion commands, workspace-state mutation, and visible-tree rebuild/render. | Fixture workspace tree in a VS Code event harness. |
| workspace-default-relative-rebuild-visible-tree | user-flow | Trigger a workspace refresh with default tag scanning and rebuild the visible tree from workspace matches. | Workspace refresh orchestration, ripgrep event handling, file reads, result application, and tree rebuild/render. | Fixture ripgrep matches, fixture file contents, and fixture scan results in a VS Code event harness. |
| workspace-custom-relative-rebuild-visible-tree | user-flow | Trigger a workspace refresh with custom regex scanning and rebuild the visible tree from workspace matches. | Workspace refresh orchestration, ripgrep event handling, regex-match normalization, result application, and tree rebuild/render. | Fixture ripgrep matches, fixture file contents, and fixture normalized regex results in a VS Code event harness. |
| visible-editor-highlight-open-file | user-flow | Focus or open a visible editor and apply highlights to that editor. | Active-editor event handling, decoration creation/update, and highlight application. | Fixture scan results fed into the real highlight pipeline in a VS Code event harness. |
| visible-editor-highlight-change-open-file | user-flow | Edit a visible file and refresh its highlights. | Text-change event handling, decoration update, and highlight application. | Fixture scan results fed into the real highlight pipeline in a VS Code event harness. |
| visible-editor-custom-highlight-config-open-file | user-flow | Open a visible editor while a large custom highlight configuration is active and apply highlights. | Custom-highlight attribute lookup, decoration creation/update, and highlight application. | Fixture scan results plus a large custom-highlight config in a VS Code event harness. |

## Metric Model

| Table | Value model | Accuracy model |
| --- | --- | --- |
| Latency | Wall-clock elapsed time around each harness flow iteration, summarized as min/p50/p90/p95/max. | Exact for each sampled iteration in this run. |
| Profiled RSS Burst | Difference between the isolated scenario worker RSS measured immediately before the flow and that worker iteration's OS high-water-mark peak RSS. | Exact for the measured worker iteration, using `process.memoryUsage().rss` at flow start and `process.resourceUsage().maxRSS` for the peak. |
| Profiled Peak RSS | Highest process RSS reached by each isolated scenario worker iteration. | Exact worker-process high-water mark from `process.resourceUsage().maxRSS`. |

## Latency

| Scenario | Kind | Baseline p50 ms | Current p50 ms | Baseline p90 ms | Current p90 ms | Baseline p95 ms | Current p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| open-file-default-save-rescan-visible-tree | user-flow | 77.03 | 1.5 | 89.7 | 1.76 | 90.8 | 2.04 |
| open-file-custom-save-rescan-visible-tree | user-flow | 78.88 | 2.52 | 82.55 | 2.57 | 84.69 | 2.66 |
| tree-view-cycle-visible-tree | user-flow | 7.88 | 0.32 | 8.68 | 0.4 | 8.69 | 0.42 |
| tree-group-toggle-tags-view | user-flow | 5.48 | 0.27 | 6.11 | 0.34 | 6.53 | 0.35 |
| tree-filter-visible-tree | user-flow | 0.33 | 0.26 | 0.36 | 0.34 | 0.36 | 0.35 |
| tree-view-repeat-click-burst | user-flow | 0.2 | 0.22 | 0.27 | 0.24 | 0.29 | 0.29 |
| tree-expansion-toggle-visible-tree | user-flow | 6.14 | 0.34 | 6.57 | 0.42 | 7.88 | 0.48 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 5.86 | 1.4 | 6.58 | 2.03 | 6.99 | 2.18 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 36.72 | 3.76 | 42.26 | 4.19 | 43.54 | 6.88 |
| visible-editor-highlight-open-file | user-flow | 16 | 1.39 | 16.74 | 1.54 | 20.38 | 1.56 |
| visible-editor-highlight-change-open-file | user-flow | 17.24 | 1.32 | 18.55 | 1.39 | 18.86 | 2.18 |
| visible-editor-custom-highlight-config-open-file | user-flow | 1391.93 | 2 | 1582.05 | 2.13 | 1589.83 | 2.33 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open-file-default-save-rescan-visible-tree | user-flow | 26.88 | 24.5 | 27.38 | 24.88 | 27.5 | 27.75 | 27.5 | 27.75 |
| open-file-custom-save-rescan-visible-tree | user-flow | 27.25 | 20.75 | 27.5 | 21.13 | 27.63 | 21.25 | 27.63 | 21.25 |
| tree-view-cycle-visible-tree | user-flow | 17.13 | 8.88 | 17.63 | 9.13 | 18.5 | 9.25 | 18.5 | 9.25 |
| tree-group-toggle-tags-view | user-flow | 16.25 | 8.88 | 16.75 | 9 | 17.5 | 9.38 | 17.5 | 9.38 |
| tree-filter-visible-tree | user-flow | 17.88 | 10.38 | 19.13 | 12.13 | 21.13 | 12.25 | 21.13 | 12.25 |
| tree-view-repeat-click-burst | user-flow | 1.25 | 1.63 | 1.38 | 1.75 | 1.38 | 1.75 | 1.38 | 1.75 |
| tree-expansion-toggle-visible-tree | user-flow | 16.5 | 8.88 | 17.25 | 9.13 | 17.5 | 9.25 | 17.5 | 9.25 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 17.5 | 9.63 | 17.75 | 9.75 | 17.88 | 9.88 | 17.88 | 9.88 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 75.38 | 14.13 | 77.75 | 14.25 | 78.13 | 14.5 | 78.13 | 14.5 |
| visible-editor-highlight-open-file | user-flow | 47.38 | 11.88 | 49.13 | 12.25 | 49.63 | 13.25 | 49.63 | 13.25 |
| visible-editor-highlight-change-open-file | user-flow | 48.88 | 11.75 | 49.13 | 12 | 49.5 | 12.63 | 49.5 | 12.63 |
| visible-editor-custom-highlight-config-open-file | user-flow | 159.88 | 14.5 | 161.25 | 14.5 | 162.5 | 14.63 | 162.5 | 14.63 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open-file-default-save-rescan-visible-tree | user-flow | 82.65 | 80.1 | 82.84 | 80.27 | 83.1 | 83.45 | 83.1 | 83.45 |
| open-file-custom-save-rescan-visible-tree | user-flow | 82.85 | 76.57 | 83.18 | 76.71 | 83.31 | 76.89 | 83.31 | 76.89 |
| tree-view-cycle-visible-tree | user-flow | 72.71 | 64.59 | 73.24 | 64.73 | 73.8 | 64.85 | 73.8 | 64.85 |
| tree-group-toggle-tags-view | user-flow | 71.94 | 64.44 | 72.46 | 64.58 | 73.19 | 64.76 | 73.19 | 64.76 |
| tree-filter-visible-tree | user-flow | 73.43 | 65.96 | 74.75 | 67.77 | 76.41 | 67.93 | 76.41 | 67.93 |
| tree-view-repeat-click-burst | user-flow | 56.86 | 57.24 | 57.06 | 57.33 | 57.11 | 57.39 | 57.11 | 57.39 |
| tree-expansion-toggle-visible-tree | user-flow | 72.05 | 64.54 | 72.58 | 64.63 | 73.08 | 64.8 | 73.08 | 64.8 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 72.94 | 65.17 | 73.26 | 65.41 | 73.38 | 65.42 | 73.38 | 65.42 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 130.97 | 69.71 | 133.17 | 70.02 | 133.31 | 70.02 | 133.31 | 70.02 |
| visible-editor-highlight-open-file | user-flow | 102.91 | 67.49 | 104.57 | 67.79 | 105.26 | 68.8 | 105.26 | 68.8 |
| visible-editor-highlight-change-open-file | user-flow | 104.37 | 67.29 | 104.55 | 67.59 | 105.02 | 68.04 | 105.02 | 68.04 |
| visible-editor-custom-highlight-config-open-file | user-flow | 215.58 | 69.98 | 216.96 | 70.09 | 218.18 | 70.32 | 218.18 | 70.32 |
