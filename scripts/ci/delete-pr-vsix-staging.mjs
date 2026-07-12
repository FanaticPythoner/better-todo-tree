import { createGitHubApi, apiRetryFromEnvironment, PrVsixInvariantError } from './sync-pr-vsix-comment.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);

function requireEnvironment(name) {
    const value = process.env[name];
    if (!value) {
        throw new PrVsixInvariantError(`${name}: expected a non-empty value`);
    }
    return value;
}

async function deleteStagingArtifact(api, runId, stagingName) {
    const artifacts = await api.listRunArtifacts(runId);
    const matches = artifacts.filter((artifact) => artifact && artifact.name === stagingName);
    if (matches.length !== 1) {
        throw new PrVsixInvariantError(
            `staging artifact ${stagingName}: expected one current artifact, found ${matches.length}`
        );
    }
    await api.deleteArtifact(matches[0].id);
    return Object.freeze({ deletedArtifactId: matches[0].id, stagingName });
}

async function main() {
    const runId = Number(requireEnvironment('GITHUB_RUN_ID'));
    const stagingName = requireEnvironment('PR_VSIX_STAGING_NAME');
    const api = createGitHubApi({
        token: requireEnvironment('GITHUB_TOKEN'),
        repository: requireEnvironment('GITHUB_REPOSITORY'),
        apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
        retry: apiRetryFromEnvironment()
    });
    process.stdout.write(`${JSON.stringify(await deleteStagingArtifact(api, runId, stagingName))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
    main().catch((error) => {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}

export { deleteStagingArtifact };
