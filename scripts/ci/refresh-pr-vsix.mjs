import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    BOT_LOGIN,
    COMMENT_MARKER,
    PrVsixInvariantError,
    apiRetryFromEnvironment,
    automaticBuildAllowed,
    createGitHubApi,
    parseCommentMetadata,
    previewArtifactName,
    pullRequestContext,
    waitForStablePullRequest
} from './sync-pr-vsix-comment.mjs';

const modulePath = fileURLToPath(import.meta.url);

function requirePositiveNumber(value, label) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new PrVsixInvariantError(`${label}: expected a positive number`);
    }
    return parsed;
}

function managedMetadata(comments) {
    return comments.filter((comment) => comment && comment.user && comment.user.login === BOT_LOGIN &&
        typeof comment.body === 'string' && comment.body.includes(COMMENT_MARKER))
        .map((comment) => parseCommentMetadata(comment.body))
        .filter(Boolean);
}

function metadataMatchesContext(metadata, context) {
    return metadata.headSha === context.headSha && metadata.baseSha === context.baseSha &&
        metadata.mergeSha === context.mergeSha;
}

function metadataMatchesSource(metadata, context) {
    return metadata.headSha === context.headSha && metadata.baseSha === context.baseSha;
}

function scheduledRefreshCause({ pullRequest, context, comments, artifacts, now, renewalWindowMs, pendingWindowMs }) {
    const metadata = managedMetadata(comments).find((candidate) =>
        metadataMatchesContext(candidate, context)
    );
    if (!metadata) {
        return 'repair';
    }
    if (['pending', 'provisional', 'transitioning'].includes(metadata.phase)) {
        const observedAt = Date.parse(metadata.startedAt);
        return !Number.isFinite(observedAt) || now - observedAt >= pendingWindowMs ? 'repair' : undefined;
    }
    if (metadata.phase !== 'completed') {
        return 'repair';
    }
    if (!metadata.artifactId) {
        return artifacts.length > 0 || metadata.conclusion === 'success' ? 'repair' : undefined;
    }
    if (artifacts.length !== 1) {
        return 'repair';
    }

    const expectedName = previewArtifactName(pullRequest.number);
    const artifact = artifacts.find((candidate) =>
        candidate.id === metadata.artifactId && candidate.name === expectedName &&
        candidate.workflow_run && candidate.workflow_run.id === metadata.runId
    );
    if (!artifact || artifact.expired) {
        return 'repair';
    }
    const expiresAt = Date.parse(artifact.expires_at);
    if (!Number.isFinite(expiresAt)) {
        return 'repair';
    }
    return expiresAt - now <= renewalWindowMs ? 'renewal' : undefined;
}

function requiresScheduledRefresh(options) {
    return scheduledRefreshCause(options) !== undefined;
}

function refreshPayload(context, cause) {
    if (!context || !Number.isSafeInteger(context.pullRequestNumber)) {
        return undefined;
    }
    return Object.freeze({
        pull_request_number: context.pullRequestNumber,
        head_sha: context.headSha,
        base_sha: context.baseSha,
        merge_sha: context.mergeSha,
        cause
    });
}

