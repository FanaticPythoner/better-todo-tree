# Runtime Benchmarks

- Baseline ref: `a6f60e0ce830c4649ac34fc05e5a1799ec91d151`
- Current source: working tree
- Node: `v25.2.0`
- Selection mode: `scenario-list`
- Declared suite: `mixed`
- Result-count validation: `2 rows, suite-consistent=true, all-user-flow=false`

## Machine Profile

| Category | Field | Value |
| --- | --- | --- |
| Host | Hostname | n00ne-AERO-17-YD |
| Host | OS | Ubuntu 22.04.5 LTS |
| Host | Kernel | 6.8.0-117-generic |
| Host | Architecture | x64 |
| Host | Load Average | 3.53, 2.65, 2.38 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,767,552 bytes`) |
| Memory | Available At Collection | 17.17 GiB (`18,434,547,712 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 109 GiB (`117,100,265,472 bytes`) |
| Memory | DMI / SPD | Unavailable: /sys/firmware/dmi/tables/smbios_entry_point: Permission denied /dev/mem: Permission denied |
| Storage | Root Device | nvme0n1 (Samsung SSD 9100 PRO 4TB), 3.64 TiB (`4,000,787,030,016 bytes`), transport nvme, rotational=false, readOnly=false |

## Scenario Model

| Scenario | Kind | User flow | Measurement scope | Input model |
| --- | --- | --- | --- | --- |
| tree-render-counts | microbenchmark | - | - | - |
| tree-view-cycle-visible-tree | user-flow | Cycle the tree between flat, tags-only, and tree views and redraw the visible tree each time. | View-mode commands, workspace-state mutation, and visible-tree rebuild/render. | Fixture workspace tree in a VS Code event harness. |

## Metric Model

| Table | Value model | Accuracy model |
| --- | --- | --- |
| Latency | Wall-clock elapsed time around each harness flow iteration, summarized as min/p50/p90/p95/max. | Exact for each sampled iteration in this run. |
| Profiled RSS Burst | Difference between the isolated scenario worker RSS measured immediately before the flow and that worker iteration's OS high-water-mark peak RSS. | Exact for the measured worker iteration, using `process.memoryUsage().rss` at flow start and `process.resourceUsage().maxRSS` for the peak. |
| Profiled Peak RSS | Highest process RSS reached by each isolated scenario worker iteration. | Exact worker-process high-water mark from `process.resourceUsage().maxRSS`. |

## Latency

| Scenario | Kind | Baseline p50 ms | Current p50 ms | Baseline p90 ms | Current p90 ms | Baseline p95 ms | Current p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| tree-render-counts | microbenchmark | 14.76 | 4.84 | 18.15 | 6.12 | 23.49 | 6.46 |
| tree-view-cycle-visible-tree | user-flow | 9.65 | 0.39 | 10.44 | 0.47 | 11.61 | 0.49 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tree-render-counts | microbenchmark | 0 | 0 | 1.25 | 0 | 7.13 | 2.38 | 7.13 | 2.38 |
| tree-view-cycle-visible-tree | user-flow | 17 | 9.13 | 17.25 | 9.25 | 17.38 | 9.25 | 17.38 | 9.25 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tree-render-counts | microbenchmark | 149.4 | 149.29 | 150.54 | 149.29 | 157.67 | 151.29 | 157.67 | 151.29 |
| tree-view-cycle-visible-tree | user-flow | 72.66 | 64.47 | 73.02 | 64.77 | 73.21 | 64.88 | 73.21 | 64.88 |
