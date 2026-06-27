# Runtime Benchmarks

- Baseline ref: `a6f60e0ce830c4649ac34fc05e5a1799ec91d151`
- Current source: working tree
- Node: `v25.2.0`
- Selection mode: `scenario-list`
- Declared suite: `user-flow`
- Result-count validation: `3 rows, suite-consistent=true, all-user-flow=true`

## Machine Profile

| Category | Field | Value |
| --- | --- | --- |
| Host | Hostname | n00ne-AERO-17-YD |
| Host | OS | Ubuntu 22.04.5 LTS |
| Host | Kernel | 6.8.0-124-generic |
| Host | Architecture | x64 |
| Host | Load Average | 6.83, 6.21, 5.78 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,755,264 bytes`) |
| Memory | Available At Collection | 28.58 GiB (`30,685,663,232 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 83.55 GiB (`89,709,338,624 bytes`) |
| Memory | DMI / SPD | Unavailable: /sys/firmware/dmi/tables/smbios_entry_point: Permission denied /dev/mem: Permission denied |
| Storage | Root Device | nvme0n1 (Samsung SSD 9100 PRO 4TB), 3.64 TiB (`4,000,787,030,016 bytes`), transport nvme, rotational=false, readOnly=false |

## Scenario Model

| Scenario | Kind | User flow | Measurement scope | Input model |
| --- | --- | --- | --- | --- |
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
| visible-editor-highlight-open-file | user-flow | 21.99 | 1.85 | 24.44 | 2.56 | 25.49 | 2.74 |
| visible-editor-highlight-change-open-file | user-flow | 19.89 | 1.88 | 22.15 | 2.62 | 22.25 | 2.83 |
| visible-editor-custom-highlight-config-open-file | user-flow | 1892.85 | 2.92 | 1925.68 | 4.26 | 1927.01 | 4.33 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| visible-editor-highlight-open-file | user-flow | 47.88 | 14.45 | 49.38 | 14.88 | 49.5 | 15 | 49.5 | 15 |
| visible-editor-highlight-change-open-file | user-flow | 48 | 14.38 | 49.25 | 14.88 | 49.63 | 15 | 49.63 | 15 |
| visible-editor-custom-highlight-config-open-file | user-flow | 160.59 | 14.97 | 162.88 | 15.23 | 163.25 | 15.25 | 163.25 | 15.25 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| visible-editor-highlight-open-file | user-flow | 104.39 | 71.12 | 105.7 | 71.23 | 106.22 | 71.6 | 106.22 | 71.6 |
| visible-editor-highlight-change-open-file | user-flow | 104.84 | 70.91 | 105.96 | 71.34 | 106.34 | 71.75 | 106.34 | 71.75 |
| visible-editor-custom-highlight-config-open-file | user-flow | 217.21 | 71.44 | 219.47 | 71.77 | 220.12 | 71.96 | 220.12 | 71.96 |
