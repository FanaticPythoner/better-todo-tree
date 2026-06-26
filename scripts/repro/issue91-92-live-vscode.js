'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_DURATION_MS = 20000;
const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_CAPTURE_AT_MS = 5000;
const DEFAULT_FILE_COUNT = 90;
const DEFAULT_LINES_PER_FILE = 15000;
const SEED = 91_92;

function parseArgs(argv) {
    const args = {
        codePath: 'code',
        extensionPath: process.cwd(),
        workspacePath: path.join('artifacts', 'repro', 'issue91-92-live-workspace'),
        outDir: path.join('artifacts', 'repro', 'issue91-92-live-current'),
        label: 'current',
        durationMs: DEFAULT_DURATION_MS,
        sampleIntervalMs: DEFAULT_SAMPLE_INTERVAL_MS,
        captureAtMs: DEFAULT_CAPTURE_AT_MS,
        fileCount: DEFAULT_FILE_COUNT,
        linesPerFile: DEFAULT_LINES_PER_FILE,
        generateWorkspace: false,
        noExtension: false
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === '--code' && next) {
            args.codePath = next;
            index += 1;
        } else if (arg === '--extension-path' && next) {
            args.extensionPath = next;
            index += 1;
        } else if (arg === '--workspace' && next) {
            args.workspacePath = next;
            index += 1;
        } else if (arg === '--out-dir' && next) {
            args.outDir = next;
            index += 1;
        } else if (arg === '--label' && next) {
            args.label = next;
            index += 1;
        } else if (arg === '--duration-ms' && next) {
            args.durationMs = parsePositiveInteger(next, arg);
            index += 1;
        } else if (arg === '--sample-interval-ms' && next) {
            args.sampleIntervalMs = parsePositiveInteger(next, arg);
            index += 1;
        } else if (arg === '--capture-at-ms' && next) {
            args.captureAtMs = parsePositiveInteger(next, arg);
            index += 1;
        } else if (arg === '--file-count' && next) {
            args.fileCount = parsePositiveInteger(next, arg);
            index += 1;
        } else if (arg === '--lines-per-file' && next) {
            args.linesPerFile = parsePositiveInteger(next, arg);
            index += 1;
        } else if (arg === '--generate-workspace') {
            args.generateWorkspace = true;
        } else if (arg === '--no-extension') {
            args.noExtension = true;
        } else {
            throw new Error(`invalid argument ${arg}`);
        }
    }

    return args;
}

function parsePositiveInteger(value, label) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} requires a positive integer`);
    }

    return parsed;
}

function mkdirp(dirPath) {
    fs.mkdirSync(dirPath, {
        recursive: true
    });
}

function writeJson(filePath, value) {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function createSettings() {
    return {
        'better-todo-tree.general.debug': true,
        'better-todo-tree.general.showScanningProgress': 'all',
        'better-todo-tree.general.statusBar': 'total',
        'better-todo-tree.tree.scanAtStartup': true,
        'better-todo-tree.tree.scanMode': 'workspace',
        'better-todo-tree.filtering.includeGlobs': [
            '**/*'
        ],
        'better-todo-tree.filtering.excludeGlobs': [],
        'better-todo-tree.filtering.passGlobsToRipgrep': true,
        'better-todo-tree.filtering.useBuiltInExcludes': 'none',
        'better-todo-tree.ripgrep.usePatternFile': true,
        'better-todo-tree.ripgrep.ripgrepArgs': '--max-columns=1000 --no-config ',
        'better-todo-tree.general.periodicRefreshInterval': 0,
        'better-todo-tree.general.automaticGitRefreshInterval': 0,
        'security.workspace.trust.enabled': false,
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'extensions.autoCheckUpdates': false,
        'extensions.autoUpdate': false,
        'workbench.startupEditor': 'none'
    };
}

function createVueDocument(fileIndex, linesPerFile) {
    const lines = [
        '<template>'
    ];
    let state = (SEED + fileIndex) >>> 0;

    for (let line = 0; line < linesPerFile; line += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        lines.push(`<div data-row="${line}" data-seed="${state}">{{ row_${fileIndex}_${line} }}</div>`);
    }

    lines.push('</template>');
    lines.push('<script setup>');

    for (let line = 0; line < linesPerFile; line += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        if (line === Math.floor(linesPerFile / 2)) {
            lines.push(`const marker_${fileIndex}_${line} = ${state}; // TODO issue 91 92 live marker ${fileIndex}`);
        } else {
            lines.push(`const marker_${fileIndex}_${line} = ${state};`);
        }
    }

    lines.push('</script>');
    lines.push('<style>');
    lines.push(`.component-${fileIndex} { color: #123456; }`);
    lines.push('</style>');

    return lines.join('\n') + '\n';
}

