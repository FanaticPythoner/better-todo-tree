# Issue 42 Regex Engine Benchmark

## Corpus

| Field | Value |
| --- | ---: |
| Files | 160 |
| Task lines per file | 8 |
| Expected matches | 1280 |
| Regex edit | Removed `|;` from `utils.DEFAULT_REGEX_SOURCE` |
| `rg` binary | `node_modules/@vscode/ripgrep-universal/bin/linux-x64/rg` |

## Results

| Strategy | Exit | Lookaround error | Matches | p50 ms | p95 ms | Throughput matches/s | Peak RSS MiB |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Raw edited regex without PCRE2 | 2 | true | 0 | - | - | - | - |
| Raw edited regex with PCRE2 and workspace normalization | 0 | false | 1280 | 30.209 | 38.678 | 42370.9 | 94.12 |
| Candidate tag scan plus local normalization | 0 | false | 1280 | 22.259 | 27.029 | 57505.8 | 96.06 |

## Command

```bash
node --expose-gc scripts/perf/issue42-regex-engine.js
```

## Invariants

| Invariant | Value |
| --- | --- |
| Broken raw path fails before result parsing | `exit=2` |
| Fixed path returns all matches | `1280/1280` |
| Fixed path preserves rendered task text | Covered by `issue #42 PCRE2 markdown task payload keeps display text` |
| Candidate route avoids raw lookaround regex in `rg` | Covered by `issue #42 default-derived workspace regex uses candidate scan` |
