'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const buffer = require('buffer');

const detection = require('../../src/detection');
const utils = require('../../src/utils');
const streamScanner = require('../../src/runtime/streamScanner');

const ITERATIONS = 7;
const LINE_COUNT = 60000;
const SEED = 91_92;

function parseArgs(argv) {
    const args = {
        jsonOut: path.join('artifacts', 'perf', 'issue91-92-large-embedded-scan.json'),
        markdownOut: path.join('artifacts', 'perf', 'issue91-92-large-embedded-scan.md')
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === '--json-out' && next) {
            args.jsonOut = next;
            index += 1;
            continue;
        }

        if ((arg === '--markdown-out' || arg === '--report-out') && next) {
            args.markdownOut = next;
            index += 1;
            continue;
        }

        throw new Error(`invalid argument ${arg}: expected --json-out or --markdown-out`);
    }

    return args;
}

function configureDetection() {
    utils.init({
        tagList: [
            'TODO',
            'FIXME'
        ],
        regexSource: utils.DEFAULT_REGEX_SOURCE,
        caseSensitive: false,
        multiLine: false,
        subTagRegexString: undefined,
        tags: function () {
            return this.tagList;
        },
        regex: function () {
            return {
                tags: this.tagList,
                regex: this.regexSource,
                caseSensitive: this.caseSensitive,
                multiLine: this.multiLine
            };
        },
        subTagRegex: function () {
            return this.subTagRegexString;
        },
        isRegexCaseSensitive: function () {
            return this.caseSensitive;
        },
        shouldGroupByTag: function () {
            return false;
        },
        globs: function () {
            return [];
        },
        shouldUseColourScheme: function () {
            return false;
        },
        defaultHighlight: function () {
            return {};
        },
        customHighlight: function () {
            return {};
        },
        foregroundColourScheme: function () {
            return [];
        },
        backgroundColourScheme: function () {
            return [];
        },
        customEmbeddedDocumentDescriptors: function () {
            return {};
        },
        customLanguageCommentPatterns: function () {
            return {};
        }
    });
}

function createVueDocument(lineCount) {
    const scriptLines = [];
    const templateLines = [];
    let state = SEED;

    for (let line = 0; line < lineCount; line += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        scriptLines.push(`const issue_${line}_${state} = ${state % 997};`);
        templateLines.push(`<section data-line="${line}">{{ issue_${line}_${state} }}</section>`);
    }

    scriptLines[Math.floor(lineCount / 3)] += ' // TODO: release delta cpu marker';
    templateLines[Math.floor(lineCount / 2)] += ' <!-- FIXME: release delta hang marker -->';

    const text = [
        '<template>',
        ...templateLines,
        '</template>',
        '<script>',
        ...scriptLines,
        '</script>'
    ].join('\n');

    return {
        text,
        matches: [
            createRipgrepMatch(text, '// TODO: release delta cpu marker'),
            createRipgrepMatch(text, '<!-- FIXME: release delta hang marker -->')
        ]
    };
}

function createRipgrepMatch(text, matchText) {
    const index = text.indexOf(matchText);

    if (index === -1) {
        throw new Error(`missing match text: ${matchText}`);
    }

    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const lineEndIndex = text.indexOf('\n', index);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex + 1;
    const line = text.slice(0, lineStart).split('\n').length;
    const column = index - lineStart + 1;

    return {
        fsPath: '',
        line,
        column,
        match: matchText,
        absoluteOffset: index,
        lines: text.slice(lineStart, lineEnd),
        submatches: [
            {
                match: matchText,
                start: column - 1,
                end: column - 1 + matchText.length
            }
        ]
    };
}

function percentile(values, percentileValue) {
    const sorted = values.slice().sort((left, right) => left - right);
    const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function summarize(values) {
    return {
        min: Number(Math.min(...values).toFixed(3)),
        p50: Number(percentile(values, 50).toFixed(3)),
        p95: Number(percentile(values, 95).toFixed(3)),
        max: Number(Math.max(...values).toFixed(3))
    };
}

function toMiB(bytes) {
    return bytes / 1024 / 1024;
}

function collectTodos(filePath, options) {
    const chunkDurations = [];

    return streamScanner.scanWorkspaceFileWithText(
        filePath,
        function (chunk) {
            const startedAt = performance.now();
            const response = detection.scanTextWithStreamingContext(
                detection.createScanContext(filePath, chunk, undefined, {
                    patternFileName: filePath
                })
            );
            chunkDurations.push(performance.now() - startedAt);
            return response;
        },
        options
    ).then((matches) => ({
        matches,
        chunkDurations
    }));
}

async function measureStrategy(filePath, label, optionsFactory) {
    const samples = [];

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        if (global.gc) {
            global.gc();
        }

        const rssBefore = process.memoryUsage().rss;
        const startedAt = performance.now();
        const result = await collectTodos(filePath, optionsFactory());
        const totalMs = performance.now() - startedAt;
        const rssAfter = process.memoryUsage().rss;

        samples.push({
            iteration,
            matchCount: result.matches.length,
            totalMs,
            maxChunkMs: Math.max(...result.chunkDurations),
            chunkCount: result.chunkDurations.length,
            rssDeltaMiB: toMiB(rssAfter - rssBefore)
        });
    }

    const matchCounts = samples.map((sample) => sample.matchCount);
    const expectedMatchCount = matchCounts[0];

    if (!matchCounts.every((matchCount) => matchCount === expectedMatchCount)) {
        throw new Error(`unstable match count for ${label}: ${matchCounts.join(',')}`);
    }

    return {
        label,
        matchCount: expectedMatchCount,
        totalMs: summarize(samples.map((sample) => sample.totalMs)),
        maxChunkMs: summarize(samples.map((sample) => sample.maxChunkMs)),
        chunkCount: summarize(samples.map((sample) => sample.chunkCount)),
        rssDeltaMiB: summarize(samples.map((sample) => sample.rssDeltaMiB)),
        samples: samples.map((sample) => ({
            iteration: sample.iteration,
            matchCount: sample.matchCount,
            totalMs: Number(sample.totalMs.toFixed(3)),
            maxChunkMs: Number(sample.maxChunkMs.toFixed(3)),
            chunkCount: sample.chunkCount,
            rssDeltaMiB: Number(sample.rssDeltaMiB.toFixed(3))
        }))
    };
}