async function mapConcurrent(values, concurrency, operation) {
    const results = new Array(values.length);
    const failures = [];
    let cursor = 0;
    async function worker() {
        while (cursor < values.length) {
            const index = cursor;
            cursor += 1;
            try {
                results[index] = await operation(values[index]);
            } catch (cause) {
                failures.push(new PrVsixInvariantError(`refresh item ${index}: ${cause.message || String(cause)}`, {
                    cause
                }));
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
    if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} PR VSIX refresh operations failed`);
    }
    return results;
}

function createDispatchScheduler(api, { intervalMs, now = Date.now, sleep = (delay) =>
    new Promise((resolve) => setTimeout(resolve, delay)) }) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 0) {
        throw new PrVsixInvariantError('dispatch interval: expected a non-negative integer');
    }
    let queue = Promise.resolve();
    let nextDispatchAt = 0;
    return function dispatchRepositoryEvent(eventType, payload) {
        let release;
        const predecessor = queue;
        queue = new Promise((resolve) => {
            release = resolve;
        });
        return predecessor.then(async () => {
            let retryAfterMs = 0;
            try {
                const delay = Math.max(0, nextDispatchAt - now());
                if (delay > 0) {
                    await sleep(delay);
                }
                return await api.dispatchRepositoryEvent(eventType, payload);
            } catch (error) {
                retryAfterMs = Number.isFinite(error && error.retryAfterMs) ? error.retryAfterMs : 0;
                throw error;
            } finally {
                nextDispatchAt = now() + Math.max(intervalMs, retryAfterMs);
                release();
            }
        });
    };
}

function managedCommentPullRequestNumber(comment) {
    if (!comment || !comment.user || comment.user.login !== BOT_LOGIN ||
        typeof comment.body !== 'string' || !comment.body.includes(COMMENT_MARKER)) {
        return undefined;
    }
    let url;
    try {
        url = new URL(comment.issue_url);
    } catch (cause) {
        throw new PrVsixInvariantError('managed comment issue URL: expected an absolute URL', { cause });
    }
    const value = Number(url.pathname.split('/').filter(Boolean).pop());
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new PrVsixInvariantError('managed comment issue URL: expected a positive issue number');
    }
    return value;
}

function managedArtifactPullRequestNumber(artifact) {
    const name = artifact && String(artifact.name || '');
    const suffix = '.vsix';
    if (!name.startsWith('better-todo-tree-pr-') || !name.endsWith(suffix)) {
        return undefined;
    }
    const value = Number(name.slice('better-todo-tree-pr-'.length, -suffix.length));
    return Number.isSafeInteger(value) && value > 0 && previewArtifactName(value) === name ? value : undefined;
}

function groupScheduledState(pullRequests, comments, artifacts) {
    const pullRequestNumbers = new Set(pullRequests.map((pullRequest) => pullRequest.number));
    const commentsByPullRequest = new Map();
    const artifactsByName = new Map();
    const managedPullRequestNumbers = new Set();
    comments.forEach((comment) => {
        const pullRequestNumber = managedCommentPullRequestNumber(comment);
        if (pullRequestNumber === undefined) {
            return;
        }
        managedPullRequestNumbers.add(pullRequestNumber);
        const bucket = commentsByPullRequest.get(pullRequestNumber) || [];
        bucket.push(comment);
        commentsByPullRequest.set(pullRequestNumber, bucket);
    });
    artifacts.forEach((artifact) => {
        const pullRequestNumber = managedArtifactPullRequestNumber(artifact);
        if (pullRequestNumber === undefined || !managedPullRequestNumbers.has(pullRequestNumber)) {
            return;
        }
        const bucket = artifactsByName.get(artifact.name) || [];
        bucket.push(artifact);
        artifactsByName.set(artifact.name, bucket);
    });
    const closedCandidates = Array.from(managedPullRequestNumbers)
        .filter((pullRequestNumber) => !pullRequestNumbers.has(pullRequestNumber))
        .sort((left, right) => left - right);
    return Object.freeze({ commentsByPullRequest, artifactsByName, closedCandidates });
}

function requiresAuthorizationRevocation({ pullRequest, comments, artifacts }) {
    const context = pullRequestContext(pullRequest);
    const metadata = managedMetadata(comments);
    const currentBlocked = metadata.length === 1 && metadataMatchesSource(metadata[0], context) &&
        metadata[0].phase === 'blocked';
    return !currentBlocked || artifacts.length > 0;
}

function requiresClosedRepair(comments, artifacts) {
    const metadata = managedMetadata(comments);
    return artifacts.length > 0 || metadata.length !== 1 || metadata[0].phase !== 'closed';
}

async function refreshOpenPullRequests({
    api,
    base,
    scheduled,
    now,
    renewalWindowMs,
    pendingWindowMs,
    concurrency,
    mergeRetry,
    commentSince,
    dispatchRepositoryEvent = api.dispatchRepositoryEvent.bind(api),
    phase = 'open',
    cursor = 0,
    batchSize = Number.MAX_SAFE_INTEGER
}) {
    if (!['open', 'closed'].includes(phase) || !Number.isSafeInteger(cursor) || cursor < 0 ||
        !Number.isSafeInteger(batchSize) || batchSize <= 0 || phase === 'closed' && !scheduled) {
        throw new PrVsixInvariantError('refresh cursor: expected a valid phase, cursor, and batch size');
    }
    const pullRequests = (await api.listOpenPullRequests(base)).slice().sort((left, right) =>
        left.number - right.number
    );
    let scheduledState;
    if (scheduled) {
        const [comments, artifacts] = await Promise.all([
            api.listRepositoryIssueComments(commentSince),
            api.listRepositoryArtifacts()
        ]);
        scheduledState = groupScheduledState(pullRequests, comments, artifacts);
    }
    const openCandidates = phase === 'open' ? pullRequests.filter((pullRequest) =>
        pullRequest.number > cursor
    ).slice(0, batchSize) : [];
    const decisions = await mapConcurrent(openCandidates, concurrency, async (listedPullRequest) => {
        const comments = scheduled ? scheduledState.commentsByPullRequest.get(listedPullRequest.number) || [] : [];
        const artifactName = previewArtifactName(listedPullRequest.number);
        const artifacts = scheduled ? scheduledState.artifactsByName.get(artifactName) || [] : [];
        if (!automaticBuildAllowed(listedPullRequest)) {
            if (scheduled && requiresAuthorizationRevocation({
                pullRequest: listedPullRequest,
                comments,
                artifacts
            })) {
                await dispatchRepositoryEvent(
                    'refresh-pr-vsix',
                    refreshPayload(pullRequestContext(listedPullRequest), 'approval-revoked')
                );
                return 'revoked';
            }
            return 'unsafe';
        }
        const stable = await waitForStablePullRequest({
            api,
            pullRequestNumber: listedPullRequest.number,
            expectedHeadSha: listedPullRequest.head.sha,
            expectedBaseSha: listedPullRequest.base.sha,
            retry: mergeRetry
        });
        if (stable.pullRequest.state === 'closed') {
            await dispatchRepositoryEvent(
                'refresh-pr-vsix',
                refreshPayload(stable.context, 'closed-repair')
            );
            return 'closed-repaired';
        }
        if (stable.pullRequest.state !== 'open') {
            return 'skipped';
        }
        if (!automaticBuildAllowed(stable.pullRequest)) {
            await dispatchRepositoryEvent(
                'refresh-pr-vsix',
                refreshPayload(stable.context, 'approval-revoked')
            );
            return 'revoked';
        }
        const cause = scheduled ? scheduledRefreshCause({
            pullRequest: stable.pullRequest,
            context: stable.context,
            comments,
            artifacts,
            now,
            renewalWindowMs,
            pendingWindowMs
        }) : 'base-push';
        if (!cause) {
            return 'current';
        }
        await dispatchRepositoryEvent('refresh-pr-vsix', refreshPayload(stable.context, cause));
        return 'dispatched';
    });
    const closedCandidates = scheduled && phase === 'closed' ? scheduledState.closedCandidates.filter(
        (pullRequestNumber) => pullRequestNumber > cursor
    ).slice(0, batchSize) : [];
    const closedDecisions = scheduled && phase === 'closed' ? await mapConcurrent(
        closedCandidates,
        concurrency,
        async (pullRequestNumber) => {
            const comments = scheduledState.commentsByPullRequest.get(pullRequestNumber) || [];
            const artifacts = scheduledState.artifactsByName.get(previewArtifactName(pullRequestNumber)) || [];
            if (!requiresClosedRepair(comments, artifacts)) {
                return 'current';
            }
            const pullRequest = await api.getPullRequest(pullRequestNumber);
            if (pullRequest.state !== 'closed') {
                return 'skipped';
            }
            await dispatchRepositoryEvent(
                'refresh-pr-vsix',
                refreshPayload(pullRequestContext(pullRequest), 'closed-repair')
            );
            return 'repaired';
        }
    ) : [];
    let continuation;
    if (phase === 'open') {
        const lastOpen = openCandidates[openCandidates.length - 1];
        const remainingOpen = lastOpen && pullRequests.some((pullRequest) => pullRequest.number > lastOpen.number);
        if (remainingOpen) {
            continuation = Object.freeze({ phase: 'open', cursor: lastOpen.number });
        } else if (scheduled && scheduledState.closedCandidates.length > 0) {
            continuation = Object.freeze({ phase: 'closed', cursor: 0 });
        }
    } else {
        const lastClosed = closedCandidates[closedCandidates.length - 1];
        if (lastClosed !== undefined && scheduledState.closedCandidates.some((number) => number > lastClosed)) {
            continuation = Object.freeze({ phase: 'closed', cursor: lastClosed });
        }
    }
    return Object.freeze({
        scanned: decisions.length,
        dispatched: decisions.filter((decision) => decision === 'dispatched').length,
        current: decisions.filter((decision) => decision === 'current').length,
        skipped: decisions.filter((decision) => decision === 'skipped').length,
        revoked: decisions.filter((decision) => decision === 'revoked').length,
        unsafe: decisions.filter((decision) => decision === 'unsafe').length,
        closedRepaired: decisions.filter((decision) => decision === 'closed-repaired').length +
            closedDecisions.filter((decision) => decision === 'repaired').length,
        ...(continuation ? { continuation } : {})
    });
}

function workflowRunBaseBranch(event) {
    const run = event && event.workflow_run;
    const repository = event && event.repository;
    if (event.action !== 'completed' || !run || run.name !== 'PR VSIX Base Event' ||
        run.event !== 'push' || run.conclusion !== 'success' || !run.head_repository ||
        !repository || run.head_repository.id !== repository.id) {
        throw new PrVsixInvariantError('base event: expected a successful same-repository push workflow');
    }
    const branch = String(run.head_branch || '');
    if (!branch || branch.includes('\n') || branch.includes('\r')) {
        throw new PrVsixInvariantError('base event branch: expected a branch name');
    }
    return branch;
}

function continuationInvocation(event) {
    const payload = event && event.client_payload;
    if (event.action !== 'continue-pr-vsix-refresh' || !payload ||
        typeof payload.scheduled !== 'boolean' ||
        !['open', 'closed'].includes(payload.phase) ||
        !Number.isSafeInteger(payload.cursor) || payload.cursor < 0 ||
        (payload.scheduled ? payload.base !== '' : typeof payload.base !== 'string' || payload.base.length === 0) ||
        (!payload.scheduled && payload.phase === 'closed')) {
        throw new PrVsixInvariantError('refresh continuation: expected a valid trusted cursor payload');
    }
    return Object.freeze({
        base: payload.base || undefined,
        scheduled: payload.scheduled,
        phase: payload.phase,
        cursor: payload.cursor
    });
}

async function main() {
    if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_EVENT_NAME) {
        throw new PrVsixInvariantError('GitHub event: expected payload path and event name');
    }
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const repository = event.repository && event.repository.full_name;
    const invocation = process.env.GITHUB_EVENT_NAME === 'workflow_run' ? Object.freeze({
        base: workflowRunBaseBranch(event),
        scheduled: false,
        phase: 'open',
        cursor: 0
    }) : process.env.GITHUB_EVENT_NAME === 'repository_dispatch' ? continuationInvocation(event) : Object.freeze({
        base: undefined,
        scheduled: true,
        phase: 'open',
        cursor: 0
    });
    const renewalDays = requirePositiveNumber(process.env.PR_VSIX_RENEWAL_DAYS, 'renewal days');
    const retentionDays = requirePositiveNumber(
        process.env.PR_VSIX_ARTIFACT_RETENTION_DAYS,
        'artifact retention days'
    );
    const pendingHours = requirePositiveNumber(process.env.PR_VSIX_PENDING_HOURS, 'pending hours');
    const concurrency = requirePositiveNumber(process.env.PR_VSIX_REFRESH_CONCURRENCY, 'refresh concurrency');
    const mergeAttempts = requirePositiveNumber(process.env.PR_VSIX_MERGE_ATTEMPTS, 'merge attempts');
    const mergeIntervalMs = Number(process.env.PR_VSIX_MERGE_INTERVAL_MS);
    const dispatchIntervalMs = Number(process.env.PR_VSIX_DISPATCH_INTERVAL_MS);
    const batchSize = Number(process.env.PR_VSIX_REFRESH_BATCH_SIZE);
    if (!Number.isSafeInteger(concurrency) || !Number.isSafeInteger(mergeAttempts) ||
        !Number.isSafeInteger(mergeIntervalMs) || mergeIntervalMs < 0 ||
        !Number.isSafeInteger(dispatchIntervalMs) || dispatchIntervalMs < 0 ||
        !Number.isSafeInteger(batchSize) || batchSize <= 0) {
        throw new PrVsixInvariantError('refresh integers: expected valid concurrency and merge retry values');
    }
    const api = createGitHubApi({
        token: process.env.GITHUB_TOKEN,
        repository,
        apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
        retry: apiRetryFromEnvironment()
    });
    const now = Date.now();
    const dispatchRepositoryEvent = createDispatchScheduler(api, { intervalMs: dispatchIntervalMs });
    const result = await refreshOpenPullRequests({
        api,
        base: invocation.base,
        scheduled: invocation.scheduled,
        now,
        renewalWindowMs: renewalDays * 24 * 60 * 60 * 1000,
        pendingWindowMs: pendingHours * 60 * 60 * 1000,
        concurrency,
        mergeRetry: { attempts: mergeAttempts, intervalMs: mergeIntervalMs },
        commentSince: new Date(now - (retentionDays + 1) * 24 * 60 * 60 * 1000).toISOString(),
        dispatchRepositoryEvent,
        phase: invocation.phase,
        cursor: invocation.cursor,
        batchSize
    });
    if (result.continuation) {
        await dispatchRepositoryEvent('continue-pr-vsix-refresh', {
            scheduled: invocation.scheduled,
            base: invocation.base || '',
            phase: result.continuation.phase,
            cursor: result.continuation.cursor
        });
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
    main().catch((error) => {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}

export {
    mapConcurrent,
    createDispatchScheduler,
    continuationInvocation,
    groupScheduledState,
    refreshOpenPullRequests,
    refreshPayload,
    requiresScheduledRefresh,
    scheduledRefreshCause,
    requiresAuthorizationRevocation,
    requiresClosedRepair,
    workflowRunBaseBranch
};
