import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const targetsPath = path.join(__dirname, 'targets.json');
const defaultOutputDirectory = path.join(repoRoot, 'artifacts', 'vsix');

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

function main() {
    const packageJson = readJson(packageJsonPath);
    const supportedTargets = readJson(targetsPath);
    const outputDirectory = process.env.VSIX_OUTDIR ? path.resolve(repoRoot, process.env.VSIX_OUTDIR) : defaultOutputDirectory;
    const selectedTargets = normalizeRequestedTargets(process.argv.slice(2), supportedTargets);

    ensureOutputDirectory(outputDirectory);

    if (process.env.SKIP_PREPUBLISH !== '1') {
        run('npm', ['run', 'vscode:prepublish']);
    }

    selectedTargets.forEach((target) => {
        const outputPath = path.join(outputDirectory, `${packageJson.name}-${packageJson.version}-${target}.vsix`);
        run('npx', ['--no-install', '@vscode/vsce', 'package', '--no-dependencies', '--target', target, '--out', outputPath]);
        process.stdout.write(`${outputPath}\n`);
    });
}

main();
