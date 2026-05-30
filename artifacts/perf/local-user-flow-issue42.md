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
| Host | Kernel | 6.8.0-124-generic |
| Host | Architecture | x64 |
| Host | Load Average | 3.76, 3.59, 3.75 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,767,552 bytes`) |
| Memory | Available At Collection | 15.95 GiB (`17,127,993,344 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 106 GiB (`113,449,418,752 bytes`) |
| Memory | DMI / SPD | Unavailable: /sys/firmware/dmi/tables/smbios_entry_point: Permission denied /dev/mem: Permission denied |
| Storage | Root Device | nvme1n1 (Samsung SSD 9100 PRO 4TB), 3.64 TiB (`4,000,787,030,016 bytes`), transport nvme, rotational=false, readOnly=false |

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
| open-file-default-save-rescan-visible-tree | user-flow | 106.37 | 2.15 | 108.62 | 2.37 | 116.03 | 2.4 |
| open-file-custom-save-rescan-visible-tree | user-flow | 93.1 | 3.18 | 94.28 | 3.39 | 97.26 | 3.48 |
| tree-view-cycle-visible-tree | user-flow | 9.85 | 0.38 | 11.41 | 0.5 | 11.46 | 0.51 |
| tree-group-toggle-tags-view | user-flow | 7.62 | 0.31 | 9.09 | 0.42 | 10.85 | 0.46 |
| tree-filter-visible-tree | user-flow | 0.42 | 0.33 | 0.53 | 0.45 | 0.6 | 0.49 |
| tree-view-repeat-click-burst | user-flow | 0.2 | 0.25 | 0.26 | 0.3 | 0.26 | 0.32 |
| tree-expansion-toggle-visible-tree | user-flow | 8.02 | 0.44 | 8.48 | 0.52 | 11.3 | 0.54 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 7.36 | 1.77 | 9.19 | 2.6 | 9.36 | 2.71 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 48.07 | 4.83 | 50.77 | 5.58 | 51.2 | 5.6 |
| visible-editor-highlight-open-file | user-flow | 19.98 | 1.8 | 22.55 | 2.56 | 23.45 | 2.73 |
| visible-editor-highlight-change-open-file | user-flow | 20.4 | 1.61 | 21.04 | 1.87 | 22.2 | 1.97 |
| visible-editor-custom-highlight-config-open-file | user-flow | 1866.49 | 2.56 | 1901.63 | 3.75 | 2124.97 | 4.03 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open-file-default-save-rescan-visible-tree | user-flow | 26.25 | 24.25 | 27 | 24.63 | 27.13 | 24.88 | 27.13 | 24.88 |
| open-file-custom-save-rescan-visible-tree | user-flow | 26.75 | 21 | 27.63 | 21.38 | 27.75 | 21.75 | 27.75 | 21.75 |
| tree-view-cycle-visible-tree | user-flow | 17 | 9.13 | 17.88 | 9.38 | 17.88 | 9.63 | 17.88 | 9.63 |
| tree-group-toggle-tags-view | user-flow | 16.38 | 9.13 | 16.88 | 9.5 | 17.25 | 9.5 | 17.25 | 9.5 |
| tree-filter-visible-tree | user-flow | 18.5 | 11.75 | 19 | 12.13 | 19.5 | 12.13 | 19.5 | 12.13 |
| tree-view-repeat-click-burst | user-flow | 1.25 | 1.63 | 1.38 | 1.75 | 1.5 | 1.75 | 1.5 | 1.75 |
| tree-expansion-toggle-visible-tree | user-flow | 16.75 | 9.13 | 18 | 9.25 | 18.25 | 9.63 | 18.25 | 9.63 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 17.13 | 9.63 | 17.38 | 9.88 | 17.38 | 10.13 | 17.38 | 10.13 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 71.5 | 13.88 | 74.25 | 14.13 | 75.63 | 14.13 | 75.63 | 14.13 |
| visible-editor-highlight-open-file | user-flow | 48.63 | 11.88 | 49.38 | 13.13 | 49.88 | 13.25 | 49.88 | 13.25 |
| visible-editor-highlight-change-open-file | user-flow | 47.73 | 11.75 | 49.5 | 12 | 49.88 | 12.13 | 49.88 | 12.13 |
| visible-editor-custom-highlight-config-open-file | user-flow | 159.88 | 14.25 | 162.5 | 14.49 | 163.63 | 14.63 | 163.63 | 14.63 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open-file-default-save-rescan-visible-tree | user-flow | 81.83 | 79.71 | 82.42 | 80.09 | 82.43 | 80.34 | 82.43 | 80.34 |
| open-file-custom-save-rescan-visible-tree | user-flow | 82.2 | 76.46 | 82.96 | 76.9 | 83.2 | 76.94 | 83.2 | 76.94 |
| tree-view-cycle-visible-tree | user-flow | 72.55 | 64.64 | 73.09 | 65.07 | 73.39 | 65.23 | 73.39 | 65.23 |
| tree-group-toggle-tags-view | user-flow | 71.89 | 64.42 | 72.26 | 64.91 | 72.29 | 65.04 | 72.29 | 65.04 |
| tree-filter-visible-tree | user-flow | 73.81 | 67.27 | 74.63 | 67.42 | 74.88 | 67.46 | 74.88 | 67.46 |
| tree-view-repeat-click-burst | user-flow | 56.72 | 57.03 | 56.81 | 57.46 | 57.16 | 57.54 | 57.16 | 57.54 |
| tree-expansion-toggle-visible-tree | user-flow | 72.12 | 64.68 | 73.64 | 64.89 | 73.68 | 64.94 | 73.68 | 64.94 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 72.51 | 65.09 | 72.97 | 65.21 | 73.01 | 65.3 | 73.01 | 65.3 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 126.91 | 69.36 | 129.91 | 69.56 | 131.12 | 69.6 | 131.12 | 69.6 |
| visible-editor-highlight-open-file | user-flow | 104.12 | 67.45 | 104.94 | 68.59 | 105.26 | 68.66 | 105.26 | 68.66 |
| visible-editor-highlight-change-open-file | user-flow | 103.36 | 67.13 | 104.87 | 67.45 | 105.2 | 67.89 | 105.2 | 67.89 |
| visible-editor-custom-highlight-config-open-file | user-flow | 215.43 | 69.78 | 218.03 | 69.93 | 219.25 | 70.08 | 219.25 | 70.08 |
