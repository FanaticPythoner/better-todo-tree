import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_VERSION = '2026-03-10';
const BOT_LOGIN = 'github-actions[bot]';
const COMMENT_MARKER = '<!-- better-todo-tree-pr-vsix';
const ARTIFACT_NAME_PREFIX = 'better-todo-tree-pr-';
const EXTERNAL_APPROVAL_REASON = 'External fork previews require maintainer approval with the `safe-to-test` label.';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CI_ACTIONS = new Set([
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
const repoRoot = path.resolve(path.dirname(modulePath), '..', '..');
const targetsPath = path.join(repoRoot, 'scripts', 'release', 'targets.json');

class PrVsixInvariantError extends Error {
    constructor(message, options) {
        super(message, options && options.cause ? { cause: options.cause } : undefined);
        this.name = 'PrVsixInvariantError';
        this.status = options && options.status;
        this.retryable = Boolean(options && options.retryable);
        this.retryAfterMs = options && options.retryAfterMs;
    }
}

function requireInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new PrVsixInvariantError(`${label}: expected a positive integer`);
    }
    return value;
}

function requireSha(value, label) {
    if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
        throw new PrVsixInvariantError(`${label}: expected a 40-character lowercase commit SHA`);
    }
    return value;
}

function requireMergeSha(value, label = 'merge SHA') {
    if (value === 'none') {
        return value;
    }
    return requireSha(value, label);
}

function requireRepository(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
        throw new PrVsixInvariantError('repository: expected owner/name');
    }
    return value;
}

function timestamp(value, label) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw new PrVsixInvariantError(`${label}: expected an ISO-8601 timestamp`);
    }
    return parsed;
}

function requireWorkflowRun(run) {
    if (!run) {
        throw new PrVsixInvariantError('workflow run: expected metadata');
    }

    const createdAt = String(run.created_at || '');
    const startedAt = String(run.run_started_at || run.created_at || '');
    const updatedAt = String(run.updated_at || '');
    timestamp(createdAt, 'workflow run creation time');
    timestamp(startedAt, 'workflow run start time');
    timestamp(updatedAt, 'workflow run update time');
    return Object.freeze({
        id: requireInteger(run.id, 'workflow run id'),
        runAttempt: requireInteger(run.run_attempt, 'workflow run attempt'),
        runNumber: requireInteger(run.run_number, 'workflow run number'),
        workflowId: requireInteger(run.workflow_id, 'workflow id'),
        workflowHeadSha: requireSha(run.head_sha, 'workflow run head SHA'),
        headRepositoryId: run.head_repository ? requireInteger(run.head_repository.id, 'head repository id') : undefined,
        createdAt,
        startedAt,
        updatedAt,
        displayTitle: String(run.display_title || ''),
        event: String(run.event || ''),
        name: String(run.name || ''),
        status: String(run.status || ''),
        conclusion: String(run.conclusion || ''),
        pullRequestNumbers: Array.isArray(run.pull_requests) ? run.pull_requests.map((pullRequest) =>
            requireInteger(pullRequest.number, 'workflow run pull request number')
        ) : []
    });
}

function previewArtifactName(pullRequestNumber) {
    return `${ARTIFACT_NAME_PREFIX}${requireInteger(pullRequestNumber, 'pull request number')}.vsix`;
}

function parseCiRunName(displayTitle) {
    const match = String(displayTitle || '').match(
        /^PR VSIX Build PR #([1-9][0-9]*) head ([0-9a-f]{40}) base ([0-9a-f]{40}) merge ([0-9a-f]{40}|none) action ([a-z-]+)$/
    );
    if (!match) {
        return undefined;
    }
    return Object.freeze({
        pullRequestNumber: Number(match[1]),
        headSha: match[2],
        baseSha: match[3],
        mergeSha: match[4],
        action: match[5]
    });
}

function parseLifecycleRunName(displayTitle) {
    const match = String(displayTitle || '').match(
        /^PR VSIX Event #([1-9][0-9]*) (closed|edited|labeled|unlabeled|opened|reopened|synchronize)$/
    );
    return match ? Object.freeze({ pullRequestNumber: Number(match[1]), action: match[2] }) : undefined;
}

function parseLifecycleArtifactName(name) {
    const match = String(name || '').match(
        /^better-todo-tree-pr-vsix-event-([1-9][0-9]*)-head-([0-9a-f]{40})-base-([0-9a-f]{40})-merge-([0-9a-f]{40}|none)-(closed|edited|labeled|unlabeled|opened|reopened|synchronize)-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/
    );
    return match ? Object.freeze({
        pullRequestNumber: Number(match[1]),
        headSha: match[2],
        baseSha: match[3],
        mergeSha: match[4],
        action: match[5],
        runId: Number(match[6]),
        runAttempt: Number(match[7])
    }) : undefined;
}

function artifactUrl(repository, runId, artifactId) {
    return `https://github.com/${requireRepository(repository)}/actions/runs/${requireInteger(runId, 'workflow run id')}/artifacts/${requireInteger(artifactId, 'artifact id')}`;
}

function runUrl(repository, runId) {
    return `https://github.com/${requireRepository(repository)}/actions/runs/${requireInteger(runId, 'workflow run id')}`;
}

function commitUrl(repository, sha) {
    return `https://github.com/${requireRepository(repository)}/commit/${requireSha(sha, 'commit SHA')}`;
}

function renderMarker(run, artifact) {
    return [
        COMMENT_MARKER,
        `source: ${run.source}`,
        `action: ${run.action}`,
        `run-id: ${run.id}`,
        `run-attempt: ${run.runAttempt}`,
        `run-number: ${run.runNumber}`,
        `observed-at: ${run.startedAt}`,
        `head-sha: ${run.headSha}`,
        `base-sha: ${run.baseSha}`,
        `merge-sha: ${run.mergeSha}`,
        `phase: ${run.phase}`,
        `conclusion: ${run.conclusion || 'none'}`,
        `artifact-id: ${artifact ? artifact.id : 'none'}`,
        `artifact-name: ${artifact ? artifact.name : 'none'}`,
        '-->'
    ].join('\n');
}

