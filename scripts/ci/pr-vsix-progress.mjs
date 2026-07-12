class PrVsixProgressError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PrVsixProgressError';
    }
}

function tableText(value, label) {
    const text = String(value || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
    if (!text) {
        throw new PrVsixProgressError(`${label}: expected non-empty text`);
    }
    return text;
}

function stateLabel(status, conclusion) {
    if (status !== 'completed') {
        return status === 'in_progress' ? 'RUNNING' : 'WAITING';
    }
    const labels = {
        success: 'PASS',
        failure: 'FAIL',
        cancelled: 'CANCELLED',
        skipped: 'SKIPPED',
        timed_out: 'TIMED OUT',
        action_required: 'ACTION REQUIRED',
        neutral: 'NEUTRAL',
        stale: 'STALE',
        startup_failure: 'STARTUP FAILURE'
    };
    return labels[conclusion] || 'UNKNOWN';
}

function workflowProgress(jobs) {
    if (!Array.isArray(jobs)) {
        throw new PrVsixProgressError('workflow jobs: expected an array');
    }
    const rows = [];
    jobs.forEach((job) => {
        const jobName = tableText(job && job.name, 'workflow job name');
        const steps = job && Array.isArray(job.steps) ? job.steps : [];
        if (steps.length === 0) {
            rows.push(Object.freeze({
                name: jobName,
                state: stateLabel(job.status, job.conclusion)
            }));
            return;
        }
        steps.forEach((step) => rows.push(Object.freeze({
            name: `${jobName}: ${tableText(step && step.name, 'workflow step name')}`,
            state: stateLabel(step.status, step.conclusion)
        })));
    });
    const running = rows.find((row) => row.state === 'RUNNING');
    const waiting = rows.find((row) => row.state === 'WAITING');
    const failed = rows.find((row) => [
        'FAIL',
        'CANCELLED',
        'TIMED OUT',
        'ACTION REQUIRED',
        'STALE',
        'STARTUP FAILURE',
        'UNKNOWN'
    ].includes(row.state));
    const stage = failed ? failed.name : running ? running.name : waiting ? `Waiting for ${waiting.name}` :
        rows.length > 0 ? 'Finalizing workflow result' : 'Waiting for GitHub Actions runner';
    return Object.freeze({ rows, stage });
}

function renderProgressTable(progress) {
    const rows = progress.rows.length > 0 ? progress.rows : [Object.freeze({
        name: 'GitHub Actions runner',
        state: 'WAITING'
    })];
    return [
        '| Gate | State |',
        '| --- | --- |',
        ...rows.map((row) => `| ${row.name} | **${row.state}** |`)
    ].join('\n');
}

export {
    PrVsixProgressError,
    renderProgressTable,
    stateLabel,
    workflowProgress
};
