class PrVsixMonitorError extends Error {
    constructor(message, options) {
        super(message, options && options.cause ? { cause: options.cause } : undefined);
        this.name = 'PrVsixMonitorError';
    }
}

function requireFunction(value, label) {
    if (typeof value !== 'function') {
        throw new PrVsixMonitorError(`${label}: expected a function`);
    }
    return value;
}

function requireMonitorOptions(options = {}) {
    const monitor = Object.freeze({
        pollIntervalMs: Number(options.pollIntervalMs),
        heartbeatMs: Number(options.heartbeatMs),
        timeoutMs: Number(options.timeoutMs),
        now: requireFunction(options.now || Date.now, 'monitor clock'),
        sleep: requireFunction(options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay))),
            'monitor sleep')
    });
    if (!Number.isSafeInteger(monitor.pollIntervalMs) || monitor.pollIntervalMs <= 0 ||
        !Number.isSafeInteger(monitor.heartbeatMs) || monitor.heartbeatMs < monitor.pollIntervalMs ||
        !Number.isSafeInteger(monitor.timeoutMs) || monitor.timeoutMs < monitor.heartbeatMs) {
        throw new PrVsixMonitorError('monitor timing: expected positive poll, heartbeat, and timeout intervals');
    }
    return monitor;
}

function workflowStateKey(run, jobs) {
    if (!Array.isArray(jobs)) {
        throw new PrVsixMonitorError('workflow jobs: expected an array');
    }
    return JSON.stringify([
        run && run.id,
        run && run.status,
        run && run.conclusion,
        jobs.map((job) => [
            job.id,
            job.status,
            job.conclusion,
            Array.isArray(job.steps) ? job.steps.map((step) => [
                step.number,
                step.status,
                step.conclusion
            ]) : []
        ])
    ]);
}

async function monitorWorkflow({ findRun, readJobs, onWaiting, onProgress, onCompleted, options }) {
    const callbacks = Object.freeze({
        findRun: requireFunction(findRun, 'monitor run lookup'),
        readJobs: requireFunction(readJobs, 'monitor job lookup'),
        onWaiting: requireFunction(onWaiting, 'monitor waiting publisher'),
        onProgress: requireFunction(onProgress, 'monitor progress publisher'),
        onCompleted: requireFunction(onCompleted, 'monitor completion publisher')
    });
    const monitor = requireMonitorOptions(options);
    const startedAt = monitor.now();
    const deadline = startedAt + monitor.timeoutMs;
    let lastState;
    let lastPublishedAt = Number.NEGATIVE_INFINITY;

    while (true) {
        const observedAt = monitor.now();
        const run = await callbacks.findRun();
        if (run && run.status === 'completed') {
            return callbacks.onCompleted(run, new Date(observedAt).toISOString());
        }

        const jobs = run ? await callbacks.readJobs(run) : [];
        const state = run ? workflowStateKey(run, jobs) : 'waiting';
        if (state !== lastState || observedAt - lastPublishedAt >= monitor.heartbeatMs) {
            if (run) {
                await callbacks.onProgress(run, jobs, new Date(observedAt).toISOString());
            } else {
                await callbacks.onWaiting(new Date(observedAt).toISOString());
            }
            lastState = state;
            lastPublishedAt = observedAt;
        }

        if (observedAt >= deadline) {
            throw new PrVsixMonitorError(`PR VSIX monitor exceeded ${monitor.timeoutMs} ms`);
        }
        await monitor.sleep(Math.min(monitor.pollIntervalMs, deadline - observedAt));
    }
}

export {
    PrVsixMonitorError,
    monitorWorkflow,
    requireMonitorOptions,
    workflowStateKey
};