function createAstroDocument(fileIndex, linesPerFile) {
    const lines = [
        '---'
    ];
    let state = (SEED + fileIndex + 1000) >>> 0;

    for (let line = 0; line < Math.max(10, Math.floor(linesPerFile / 8)); line += 1) {
        state = (state * 1103515245 + 12345) >>> 0;
        if (line === 4) {
            lines.push(`const astroMarker${fileIndex} = ${state}; // FIXME issue 91 92 astro marker ${fileIndex}`);
        } else {
            lines.push(`const astroValue${fileIndex}_${line} = ${state};`);
        }
    }

    lines.push('---');
    lines.push(`<main data-file="${fileIndex}">`);
    lines.push('  {/* TODO issue 91 92 astro template marker */}');
    lines.push('</main>');

    return lines.join('\n') + '\n';
}

function generateWorkspace(args) {
    fs.rmSync(args.workspacePath, {
        recursive: true,
        force: true
    });
    mkdirp(path.join(args.workspacePath, '.vscode'));
    mkdirp(path.join(args.workspacePath, 'src'));

    writeJson(path.join(args.workspacePath, '.vscode', 'settings.json'), createSettings());

    for (let index = 0; index < args.fileCount; index += 1) {
        const extension = index % 10 === 0 ? '.astro' : '.vue';
        const content = extension === '.astro' ?
            createAstroDocument(index, args.linesPerFile) :
            createVueDocument(index, args.linesPerFile);
        fs.writeFileSync(path.join(args.workspacePath, 'src', `component-${String(index).padStart(4, '0')}${extension}`), content);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options) {
    return childProcess.execFileSync(command, args, Object.assign({
        encoding: 'utf8',
        stdio: [
            'ignore',
            'pipe',
            'pipe'
        ]
    }, options || {}));
}

function finiteNumber(value, label) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        throw new Error(`invalid ${label}: ${value}`);
    }

    return parsed;
}

function splitLines(text) {
    const lines = [];
    let start = 0;

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '\n') {
            const end = index > start && text[index - 1] === '\r' ? index - 1 : index;
            lines.push(text.slice(start, end));
            start = index + 1;
        }
    }

    if (start < text.length) {
        const end = text[text.length - 1] === '\r' ? text.length - 1 : text.length;
        lines.push(text.slice(start, end));
    }

    return lines;
}

function isWhitespace(character) {
    return character === ' ' || character === '\t';
}

function splitWhitespaceColumns(text, limit) {
    const columns = [];
    let index = 0;

    while (index < text.length && columns.length < limit) {
        while (index < text.length && isWhitespace(text[index])) {
            index += 1;
        }

        if (index >= text.length) {
            break;
        }

        if (columns.length === limit - 1) {
            columns.push(text.slice(index));
            return columns;
        }

        const start = index;
        while (index < text.length && isWhitespace(text[index]) !== true) {
            index += 1;
        }
        columns.push(text.slice(start, index));
    }

    return columns;
}

function listProcesses(userDataDir) {
    const output = runCommand('ps', [
        '-eo',
        'pid=,ppid=,pcpu=,pmem=,rss=,etime=,args='
    ]);

    return splitLines(output).filter((line) => line.indexOf(userDataDir) !== -1).map((line) => line.trim());
}

function resolveClockTicksPerSecond() {
    const output = runCommand('getconf', [
        'CLK_TCK'
    ]).trim();
    const value = Number(output);

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`invalid CLK_TCK: ${output}`);
    }

    return value;
}

function readProcessCpuTicks(pid) {
    const statPath = path.join('/proc', String(pid), 'stat');

    try {
        const stat = fs.readFileSync(statPath, 'utf8');
        const closeParen = stat.lastIndexOf(')');

        if (closeParen === -1) {
            throw new Error(`invalid proc stat for pid ${pid}: missing command terminator`);
        }

        const fields = splitWhitespaceColumns(stat.slice(closeParen + 2).trim(), Number.MAX_SAFE_INTEGER);
        const userTicks = finiteNumber(fields[11], `proc user ticks for pid ${pid}`);
        const systemTicks = finiteNumber(fields[12], `proc system ticks for pid ${pid}`);

        return userTicks + systemTicks;
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EACCES') {
            return undefined;
        }

        throw error;
    }
}

