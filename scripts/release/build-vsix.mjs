import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binPathFor } from '@vscode/ripgrep-universal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { pack } = require('@vscode/vsce/out/package.js');
const repoRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const targetsPath = path.join(__dirname, 'targets.json');
const defaultOutputDirectory = path.join(repoRoot, 'artifacts', 'vsix');
const ripgrepPackageRoot = path.join(repoRoot, 'node_modules', '@vscode', 'ripgrep-universal');
const ripgrepStageRoot = path.join(repoRoot, 'dist', 'ripgrep');
const ripgrepTargetPlatforms = new Map([
    ['win32-x64', Object.freeze({ os: 'win32', arch: 'x64' })],
    ['win32-arm64', Object.freeze({ os: 'win32', arch: 'arm64' })],
    ['linux-x64', Object.freeze({ os: 'linux', arch: 'x64' })],
    ['linux-arm64', Object.freeze({ os: 'linux', arch: 'arm64' })],
    ['linux-armhf', Object.freeze({ os: 'linux', arch: 'arm' })],
    ['darwin-x64', Object.freeze({ os: 'darwin', arch: 'x64' })],
    ['darwin-arm64', Object.freeze({ os: 'darwin', arch: 'arm64' })],
    ['alpine-x64', Object.freeze({ os: 'linux', arch: 'x64' })],
    ['alpine-arm64', Object.freeze({ os: 'linux', arch: 'arm64' })],
    ['web', undefined]
]);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: 'inherit',
        env: process.env,
        ...options
    });

    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    }
}

function normalizeRequestedTargets(argv, supportedTargets) {
    const requested = argv
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.replace(/^--/, ''));

    if (requested.length === 0 || requested.includes('all')) {
        return supportedTargets.slice();
    }

    const seen = new Set();
    const selected = [];

    requested.forEach((target) => {
        if (!supportedTargets.includes(target)) {
            throw new Error(`Unsupported target "${target}". Supported targets: ${supportedTargets.join(', ')}`);
        }

        if (!seen.has(target)) {
            seen.add(target);
            selected.push(target);
        }
    });

    return selected;
}

function ensureOutputDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
}

function ripgrepPlatformDirectory(platform) {
    return `${platform.os}-${platform.arch}`;
}

function ripgrepExecutableName(platform) {
    return platform.os === 'win32' ? 'rg.exe' : 'rg';
}

function resetRipgrepStage() {
    fs.rmSync(ripgrepStageRoot, { recursive: true, force: true });
}

function copyRipgrepPackageFile(fileName) {
    const sourcePath = path.join(ripgrepPackageRoot, fileName);
    const destinationPath = path.join(ripgrepStageRoot, fileName);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`@vscode/ripgrep-universal is missing ${fileName}`);
    }

    fs.copyFileSync(sourcePath, destinationPath);
}

function stageRipgrepForTarget(target) {
    const platform = ripgrepTargetPlatforms.get(target);

    if (!ripgrepTargetPlatforms.has(target)) {
        throw new Error(`Unsupported ripgrep target "${target}".`);
    }

    resetRipgrepStage();

    if (platform === undefined) {
        return;
    }

    const executableName = ripgrepExecutableName(platform);
    const platformDirectory = ripgrepPlatformDirectory(platform);
    const sourcePath = binPathFor(platform);
    const destinationDirectory = path.join(ripgrepStageRoot, platformDirectory);
    const destinationPath = path.join(destinationDirectory, executableName);
    const packageJson = readJson(path.join(ripgrepPackageRoot, 'package.json'));

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`@vscode/ripgrep-universal does not contain ${platformDirectory}/${executableName}`);
    }

    fs.mkdirSync(destinationDirectory, { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, platform.os === 'win32' ? 0o644 : 0o755);
    copyRipgrepPackageFile('LICENSE');
    copyRipgrepPackageFile('README.md');
    fs.writeFileSync(path.join(ripgrepStageRoot, 'manifest.json'), JSON.stringify({
        package: '@vscode/ripgrep-universal',
        version: packageJson.version,
        target: target,
        platform: platformDirectory,
        executable: executableName
    }, null, 4) + '\n');
}

async function packageTarget(target, outputPath) {
    await pack({
        cwd: repoRoot,
        packagePath: outputPath,
        target: target,
        dependencies: false,
        useYarn: false
    });

    process.stdout.write(`${outputPath}\n`);
}

async function main() {
    const packageJson = readJson(packageJsonPath);
    const supportedTargets = readJson(targetsPath);
    const outputDirectory = process.env.VSIX_OUTDIR ? path.resolve(repoRoot, process.env.VSIX_OUTDIR) : defaultOutputDirectory;
    const selectedTargets = normalizeRequestedTargets(process.argv.slice(2), supportedTargets);

    ensureOutputDirectory(outputDirectory);

    try {
        if (process.env.SKIP_PREPUBLISH !== '1') {
            run('npm', ['run', 'vscode:prepublish']);
        }

        for (const target of selectedTargets) {
            stageRipgrepForTarget(target);
            const outputPath = path.join(outputDirectory, `${packageJson.name}-${packageJson.version}-${target}.vsix`);
            await packageTarget(target, outputPath);
        }
    } finally {
        resetRipgrepStage();
    }
}

main().catch((error) => {
    process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
    process.exitCode = 1;
});
