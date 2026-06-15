# Issue 19 Embedded Documents Benchmark

## Corpus

| Field | Value |
| --- | ---: |
| Files | 250 |
| Regions per file | 3 |
| Expected baseline matches | 250 |
| Expected current matches | 1000 |
| Target extension | `.vue` |

## Results

| Strategy | Matches | p50 ms | p95 ms | Throughput matches/s | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Base markup only | 250 | 5.121 | 6.98 | 48818.59 | 67.535 |
| Embedded descriptor scan | 1000 | 19.916 | 26.615 | 50210.886 | 73.254 |

## Command

```bash
node --expose-gc scripts/perf/issue19-embedded-documents.js
```