function parseProcessLine(line) {
    const columns = splitWhitespaceColumns(line, 7);

    if (columns.length < 7) {
        throw new Error(`invalid process row: ${line}`);
    }

    return {
        pid: finiteNumber(columns[0], 'pid'),
        ppid: finiteNumber(columns[1], 'ppid'),
        cpuPercent: finiteNumber(columns[2], 'cpu percent'),
        cpuTicks: readProcessCpuTicks(finiteNumber(columns[0], 'pid')),
        memoryPercent: finiteNumber(columns[3], 'memory percent'),
        rssKiB: finiteNumber(columns[4], 'rss KiB'),
        elapsed: columns[5],
        command: columns[6]
    };
}

function captureScreenshot(outDir, label) {
    const filePath = path.join(outDir, `${label}.png`);
    const output = runCommand('import', [
        '-window',
        'root',
        filePath
    ]);

    return {
        filePath,
        output
    };
}

function killProcesses(userDataDir) {
    const processes = listProcesses(userDataDir).map(parseProcessLine).filter((entry) => typeof entry.pid === 'number');

    processes.sort((left, right) => right.pid - left.pid).forEach((entry) => {
        try {
            process.kill(entry.pid, 'SIGTERM');
        } catch (error) {
            if (error.code !== 'ESRCH') {
                throw error;
            }
        }
    });

    return processes.map((entry) => entry.pid);
}

function summarizeSamplesForExtensionHostPids(samples, extensionHostPids) {
    const pidSet = new Set(extensionHostPids);
    const clockTicksPerSecond = resolveClockTicksPerSecond();
    const extensionHostSamples = samples.flatMap((sample) => sample.processes).filter((entry) => {
        return typeof entry.pid === 'number' && (
            pidSet.has(entry.pid) ||
            (entry.command && entry.command.indexOf('extension-host') !== -1) ||
            (entry.command && entry.command.indexOf('extensionHost') !== -1)
        );
    });
    const cpuValues = extensionHostSamples.map((entry) => entry.cpuPercent);
    const rssValues = extensionHostSamples.map((entry) => entry.rssKiB);
    const intervalCpuValues = extensionHostPids.flatMap((pid) => summarizeIntervalCpuForPid(samples, pid, clockTicksPerSecond));

    return {
        sampleCount: samples.length,
        extensionHostSampleCount: extensionHostSamples.length,
        extensionHostCpuMax: cpuValues.length > 0 ? Math.max(...cpuValues) : 0,
        extensionHostCpuMean: cpuValues.length > 0 ? cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length : 0,
        extensionHostIntervalCpuMax: intervalCpuValues.length > 0 ? Math.max(...intervalCpuValues) : 0,
        extensionHostIntervalCpuMean: intervalCpuValues.length > 0 ?
            intervalCpuValues.reduce((sum, value) => sum + value, 0) / intervalCpuValues.length :
            0,
        extensionHostRssKiBMax: rssValues.length > 0 ? Math.max(...rssValues) : 0,
        clockTicksPerSecond
    };
}

function summarizeIntervalCpuForPid(samples, pid, clockTicksPerSecond) {
    const hostSamples = samples.map((sample) => {
        const processEntry = sample.processes.find((entry) => entry.pid === pid);

        if (!processEntry || typeof processEntry.cpuTicks !== 'number') {
            return undefined;
        }

        return {
            elapsedMs: sample.elapsedMs,
            cpuTicks: processEntry.cpuTicks
        };
    }).filter(Boolean);
    const values = [];

    for (let index = 1; index < hostSamples.length; index += 1) {
        const previous = hostSamples[index - 1];
        const current = hostSamples[index];
        const elapsedSeconds = (current.elapsedMs - previous.elapsedMs) / 1000;
        const cpuSeconds = (current.cpuTicks - previous.cpuTicks) / clockTicksPerSecond;

        if (elapsedSeconds > 0 && cpuSeconds >= 0) {
            values.push((cpuSeconds / elapsedSeconds) * 100);
        }
    }

    return values;
}

function parseExtensionHostPids(status) {
    const pids = [];

    splitLines(status).forEach((line) => {
        const columns = splitWhitespaceColumns(line, 5);

        if (columns[3] === 'extension-host') {
            pids.push(Number(columns[2]));
        }
    });

    return pids;
}