function parseCommentMetadata(body) {
    if (typeof body !== 'string' || !body.includes(COMMENT_MARKER)) {
        return undefined;
    }

    const patterns = {
        source: /source: (ci|lifecycle)/,
        action: /action: ([a-z-]+)/,
        runId: /run-id: ([1-9][0-9]*)/,
        runAttempt: /run-attempt: ([1-9][0-9]*)/,
        runNumber: /run-number: ([1-9][0-9]*)/,
        startedAt: /observed-at: ([^\n]+)/,
        headSha: /head-sha: ([0-9a-f]{40})/,
        baseSha: /base-sha: ([0-9a-f]{40})/,
        mergeSha: /merge-sha: ([0-9a-f]{40}|none)/,
        phase: /phase: (blocked|closed|completed|pending|provisional|transitioning)/,
        conclusion: /conclusion: ([a-z_]+|none)/,
        artifactId: /artifact-id: ([1-9][0-9]*|none)/,
        artifactName: /artifact-name: ([A-Za-z0-9._-]+|none)/
    };
    const matches = Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [key, body.match(pattern)]));
    if (!matches.runId || !matches.runAttempt) {
        return undefined;
    }

    return Object.freeze({
        source: matches.source && matches.source[1],
        action: matches.action && matches.action[1],
        runId: Number(matches.runId[1]),
        runAttempt: Number(matches.runAttempt[1]),
        runNumber: matches.runNumber ? Number(matches.runNumber[1]) : undefined,
        startedAt: matches.startedAt && matches.startedAt[1],
        headSha: matches.headSha && matches.headSha[1],
        baseSha: matches.baseSha && matches.baseSha[1],
        mergeSha: matches.mergeSha && matches.mergeSha[1],
        phase: matches.phase && matches.phase[1],
        conclusion: matches.conclusion && matches.conclusion[1] !== 'none' ? matches.conclusion[1] : undefined,
        artifactId: matches.artifactId && matches.artifactId[1] !== 'none' ? Number(matches.artifactId[1]) : undefined,
        artifactName: matches.artifactName && matches.artifactName[1] !== 'none' ? matches.artifactName[1] : undefined
    });
}

function compareSequence(left, right) {
    if (left.runNumber !== right.runNumber) {
        return left.runNumber - right.runNumber;
    }
    return left.runAttempt - right.runAttempt;
}

function contextMatches(left, right) {
    return left.headSha === right.headSha && left.baseSha === right.baseSha && left.mergeSha === right.mergeSha;
}

function phaseRank(phase) {
    return phase === 'completed' ? 2 : 1;
}

function existingStateDominates(existing, incoming) {
    if (!existing.source || !existing.runNumber || !existing.startedAt || !existing.baseSha || !existing.mergeSha ||
        !contextMatches(existing, incoming) || incoming.phase === 'closed' || existing.phase === 'closed') {
        return false;
    }
    if (existing.source === 'ci' && incoming.source === 'ci') {
        const generation = compareSequence(existing, incoming);
        return generation > 0 || generation === 0 && phaseRank(existing.phase) > phaseRank(incoming.phase);
    }
    const sameAction = existing.action && existing.action === incoming.action;
    if (sameAction && existing.source === 'ci' && incoming.source === 'lifecycle' &&
        existing.phase === 'completed' && incoming.phase !== 'blocked') {
        return true;
    }
    if (sameAction && existing.source === 'lifecycle' && incoming.source === 'ci' &&
        incoming.phase === 'completed' && existing.phase !== 'blocked') {
        return false;
    }

    const observed = timestamp(existing.startedAt, 'comment observation time') -
        timestamp(incoming.startedAt, 'workflow observation time');
    if (observed !== 0) {
        return observed > 0;
    }
    if (existing.source !== incoming.source) {
        return existing.source === 'ci';
    }
    return compareSequence(existing, incoming) > 0;
}

function isArtifactForRun(artifact, run, pullRequestNumber) {
    const createdAt = artifact && timestamp(artifact.created_at, 'artifact creation time');
    return artifact && artifact.name === previewArtifactName(pullRequestNumber) &&
        artifact.workflow_run && artifact.workflow_run.id === run.id &&
        artifact.workflow_run.head_sha === run.workflowHeadSha &&
        createdAt >= timestamp(run.startedAt, 'workflow run start time') &&
        (run.status !== 'completed' || createdAt <= timestamp(run.updatedAt, 'workflow run update time'));
}

function isCurrentArtifact(artifact, run, pullRequestNumber) {
    return isArtifactForRun(artifact, run, pullRequestNumber) && !artifact.expired &&
        Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 &&
        DIGEST_PATTERN.test(String(artifact.digest || '')) &&
        Number.isFinite(timestamp(artifact.expires_at, 'artifact expiry time'));
}

function renderReadyComment({ repository, run, artifact, targets }) {
    if (!isCurrentArtifact(artifact, run, run.pullRequestNumber)) {
        throw new PrVsixInvariantError('artifact: expected a current SHA-256-addressed artifact');
    }
    if (!Array.isArray(targets) || targets.length === 0) {
        throw new PrVsixInvariantError('targets: expected a non-empty target list');
    }

    const desktopTargets = targets.filter((target) => target !== 'web');
    return [
        renderMarker(run, artifact),
        '### PR VSIX: ready',
        '',
        `Full CI passed for [\`${run.headSha.slice(0, 12)}\`](${commitUrl(repository, run.headSha)}).`,
        '',
        `[Download the cross-platform VSIX](${artifactUrl(repository, run.id, artifact.id)})`,
        '',
        '**Security:** This VSIX contains unreviewed code from this pull request. Use an isolated VS Code profile and a disposable test workspace without production credentials.',
        '',
        `Desktop targets: ${desktopTargets.map((target) => `\`${target}\``).join(', ')}`,
        '',
        `Artifact digest: \`${artifact.digest}\`  `,
        `Expires: \`${artifact.expires_at}\``,
        '',
        'Installation:',
        '1. Download the `.vsix` file while signed in to GitHub.',
        '2. Run `Profiles: Create a Temporary Profile` from the VS Code Command Palette.',
        '3. Open a disposable test workspace without production credentials.',
        '4. Run `Extensions: Install from VSIX...` from the Command Palette.',
        '',
        `[Workflow run](${runUrl(repository, run.id)})`
    ].join('\n');
}

