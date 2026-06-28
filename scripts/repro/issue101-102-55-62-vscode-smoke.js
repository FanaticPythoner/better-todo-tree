'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const regexRegistry = require('../../src/regexRegistry.js');

const DEFAULT_WAIT_MS = 30000;
const POLL_MS = 1000;
const EXPECTED_FILES = [
    './.env',
    './.env.example',
    './config/settings.json',
    './config/settings.jsonc'
];
const lineBreakRegex = regexRegistry.createRegExp('optionalCarriageReturnLineBreak');
const betterTodoTreeLogSuffixRegex = regexRegistry.createRegExp('betterTodoTreeLogSuffix');
const issueSmokeLogTimePrefixRegex = regexRegistry.createRegExp('issueSmokeLogTimePrefix');
const issueSmokeFoundItemsRegex = regexRegistry.createRegExp('issueSmokeFoundItems');
const issueSmokeSearchProducedMatchesRegex = regexRegistry.createRegExp('issueSmokeSearchProducedMatches');
const issueSmokeTreeItemPathJsonRegex = regexRegistry.createRegExp('issueSmokeTreeItemPathJson');
const extensionHostTextRegex = regexRegistry.createRegExp('extensionHostText');
const whitespaceOneOrMoreRegex = regexRegistry.createRegExp('whitespaceOneOrMore');
const pathBackslashRegex = regexRegistry.createRegExp('pathBackslash', 'g');