function renderMarkdown(result) {
    const summary = result.summary;
    const processRows = result.samples.map((sample) => {
        const host = sample.processes.find((entry) => result.extensionHostPids.indexOf(entry.pid) !== -1);
        return [
            sample.elapsedMs,
            host ? host.cpuPercent : 0,
            host ? host.rssKiB : 0,
            sample.processes.length
        ];
    });

    return [
        `# Issue 91 and 92 live VS Code repro: ${result.label}`,
        '',
        `- extensionPath: ${result.extensionPath}`,
        `- workspacePath: ${result.workspacePath}`,
        `- durationMs: ${result.durationMs}`,
        `- sampleIntervalMs: ${result.sampleIntervalMs}`,
        `- screenshot: ${result.screenshot.filePath}`,
        `- extensionHostPids: ${result.extensionHostPids.join(', ')}`,
        `- extensionHostCpuMax: ${summary.extensionHostCpuMax.toFixed(2)}`,
        `- extensionHostCpuMean: ${summary.extensionHostCpuMean.toFixed(2)}`,
        `- extensionHostIntervalCpuMax: ${summary.extensionHostIntervalCpuMax.toFixed(2)}`,
        `- extensionHostIntervalCpuMean: ${summary.extensionHostIntervalCpuMean.toFixed(2)}`,
        `- extensionHostRssMiBMax: ${(summary.extensionHostRssKiBMax / 1024).toFixed(2)}`,
        '',
        '| elapsed ms | extension host cpu % | extension host rss KiB | process count |',
        '| ---: | ---: | ---: | ---: |',
        ...processRows.map((row) => `| ${row.join(' | ')} |`)
    ].join('\n') + '\n';
}

async function runLiveRepro(args) {
    const outDir = path.resolve(args.outDir);
    const extensionPath = path.resolve(args.extensionPath);
    const workspacePath = path.resolve(args.workspacePath);
    const userDataDir = path.join(outDir, 'user-data');
    const extensionsDir = path.join(outDir, 'extensions');
    const samples = [];

    fs.rmSync(outDir, {
        recursive: true,
        force: true
    });
    mkdirp(outDir);
    mkdirp(path.join(userDataDir, 'User'));
    mkdirp(extensionsDir);
    writeJson(path.join(userDataDir, 'User', 'settings.json'), createSettings());

    const codeArgs = [
        '--user-data-dir',
        userDataDir,
        '--extensions-dir',
        extensionsDir,
        '--new-window',
        '--log',
        'trace',
        '--wait',
        workspacePath
    ];

    if (args.noExtension !== true) {
        codeArgs.splice(4, 0, '--extensionDevelopmentPath=' + extensionPath);
    }

    const child = childProcess.spawn(args.codePath, codeArgs, {
        detached: false,
        stdio: [
            'ignore',
            fs.openSync(path.join(outDir, 'code.stdout.log'), 'w'),
            fs.openSync(path.join(outDir, 'code.stderr.log'), 'w')
        ]
    });

    const startedAt = Date.now();
    let screenshot;
    let captured = false;

    while (Date.now() - startedAt < args.durationMs) {
        const elapsedMs = Date.now() - startedAt;
        const processes = listProcesses(userDataDir).map(parseProcessLine);
        samples.push({
            elapsedMs,
            processes
        });

        if (captured !== true && elapsedMs >= args.captureAtMs) {
            screenshot = captureScreenshot(outDir, 'screenshot-' + args.label);
            captured = true;
        }

        await sleep(args.sampleIntervalMs);
    }

    if (!screenshot) {
        screenshot = captureScreenshot(outDir, 'screenshot-' + args.label);
    }

    const status = runCommand(args.codePath, [
        '--user-data-dir',
        userDataDir,
        '--status'
    ]);
    const extensionHostPids = parseExtensionHostPids(status);
    fs.writeFileSync(path.join(outDir, 'code-status.txt'), status);

    const killedPids = killProcesses(userDataDir);
    child.kill('SIGTERM');
    await sleep(1000);

    const result = {
        label: args.label,
        extensionPath: args.noExtension === true ? undefined : extensionPath,
        noExtension: args.noExtension,
        workspacePath,
        durationMs: args.durationMs,
        sampleIntervalMs: args.sampleIntervalMs,
        captureAtMs: args.captureAtMs,
        screenshot,
        statusPath: path.join(outDir, 'code-status.txt'),
        killedPids,
        extensionHostPids,
        summary: summarizeSamplesForExtensionHostPids(samples, extensionHostPids),
        samples
    };

    writeJson(path.join(outDir, 'result.json'), result);
    fs.writeFileSync(path.join(outDir, 'result.md'), renderMarkdown(result));
    console.log(JSON.stringify(result.summary, null, 2));
}

async function main() {
    const args = parseArgs(process.argv);

    args.workspacePath = path.resolve(args.workspacePath);
    args.extensionPath = path.resolve(args.extensionPath);
    args.outDir = path.resolve(args.outDir);

    if (args.generateWorkspace === true) {
        generateWorkspace(args);
    }

    await runLiveRepro(args);
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
