import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    executableName,
    platformDirectory,
    ripgrepTargetPlatforms,
    uniqueNativePlatforms
} from '../release/ripgrep-targets.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..', '..');
const targetsPath = path.join(repoRoot, 'scripts', 'release', 'targets.json');

class PrVsixVerificationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PrVsixVerificationError';
    }
}

function expectedRipgrepEntries(targets) {
    return uniqueNativePlatforms(targets).map((platform) =>
        `extension/dist/ripgrep/${platformDirectory(platform)}/${executableName(platform)}`
    ).sort();
}

function verifyTargetMap(targets) {
    const configuredTargets = Array.from(ripgrepTargetPlatforms.keys());
    if (JSON.stringify(configuredTargets) !== JSON.stringify(targets)) {
        throw new PrVsixVerificationError('ripgrep target map must match targets.json order and membership');
    }
}

function verifyEntrySet(entries, targets) {
    const expected = expectedRipgrepEntries(targets);
    const actual = entries.filter((entry) => /extension\/dist\/ripgrep\/[^/]+\/rg(?:\.exe)?$/.test(entry)).sort();
    const unique = Array.from(new Set(actual));

    if (actual.length !== unique.length) {
        throw new PrVsixVerificationError('PR VSIX contains duplicate ripgrep executable entries');
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new PrVsixVerificationError(`PR VSIX ripgrep entries mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }

    [
        'extension/dist/ripgrep/LICENSE',
        'extension/dist/ripgrep/README.md',
        'extension/dist/ripgrep/manifest.json'
    ].forEach((entry) => {
        if (!entries.includes(entry)) {
            throw new PrVsixVerificationError(`PR VSIX is missing ${entry}`);
        }
    });
    return expected;
}

function verifyExecutableModes(zipInfoLines, executableEntries) {
    executableEntries.filter((entry) => !entry.endsWith('.exe')).forEach((entry) => {
        const line = zipInfoLines.find((candidate) => candidate.endsWith(` ${entry}`));
        if (!line || !line.startsWith('-rwx')) {
            throw new PrVsixVerificationError(`PR VSIX executable mode mismatch: ${entry}`);
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

function verifyPrVsix(vsixPath, targets) {
    const resolvedPath = path.resolve(repoRoot, vsixPath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size === 0) {
        throw new PrVsixVerificationError('PR VSIX must be a non-empty file');
    }

    verifyTargetMap(targets);
    runUnzip(['-tqq', resolvedPath]);
    const entries = runUnzip(['-Z1', resolvedPath]).split(/\r?\n/).filter(Boolean);
    const nativeEntries = verifyEntrySet(entries, targets);
    const zipInfoLines = runUnzip(['-Z', '-l', resolvedPath]).split(/\r?\n/).filter(Boolean);
    verifyExecutableModes(zipInfoLines, nativeEntries);
    const manifest = runUnzip(['-p', resolvedPath, 'extension.vsixmanifest']);
    if (/TargetPlatform=/.test(manifest)) {
        throw new PrVsixVerificationError('PR VSIX must remain untargeted for cross-platform installation');
    }

    return Object.freeze({
        path: path.relative(repoRoot, resolvedPath),
        bytes: stat.size,
        sha256: createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex'),
        canonicalTargets: targets.length,
        desktopTargets: targets.filter((target) => target !== 'web').length,
        nativeBinaries: nativeEntries.length
    });
}

function main() {
    if (process.argv.length !== 3) {
        throw new PrVsixVerificationError('usage: node scripts/ci/verify-pr-vsix.mjs <path.vsix>');
    }
    const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
    process.stdout.write(`${JSON.stringify(verifyPrVsix(process.argv[2], targets))}\n`);
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
    expectedRipgrepEntries,
    verifyEntrySet,
    verifyExecutableModes,
    verifyPrVsix,
    verifyTargetMap
};
