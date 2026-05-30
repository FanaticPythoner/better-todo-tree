# Runtime Benchmarks

- Baseline ref: `a6f60e0ce830c4649ac34fc05e5a1799ec91d151`
- Current source: working tree
- Node: `v25.2.0`
- Selection mode: `scenario-list`
- Declared suite: `mixed`
- Result-count validation: `4 rows, suite-consistent=true, all-user-flow=false`

## Machine Profile

| Category | Field | Value |
| --- | --- | --- |
| Host | Hostname | n00ne-AERO-17-YD |
| Host | OS | Ubuntu 22.04.5 LTS |
| Host | Kernel | 6.8.0-117-generic |
| Host | Architecture | x64 |
| Host | Load Average | 3.34, 3.63, 3.14 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,767,552 bytes`) |
| Memory | Available At Collection | 17.92 GiB (`19,236,577,280 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 109 GiB (`116,994,105,344 bytes`) |
| Memory | DMI / SPD | Unavailable: /sys/firmware/dmi/tables/smbios_entry_point: Permission denied /dev/mem: Permission denied |
| Storage | Root Device | nvme0n1 (Samsung SSD 9100 PRO 4TB), 3.64 TiB (`4,000,787,030,016 bytes`), transport nvme, rotational=false, readOnly=false |

## Scenario Model

| Scenario | Kind | User flow | Measurement scope | Input model |
| --- | --- | --- | --- | --- |
| scan-large-custom-regex | microbenchmark | - | - | - |
| attributes-custom-highlight | microbenchmark | - | - | - |
| open-file-custom-save-rescan-visible-tree | user-flow | Save an already-open file that uses custom regex scanning and redraw the visible tree. | Document save listener, custom-regex document rescan, search-result replacement, and visible-tree render. | Real document text in a VS Code event harness. |
| tree-render-counts | microbenchmark | - | - | - |

## Metric Model

| Table | Value model | Accuracy model |
| --- | --- | --- |
| Latency | Wall-clock elapsed time around each harness flow iteration, summarized as min/p50/p90/p95/max. | Exact for each sampled iteration in this run. |
| Profiled RSS Burst | Difference between the isolated scenario worker RSS measured immediately before the flow and that worker iteration's OS high-water-mark peak RSS. | Exact for the measured worker iteration, using `process.memoryUsage().rss` at flow start and `process.resourceUsage().maxRSS` for the peak. |
| Profiled Peak RSS | Highest process RSS reached by each isolated scenario worker iteration. | Exact worker-process high-water mark from `process.resourceUsage().maxRSS`. |

## Latency

| Scenario | Kind | Baseline p50 ms | Current p50 ms | Baseline p90 ms | Current p90 ms | Baseline p95 ms | Current p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scan-large-custom-regex | microbenchmark | 5.17 | 9.12 | 6.06 | 9.81 | 6.61 | 10.34 |
| attributes-custom-highlight | microbenchmark | 59.84 | 0.06 | 62.13 | 0.09 | 63.14 | 0.24 |
| open-file-custom-save-rescan-visible-tree | user-flow | 83.45 | 2.79 | 87.28 | 3.04 | 90.21 | 3.05 |
| tree-render-counts | microbenchmark | 12.11 | 4.73 | 13.49 | 5.68 | 18.63 | 6.17 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| scan-large-custom-regex | microbenchmark | 0.75 | 0.75 | 1.13 | 2.13 | 1.13 | 5 | 1.13 | 5 |
| attributes-custom-highlight | microbenchmark | 0 | 0 | 0 | 0 | 0 | 0 | 1.63 | 0 |
| open-file-custom-save-rescan-visible-tree | user-flow | 26.88 | 21 | 27.25 | 21.5 | 27.38 | 21.73 | 27.38 | 21.73 |
| tree-render-counts | microbenchmark | 0 | 0 | 1.63 | 0 | 4.25 | 0 | 4.25 | 0 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| scan-large-custom-regex | microbenchmark | 76.2 | 75.42 | 76.58 | 75.56 | 76.58 | 75.56 | 76.58 | 75.56 |
| attributes-custom-highlight | microbenchmark | 76.33 | 76.02 | 76.33 | 76.02 | 76.33 | 76.02 | 77.64 | 76.02 |
| open-file-custom-save-rescan-visible-tree | user-flow | 82.46 | 76.59 | 82.94 | 77.06 | 83.09 | 77.08 | 83.09 | 77.08 |
| tree-render-counts | microbenchmark | 238.73 | 241.16 | 242.91 | 241.16 | 247.16 | 241.16 | 247.16 | 241.16 |