async function measureRawNormalization(filePath, rawMatches) {
    const samples = [];

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        if (global.gc) {
            global.gc();
        }

        const rssBefore = process.memoryUsage().rss;
        const startedAt = performance.now();
        const matches = rawMatches.map((match) => {
            return detection.normalizeWorkspaceRegexMatch(filePath, Object.assign({}, match, {
                fsPath: filePath
            }));
        }).filter(Boolean);
        const totalMs = performance.now() - startedAt;
        const rssAfter = process.memoryUsage().rss;

        samples.push({
            iteration,
            matchCount: matches.length,
            totalMs,
            maxChunkMs: totalMs,
            chunkCount: 1,
            rssDeltaMiB: toMiB(rssAfter - rssBefore)
        });
    }

    const matchCounts = samples.map((sample) => sample.matchCount);
    const expectedMatchCount = matchCounts[0];

    if (!matchCounts.every((matchCount) => matchCount === expectedMatchCount)) {
        throw new Error(`unstable match count for oversized raw regex normalization: ${matchCounts.join(',')}`);
    }

    return {
        label: 'oversized raw regex normalization',
        matchCount: expectedMatchCount,
        totalMs: summarize(samples.map((sample) => sample.totalMs)),
        maxChunkMs: summarize(samples.map((sample) => sample.maxChunkMs)),
        chunkCount: summarize(samples.map((sample) => sample.chunkCount)),
        rssDeltaMiB: summarize(samples.map((sample) => sample.rssDeltaMiB)),
        samples: samples.map((sample) => ({
            iteration: sample.iteration,
            matchCount: sample.matchCount,
            totalMs: Number(sample.totalMs.toFixed(3)),
            maxChunkMs: Number(sample.maxChunkMs.toFixed(3)),
            chunkCount: sample.chunkCount,
            rssDeltaMiB: Number(sample.rssDeltaMiB.toFixed(3))
        }))
    };
}

function renderMarkdown(result) {
    const rows = result.strategies.map((strategy) => [
        strategy.label,
        strategy.matchCount,
        strategy.totalMs.p50,
        strategy.totalMs.p95,
        strategy.maxChunkMs.p50,
        strategy.maxChunkMs.p95,
        strategy.chunkCount.p50,
        strategy.rssDeltaMiB.p95
    ]);

    return [
        '# Issue 91 and 92 large embedded scan benchmark',
        '',
        `- seed: ${result.seed}`,
        `- iterations: ${result.iterations}`,
        `- lineCount: ${result.lineCount}`,
        `- bytes: ${result.bytes}`,
        '',
        '| strategy | matches | total p50 ms | total p95 ms | max chunk p50 ms | max chunk p95 ms | chunk p50 | rss p95 MiB |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...rows.map((row) => `| ${row.join(' | ')} |`)
    ].join('\n') + '\n';
}

async function main() {
    const args = parseArgs(process.argv);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'better-todo-tree-issue91-92-'));
    const filePath = path.join(tempDir, 'large.vue');

    try {
        configureDetection();
        const document = createVueDocument(LINE_COUNT);
        fs.writeFileSync(filePath, document.text);

        const strategies = [
            await measureStrategy(filePath, 'legacy in-memory threshold', () => ({
                maxInMemoryBytes: buffer.constants.MAX_STRING_LENGTH,
                chunkBytes: 64 * 1024 * 1024,
                overlapBytes: 1024 * 1024
            })),
            await measureStrategy(filePath, 'current streamed threshold', () => ({
                maxInMemoryBytes: streamScanner.DEFAULT_MAX_INMEMORY_SCAN_BYTES,
                chunkBytes: streamScanner.DEFAULT_STREAM_CHUNK_BYTES,
                overlapBytes: streamScanner.DEFAULT_STREAM_OVERLAP_BYTES
            })),
            await measureRawNormalization(filePath, document.matches)
        ];

        const result = {
            generatedAt: new Date(0).toISOString(),
            seed: SEED,
            iterations: ITERATIONS,
            lineCount: LINE_COUNT,
            bytes: Buffer.byteLength(document.text),
            defaults: {
                defaultMaxInMemoryScanBytes: streamScanner.DEFAULT_MAX_INMEMORY_SCAN_BYTES,
                defaultStreamChunkBytes: streamScanner.DEFAULT_STREAM_CHUNK_BYTES,
                defaultStreamOverlapBytes: streamScanner.DEFAULT_STREAM_OVERLAP_BYTES
            },
            strategies
        };

        fs.mkdirSync(path.dirname(args.jsonOut), {
            recursive: true
        });
        fs.mkdirSync(path.dirname(args.markdownOut), {
            recursive: true
        });
        fs.writeFileSync(args.jsonOut, JSON.stringify(result, null, 2) + '\n');
        fs.writeFileSync(args.markdownOut, renderMarkdown(result));
        console.log(JSON.stringify(result, null, 2));
    } finally {
        fs.rmSync(tempDir, {
            recursive: true,
            force: true
        });
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
