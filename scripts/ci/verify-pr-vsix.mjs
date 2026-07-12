import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    executableName,
    platformDirectory,
    ripgrepTargetPlatforms
} from '../release/ripgrep-targets.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const targetsPath = path.join(repoRoot, 'scripts', 'release', 'targets.json');
const ripgrepMetadataEntries = Object.freeze([
    'extension/dist/ripgrep/LICENSE',
    'extension/dist/ripgrep/README.md',
    'extension/dist/ripgrep/manifest.json'
]);

class PrVsixVerificationError extends Error {
    constructor(message, options) {
        super(message, options && options.cause ? { cause: options.cause } : undefined);
        this.name = 'PrVsixVerificationError';
    }
}

function requireTarget(target) {
    if (!ripgrepTargetPlatforms.has(target)) {
        throw new PrVsixVerificationError(`Unsupported VSIX target "${target}".`);
    }
    return ripgrepTargetPlatforms.get(target);
}

function expectedBundleFileNames(packageMetadata, targets) {
    return targets.map((target) =>
        `${packageMetadata.name}-${packageMetadata.version}-${target}.vsix`
    ).sort();
}

function expectedRipgrepEntries(target) {
    const platform = requireTarget(target);
    if (platform === undefined) {
        return [];
    }
    return [
        `extension/dist/ripgrep/${platformDirectory(platform)}/${executableName(platform)}`
    ];
}

function verifyTargetMap(targets) {
    const configuredTargets = Array.from(ripgrepTargetPlatforms.keys());
    if (JSON.stringify(configuredTargets) !== JSON.stringify(targets)) {
        throw new PrVsixVerificationError('ripgrep target map must match targets.json order and membership');
    }
}

function verifyEntrySet(entries, target) {
    const expectedExecutables = expectedRipgrepEntries(target);
    const actualExecutables = entries.filter((entry) =>
        /extension\/dist\/ripgrep\/[^/]+\/rg(?:\.exe)?$/.test(entry)
    ).sort();
    if (actualExecutables.length !== new Set(actualExecutables).size) {
        throw new PrVsixVerificationError(`${target} VSIX contains duplicate ripgrep executable entries`);
    }
    if (JSON.stringify(actualExecutables) !== JSON.stringify(expectedExecutables)) {
        throw new PrVsixVerificationError(
            `${target} VSIX ripgrep entries mismatch: expected ${JSON.stringify(expectedExecutables)}, ` +
            `received ${JSON.stringify(actualExecutables)}`
        );
    }

    const actualMetadata = ripgrepMetadataEntries.filter((entry) => entries.includes(entry));
    const expectedMetadata = expectedExecutables.length === 0 ? [] : ripgrepMetadataEntries;
    if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
        throw new PrVsixVerificationError(`${target} VSIX ripgrep metadata entries mismatch`);
    }
    return expectedExecutables;
}

function verifyExecutableModes(zipInfoLines, executableEntries) {
    executableEntries.filter((entry) => !entry.endsWith('.exe')).forEach((entry) => {
        const line = zipInfoLines.find((candidate) => candidate.endsWith(` ${entry}`));
        if (!line || !line.startsWith('-rwx')) {
            throw new PrVsixVerificationError(`VSIX executable mode mismatch: ${entry}`);
        }
    });
}

