import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    PrVsixInvariantError,
    apiRetryFromEnvironment,
    automaticBuildAllowed,
    createGitHubApi,
    pullRequestContext,
    waitForStablePullRequest
} from './sync-pr-vsix-comment.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const BUILD_CAUSES = new Set([
    'approval-revoked',
    'base-edited',
    'base-push',
    'closed-repair',
    'labeled',
    'manual',
    'opened',
    'renewal',
    'reopened',
    'repair',
    'synchronize'
]);
const modulePath = fileURLToPath(import.meta.url);

function requireEventRepository(event) {
    const repository = event && event.repository && event.repository.full_name;
    if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        throw new PrVsixInvariantError('repository: expected owner/name');
    }
    return repository;
}

function requireDispatchPayload(payload) {
    if (!payload || !Number.isSafeInteger(payload.pull_request_number) || payload.pull_request_number <= 0 ||
        !SHA_PATTERN.test(String(payload.head_sha || '')) || !SHA_PATTERN.test(String(payload.base_sha || '')) ||
        !(payload.merge_sha === 'none' || SHA_PATTERN.test(String(payload.merge_sha || ''))) ||
        !BUILD_CAUSES.has(payload.cause)) {
        throw new PrVsixInvariantError('repository dispatch payload: expected PR, build SHAs, and cause');
    }
    return Object.freeze({
        pullRequestNumber: payload.pull_request_number,
        headSha: payload.head_sha,
        baseSha: payload.base_sha,
        mergeSha: payload.merge_sha,
        cause: payload.cause
    });
}

function contextEquals(left, right) {
    return left.pullRequestNumber === right.pullRequestNumber && left.headSha === right.headSha &&
        left.baseSha === right.baseSha && left.mergeSha === right.mergeSha;
}

async function resolveBuildContext({ event, api, mergeRetry }) {
    const repository = requireEventRepository(event);
    if (event.action !== 'refresh-pr-vsix' || !api) {
        throw new PrVsixInvariantError('repository dispatch: expected refresh-pr-vsix and a GitHub API client');
    }
    const requested = requireDispatchPayload(event.client_payload);
    if (requested.cause === 'approval-revoked' || requested.cause === 'closed-repair') {
        const pullRequest = await api.getPullRequest(requested.pullRequestNumber);
        const context = pullRequestContext(pullRequest);
        const baseRepository = pullRequest.base && pullRequest.base.repo;
        const cleanupRequired = requested.cause === 'approval-revoked' ?
            pullRequest.state === 'open' && !automaticBuildAllowed(pullRequest) && contextEquals(requested, context) :
            pullRequest.state === 'closed';
        if (cleanupRequired && baseRepository && baseRepository.full_name === repository) {
            return Object.freeze({
                ...context,
                checkoutSha: context.baseSha,
                build: false,
                isPullRequest: true
            });
        }
        throw new PrVsixInvariantError(
            `pull request ${requested.pullRequestNumber}: cleanup context is stale or inapplicable`
        );
    }
    const stable = await waitForStablePullRequest({
        api,
        pullRequestNumber: requested.pullRequestNumber,
        expectedHeadSha: requested.headSha,
        expectedBaseSha: requested.baseSha,
        retry: mergeRetry
    });
    if (!stable.buildable || !automaticBuildAllowed(stable.pullRequest) ||
        !stable.pullRequest.base || !stable.pullRequest.base.repo ||
        stable.pullRequest.base.repo.full_name !== repository || !contextEquals(requested, stable.context)) {
        throw new PrVsixInvariantError(`pull request ${requested.pullRequestNumber}: refresh context is unauthorized, stale, or unmergeable`);
    }
    return Object.freeze({
        ...stable.context,
        checkoutSha: stable.context.mergeSha,
        build: true,
        isPullRequest: true
    });
}

function renderOutputs(context) {
    return [
        `is-pull-request=${context.isPullRequest}`,
        `build=${context.build}`,
        `checkout-sha=${context.checkoutSha}`,
        `pull-request-number=${context.pullRequestNumber}`,
        `head-sha=${context.headSha}`,
        `base-sha=${context.baseSha}`,
        `merge-sha=${context.mergeSha}`
    ].join('\n') + '\n';
}

async function main() {
    if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_OUTPUT) {
        throw new PrVsixInvariantError('GitHub files: expected event and output paths');
    }
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const repository = requireEventRepository(event);
    const api = createGitHubApi({
        token: process.env.GITHUB_TOKEN,
        repository,
        apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
        retry: apiRetryFromEnvironment()
    });
    const context = await resolveBuildContext({
        event,
        api,
        mergeRetry: {
            attempts: Number(process.env.PR_VSIX_MERGE_ATTEMPTS),
            intervalMs: Number(process.env.PR_VSIX_MERGE_INTERVAL_MS)
        }
    });
    fs.appendFileSync(process.env.GITHUB_OUTPUT, renderOutputs(context), 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
    main().catch((error) => {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}

export { contextEquals, renderOutputs, resolveBuildContext };
