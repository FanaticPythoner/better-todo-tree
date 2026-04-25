# Runtime Benchmarks

- Baseline ref: `a6f60e0ce830c4649ac34fc05e5a1799ec91d151`
- Current source: working tree
- Node: `v24.8.0`
- Selection mode: `suite`
- Declared suite: `all`
- Result-count validation: `20 rows, suite-consistent=true, all-user-flow=false`

## Machine Profile

| Category | Field | Value |
| --- | --- | --- |
| Host | Hostname | n00ne-AERO-17-YD |
| Host | OS | Ubuntu 22.04.5 LTS |
| Host | Kernel | 6.8.0-110-generic |
| Host | Architecture | x64 |
| Host | Load Average | 2.77, 3.57, 3.94 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,755,264 bytes`) |
| Memory | Available At Collection | 34.28 GiB (`36,812,800,000 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 104 GiB (`111,549,779,968 bytes`) |
| Memory | DMI / SPD | Accessible |
| Storage | Root Device | nvme1n1 (Samsung SSD 9100 PRO 4TB), 3.64 TiB (`4,000,787,030,016 bytes`), transport nvme, rotational=false, readOnly=false |

## Scenario Model

| Scenario | Kind | User flow | Measurement scope | Input model |
| --- | --- | --- | --- | --- |
| scan-large-default | microbenchmark | - | - | - |
| scan-large-custom-regex | microbenchmark | - | - | - |
| tree-render-counts | microbenchmark | - | - | - |
| highlight-repeat-visible-doc | microbenchmark | - | - | - |
| workspace-json-streaming | microbenchmark | - | - | - |
| attributes-custom-highlight | microbenchmark | - | - | - |
| workspace-incremental-rescans | microbenchmark | - | - | - |
| workspace-incremental-updates | microbenchmark | - | - | - |
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
| scan-large-default | microbenchmark | 6.49 | 21.94 | 8.2 | 24.78 | 8.63 | 34.85 |
| scan-large-custom-regex | microbenchmark | 5.09 | 7.91 | 6 | 10 | 6.04 | 10.16 |
| tree-render-counts | microbenchmark | 8.96 | 4.14 | 11.3 | 8.19 | 13.2 | 8.56 |
| highlight-repeat-visible-doc | microbenchmark | 0.34 | 0.16 | 0.52 | 0.34 | 0.53 | 0.35 |
| workspace-json-streaming | microbenchmark | 3.71 | 88.66 | 4.63 | 93.99 | 5.16 | 100.41 |
| attributes-custom-highlight | microbenchmark | 54.43 | 0.07 | 56.47 | 0.1 | 59.19 | 0.2 |
| workspace-incremental-rescans | microbenchmark | 532.06 | 23.48 | 580.25 | 27.66 | 580.25 | 27.66 |
| workspace-incremental-updates | microbenchmark | 516.16 | 17.25 | 523.32 | 19.39 | 523.32 | 19.39 |
| open-file-default-save-rescan-visible-tree | user-flow | 86.66 | 1.64 | 92.54 | 1.94 | 93.84 | 2.08 |
| open-file-custom-save-rescan-visible-tree | user-flow | 77.54 | 2.48 | 84.67 | 3.02 | 89.03 | 3.89 |
| tree-view-cycle-visible-tree | user-flow | 8.24 | 39.72 | 8.73 | 42.17 | 8.94 | 42.72 |
| tree-group-toggle-tags-view | user-flow | 6.3 | 8.13 | 6.98 | 9.33 | 7.94 | 10.64 |
| tree-filter-visible-tree | user-flow | 0.32 | 1.35 | 0.45 | 1.41 | 0.47 | 1.64 |
| tree-view-repeat-click-burst | user-flow | 0.23 | 0.2 | 0.32 | 0.29 | 0.35 | 0.33 |
| tree-expansion-toggle-visible-tree | user-flow | 6.53 | 9.61 | 8.11 | 15.36 | 12.85 | 16.37 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 5.37 | 7.61 | 8.12 | 9.08 | 8.52 | 9.18 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 39.39 | 14.69 | 45.1 | 16.03 | 45.95 | 17.43 |
| visible-editor-highlight-open-file | user-flow | 15.79 | 1.46 | 17.8 | 2.08 | 18.49 | 2.36 |
| visible-editor-highlight-change-open-file | user-flow | 14.4 | 1.5 | 18.68 | 2.31 | 29.93 | 2.43 |
| visible-editor-custom-highlight-config-open-file | user-flow | 1171.33 | 2.42 | 1244.6 | 3.37 | 1282.1 | 3.86 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| scan-large-default | microbenchmark | 0.75 | 1.04 | 0.75 | 16.48 | 0.88 | 27.42 | 0.88 | 27.42 |
| scan-large-custom-regex | microbenchmark | 0.75 | 0.75 | 1.38 | 0.75 | 2.38 | 0.75 | 2.38 | 0.75 |
| tree-render-counts | microbenchmark | 0 | 0 | 0.13 | 0.75 | 0.88 | 3 | 0.88 | 3 |
| highlight-repeat-visible-doc | microbenchmark | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| workspace-json-streaming | microbenchmark | 0.38 | 0 | 0.63 | 0.63 | 1.25 | 0.88 | 1.25 | 0.88 |
| attributes-custom-highlight | microbenchmark | 0 | 0 | 0 | 0 | 0 | 0 | 0.25 | 0 |
| workspace-incremental-rescans | microbenchmark | 10.2 | 0 | 10.74 | 0.38 | 10.74 | 0.38 | 10.74 | 0.38 |
| workspace-incremental-updates | microbenchmark | 10.16 | 0 | 10.36 | 0 | 10.36 | 0 | 10.36 | 0 |
| open-file-default-save-rescan-visible-tree | user-flow | 26.89 | 24.63 | 27.88 | 24.88 | 28.75 | 25 | 28.75 | 25 |
| open-file-custom-save-rescan-visible-tree | user-flow | 28 | 21.48 | 28.38 | 21.63 | 28.5 | 21.75 | 28.5 | 21.75 |
| tree-view-cycle-visible-tree | user-flow | 14.95 | 27.5 | 16.63 | 32.76 | 17 | 33.25 | 17 | 33.25 |
| tree-group-toggle-tags-view | user-flow | 13.85 | 22.26 | 15.88 | 24 | 16 | 24.5 | 16 | 24.5 |
| tree-filter-visible-tree | user-flow | 16.74 | 21.2 | 18.18 | 23.64 | 18.75 | 25.88 | 18.75 | 25.88 |
| tree-view-repeat-click-burst | user-flow | 1.25 | 1.63 | 1.5 | 1.75 | 1.5 | 1.88 | 1.5 | 1.88 |
| tree-expansion-toggle-visible-tree | user-flow | 14.01 | 22.37 | 15.5 | 22.89 | 15.75 | 23.88 | 15.75 | 23.88 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 14.91 | 25.25 | 16.5 | 28.16 | 16.75 | 30.38 | 16.75 | 30.38 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 71.67 | 42.64 | 73.34 | 42.87 | 74.32 | 43.7 | 74.32 | 43.7 |
| visible-editor-highlight-open-file | user-flow | 46.66 | 11.88 | 48 | 12.13 | 49.13 | 12.13 | 49.13 | 12.13 |
| visible-editor-highlight-change-open-file | user-flow | 46.73 | 11.88 | 48.63 | 12.25 | 48.88 | 12.5 | 48.88 | 12.5 |
| visible-editor-custom-highlight-config-open-file | user-flow | 159.11 | 14.63 | 161.35 | 15 | 167.26 | 15 | 167.26 | 15 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| scan-large-default | microbenchmark | 120.16 | 119.17 | 120.56 | 119.47 | 120.59 | 120.11 | 120.59 | 120.11 |
| scan-large-custom-regex | microbenchmark | 121.03 | 120.31 | 121.03 | 120.49 | 121.94 | 121.67 | 121.94 | 121.67 |
| tree-render-counts | microbenchmark | 214.85 | 214.34 | 215.21 | 215.21 | 215.21 | 217 | 215.21 | 217 |
| highlight-repeat-visible-doc | microbenchmark | 215.1 | 215.1 | 215.1 | 215.1 | 215.1 | 215.1 | 215.1 | 215.1 |
| workspace-json-streaming | microbenchmark | 217.98 | 216.12 | 218.04 | 217 | 218.04 | 217 | 218.04 | 217 |
| attributes-custom-highlight | microbenchmark | 217.72 | 217.47 | 217.72 | 217.47 | 217.72 | 217.47 | 217.72 | 217.62 |
| workspace-incremental-rescans | microbenchmark | 262.07 | 251.32 | 262.13 | 251.47 | 262.13 | 251.47 | 262.13 | 251.47 |
| workspace-incremental-updates | microbenchmark | 271.22 | 260.96 | 271.4 | 260.96 | 271.4 | 260.96 | 271.4 | 260.96 |
| open-file-default-save-rescan-visible-tree | user-flow | 84.77 | 82.5 | 85.57 | 82.72 | 86.76 | 82.9 | 86.76 | 82.9 |
| open-file-custom-save-rescan-visible-tree | user-flow | 85.72 | 79.31 | 86.31 | 79.47 | 86.32 | 79.69 | 86.32 | 79.69 |
| tree-view-cycle-visible-tree | user-flow | 72.9 | 85.13 | 74.6 | 90.63 | 74.84 | 90.83 | 74.84 | 90.83 |
| tree-group-toggle-tags-view | user-flow | 71.88 | 80.05 | 73.84 | 82.15 | 73.87 | 82.19 | 73.87 | 82.19 |
| tree-filter-visible-tree | user-flow | 74.77 | 79.09 | 76.33 | 81.58 | 76.64 | 83.71 | 76.64 | 83.71 |
| tree-view-repeat-click-burst | user-flow | 59.29 | 59.56 | 59.43 | 59.63 | 59.44 | 59.71 | 59.44 | 59.71 |
| tree-expansion-toggle-visible-tree | user-flow | 71.85 | 80.55 | 73.3 | 80.95 | 73.63 | 81.61 | 73.63 | 81.61 |
| workspace-default-relative-rebuild-visible-tree | user-flow | 73.1 | 83.13 | 74.62 | 86.17 | 74.66 | 88.32 | 74.66 | 88.32 |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 129.09 | 100.59 | 131.2 | 100.77 | 132.36 | 101.64 | 132.36 | 101.64 |
| visible-editor-highlight-open-file | user-flow | 104.63 | 69.84 | 106.1 | 70.01 | 106.86 | 70.16 | 106.86 | 70.16 |
| visible-editor-highlight-change-open-file | user-flow | 104.84 | 69.85 | 106.59 | 70.19 | 106.76 | 70.44 | 106.76 | 70.44 |
| visible-editor-custom-highlight-config-open-file | user-flow | 217 | 72.6 | 219.05 | 72.79 | 225.27 | 72.82 | 225.27 | 72.82 |