function runUnzip(args) {
    const result = spawnSync('unzip', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
        throw new PrVsixVerificationError(`unzip ${args.join(' ')} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

function statPath(targetPath, label) {
    try {
        return fs.statSync(targetPath);
    } catch (cause) {
        throw new PrVsixVerificationError(`${label}: path is not readable`, { cause });
    }
}

function readDirectory(directory) {
    try {
        return fs.readdirSync(directory);
    } catch (cause) {
        throw new PrVsixVerificationError('PR VSIX bundle directory is not readable', { cause });
    }
}

function verifyTargetManifest(vsixPath, target) {
    const manifest = runUnzip(['-p', vsixPath, 'extension.vsixmanifest']);
    if (!manifest.includes(`TargetPlatform="${target}"`)) {
        throw new PrVsixVerificationError(`${target} VSIX manifest target mismatch`);
    }
}

function verifyRipgrepManifest(vsixPath, target, executableEntries) {
    if (executableEntries.length === 0) {
        return;
    }
    const raw = runUnzip(['-p', vsixPath, 'extension/dist/ripgrep/manifest.json']);
    let manifest;
    try {
        manifest = JSON.parse(raw);
    } catch (cause) {
        throw new PrVsixVerificationError(`${target} VSIX ripgrep manifest is invalid JSON`, { cause });
    }
    if (manifest.target !== target || manifest.platform !== executableEntries[0].split('/').at(-2) ||
        manifest.executable !== executableEntries[0].split('/').at(-1)) {
        throw new PrVsixVerificationError(`${target} VSIX ripgrep manifest mismatch`);
    }
}

function verifyTargetVsix(vsixPath, target) {
    const stat = statPath(vsixPath, `${target} VSIX`);
    if (!stat.isFile() || stat.size === 0) {
        throw new PrVsixVerificationError(`${target} VSIX must be a non-empty file`);
    }
    runUnzip(['-tqq', vsixPath]);
    const entries = runUnzip(['-Z1', vsixPath]).split(/\r?\n/).filter(Boolean);
    const executableEntries = verifyEntrySet(entries, target);
    const zipInfoLines = runUnzip(['-Z', '-l', vsixPath]).split(/\r?\n/).filter(Boolean);
    verifyExecutableModes(zipInfoLines, executableEntries);
    verifyTargetManifest(vsixPath, target);
    verifyRipgrepManifest(vsixPath, target, executableEntries);
    return Object.freeze({
        target,
        file: path.basename(vsixPath),
        bytes: stat.size,
        sha256: createHash('sha256').update(fs.readFileSync(vsixPath)).digest('hex'),
        nativeBinaries: executableEntries.length
    });
}

function verifyPrVsixBundle(directory, packageMetadata, targets) {
    const resolvedDirectory = path.resolve(repoRoot, directory);
    const stat = statPath(resolvedDirectory, 'PR VSIX bundle');
    if (!stat.isDirectory()) {
        throw new PrVsixVerificationError('PR VSIX bundle path must be a directory');
    }
    verifyTargetMap(targets);
    const expectedFiles = expectedBundleFileNames(packageMetadata, targets);
    const actualFiles = readDirectory(resolvedDirectory).filter((fileName) => fileName.endsWith('.vsix')).sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
        throw new PrVsixVerificationError(
            `PR VSIX bundle mismatch: expected ${JSON.stringify(expectedFiles)}, received ${JSON.stringify(actualFiles)}`
        );
    }
    const files = targets.map((target) => verifyTargetVsix(
        path.join(resolvedDirectory, `${packageMetadata.name}-${packageMetadata.version}-${target}.vsix`),
        target
    ));
    return Object.freeze({
        path: path.relative(repoRoot, resolvedDirectory),
        targets: targets.length,
        files,
        totalBytes: files.reduce((total, file) => total + file.bytes, 0)
    });
}

function main() {
    if (process.argv.length !== 3) {
        throw new PrVsixVerificationError('usage: node scripts/ci/verify-pr-vsix.mjs <bundle-directory>');
    }
    const packageMetadata = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
    process.stdout.write(`${JSON.stringify(verifyPrVsixBundle(process.argv[2], packageMetadata, targets))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    }
}

export {
    PrVsixVerificationError,
    expectedBundleFileNames,
    expectedRipgrepEntries,
    verifyEntrySet,
    verifyExecutableModes,
    verifyPrVsixBundle,
    verifyRipgrepManifest,
    verifyTargetMap,
    verifyTargetManifest,
    verifyTargetVsix
};
