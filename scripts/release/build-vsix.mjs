import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binPathFor } from '@vscode/ripgrep-universal';
import {
    executableName as ripgrepExecutableName,
    platformDirectory as ripgrepPlatformDirectory,
    ripgrepTargetPlatforms,
    uniqueNativePlatforms
} from './ripgrep-targets.mjs';

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
const previewTarget = 'pr-preview';

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

function isSelectedTargetPackage(fileName, packageName, selectedTargets) {
    const extension = '.vsix';
    const prefix = `${packageName}-`;

    if (!fileName.startsWith(prefix) || !fileName.endsWith(extension)) {
        return false;
    }

    const versionAndTarget = fileName.slice(prefix.length, -extension.length);

    return selectedTargets.some((target) => {
        const suffix = `-${target}`;
        return versionAndTarget.endsWith(suffix) && versionAndTarget.length > suffix.length;
    });
}

function cleanSelectedTargetOutputs(directory, packageName, selectedTargets) {
    fs.readdirSync(directory)
        .filter((fileName) => isSelectedTargetPackage(fileName, packageName, selectedTargets))
        .forEach((fileName) => {
            fs.unlinkSync(path.join(directory, fileName));
        });
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

function copyRipgrepPlatform(platform) {
    const executableName = ripgrepExecutableName(platform);
    const platformDirectory = ripgrepPlatformDirectory(platform);
    const sourcePath = binPathFor(platform);
    const destinationDirectory = path.join(ripgrepStageRoot, platformDirectory);
    const destinationPath = path.join(destinationDirectory, executableName);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`@vscode/ripgrep-universal does not contain ${platformDirectory}/${executableName}`);
    }

    fs.mkdirSync(destinationDirectory, { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, platform.os === 'win32' ? 0o644 : 0o755);

    return Object.freeze({
        platform: platformDirectory,
        executable: executableName
    });
}

function writeRipgrepManifest(manifest) {
    fs.writeFileSync(path.join(ripgrepStageRoot, 'manifest.json'), JSON.stringify(manifest, null, 4) + '\n');
}

function copyRipgrepMetadata() {
    copyRipgrepPackageFile('LICENSE');
    copyRipgrepPackageFile('README.md');
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

    const packageJson = readJson(path.join(ripgrepPackageRoot, 'package.json'));
    const stagedPlatform = copyRipgrepPlatform(platform);
    copyRipgrepMetadata();
    writeRipgrepManifest({
        package: '@vscode/ripgrep-universal',
        version: packageJson.version,
        target: target,
        platform: stagedPlatform.platform,
        executable: stagedPlatform.executable
    });
}

function stageRipgrepForPreview(targets) {
    const packageJson = readJson(path.join(ripgrepPackageRoot, 'package.json'));

    resetRipgrepStage();
    const platforms = uniqueNativePlatforms(targets).map(copyRipgrepPlatform);
    copyRipgrepMetadata();
    writeRipgrepManifest({
        package: '@vscode/ripgrep-universal',
        version: packageJson.version,
        target: previewTarget,
        platforms: platforms
    });
}

async function packageTarget(target, outputPath) {
    const options = {
        cwd: repoRoot,
        packagePath: outputPath,
        dependencies: false,
        useYarn: false
    };
    if (target !== undefined) {
        options.target = target;
    }

    await pack(options);

    process.stdout.write(`${outputPath}\n`);
}

async function main() {
    const packageJson = readJson(packageJsonPath);
    const supportedTargets = readJson(targetsPath);
    const outputDirectory = process.env.VSIX_OUTDIR ? path.resolve(repoRoot, process.env.VSIX_OUTDIR) : defaultOutputDirectory;
    const requested = process.argv.slice(2).flatMap((value) => value.split(','))
        .map((value) => value.trim().replace(/^--/, ''))
        .filter(Boolean);
    const previewRequested = requested.includes(previewTarget);
    if (previewRequested && (requested.length !== 1 || requested[0] !== previewTarget)) {
        throw new Error(`${previewTarget} cannot be combined with release targets.`);
    }
    const selectedTargets = previewRequested ? supportedTargets : normalizeRequestedTargets(requested, supportedTargets);

    ensureOutputDirectory(outputDirectory);
    if (!previewRequested) {
        cleanSelectedTargetOutputs(outputDirectory, packageJson.name, selectedTargets);
    }

    try {
        if (process.env.SKIP_PREPUBLISH !== '1') {
            run('npm', ['run', 'vscode:prepublish']);
        }

        if (previewRequested) {
            const fileName = process.env.PR_VSIX_FILENAME || `${packageJson.name}-${packageJson.version}-${previewTarget}.vsix`;
            if (path.basename(fileName) !== fileName || !/^[A-Za-z0-9._-]+\.vsix$/.test(fileName)) {
                throw new Error('PR_VSIX_FILENAME must be a portable VSIX basename.');
            }
            const outputPath = path.join(outputDirectory, fileName);
            fs.rmSync(outputPath, { force: true });
            stageRipgrepForPreview(selectedTargets);
            await packageTarget(undefined, outputPath);
        } else {
            for (const target of selectedTargets) {
                stageRipgrepForTarget(target);
                const outputPath = path.join(outputDirectory, `${packageJson.name}-${packageJson.version}-${target}.vsix`);
                await packageTarget(target, outputPath);
            }
        }
    } finally {
        resetRipgrepStage();
    }
}

main().catch((error) => {
    process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
    process.exitCode = 1;
});