function renderUnavailableComment({ repository, run, reason }) {
    return [
        renderMarker(run),
        '### PR VSIX: unavailable',
        '',
        `No installable bundle matches [\`${run.headSha.slice(0, 12)}\`](${commitUrl(repository, run.headSha)}).`,
        '',
        `Reason: ${reason}`,
        '',
        `[Workflow run](${runUrl(repository, run.id)})`
    ].join('\n');
}

function renderPendingComment({ repository, run }) {
    return [
        renderMarker(run),
        '### PR VSIX: building',
        '',
        `CI is testing [\`${run.headSha.slice(0, 12)}\`](${commitUrl(repository, run.headSha)}).`,
        '',
        'The download link remains withheld until every test, bundle, package, and archive check passes.'
    ].join('\n');
}

function renderTransitionComment({ repository, run }) {
    const transitionRun = Object.freeze({ ...run, phase: 'transitioning' });
    return [
        renderMarker(transitionRun),
        '### PR VSIX: preparing',
        '',
        `Full CI passed for [\`${run.headSha.slice(0, 12)}\`](${commitUrl(repository, run.headSha)}).`,
        '',
        'The verified download link is being synchronized.'
    ].join('\n');
}

function renderClosedComment({ repository, run }) {
    return [
        renderMarker(run),
        '### PR VSIX: unavailable',
        '',
        `The artifact for [\`${run.headSha.slice(0, 12)}\`](${commitUrl(repository, run.headSha)}) was removed when the pull request closed.`
    ].join('\n');
}

function requireWorkflowSelector(value) {
    if (Number.isSafeInteger(value)) {
        return String(requireInteger(value, 'workflow id'));
    }
    if (typeof value === 'string' && /^[A-Za-z0-9._-]+\.ya?ml$/.test(value)) {
        return encodeURIComponent(value);
    }
    throw new PrVsixInvariantError('workflow selector: expected an id or workflow filename');
}

function workflowRunQuery(filters = {}) {
    const parameters = [];
    if (filters.event) {
        if (!['pull_request', 'repository_dispatch'].includes(filters.event)) {
            throw new PrVsixInvariantError('workflow run event filter: unsupported event');
        }
        parameters.push(['event', filters.event]);
    }
    if (filters.headSha) {
        parameters.push(['head_sha', requireSha(filters.headSha, 'workflow run filter head SHA')]);
    }
    if (filters.createdAfter) {
        timestamp(filters.createdAfter, 'workflow run creation lower bound');
        parameters.push(['created', `>=${filters.createdAfter}`]);
    }
    return parameters.length === 0 ? '' : `?${parameters.map(([key, value]) =>
        `${key}=${encodeURIComponent(value)}`
    ).join('&')}`;
}

function requireApiRetryOptions(options = {}) {
    const retry = {
        attempts: options.attempts === undefined ? 1 : Number(options.attempts),
        baseDelayMs: options.baseDelayMs === undefined ? 0 : Number(options.baseDelayMs),
        maxDelayMs: options.maxDelayMs === undefined ? 0 : Number(options.maxDelayMs),
        now: options.now || Date.now,
        sleep: options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
    };
    if (!Number.isSafeInteger(retry.attempts) || retry.attempts <= 0 ||
        !Number.isSafeInteger(retry.baseDelayMs) || retry.baseDelayMs < 0 ||
        !Number.isSafeInteger(retry.maxDelayMs) || retry.maxDelayMs < retry.baseDelayMs ||
        typeof retry.now !== 'function' || typeof retry.sleep !== 'function') {
        throw new PrVsixInvariantError('API retry policy: expected positive attempts and valid delays');
    }
    return Object.freeze(retry);
}

function apiRetryFromEnvironment(environment = process.env) {
    return requireApiRetryOptions({
        attempts: environment.PR_VSIX_API_RETRY_ATTEMPTS,
        baseDelayMs: environment.PR_VSIX_API_RETRY_BASE_MS,
        maxDelayMs: environment.PR_VSIX_API_RETRY_MAX_MS
    });
}

function responseRetryAfterMs(response, now) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.ceil(seconds * 1000);
        }
        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) {
            return Math.max(0, date - now());
        }
    }
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (remaining === '0' && Number.isFinite(reset)) {
        return Math.max(0, reset * 1000 - now()) + 1000;
    }
    return response.status === 403 || response.status === 429 ? 60000 : undefined;
}