function parseArgs(argv) {
    const args = {
        codePath: 'code',
        vsixPath: path.join('artifacts', 'vsix', 'issue101-102-55-62-user-smoke.vsix'),
        outDir: path.join('artifacts', 'user-smoke', 'issue101-102-55-62-packaged-vscode'),
        waitMs: DEFAULT_WAIT_MS
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === '--code' && next) {
            args.codePath = next;
            index += 1;
        } else if (arg === '--vsix' && next) {
            args.vsixPath = next;
            index += 1;
        } else if (arg === '--out-dir' && next) {
            args.outDir = next;
            index += 1;
        } else if (arg === '--wait-ms' && next) {
            args.waitMs = parsePositiveInteger(next, arg);
            index += 1;
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

function writeText(filePath, value) {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, value, 'utf8');
}

function normalizeDisplayPath(value) {
    return String(value || '').replace(pathBackslashRegex, '/');
}

function createPathRedactor(args, rootOutDir) {
    const replacements = [
        [rootOutDir, '<smoke-root>'],
        [path.resolve(args.vsixPath), '<vsix>'],
        [process.cwd(), '<repo>']
    ].flatMap((entry) => {
        const raw = String(entry[0] || '');
        const marker = entry[1];
        const normalized = normalizeDisplayPath(raw);

        return raw === normalized ? [
            [raw, marker]
        ] : [
            [raw, marker],
            [normalized, marker]
        ];
    }).filter((entry) => entry[0].length > 0);

    return (value) => {
        let redacted = String(value || '');

        replacements.forEach((entry) => {
            redacted = redacted.split(entry[0]).join(entry[1]);
        });

        return redacted;
    };
}

function redactValue(value, redactor) {
    if (typeof value === 'string') {
        return redactor(value);
    }

    if (Array.isArray(value)) {
        return value.map((entry) => redactValue(entry, redactor));
    }

    if (value && typeof value === 'object') {
        return Object.keys(value).reduce((target, key) => {
            target[key] = redactValue(value[key], redactor);
            return target;
        }, {});
    }

    return value;
}

function removeRuntimeArtifacts(scenarioDir) {
    [
        'workspace',
        'user-data',
        'extensions',
        'install.stdout.log',
        'install.stderr.log',
        'extensions.txt',
        'extensions.stderr.log',
        'code.stdout.log',
        'code.stderr.log',
        'code-status.txt',
        'code-status.stderr.log',
        'processes.txt'
    ].forEach((name) => {
        fs.rmSync(path.join(scenarioDir, name), {
            recursive: true,
            force: true
        });
    });
}

function runCommand(command, args, options) {
    const result = childProcess.spawnSync(command, args, Object.assign({
        encoding: 'utf8',
        stdio: [
            'ignore',
            'pipe',
            'pipe'
        ]
    }, options || {}));

    if (result.error) {
        throw result.error;
    }

    if (options && options.stdoutPath) {
        writeText(options.stdoutPath, result.stdout || '');
    }

    if (options && options.stderrPath) {
        writeText(options.stderrPath, result.stderr || '');
    }

    if ((!options || options.allowNonZero !== true) && result.status !== 0) {
        throw new Error(`${command} exited ${result.status}: ${(result.stderr || '').trim()}`);
    }

    return result;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function listFiles(rootPath) {
    if (fs.existsSync(rootPath) !== true) {
        return [];
    }

    return fs.readdirSync(rootPath, {
        withFileTypes: true
    }).flatMap((entry) => {
        const entryPath = path.join(rootPath, entry.name);

        if (entry.isDirectory()) {
            return listFiles(entryPath);
        }

        return [entryPath];
    });
}

function splitLines(text) {
    return text.split(lineBreakRegex).filter((line) => line.length > 0);
}

function createSettings(includeHiddenFiles) {
    return {
        'better-todo-tree.general.debug': true,
        'better-todo-tree.general.tags': [
            'NOTE'
        ],
        'better-todo-tree.tree.scanAtStartup': true,
        'better-todo-tree.tree.scanMode': 'workspace',
        'better-todo-tree.tree.showCountsInTree': true,
        'better-todo-tree.filtering.includeHiddenFiles': includeHiddenFiles,
        'better-todo-tree.filtering.includeGlobs': [
            '**/*.json',
            '**/*.jsonc',
            '**/.env',
            '**/.env*'
        ],
        'better-todo-tree.filtering.excludeGlobs': [],
        'better-todo-tree.filtering.passGlobsToRipgrep': true,
        'better-todo-tree.filtering.useBuiltInExcludes': 'none',
        'better-todo-tree.languages.customPatterns': [
            {
                id: 'issue-json-comments',
                extensions: [
                    '.json',
                    '.jsonc'
                ],
                singleLineComments: [
                    '//'
                ]
            },
            {
                id: 'issue-dotenv-comments',
                filenames: [
                    '.env',
                    '.env.example'
                ],
                filenameGlobs: [
                    '**/.env',
                    '**/.env*'
                ],
                singleLineComments: [
                    '#'
                ]
            }
        ],
        'better-todo-tree.ripgrep.usePatternFile': true,
        'better-todo-tree.ripgrep.ripgrepArgs': '--no-config',
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

function createWorkspace(workspacePath, includeHiddenFiles, deniedDirectory) {
    fs.rmSync(workspacePath, {
        recursive: true,
        force: true
    });

    writeJson(path.join(workspacePath, '.vscode', 'settings.json'), createSettings(includeHiddenFiles));
    writeText(path.join(workspacePath, '.env'), '# NOTE env item\n');
    writeText(path.join(workspacePath, '.env.example'), '# NOTE env example\n');
    writeText(path.join(workspacePath, 'config', 'settings.json'), '// NOTE json item\n');
    writeText(path.join(workspacePath, 'config', 'settings.jsonc'), '// NOTE jsonc item\n');
    writeText(path.join(workspacePath, 'src', 'source.py'), '# NOTE source control item\n');

    if (deniedDirectory === true) {
        const deniedPath = path.join(workspacePath, '.denied');
        writeText(path.join(deniedPath, 'blocked.json'), '// NOTE denied item\n');
        fs.chmodSync(deniedPath, 0);
    }
}

function restoreWorkspace(workspacePath) {
    const deniedPath = path.join(workspacePath, '.denied');

    if (fs.existsSync(deniedPath)) {
        fs.chmodSync(deniedPath, 0o700);
    }
}

function installVsix(args, scenarioDir) {
    const userDataDir = path.join(scenarioDir, 'user-data');
    const extensionsDir = path.join(scenarioDir, 'extensions');

    mkdirp(path.join(userDataDir, 'User'));
    mkdirp(extensionsDir);
    writeJson(path.join(userDataDir, 'User', 'settings.json'), createSettings(false));

    const install = runCommand(args.codePath, [
        '--user-data-dir',
        userDataDir,
        '--extensions-dir',
        extensionsDir,
        '--install-extension',
        args.vsixPath,
        '--force'
    ], {
        stdoutPath: path.join(scenarioDir, 'install.stdout.log'),
        stderrPath: path.join(scenarioDir, 'install.stderr.log')
    });

    const listed = runCommand(args.codePath, [
        '--user-data-dir',
        userDataDir,
        '--extensions-dir',
        extensionsDir,
        '--list-extensions',
        '--show-versions'
    ], {
        stdoutPath: path.join(scenarioDir, 'extensions.txt'),
        stderrPath: path.join(scenarioDir, 'extensions.stderr.log')
    });

    return {
        userDataDir,
        extensionsDir,
        installed: listed.stdout.indexOf('FanaticPythoner.better-todo-tree@') !== -1 ||
            listed.stdout.indexOf('fanaticpythoner.better-todo-tree@') !== -1,
        installOutput: install.stdout.trim()
    };
}

function collectExtensionLogs(userDataDir, scenarioDir, redactor) {
    const logRoot = path.join(userDataDir, 'logs');
    const outputLogs = listFiles(logRoot).filter((filePath) => betterTodoTreeLogSuffixRegex.test(filePath));
    const combined = outputLogs.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');

    writeText(path.join(scenarioDir, 'better-todo-tree.log'), redactor(combined));

    return {
        outputLogs,
        combined
    };
}

function parseTimeMs(line) {
    const match = issueSmokeLogTimePrefixRegex.exec(line);

    if (!match) {
        return undefined;
    }

    return (
        Number(match[1]) * 3600000 +
        Number(match[2]) * 60000 +
        Number(match[3]) * 1000 +
        Number(match[4])
    );
}

function parseLog(combined) {
    const lines = splitLines(combined);
    const foundItemCounts = [];
    const searchMatchCounts = [];
    const commandLines = [];
    const skippedIssues = [];
    const rawPaths = [];
    let searchStartedMs;
    let foundLoggedMs;

    lines.forEach((line) => {
        let match = issueSmokeFoundItemsRegex.exec(line);

        if (match) {
            foundItemCounts.push(Number(match[1]));
            foundLoggedMs = parseTimeMs(line);
        }

        match = issueSmokeSearchProducedMatchesRegex.exec(line);
        if (match) {
            searchMatchCounts.push(Number(match[1]));
        }

        if (line.indexOf('Command: ') !== -1) {
            commandLines.push(line);
        }

        if (line.indexOf('Skipping workspace file: ') !== -1) {
            skippedIssues.push(line);
        }

        if (line.indexOf('Searching ....') !== -1) {
            searchStartedMs = parseTimeMs(line);
        }

        match = issueSmokeTreeItemPathJsonRegex.exec(line);
        if (match) {
            rawPaths.push(match[1]);
        }
    });

    return {
        foundItemCounts,
        searchMatchCounts,
        commandLines,
        skippedIssues,
        rawPaths: Array.from(new Set(rawPaths)),
        scanDurationMs: searchStartedMs !== undefined && foundLoggedMs !== undefined ?
            Math.max(0, foundLoggedMs - searchStartedMs) :
            undefined
    };
}

function listScenarioProcesses(userDataDir) {
    return listProcessesByNeedle(userDataDir);
}

function listProcessesByNeedle(needle) {
    const result = runCommand('ps', [
        '-eo',
        'pid=,ppid=,pcpu=,pmem=,rss=,args='
    ]);

    return splitLines(result.stdout).filter((line) => line.indexOf(needle) !== -1);
}

function parseStatusExtensionHost(statusText) {
    return extensionHostTextRegex.test(statusText);
}

function captureRuntimeState(args, scenarioDir, userDataDir) {
    const status = runCommand(args.codePath, [
        '--user-data-dir',
        userDataDir,
        '--status'
    ], {
        allowNonZero: true,
        stdoutPath: path.join(scenarioDir, 'code-status.txt'),
        stderrPath: path.join(scenarioDir, 'code-status.stderr.log')
    });
    const processRows = listScenarioProcesses(userDataDir);

    writeText(path.join(scenarioDir, 'processes.txt'), processRows.join('\n') + '\n');

    return {
        statusCode: status.status,
        statusHasExtensionHost: parseStatusExtensionHost(status.stdout),
        processRows: processRows.length
    };
}

function signalPid(pid, signal) {
    try {
        process.kill(pid, signal);
    } catch (error) {
        if (error.code !== 'ESRCH') {
            throw error;
        }
    }
}

async function terminateProcessesByNeedle(needle) {
    const rows = listProcessesByNeedle(needle);
    const pids = rows.map((line) => Number(line.trim().split(whitespaceOneOrMoreRegex, 1)[0])).filter((pid) => {
        return Number.isFinite(pid) && pid !== process.pid;
    });

    pids.sort((left, right) => right - left).forEach((pid) => {
        signalPid(pid, 'SIGTERM');
    });

    if (pids.length > 0) {
        await sleep(1000);
    }

    listProcessesByNeedle(needle).map((line) => {
        return Number(line.trim().split(whitespaceOneOrMoreRegex, 1)[0]);
    }).filter((pid) => {
        return Number.isFinite(pid) && pid !== process.pid;
    }).sort((left, right) => right - left).forEach((pid) => {
        signalPid(pid, 'SIGKILL');
    });

    return pids;
}

function summarizeScenario(name, scenario, install, parsedLog, runtime, killedPids, elapsedMs) {
    return {
        name,
        expectedItemCount: scenario.expectedItemCount,
        expectedSearchMatchCount: scenario.expectedSearchMatchCount,
        expectedFiles: EXPECTED_FILES,
        installed: install.installed,
        outputLogCount: parsedLog.outputLogCount,
        foundItemCounts: parsedLog.foundItemCounts,
        searchMatchCounts: parsedLog.searchMatchCounts,
        commandLines: parsedLog.commandLines,
        skippedIssues: parsedLog.skippedIssues,
        rawPaths: parsedLog.rawPaths,
        scanDurationMs: parsedLog.scanDurationMs,
        elapsedMs,
        codeStatusExitCode: runtime.statusCode,
        statusHasExtensionHost: runtime.statusHasExtensionHost,
        processRows: runtime.processRows,
        killedPids
    };
}

function assertIncludesAllPaths(result) {
    const pathSet = new Set(result.rawPaths);

    EXPECTED_FILES.forEach((filePath) => {
        if (pathSet.has(filePath) !== true) {
            throw new Error(`${result.name} missing raw match path ${filePath}`);
        }
    });
}

function assertScenario(result, scenario) {
    if (result.installed !== true) {
        throw new Error(`${result.name} extension install missing`);
    }

    if (result.foundItemCounts.indexOf(scenario.expectedItemCount) === -1) {
        throw new Error(`${result.name} expected ${scenario.expectedItemCount} tree items`);
    }

    if (result.searchMatchCounts.indexOf(scenario.expectedSearchMatchCount) === -1) {
        throw new Error(`${result.name} expected ${scenario.expectedSearchMatchCount} raw matches`);
    }

    if (scenario.expectRecoverableIssue === true && result.skippedIssues.length === 0) {
        throw new Error(`${result.name} expected recoverable workspace issue`);
    }

    if (scenario.expectRecoverableIssue !== true && result.skippedIssues.length !== 0) {
        throw new Error(`${result.name} unexpected workspace issue`);
    }

    if (scenario.assertPreviewPaths !== false) {
        assertIncludesAllPaths(result);
    }

    if (result.statusHasExtensionHost !== true && result.outputLogCount === 0) {
        throw new Error(`${result.name} extension host evidence missing`);
    }
}

async function waitForScan(args, scenarioDir, install, scenario, redactor) {
    const startedAt = Date.now();
    let latestLogs = {
        outputLogs: [],
        combined: ''
    };
    let parsedLog = parseLog('');

    while (Date.now() - startedAt < args.waitMs) {
        await sleep(POLL_MS);
        latestLogs = collectExtensionLogs(install.userDataDir, scenarioDir, redactor);
        parsedLog = parseLog(latestLogs.combined);

        if (
            parsedLog.foundItemCounts.indexOf(scenario.expectedItemCount) !== -1 &&
            parsedLog.searchMatchCounts.indexOf(scenario.expectedSearchMatchCount) !== -1 &&
            (scenario.expectRecoverableIssue !== true || parsedLog.skippedIssues.length > 0)
        ) {
            break;
        }
    }

    parsedLog.outputLogCount = latestLogs.outputLogs.length;

    return {
        parsedLog,
        elapsedMs: Date.now() - startedAt
    };
}

async function runScenario(args, rootOutDir, name, scenario, redactor) {
    const scenarioDir = path.join(rootOutDir, name);
    const workspacePath = path.join(scenarioDir, 'workspace');
    let child;
    let killedPids = [];

    await terminateProcessesByNeedle(scenarioDir);
    fs.rmSync(scenarioDir, {
        recursive: true,
        force: true
    });
    mkdirp(scenarioDir);
    createWorkspace(workspacePath, scenario.includeHiddenFiles, scenario.deniedDirectory);

    const install = installVsix(args, scenarioDir);

    try {
        child = childProcess.spawn(args.codePath, [
            '--user-data-dir',
            install.userDataDir,
            '--extensions-dir',
            install.extensionsDir,
            '--new-window',
            '--log',
            'trace',
            '--disable-workspace-trust',
            '--skip-welcome',
            '--skip-release-notes',
            '--disable-telemetry',
            workspacePath
        ], {
            stdio: [
                'ignore',
                fs.openSync(path.join(scenarioDir, 'code.stdout.log'), 'w'),
                fs.openSync(path.join(scenarioDir, 'code.stderr.log'), 'w')
            ]
        });

        const waited = await waitForScan(args, scenarioDir, install, scenario, redactor);
        const runtime = captureRuntimeState(args, scenarioDir, install.userDataDir);

        killedPids = await terminateProcessesByNeedle(scenarioDir);

        const result = summarizeScenario(
            name,
            scenario,
            install,
            waited.parsedLog,
            runtime,
            killedPids,
            waited.elapsedMs
        );
        const publicResult = redactValue(result, redactor);

        assertScenario(result, scenario);
        writeJson(path.join(scenarioDir, 'result.json'), publicResult);

        return publicResult;
    } finally {
        restoreWorkspace(workspacePath);

        if (child) {
            child.kill('SIGTERM');
        }

        if (killedPids.length === 0) {
            killedPids = await terminateProcessesByNeedle(scenarioDir);
        }

        removeRuntimeArtifacts(scenarioDir);
    }
}

function renderMarkdown(result) {
    const rows = result.scenarios.map((scenario) => [
        scenario.name,
        scenario.expectedItemCount,
        scenario.foundItemCounts.join(', '),
        scenario.expectedSearchMatchCount,
        scenario.searchMatchCounts.join(', '),
        scenario.skippedIssues.length,
        scenario.scanDurationMs === undefined ? '' : scenario.scanDurationMs,
        scenario.elapsedMs,
        scenario.processRows
    ]);

    return [
        '# Issue 101 102 55 62 packaged VS Code smoke',
        '',
        `- vsixPath: ${result.vsixPath}`,
        `- codePath: ${result.codePath}`,
        `- scenarioCount: ${result.scenarios.length}`,
        `- totalElapsedMs: ${result.totalElapsedMs}`,
        '',
        '| scenario | expected items | found items | expected raw matches | raw matches | scan issues | scan ms | elapsed ms | process rows |',
        '| --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: |',
        ...rows.map((row) => `| ${row.join(' | ')} |`)
    ].join('\n') + '\n';
}

async function main() {
    const args = parseArgs(process.argv);
    const rootOutDir = path.resolve(args.outDir);
    const startedAt = Date.now();
    const scenarios = {
        explicit_include_dotfiles: {
            includeHiddenFiles: false,
            deniedDirectory: false,
            expectedItemCount: 4,
            expectedSearchMatchCount: 4,
            expectRecoverableIssue: false,
            assertPreviewPaths: true
        },
        hidden_permission_recovery: {
            includeHiddenFiles: true,
            deniedDirectory: true,
            expectedItemCount: 4,
            expectedSearchMatchCount: 5,
            expectRecoverableIssue: true,
            assertPreviewPaths: false
        }
    };

    args.vsixPath = path.resolve(args.vsixPath);
    args.outDir = rootOutDir;
    const redactor = createPathRedactor(args, rootOutDir);

    if (fs.existsSync(args.vsixPath) !== true) {
        throw new Error(`missing VSIX: ${args.vsixPath}`);
    }

    await terminateProcessesByNeedle(rootOutDir);
    fs.rmSync(rootOutDir, {
        recursive: true,
        force: true
    });
    mkdirp(rootOutDir);

    const scenarioResults = [];

    for (const entry of Object.entries(scenarios)) {
        scenarioResults.push(await runScenario(args, rootOutDir, entry[0], entry[1], redactor));
    }

    const result = {
        codePath: args.codePath,
        vsixPath: redactor(args.vsixPath),
        totalElapsedMs: Date.now() - startedAt,
        scenarios: scenarioResults
    };

    writeJson(path.join(rootOutDir, 'result.json'), result);
    writeText(path.join(rootOutDir, 'result.md'), renderMarkdown(result));
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
