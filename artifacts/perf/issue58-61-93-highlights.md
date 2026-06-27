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
| Host | Load Average | 4.9, 4.53, 4.52 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,755,264 bytes`) |
| Memory | Available At Collection | 24.29 GiB (`26,085,892,096 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 96.88 GiB (`104,022,544,384 bytes`) |
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
| open-file-default-save-rescan-visible-tree | user-flow | 101.5 | 2.02 | 103.83 | 2.35 | 112.72 | 2.88 |
| open-file-custom-save-rescan-visible-tree | user-flow | 91 | 4.23 | 97.27 | 4.5 | 99.61 | 4.53 |
| tree-view-cycle-visible-tree | user-flow | 11.47 | 0.36 | 12.56 | 0.49 | 12.92 | 0.54 |
| tree-group-toggle-tags-view | user-flow | 7.46 | 0.38 | 8.99 | 0.44 | 9.25 | 0.44 |
| tree-filter-visible-tree | user-flow | 0.41 | 0.35 | 0.52 | 0.51 | 0.53 | 0.75 |
| tree-view-repeat-click-burst | user-flow | 0.21 | 0.24 | 0.27 | 0.31 | 0.33 | 0.41 |
| tree-expansion-toggle-visible-tree | user-flow | 7.89 | 0.38 | 8.55 | 0.51 | 8.63 | 0.54 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 7.44 | 3.78 | 8.79 | 4.4 | 11.03 | 4.47 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 51.19 | 6.39 | 53.8 | 7.37 | 54.25 | 7.44 |
| visible-editor-highlight-open-file | user-flow | 19.5 | 1.61 | 20.85 | 2.16 | 21.92 | 2.44 |
| visible-editor-highlight-change-open-file | user-flow | 19.26 | 1.57 | 21.77 | 2.39 | 22.16 | 2.4 |
| visible-editor-custom-highlight-config-open-file | user-flow | 1791.22 | 2.55 | 1823.59 | 2.81 | 1832.76 | 4.38 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open-file-default-save-rescan-visible-tree | user-flow | 26.13 | 24.25 | 26.75 | 27 | 26.88 | 27.25 | 26.88 | 27.25 |
| open-file-custom-save-rescan-visible-tree | user-flow | 26.75 | 20.83 | 26.88 | 21.23 | 27.38 | 21.25 | 27.38 | 21.25 |
| tree-view-cycle-visible-tree | user-flow | 17.25 | 15.48 | 17.63 | 15.83 | 17.88 | 16.25 | 17.88 | 16.25 |
| tree-group-toggle-tags-view | user-flow | 17 | 15.35 | 17.5 | 15.88 | 17.5 | 16 | 17.5 | 16 |
| tree-filter-visible-tree | user-flow | 18.75 | 18.75 | 19.25 | 20.5 | 19.38 | 20.88 | 19.38 | 20.88 |
| tree-view-repeat-click-burst | user-flow | 1.25 | 2.88 | 1.38 | 3 | 1.38 | 3.25 | 1.38 | 3.25 |
| tree-expansion-toggle-visible-tree | user-flow | 17.25 | 15.5 | 17.75 | 15.85 | 17.88 | 16.13 | 17.88 | 16.13 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 18.38 | 17.88 | 18.75 | 18.5 | 18.75 | 18.87 | 18.75 | 18.87 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 79.75 | 23.38 | 88.13 | 30.75 | 88.5 | 31.38 | 88.5 | 31.38 |
| visible-editor-highlight-open-file | user-flow | 47.75 | 14.46 | 48.88 | 14.75 | 49.25 | 14.75 | 49.25 | 14.75 |
| visible-editor-highlight-change-open-file | user-flow | 48.5 | 14.38 | 49.63 | 14.82 | 49.63 | 14.88 | 49.63 | 14.88 |
| visible-editor-custom-highlight-config-open-file | user-flow | 160.13 | 14.85 | 163.13 | 15.08 | 164 | 15.38 | 164 | 15.38 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| open-file-default-save-rescan-visible-tree | user-flow | 82.74 | 80.79 | 83.34 | 83.54 | 83.35 | 83.7 | 83.35 | 83.7 |
| open-file-custom-save-rescan-visible-tree | user-flow | 83.23 | 77.44 | 83.8 | 77.61 | 83.87 | 77.71 | 83.87 | 77.71 |
| tree-view-cycle-visible-tree | user-flow | 73.63 | 72.18 | 74.13 | 72.51 | 74.32 | 72.89 | 74.32 | 72.89 |
| tree-group-toggle-tags-view | user-flow | 73.71 | 71.92 | 73.82 | 72.36 | 73.97 | 72.36 | 73.97 | 72.36 |
| tree-filter-visible-tree | user-flow | 75.4 | 75.5 | 75.8 | 77.07 | 75.82 | 77.51 | 75.82 | 77.51 |
| tree-view-repeat-click-burst | user-flow | 57.83 | 59.47 | 58 | 59.68 | 58.23 | 60.11 | 58.23 | 60.11 |
| tree-expansion-toggle-visible-tree | user-flow | 73.79 | 72.19 | 74.38 | 72.54 | 74.54 | 72.55 | 74.54 | 72.55 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 75.16 | 74.55 | 75.41 | 75.27 | 75.64 | 75.4 | 75.64 | 75.4 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 136.27 | 80.2 | 144.79 | 87.56 | 145.49 | 87.81 | 145.49 | 87.81 |
| visible-editor-highlight-open-file | user-flow | 104.43 | 70.95 | 105.53 | 71.28 | 105.93 | 71.32 | 105.93 | 71.32 |
| visible-editor-highlight-change-open-file | user-flow | 105.1 | 70.99 | 106.07 | 71.6 | 106.22 | 71.61 | 106.22 | 71.61 |
| visible-editor-custom-highlight-config-open-file | user-flow | 216.79 | 71.43 | 219.57 | 71.66 | 220.41 | 71.93 | 220.41 | 71.93 |
