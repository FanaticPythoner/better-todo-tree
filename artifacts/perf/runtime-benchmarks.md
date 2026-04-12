# Runtime Benchmarks

| Scenario | Baseline p50 ms | Current p50 ms | Baseline p95 ms | Current p95 ms | Baseline RSS MiB | Current RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scan-large-default | 34.37 | 31.85 | 48.08 | 41.35 | 197.3 | 120.48 |
| scan-large-custom-regex | 12304.66 | 8.99 | 13389.52 | 11.42 | 263.92 | 196.43 |
| tree-render-counts | 6.98 | 3.41 | 10.76 | 4.88 | 214.48 | 213.64 |
| highlight-repeat-visible-doc | 0.14 | 0.16 | 0.42 | 0.26 | 214.73 | 214.73 |
| workspace-json-streaming | 173.18 | 105.75 | 202.03 | 117.25 | 215.84 | 215.43 |
| attributes-custom-highlight | 5889.01 | 5.03 | 11397.21 | 6.08 | 217.52 | 216.27 |