function createGitHubApi({
    token,
    repository,
    apiUrl = 'https://api.github.com',
    fetchImpl = globalThis.fetch,
    retry
}) {
    if (typeof token !== 'string' || token.length === 0) {
        throw new PrVsixInvariantError('GITHUB_TOKEN: expected a non-empty token');
    }
    if (typeof fetchImpl !== 'function') {
        throw new PrVsixInvariantError('fetch implementation: expected a function');
    }

    const [owner, name] = requireRepository(repository).split('/');
    const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const retryOptions = requireApiRetryOptions(retry);
    let rateLimitUntil = 0;
    let rateLimitGate = Promise.resolve();

    function blockForRateLimit(delay) {
        const blockedUntil = retryOptions.now() + delay;
        if (blockedUntil <= rateLimitUntil) {
            return rateLimitGate;
        }
        rateLimitUntil = blockedUntil;
        rateLimitGate = rateLimitGate.then(async () => {
            const remaining = Math.max(0, rateLimitUntil - retryOptions.now());
            if (remaining > 0) {
                await retryOptions.sleep(remaining);
            }
        });
        return rateLimitGate;
    }

    async function requestOnce(relativePath, { method = 'GET', body, expectedStatuses = [200] } = {}) {
        let response;
        try {
            response = await fetchImpl(`${apiUrl}${relativePath}`, {
                method,
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    'User-Agent': 'better-todo-tree-pr-vsix',
                    'X-GitHub-Api-Version': API_VERSION,
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
                },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch (cause) {
            throw new PrVsixInvariantError(`GitHub API ${method} ${relativePath}: request failed`, {
                cause,
                retryable: true
            });
        }
        const responseText = await response.text();
        function httpError(detail, cause) {
            const normalizedDetail = String(detail).toLowerCase();
            const rateLimited = response.status === 429 || response.status === 403 &&
                (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0' ||
                normalizedDetail.includes('rate limit') || normalizedDetail.includes('abuse detection'));
            const retryable = rateLimited || [500, 502, 503, 504].includes(response.status);
            return new PrVsixInvariantError(
                `GitHub API ${method} ${relativePath}: HTTP ${response.status}: ${detail}`,
                {
                    cause,
                    status: response.status,
                    retryable,
                    retryAfterMs: rateLimited ? responseRetryAfterMs(response, retryOptions.now) : undefined
                }
            );
        }
        let responseBody;
        try {
            responseBody = responseText.length === 0 ? undefined : JSON.parse(responseText);
        } catch (cause) {
            if (!expectedStatuses.includes(response.status)) {
                throw httpError(responseText.slice(0, 1000), cause);
            }
            throw new PrVsixInvariantError(`GitHub API ${method} ${relativePath}: invalid JSON response`, { cause });
        }

        if (!expectedStatuses.includes(response.status)) {
            const detail = responseBody && responseBody.message ? responseBody.message : responseText.slice(0, 1000);
            throw httpError(detail);
        }
        return responseBody;
    }

    async function request(relativePath, options) {
        for (let attempt = 1; attempt <= retryOptions.attempts; attempt += 1) {
            await rateLimitGate;
            try {
                return await requestOnce(relativePath, options);
            } catch (error) {
                const rateLimitDelay = error instanceof PrVsixInvariantError &&
                    Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0;
                const rateLimitWait = rateLimitDelay > 0 ? blockForRateLimit(rateLimitDelay) : undefined;
                if (!(error instanceof PrVsixInvariantError) || !error.retryable ||
                    attempt === retryOptions.attempts) {
                    throw error;
                }
                const exponentialDelay = Math.min(
                    retryOptions.maxDelayMs,
                    retryOptions.baseDelayMs * 2 ** (attempt - 1)
                );
                if (rateLimitWait) {
                    await rateLimitWait;
                } else if (exponentialDelay > 0) {
                    await retryOptions.sleep(exponentialDelay);
                }
            }
        }
        throw new PrVsixInvariantError('GitHub API retry policy: unreachable state');
    }

    async function listPaginated(relativePath, property) {
        const separator = relativePath.includes('?') ? '&' : '?';
        const values = [];
        let page = 1;
        while (true) {
            const responseBody = await request(`${relativePath}${separator}per_page=100&page=${page}`);
            const pageValues = property === undefined ? responseBody : responseBody && responseBody[property];
            if (!Array.isArray(pageValues)) {
                throw new PrVsixInvariantError(`GitHub API ${relativePath}: expected a paginated array`);
            }
            values.push(...pageValues);
            if (pageValues.length < 100) {
                return values;
            }
            page += 1;
        }
    }

    return Object.freeze({
        getPullRequest(number) {
            return request(`${repositoryPath}/pulls/${requireInteger(number, 'pull request number')}`);
        },
        getCommit(sha) {
            return request(`${repositoryPath}/commits/${requireSha(sha, 'commit SHA')}`);
        },
        listOpenPullRequests(base) {
            const baseQuery = base ? `&base=${encodeURIComponent(base)}` : '';
            return listPaginated(`${repositoryPath}/pulls?state=open${baseQuery}`);
        },
        listRunArtifacts(runId) {
            return listPaginated(`${repositoryPath}/actions/runs/${requireInteger(runId, 'workflow run id')}/artifacts`, 'artifacts');
        },
        listWorkflowRuns(workflow, filters) {
            return listPaginated(
                `${repositoryPath}/actions/workflows/${requireWorkflowSelector(workflow)}/runs${workflowRunQuery(filters)}`,
                'workflow_runs'
            );
        },
        listArtifactsByName(nameValue) {
            return listPaginated(`${repositoryPath}/actions/artifacts?name=${encodeURIComponent(nameValue)}`, 'artifacts');
        },
        listRepositoryArtifacts() {
            return listPaginated(`${repositoryPath}/actions/artifacts`, 'artifacts');
        },
        deleteArtifact(artifactId) {
            return request(`${repositoryPath}/actions/artifacts/${requireInteger(artifactId, 'artifact id')}`, {
                method: 'DELETE',
                expectedStatuses: [204, 404]
            });
        },
        listIssueComments(number) {
            return listPaginated(`${repositoryPath}/issues/${requireInteger(number, 'pull request number')}/comments`);
        },
        listRepositoryIssueComments(since) {
            timestamp(since, 'repository issue comment lower bound');
            return listPaginated(
                `${repositoryPath}/issues/comments?sort=updated&direction=desc&since=${encodeURIComponent(since)}`
            );
        },
        createIssueComment(number, body) {
            return request(`${repositoryPath}/issues/${requireInteger(number, 'pull request number')}/comments`, {
                method: 'POST',
                body: { body },
                expectedStatuses: [201]
            });
        },
        updateIssueComment(commentId, body) {
            return request(`${repositoryPath}/issues/comments/${requireInteger(commentId, 'comment id')}`, {
                method: 'PATCH',
                body: { body }
            });
        },
        deleteIssueComment(commentId) {
            return request(`${repositoryPath}/issues/comments/${requireInteger(commentId, 'comment id')}`, {
                method: 'DELETE',
                expectedStatuses: [204, 404]
            });
        },
        dispatchRepositoryEvent(eventType, clientPayload) {
            if (typeof eventType !== 'string' || !/^[A-Za-z0-9_-]+$/.test(eventType)) {
                throw new PrVsixInvariantError('repository dispatch event type: expected a portable identifier');
            }
            return request(`${repositoryPath}/dispatches`, {
                method: 'POST',
                body: { event_type: eventType, client_payload: clientPayload },
                expectedStatuses: [204]
            });
        }
    });
}

function normalizedMergeSha(pullRequest) {
    if (pullRequest && (pullRequest.mergeable === false || pullRequest.mergeable_state === 'dirty')) {
        return 'none';
    }
    return pullRequest && SHA_PATTERN.test(String(pullRequest.merge_commit_sha || '')) ?
        pullRequest.merge_commit_sha : 'none';
}

function pullRequestContext(pullRequest) {
    return Object.freeze({
        pullRequestNumber: requireInteger(pullRequest.number, 'pull request number'),
        headSha: requireSha(pullRequest.head && pullRequest.head.sha, 'pull request head SHA'),
        baseSha: requireSha(pullRequest.base && pullRequest.base.sha, 'pull request base SHA'),
        mergeSha: requireMergeSha(normalizedMergeSha(pullRequest))
    });
}

function automaticBuildAllowed(pullRequest) {
    const association = String(pullRequest.author_association || '');
    const labels = Array.isArray(pullRequest.labels) ? pullRequest.labels : [];
    return pullRequest.head && pullRequest.head.repo && pullRequest.base && pullRequest.base.repo &&
        (pullRequest.head.repo.id === pullRequest.base.repo.id ||
        ['COLLABORATOR', 'MEMBER', 'OWNER'].includes(association) ||
        labels.some((label) => label && label.name === 'safe-to-test'));
}

function mergeCommitMatchesContext(commit, context) {
    const parents = commit && Array.isArray(commit.parents) ? commit.parents.map((parent) => parent.sha) : [];
    return parents.length === 2 && new Set(parents).size === 2 &&
        parents.includes(context.baseSha) && parents.includes(context.headSha);
}

function requireMergeRetry(options) {
    if (!options || !Number.isSafeInteger(options.attempts) || options.attempts <= 0 ||
        !Number.isSafeInteger(options.intervalMs) || options.intervalMs < 0) {
        throw new PrVsixInvariantError('merge retry: expected positive attempts and a non-negative interval');
    }
    return options;
}

async function waitForStablePullRequest({ api, pullRequestNumber, expectedHeadSha, expectedBaseSha, retry }) {
    const options = requireMergeRetry(retry);
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        const pullRequest = await api.getPullRequest(pullRequestNumber);
        const context = pullRequestContext(pullRequest);
        if (expectedHeadSha && context.headSha !== expectedHeadSha ||
            expectedBaseSha && context.baseSha !== expectedBaseSha) {
            throw new PrVsixInvariantError(`pull request ${pullRequestNumber}: build context changed during reconciliation`);
        }
        if (pullRequest.state !== 'open') {
            return Object.freeze({ pullRequest, context, buildable: false });
        }
        if (pullRequest.mergeable === false || pullRequest.mergeable_state === 'dirty') {
            return Object.freeze({
                pullRequest,
                context: Object.freeze({ ...context, mergeSha: 'none' }),
                buildable: false
            });
        }
        if (pullRequest.mergeable === true && context.mergeSha !== 'none') {
            const mergeCommit = await api.getCommit(context.mergeSha);
            if (mergeCommitMatchesContext(mergeCommit, context)) {
                return Object.freeze({ pullRequest, context, buildable: true });
            }
        }
        if (attempt < options.attempts) {
            await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
        }
    }
    throw new PrVsixInvariantError(`pull request ${pullRequestNumber}: merge context did not stabilize`);
}

function runMatchesPullRequest(run, pullRequest, repository) {
    const context = pullRequestContext(pullRequest);
    const baseRepository = pullRequest.base && pullRequest.base.repo;
    const runCreatedAt = timestamp(run.createdAt, 'workflow run creation time');
    const closedRepair = run.action === 'closed-repair' && pullRequest.state === 'closed';
    const temporal = timestamp(pullRequest.created_at, 'pull request creation time') <= runCreatedAt &&
        (closedRepair || !pullRequest.closed_at || runCreatedAt <=
            timestamp(pullRequest.closed_at, 'pull request close time'));
    const sourceMatches = run.event === 'repository_dispatch' && baseRepository &&
        baseRepository.id === run.headRepositoryId;

    return run.pullRequestNumber === pullRequest.number && baseRepository &&
        baseRepository.full_name === repository && sourceMatches && temporal &&
        (closedRepair || contextMatches(context, run));
}

function ciRunFromRaw(rawRun) {
    const workflowRun = requireWorkflowRun(rawRun);
    const context = parseCiRunName(workflowRun.displayTitle);
    if (!context || !CI_ACTIONS.has(context.action)) {
        return undefined;
    }
    return Object.freeze({ ...workflowRun, ...context, source: 'ci' });
}

async function associatedPullRequest(api, workflowRun, repository) {
    const context = parseCiRunName(workflowRun.displayTitle);
    if (!context) {
        throw new PrVsixInvariantError(`workflow run ${workflowRun.id}: missing canonical PR run name`);
    }
    const pullRequest = await api.getPullRequest(context.pullRequestNumber);
    return runMatchesPullRequest({ ...workflowRun, ...context }, pullRequest, repository) ? pullRequest : undefined;
}

async function latestCiRun(api, workflow, pullRequest, repository, options = {}) {
    const context = pullRequestContext(pullRequest);
    const defaultBase = pullRequest.base && pullRequest.base.repo &&
        pullRequest.base.ref === pullRequest.base.repo.default_branch;
    const runs = await api.listWorkflowRuns(workflow, {
        event: 'repository_dispatch',
        headSha: defaultBase && !options.omitHeadSha ? context.baseSha : undefined,
        createdAfter: options.createdAfter
    });
    const matching = runs.map(ciRunFromRaw).filter((run) =>
        run && (!options.actions || options.actions.has(run.action)) &&
        runMatchesPullRequest(run, pullRequest, repository)
    );
    return matching.reduce((candidate, run) =>
        !candidate || compareSequence(run, candidate) > 0 ? run : candidate
    , undefined);
}

async function upsertComment(
    api,
    pullRequestNumber,
    body,
    run,
    prepare = async () => 0,
    transitionBody
) {
    const comments = await api.listIssueComments(pullRequestNumber);
    const managed = comments.filter((comment) =>
        comment && comment.user && comment.user.login === BOT_LOGIN &&
        typeof comment.body === 'string' && comment.body.includes(COMMENT_MARKER)
    ).sort((left, right) => left.id - right.id);
    if (managed.some((comment) => {
        const metadata = parseCommentMetadata(comment.body);
        return metadata && existingStateDominates(metadata, run);
    })) {
        return Object.freeze({ applied: false, removedArtifacts: 0 });
    }

    const primary = managed[0];
    const alreadyFinal = primary && primary.body === body;
    const initialBody = alreadyFinal ? body : transitionBody || body;
    let commentId;
    if (!primary) {
        const created = await api.createIssueComment(pullRequestNumber, initialBody);
        commentId = created.id;
    } else {
        commentId = primary.id;
        if (primary.body !== initialBody) {
            await api.updateIssueComment(primary.id, initialBody);
        }
    }
    await Promise.all(managed.slice(primary ? 1 : 0).map((comment) => api.deleteIssueComment(comment.id)));
    const removedArtifacts = await prepare();
    if (!alreadyFinal && transitionBody && transitionBody !== body) {
        await api.updateIssueComment(commentId, body);
    }
    return Object.freeze({ applied: true, commentId, removedArtifacts });
}

async function removePreviewArtifacts(api, pullRequestNumber, retainedArtifactId, retainedRun) {
    const name = previewArtifactName(pullRequestNumber);
    const artifacts = await api.listArtifactsByName(name);
    const removals = artifacts.filter((artifact) => {
        if (artifact.name !== name) {
            throw new PrVsixInvariantError(`artifact ${artifact.id}: managed name mismatch`);
        }
        if (artifact.id === retainedArtifactId) {
            return false;
        }
        if (!retainedRun) {
            return true;
        }
        if (artifact.workflow_run && artifact.workflow_run.id === retainedRun.id) {
            if (retainedRun.status !== 'completed' && isArtifactForRun(artifact, retainedRun, pullRequestNumber)) {
                return false;
            }
            return timestamp(artifact.created_at, 'artifact creation time') <=
                timestamp(retainedRun.updatedAt, 'workflow run update time');
        }
        return timestamp(artifact.created_at, 'artifact creation time') <
            timestamp(retainedRun.createdAt, 'workflow run creation time');
    });
    await Promise.all(removals.map((artifact) => api.deleteArtifact(artifact.id)));
    return removals.length;
}

async function removeRunArtifacts(api, artifacts, run, pullRequestNumber) {
    const removals = artifacts.filter((artifact) => isArtifactForRun(artifact, run, pullRequestNumber));
    await Promise.all(removals.map((artifact) => api.deleteArtifact(artifact.id)));
    return removals.length;
}

async function synchronizeCompletedRun({ api, repository, run, pullRequest, artifacts, targets }) {
    const name = previewArtifactName(pullRequest.number);
    const matches = artifacts.filter((artifact) => isCurrentArtifact(artifact, run, pullRequest.number));
    let body;
    let retainedArtifact;
    let invariantError;
    if (run.conclusion === 'success' && matches.length === 1) {
        retainedArtifact = matches[0];
        body = renderReadyComment({ repository, run, artifact: retainedArtifact, targets });
    } else if (run.conclusion === 'success') {
        body = renderUnavailableComment({
            repository,
            run,
            reason: `CI succeeded, but the run produced ${matches.length} current artifacts named \`${name}\`.`
        });
        invariantError = new PrVsixInvariantError(`workflow run ${run.id}: expected one ${name} artifact, found ${matches.length}`);
    } else {
        body = renderUnavailableComment({
            repository,
            run,
            reason: `CI concluded with \`${run.conclusion || 'unknown'}\`.`
        });
    }

    const comment = await upsertComment(
        api,
        pullRequest.number,
        body,
        run,
        () => removePreviewArtifacts(api, pullRequest.number, retainedArtifact && retainedArtifact.id, run),
        retainedArtifact ? renderTransitionComment({ repository, run }) : undefined
    );
    if (!comment.applied) {
        const removedArtifacts = await removeRunArtifacts(api, artifacts, run, pullRequest.number);
        return Object.freeze({ pullRequestNumber: pullRequest.number, applied: false, removedArtifacts });
    }
    if (invariantError) {
        throw invariantError;
    }
    return Object.freeze({
        pullRequestNumber: pullRequest.number,
        applied: true,
        removedArtifacts: comment.removedArtifacts
    });
}

async function synchronizeWorkflowRun({ api, repository, run, targets, action }) {
    const rawRun = requireWorkflowRun(run);
    if (rawRun.name !== 'PR VSIX Build' || rawRun.event !== 'repository_dispatch') {
        throw new PrVsixInvariantError('PR VSIX build workflow run: unexpected workflow identity');
    }
    const context = parseCiRunName(rawRun.displayTitle);
    if (!context) {
        throw new PrVsixInvariantError(`workflow run ${rawRun.id}: missing canonical PR run name`);
    }
    if (!CI_ACTIONS.has(context.action)) {
        return [];
    }
    const workflowRun = Object.freeze({ ...rawRun, ...context, source: 'ci' });
    const pullRequest = await associatedPullRequest(api, rawRun, requireRepository(repository));
    const artifacts = action === 'completed' ? await api.listRunArtifacts(workflowRun.id) : [];
    if (!pullRequest) {
        if (action === 'completed') {
            await removeRunArtifacts(api, artifacts, workflowRun, workflowRun.pullRequestNumber);
        }
        return [];
    }

    const latest = await latestCiRun(
        api,
        workflowRun.workflowId,
        pullRequest,
        repository,
        {
            createdAfter: workflowRun.createdAt,
            omitHeadSha: workflowRun.action === 'closed-repair'
        }
    );
    const currentGeneration = latest && latest.id === workflowRun.id &&
        latest.runAttempt === workflowRun.runAttempt;
    if (!currentGeneration) {
        if (action === 'completed') {
            await removeRunArtifacts(api, artifacts, workflowRun, pullRequest.number);
        }
        return [];
    }

    if (pullRequest.state === 'closed') {
        const closedRun = Object.freeze({ ...workflowRun, phase: 'closed' });
        const comment = await upsertComment(
            api,
            pullRequest.number,
            renderClosedComment({ repository, run: closedRun }),
            closedRun,
            () => removePreviewArtifacts(api, pullRequest.number)
        );
        return [Object.freeze({
            pullRequestNumber: pullRequest.number,
            applied: comment.applied,
            removedArtifacts: comment.removedArtifacts
        })];
    }
    if (pullRequest.state !== 'open') {
        return [];
    }
    if (workflowRun.action === 'closed-repair' ||
        (workflowRun.action === 'approval-revoked' && automaticBuildAllowed(pullRequest))) {
        return [];
    }
    if (!['in_progress', 'completed'].includes(action)) {
        throw new PrVsixInvariantError(`PR VSIX build workflow action: unsupported ${action}`);
    }
    if (!automaticBuildAllowed(pullRequest)) {
        const blockedRun = Object.freeze({ ...workflowRun, phase: 'blocked' });
        const comment = await upsertComment(
            api,
            pullRequest.number,
            renderUnavailableComment({
                repository,
                run: blockedRun,
                reason: EXTERNAL_APPROVAL_REASON
            }),
            blockedRun,
            () => removePreviewArtifacts(api, pullRequest.number)
        );
        const removedArtifacts = comment.applied ? comment.removedArtifacts :
            await removeRunArtifacts(api, artifacts, workflowRun, pullRequest.number);
        return [Object.freeze({
            pullRequestNumber: pullRequest.number,
            applied: comment.applied,
            removedArtifacts
        })];
    }
    if (workflowRun.action === 'renewal' &&
        (action === 'in_progress' || action === 'completed' && workflowRun.conclusion !== 'success')) {
        if (action === 'completed') {
            await removeRunArtifacts(api, artifacts, workflowRun, pullRequest.number);
        }
        return [];
    }
    if (action === 'in_progress') {
        const pendingRun = Object.freeze({ ...workflowRun, phase: 'pending' });
        const comment = await upsertComment(
            api,
            pullRequest.number,
            renderPendingComment({ repository, run: pendingRun }),
            pendingRun,
            () => removePreviewArtifacts(api, pullRequest.number, undefined, workflowRun)
        );
        return [Object.freeze({
            pullRequestNumber: pullRequest.number,
            applied: comment.applied,
            removedArtifacts: comment.removedArtifacts
        })];
    }
    const completedRun = Object.freeze({ ...workflowRun, phase: 'completed' });
    return [await synchronizeCompletedRun({
        api,
        repository,
        run: completedRun,
        pullRequest,
        artifacts,
        targets
    })];
}

function isLifecycleArtifact(artifact, workflowRun, marker) {
    return artifact && !artifact.expired && Number.isSafeInteger(artifact.size_in_bytes) &&
        artifact.size_in_bytes > 0 && DIGEST_PATTERN.test(String(artifact.digest || '')) &&
        artifact.workflow_run && artifact.workflow_run.id === workflowRun.id &&
        marker.runId === workflowRun.id && marker.runAttempt === workflowRun.runAttempt;
}

async function removeLifecycleMarkers(api, artifacts, workflowRun) {
    const stale = artifacts.filter((artifact) => {
        const marker = parseLifecycleArtifactName(artifact.name);
        return marker && marker.runId === workflowRun.id && marker.runAttempt <= workflowRun.runAttempt;
    });
    await Promise.all(stale.map((artifact) => api.deleteArtifact(artifact.id)));
}

async function synchronizeLifecycleRun({ api, repository, run, targets, mergeRetry }) {
    const workflowRun = requireWorkflowRun(run);
    if (workflowRun.name !== 'PR VSIX Event' ||
        !['pull_request', 'pull_request_target'].includes(workflowRun.event)) {
        throw new PrVsixInvariantError('lifecycle workflow run: unexpected workflow identity');
    }

    const artifacts = await api.listRunArtifacts(workflowRun.id);
    const markers = artifacts.map((artifact) => ({ artifact, marker: parseLifecycleArtifactName(artifact.name) }))
        .filter(({ artifact, marker }) => marker && isLifecycleArtifact(artifact, workflowRun, marker));
    if (markers.length === 0) {
        return [];
    }
    if (markers.length !== 1) {
        throw new PrVsixInvariantError(`lifecycle workflow run ${workflowRun.id}: expected one current marker artifact, found ${markers.length}`);
    }

    const { marker } = markers[0];
    let pullRequest = await api.getPullRequest(marker.pullRequestNumber);
    const expectedState = marker.action === 'closed' ? 'closed' : 'open';
    const baseRepositoryMatches = pullRequest.base && pullRequest.base.repo &&
        pullRequest.base.repo.full_name === requireRepository(repository);
    const sourceMatches = workflowRun.event === 'pull_request_target' || marker.action === 'closed' ||
        (workflowRun.event === 'pull_request' && workflowRun.pullRequestNumbers.includes(pullRequest.number));
    const headMatches = pullRequest.head && pullRequest.head.sha === marker.headSha;
    let current = pullRequest.state === expectedState && baseRepositoryMatches && sourceMatches && headMatches;
    if (expectedState === 'open') {
        current = current && pullRequest.base.sha === marker.baseSha;
    }
    if (!current) {
        await removeLifecycleMarkers(api, artifacts, workflowRun);
        return [];
    }

    let context = pullRequestContext(pullRequest);
    let buildable = false;
    let authorized = true;
    const ciAction = marker.action === 'edited' ? 'base-edited' : marker.action;
    if (expectedState === 'open') {
        authorized = automaticBuildAllowed(pullRequest);
        if (marker.action === 'unlabeled' && authorized) {
            await removeLifecycleMarkers(api, artifacts, workflowRun);
            return [Object.freeze({
                pullRequestNumber: pullRequest.number,
                applied: false,
                removedArtifacts: 0
            })];
        }
        if (authorized) {
            let stable;
            try {
                stable = await waitForStablePullRequest({
                    api,
                    pullRequestNumber: pullRequest.number,
                    expectedHeadSha: marker.headSha,
                    expectedBaseSha: marker.baseSha,
                    retry: mergeRetry
                });
            } catch (error) {
                const provisionalRun = Object.freeze({
                    ...workflowRun,
                    ...context,
                    action: ciAction,
                    source: 'lifecycle',
                    phase: 'pending'
                });
                await upsertComment(
                    api,
                    pullRequest.number,
                    renderPendingComment({ repository, run: provisionalRun }),
                    provisionalRun,
                    () => removePreviewArtifacts(api, pullRequest.number)
                );
                throw error;
            }
            pullRequest = stable.pullRequest;
            context = stable.context;
            buildable = stable.buildable;
        }
    }

    if (expectedState === 'open' && authorized && buildable) {
        const currentCi = await latestCiRun(
            api,
            'pr-vsix-build.yml',
            pullRequest,
            repository,
            { actions: new Set([ciAction]), createdAfter: workflowRun.createdAt }
        );
        if (currentCi) {
            let result;
            if (currentCi.status === 'completed') {
                const ciArtifacts = await api.listRunArtifacts(currentCi.id);
                result = await synchronizeCompletedRun({
                    api,
                    repository,
                    run: Object.freeze({ ...currentCi, phase: 'completed' }),
                    pullRequest,
                    artifacts: ciArtifacts,
                    targets
                });
            } else {
                const pendingRun = Object.freeze({ ...currentCi, phase: 'pending' });
                const comment = await upsertComment(
                    api,
                    pullRequest.number,
                    renderPendingComment({ repository, run: pendingRun }),
                    pendingRun,
                    () => removePreviewArtifacts(api, pullRequest.number, undefined, currentCi)
                );
                result = Object.freeze({
                    pullRequestNumber: pullRequest.number,
                    applied: comment.applied,
                    removedArtifacts: comment.removedArtifacts
                });
            }
            await removeLifecycleMarkers(api, artifacts, workflowRun);
            return [result];
        }
    }

    const phase = expectedState === 'closed' ? 'closed' : !authorized || !buildable ? 'blocked' : 'pending';
    const lifecycleRun = Object.freeze({
        ...workflowRun,
        ...context,
        action: ciAction,
        source: 'lifecycle',
        phase
    });
    const body = phase === 'closed' ? renderClosedComment({ repository, run: lifecycleRun }) :
        !authorized ? renderUnavailableComment({
            repository,
            run: lifecycleRun,
            reason: EXTERNAL_APPROVAL_REASON
        }) : !buildable ? renderUnavailableComment({
            repository,
            run: lifecycleRun,
            reason: 'The pull request has merge conflicts; CI cannot produce a tested artifact.'
        }) : renderPendingComment({ repository, run: lifecycleRun });
    const comment = await upsertComment(
        api,
        pullRequest.number,
        body,
        lifecycleRun,
        () => removePreviewArtifacts(api, pullRequest.number)
    );
    if (expectedState === 'open' && authorized && buildable) {
        await api.dispatchRepositoryEvent('refresh-pr-vsix', {
            pull_request_number: context.pullRequestNumber,
            head_sha: context.headSha,
            base_sha: context.baseSha,
            merge_sha: context.mergeSha,
            cause: ciAction
        });
    }
    await removeLifecycleMarkers(api, artifacts, workflowRun);
    return [Object.freeze({
        pullRequestNumber: pullRequest.number,
        applied: comment.applied,
        removedArtifacts: comment.removedArtifacts
    })];
}

function resolveWorkflowIdentity(run) {
    const workflowRun = requireWorkflowRun(run);
    if (workflowRun.name === 'PR VSIX Build' && workflowRun.event === 'repository_dispatch') {
        const context = parseCiRunName(workflowRun.displayTitle);
        if (context) {
            return Object.freeze({
                pullRequestNumber: context.pullRequestNumber,
                processable: CI_ACTIONS.has(context.action)
            });
        }
    }
    if (workflowRun.name === 'PR VSIX Event' &&
        ['pull_request', 'pull_request_target'].includes(workflowRun.event)) {
        const context = parseLifecycleRunName(workflowRun.displayTitle);
        if (context) {
            return Object.freeze({ pullRequestNumber: context.pullRequestNumber, processable: true });
        }
    }
    throw new PrVsixInvariantError('workflow run: expected a canonical PR identity');
}

async function main() {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
        throw new PrVsixInvariantError('GITHUB_EVENT_PATH: expected a workflow event path');
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    if (!event.workflow_run) {
        throw new PrVsixInvariantError('workflow event: expected workflow_run metadata');
    }
    if (process.argv[2] === 'resolve') {
        const identity = resolveWorkflowIdentity(event.workflow_run);
        process.stdout.write([
            `pull-request-number=${identity.pullRequestNumber}`,
            `processable=${identity.processable}`,
            ''
        ].join('\n'));
        return;
    }

    const repository = requireRepository(event.repository && event.repository.full_name);
    const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
    const api = createGitHubApi({
        token: process.env.GITHUB_TOKEN,
        repository,
        apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
        retry: apiRetryFromEnvironment()
    });
    const mergeRetry = event.workflow_run.name === 'PR VSIX Event' ? requireMergeRetry({
        attempts: Number(process.env.PR_VSIX_MERGE_ATTEMPTS),
        intervalMs: Number(process.env.PR_VSIX_MERGE_INTERVAL_MS)
    }) : undefined;
    const results = event.workflow_run.name === 'PR VSIX Build' ? await synchronizeWorkflowRun({
        api,
        repository,
        run: event.workflow_run,
        targets,
        action: event.action
    }) : await synchronizeLifecycleRun({
        api,
        repository,
        run: event.workflow_run,
        targets,
        mergeRetry
    });
    process.stdout.write(`${JSON.stringify({ synchronized: results.length, results })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
    main().catch((error) => {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}

export {
    BOT_LOGIN,
    COMMENT_MARKER,
    PrVsixInvariantError,
    apiRetryFromEnvironment,
    automaticBuildAllowed,
    compareSequence,
    createGitHubApi,
    normalizedMergeSha,
    parseCiRunName,
    parseCommentMetadata,
    previewArtifactName,
    pullRequestContext,
    renderClosedComment,
    renderPendingComment,
    renderReadyComment,
    renderUnavailableComment,
    resolveWorkflowIdentity,
    synchronizeLifecycleRun,
    synchronizeWorkflowRun,
    waitForStablePullRequest
};
