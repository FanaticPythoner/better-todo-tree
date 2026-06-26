# Issue 91 and 92 large embedded scan benchmark

- seed: 9192
- iterations: 7
- lineCount: 60000
- bytes: 6049086

| strategy | matches | total p50 ms | total p95 ms | max chunk p50 ms | max chunk p95 ms | chunk p50 | rss p95 MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy in-memory threshold | 2 | 144.77 | 164.638 | 140.575 | 156.331 | 1 | 42.246 |
| current streamed threshold | 2 | 737.713 | 754.363 | 57.805 | 59.234 | 23 | 16.684 |
| oversized raw regex normalization | 2 | 0.157 | 1.221 | 0.157 | 1.221 | 1 | 0 |
