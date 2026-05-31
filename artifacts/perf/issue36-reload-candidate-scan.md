# Runtime Benchmarks

- Baseline ref: `a6f60e0ce830c4649ac34fc05e5a1799ec91d151`
- Current source: working tree
- Node: `v25.2.0`
- Selection mode: `scenario-list`
- Declared suite: `user-flow`
- Result-count validation: `1 rows, suite-consistent=true, all-user-flow=true`

## Machine Profile

| Category | Field | Value |
| --- | --- | --- |
| Host | Hostname | n00ne-AERO-17-YD |
| Host | OS | Ubuntu 22.04.5 LTS |
| Host | Kernel | 6.8.0-124-generic |
| Host | Architecture | x64 |
| Host | Load Average | 5.25, 5.51, 4.84 |
| Host | Available Parallelism | - |
| CPU | Model | Intel(R) Core(TM) i9-14900HX |
| CPU | Vendor | GenuineIntel |
| CPU | Topology | 16 logical CPU(s), 2 thread(s)/core, 8 core(s)/socket, 1 socket(s), 1 NUMA node(s) |
| CPU | Frequency | 800 MHz to 5,800 MHz |
| CPU | Cache | L1d 384 KiB (8 instances), L1i 256 KiB (8 instances), L2 16 MiB (8 instances), L3 36 MiB (1 instance) |
| Memory | Total RAM | 62.51 GiB (`67,119,767,552 bytes`) |
| Memory | Available At Collection | 12.60 GiB (`13,530,300,416 bytes`) |
| Memory | Online Physical RAM | 66.00 GiB (`70,866,960,384 bytes`) |
| Memory | Swap | total 120 GiB (`128,848,973,824 bytes`); free 98.80 GiB (`106,081,943,552 bytes`) |
| Memory | DMI / SPD | Unavailable: /sys/firmware/dmi/tables/smbios_entry_point: Permission denied /dev/mem: Permission denied |
| Storage | Root Device | nvme1n1 (Samsung SSD 9100 PRO 4TB), 3.64 TiB (`4,000,787,030,016 bytes`), transport nvme, rotational=false, readOnly=false |

## Scenario Model

| Scenario | Kind | User flow | Measurement scope | Input model |
| --- | --- | --- | --- | --- |
| workspace-custom-relative-rebuild-visible-tree | user-flow | Trigger a workspace refresh with custom regex scanning and rebuild the visible tree from workspace matches. | Workspace refresh orchestration, ripgrep event handling, regex-match normalization, result application, and tree rebuild/render. | Fixture ripgrep matches, fixture file contents, and fixture normalized regex results in a VS Code event harness. |

## Metric Model

| Table | Value model | Accuracy model |
| --- | --- | --- |
| Latency | Wall-clock elapsed time around each harness flow iteration, summarized as min/p50/p90/p95/max. | Exact for each sampled iteration in this run. |
| Profiled RSS Burst | Difference between the isolated scenario worker RSS measured immediately before the flow and that worker iteration's OS high-water-mark peak RSS. | Exact for the measured worker iteration, using `process.memoryUsage().rss` at flow start and `process.resourceUsage().maxRSS` for the peak. |
| Profiled Peak RSS | Highest process RSS reached by each isolated scenario worker iteration. | Exact worker-process high-water mark from `process.resourceUsage().maxRSS`. |

## Latency

| Scenario | Kind | Baseline p50 ms | Current p50 ms | Baseline p90 ms | Current p90 ms | Baseline p95 ms | Current p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 52.33 | 5.45 | 57.76 | 6.18 | 58.76 | 7.43 |

## Profiled RSS Burst

| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 70.13 | 17.38 | 71.88 | 17.63 | 74.88 | 17.88 | 74.88 | 17.88 |

## Profiled Peak RSS

| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| workspace-custom-relative-rebuild-visible-tree | user-flow | 125.93 | 73.59 | 127.81 | 73.74 | 131.13 | 74.08 | 131.13 | 74.08 |
