var childProcess = require( 'child_process' );
var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var pathToFileURL = require( 'url' ).pathToFileURL;

var modulePromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'sync-pr-vsix-comment.mjs' )
).href );

var REPOSITORY = 'FanaticPythoner/better-todo-tree';
var SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
var SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
var SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';
var SHA_D = 'dddddddddddddddddddddddddddddddddddddddd';
var SHA_E = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
var TARGETS = require( '../scripts/release/targets.json' );

function resolveWorkflowEvent( run )
{
    var directory = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-pr-vsix-' ) );
    var eventPath = path.join( directory, 'event.json' );
    try
    {
        fs.writeFileSync( eventPath, JSON.stringify( { workflow_run: run } ) );
        return childProcess.spawnSync( process.execPath, [
            path.join( __dirname, '..', 'scripts', 'ci', 'sync-pr-vsix-comment.mjs' ),
            'resolve'
        ], {
            cwd: path.join( __dirname, '..' ),
            encoding: 'utf8',
            env: Object.assign( {}, process.env, { GITHUB_EVENT_PATH: eventPath } )
        } );
    }
    finally
    {
        fs.rmSync( directory, { recursive: true, force: true } );
    }
}

function ciTitle( overrides )
{
    var values = Object.assign( {
        number: 19,
        head: SHA_A,
        base: SHA_B,
        merge: SHA_C,
        action: 'synchronize'
    }, overrides || {} );
    return 'PR VSIX Build PR #' + values.number + ' head ' + values.head + ' base ' + values.base +
        ' merge ' + values.merge + ' action ' + values.action;
}

function workflowRun( overrides )
{
    return Object.assign( {
        id: 200,
        run_attempt: 1,
        run_number: 20,
        workflow_id: 10,
        event: 'repository_dispatch',
        name: ciTitle(),
        status: 'completed',
        head_sha: SHA_B,
        head_branch: 'master',
        head_repository: { id: 1 },
        created_at: '2026-07-11T10:00:00Z',
        run_started_at: '2026-07-11T10:00:00Z',
        updated_at: '2026-07-11T10:06:00Z',
        display_title: ciTitle(),
        conclusion: 'success',
        pull_requests: []
    }, overrides || {} );
}

function pullRequest( overrides )
{
    return Object.assign( {
        number: 19,
        state: 'open',
        created_at: '2026-07-11T09:00:00Z',
        closed_at: null,
        mergeable: true,
        mergeable_state: 'clean',
        merge_commit_sha: null,
        author_association: 'OWNER',
        labels: [],
        head: { sha: SHA_A, ref: 'fix/issue-19', repo: { id: 99 } },
        base: {
            sha: SHA_B,
            ref: 'master',
            repo: { id: 1, full_name: REPOSITORY, default_branch: 'master' }
        }
    }, overrides || {} );
}

function artifact( overrides )
{
    return Object.assign( {
        id: 300,
        name: 'better-todo-tree-pr-19.vsix',
        expired: false,
        size_in_bytes: 15000000,
        digest: 'sha256:' + 'e'.repeat( 64 ),
        created_at: '2026-07-11T10:05:00Z',
        expires_at: '2026-10-09T10:05:00Z',
        workflow_run: { id: 200, head_sha: SHA_B }
    }, overrides || {} );
}

function lifecycleRun( overrides )
{
    return Object.assign( {
        id: 500,
        run_attempt: 1,
        run_number: 50,
        workflow_id: 11,
        event: 'pull_request_target',
        name: 'PR VSIX Event #19 synchronize',
        status: 'completed',
        head_sha: SHA_B,
        head_branch: 'master',
        head_repository: { id: 1 },
        created_at: '2026-07-11T10:00:01Z',
        run_started_at: '2026-07-11T10:00:01Z',
        updated_at: '2026-07-11T10:00:03Z',
        display_title: 'PR VSIX Event #19 synchronize',
        conclusion: 'success',
        pull_requests: []
    }, overrides || {} );
}

function lifecycleArtifact( action, overrides )
{
    return Object.assign( {
        id: 600,
        name: 'better-todo-tree-pr-vsix-event-19-head-' + SHA_A + '-base-' + SHA_B +
            '-merge-none-' + action + '-run-500-attempt-1',
        expired: false,
        size_in_bytes: 100,
        digest: 'sha256:' + 'f'.repeat( 64 ),
        created_at: '2026-07-11T10:00:02Z',
        expires_at: '2026-07-12T10:00:02Z',
        workflow_run: { id: 500, head_sha: SHA_B }
    }, overrides || {} );
}

function apiFixture( options )
{
    var settings = options || {};
    var activeRun = workflowRun();
    var calls = {
        createdComments: [],
        commitReads: [],
        updatedComments: [],
        deletedComments: [],
        deletedArtifacts: [],
        dispatchedEvents: [],
        mergeRefReads: [],
        pullRequestReads: [],
        runArtifactReads: [],
        workflowJobReads: [],
        workflowQueries: [],
        order: []
    };
    var api = {
        getPullRequest: async function( number )
        {
            calls.pullRequestReads.push( number );
            if( settings.pullRequestError )
            {
                throw settings.pullRequestError;
            }
            if( Array.isArray( settings.pullRequestResponses ) )
            {
                var response = settings.pullRequestResponses[ Math.min(
                    calls.pullRequestReads.length - 1,
                    settings.pullRequestResponses.length - 1
                ) ];
                if( response instanceof Error )
                {
                    throw response;
                }
                return response;
            }
            return ( settings.pullRequests || [ pullRequest() ] ).find( function( item )
            {
                return item.number === number;
            } );
        },
        getPullRequestMergeSha: async function( number )
        {
            calls.mergeRefReads.push( number );
            if( Array.isArray( settings.mergeRefShas ) )
            {
                return settings.mergeRefShas[ Math.min(
                    calls.mergeRefReads.length - 1,
                    settings.mergeRefShas.length - 1
                ) ];
            }
            return Object.prototype.hasOwnProperty.call( settings, 'mergeRefSha' ) ?
                settings.mergeRefSha : SHA_C;
        },
        getCommit: async function( sha )
        {
            calls.commitReads.push( sha );
            if( settings.mergeCommitError )
            {
                throw settings.mergeCommitError;
            }
            return settings.mergeCommit || { sha: sha, parents: [ { sha: SHA_B }, { sha: SHA_A } ] };
        },
        listRunArtifacts: async function( runId )
        {
            calls.runArtifactReads.push( runId );
            if( settings.runArtifactsError )
            {
                throw settings.runArtifactsError;
            }
            if( settings.runArtifactsByRun )
            {
                return settings.runArtifactsByRun[ runId ] || [];
            }
            return settings.runArtifacts || [];
        },
        listWorkflowRuns: async function( workflow, filters )
        {
            calls.workflowQueries.push( { workflow: workflow, filters: filters } );
            if( settings.workflowRunsError )
            {
                throw settings.workflowRunsError;
            }
            var runs = Array.isArray( settings.workflowRunResponses ) ? settings.workflowRunResponses[ Math.min(
                calls.workflowQueries.length - 1,
                settings.workflowRunResponses.length - 1
            ) ] : settings.workflowRuns || [ activeRun ];
            return runs.filter( function( item )
            {
                return ( !filters || !filters.createdAfter ||
                    Date.parse( item.created_at ) >= Date.parse( filters.createdAfter ) ) &&
                    ( !filters || !filters.headSha || item.head_sha === filters.headSha );
            } );
        },
        listWorkflowRunJobs: async function( runId )
        {
            calls.workflowJobReads.push( runId );
            return settings.workflowJobs || [];
        },
        listArtifactsByName: async function( name )
        {
            return ( settings.repositoryArtifacts || [] ).filter( function( item )
            {
                return item.name === name;
            } );
        },
        deleteArtifact: async function( id )
        {
            calls.deletedArtifacts.push( id );
            calls.order.push( 'delete-artifact-' + id );
            if( settings.deleteArtifactError )
            {
                throw settings.deleteArtifactError;
            }
        },
        listIssueComments: async function()
        {
            return settings.comments || [];
        },
        createIssueComment: async function( number, body )
        {
            calls.createdComments.push( { number: number, body: body } );
            calls.order.push( 'create-comment' );
            return { id: 400 };
        },
        updateIssueComment: async function( id, body )
        {
            calls.updatedComments.push( { id: id, body: body } );
            calls.order.push( 'update-comment-' + id );
            if( settings.updateCommentError )
            {
                throw settings.updateCommentError;
            }
            return { id: id };
        },
        deleteIssueComment: async function( id )
        {
            calls.deletedComments.push( id );
            if( settings.deleteCommentError )
            {
                throw settings.deleteCommentError;
            }
        },
        dispatchRepositoryEvent: async function( name, payload )
        {
            calls.dispatchedEvents.push( { name: name, payload: payload } );
        }
    };
    return {
        api: api,
        calls: calls,
        settings: settings,
        setActiveRun: function( run ) { activeRun = run; }
    };
}

function synchronize( module, fixture, run, mergeRetry )
{
    fixture.setActiveRun( run );
    return module.synchronizeWorkflowRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: run,
        targets: TARGETS,
        mergeRetry: mergeRetry || { attempts: 1, intervalMs: 0 }
    } );
}

function synchronizeLifecycle( module, fixture, run )
{
    return module.synchronizeLifecycleRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: run,
        targets: TARGETS,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } );
}

function commentRun( module, run, phase )
{
    var context = module.parseCiRunName( run.display_title );
    return Object.assign( {
        id: run.id,
        runAttempt: run.run_attempt,
        runNumber: run.run_number,
        workflowHeadSha: run.head_sha,
        startedAt: run.run_started_at,
        updatedAt: run.updated_at,
        status: run.status,
        conclusion: run.conclusion,
        source: 'ci',
        phase: phase || 'completed'
    }, context );
}

function renderedReadyComment( module, run, item )
{
    return module.renderReadyComment( {
        repository: REPOSITORY,
        run: commentRun( module, run ),
        artifact: item,
        targets: TARGETS
    } );
}

QUnit.module( 'PR VSIX comment synchronization' );

QUnit.test( 'successful current run publishes one platform bundle and removes duplicate namespace artifacts', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var prior = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var fixture = apiFixture( {
        runArtifacts: [ current ],
        repositoryArtifacts: [ current, prior ]
    } );
    var results = await synchronize( module, fixture, workflowRun() );
    var body = fixture.calls.updatedComments[ 0 ].body;

    assert.deepEqual( results, [ { pullRequestNumber: 19, applied: true, removedArtifacts: 1 } ] );
    assert.ok( body.indexOf( 'actions/runs/200/artifacts/300' ) !== -1 );
    assert.ok( body.indexOf( 'Download all 10 platform-specific VSIX files' ) !== -1 );
    assert.ok( body.indexOf( '`win32-x64`' ) !== -1 );
    assert.ok( body.indexOf( '`web`' ) !== -1 );
    assert.ok( body.indexOf( 'Download and extract the artifact' ) !== -1 );
    assert.ok( body.indexOf( 'unreviewed code from this pull request' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );
} );

QUnit.test( 'successful cleanup removes a late artifact from an older workflow run', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var lateOld = artifact( {
        id: 299,
        created_at: '2026-07-11T10:05:30Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var fixture = apiFixture( {
        runArtifacts: [ current ],
        repositoryArtifacts: [ current, lateOld ]
    } );

    assert.equal( ( await synchronize( module, fixture, workflowRun() ) )[ 0 ].applied, true );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );
} );

QUnit.test( 'linkless state is published before stale artifact cleanup', async function( assert )
{
    var module = await modulePromise;
    var priorRun = workflowRun( {
        id: 199,
        run_number: 19,
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z',
        updated_at: '2026-07-11T09:56:00Z',
        display_title: ciTitle( { head: SHA_D } )
    } );
    var prior = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var failedRun = workflowRun( { id: 201, run_number: 21, conclusion: 'failure' } );
    var fixture = apiFixture( {
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, priorRun, prior ),
            user: { login: 'github-actions[bot]' }
        } ],
        repositoryArtifacts: [ prior ]
    } );

    await synchronize( module, fixture, failedRun );

    assert.deepEqual( fixture.calls.order, [ 'update-comment-401', 'delete-artifact-299' ] );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: unavailable' ) !== -1 );
} );

QUnit.test( 'cleanup failure leaves a linkless recoverable transition', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun( {
        id: 199,
        run_number: 19,
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z',
        updated_at: '2026-07-11T09:56:00Z'
    } );
    var oldArtifact = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var current = artifact();
    var fixture = apiFixture( {
        runArtifacts: [ current ],
        repositoryArtifacts: [ current, oldArtifact ],
        deleteArtifactError: new Error( 'delete failed' ),
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, oldRun, oldArtifact ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, workflowRun() ), function( error )
    {
        return error.message === 'delete failed';
    } );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: preparing' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( '/artifacts/' ) === -1 );
    assert.deepEqual( fixture.calls.order, [ 'update-comment-401', 'delete-artifact-299' ] );
} );

QUnit.test( 'stale head completion deletes only its run artifact', async function( assert )
{
    var module = await modulePromise;
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( {
            head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } },
            merge_commit_sha: SHA_D
        } ) ],
        runArtifacts: [ artifact() ],
        repositoryArtifacts: [ artifact() ]
    } );

    assert.deepEqual( await synchronize( module, fixture, workflowRun() ), [] );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'successful rerun rejects an artifact created before the current attempt', async function( assert )
{
    var module = await modulePromise;
    var rerun = workflowRun( {
        run_attempt: 2,
        run_started_at: '2026-07-11T11:00:00Z',
        updated_at: '2026-07-11T11:06:00Z'
    } );
    var staleAttempt = artifact( { created_at: '2026-07-11T10:05:00Z' } );
    var fixture = apiFixture( {
        workflowRuns: [ rerun ],
        runArtifacts: [ staleAttempt ],
        repositoryArtifacts: [ staleAttempt ]
    } );

    await assert.rejects( synchronize( module, fixture, rerun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message.indexOf( 'better-todo-tree-pr-19.vsix artifact, found 0' ) !== -1;
    } );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'noncanonical build display title fails closed', async function( assert )
{
    var module = await modulePromise;
    var fixture = apiFixture();
    var run = workflowRun( { display_title: 'PR VSIX Build' } );

    await assert.rejects( synchronize( module, fixture, run ), function( error )
    {
        return error.message.indexOf( 'expected a canonical PR identity' ) !== -1;
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
} );

QUnit.test( 'non-dispatch build workflow identity fails closed', async function( assert )
{
    var module = await modulePromise;
    var fixture = apiFixture();

    await assert.rejects( synchronize( module, fixture, workflowRun( { event: 'pull_request' } ) ), function( error )
    {
        return error.message.indexOf( 'unexpected workflow identity' ) !== -1;
    } );
} );

QUnit.test( 'completed cleanup preserves an artifact from a concurrently newer generation', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var newer = artifact( {
        id: 301,
        created_at: '2026-07-11T10:07:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var fixture = apiFixture( {
        runArtifacts: [ current ],
        repositoryArtifacts: [ current, newer ]
    } );

    assert.equal( ( await synchronize( module, fixture, workflowRun() ) )[ 0 ].applied, true );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'completed cleanup preserves a newer rerun artifact with the same run id', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var newerAttempt = artifact( {
        id: 301,
        created_at: '2026-07-11T10:07:00Z'
    } );
    var fixture = apiFixture( {
        runArtifacts: [ current ],
        repositoryArtifacts: [ current, newerAttempt ]
    } );

    assert.equal( ( await synchronize( module, fixture, workflowRun() ) )[ 0 ].applied, true );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'superseded rerun attempt deletes its exact attempt artifact', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun();
    var latestRun = workflowRun( {
        run_attempt: 2,
        run_started_at: '2026-07-11T11:00:00Z',
        updated_at: '2026-07-11T11:06:00Z'
    } );
    var oldArtifact = artifact();
    var fixture = apiFixture( {
        workflowRuns: [ latestRun ],
        runArtifacts: [ oldArtifact ],
        repositoryArtifacts: [ oldArtifact ]
    } );

    assert.deepEqual( await module.synchronizeWorkflowRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: oldRun,
        targets: TARGETS,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'superseded attempt callback cannot delete the newer attempt artifact', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun();
    var latestRun = workflowRun( {
        run_attempt: 2,
        run_started_at: '2026-07-11T11:00:00Z',
        updated_at: '2026-07-11T11:06:00Z'
    } );
    var latestArtifact = artifact( { created_at: '2026-07-11T11:05:00Z' } );
    var fixture = apiFixture( {
        workflowRuns: [ latestRun ],
        runArtifacts: [ latestArtifact ],
        repositoryArtifacts: [ latestArtifact ]
    } );

    assert.deepEqual( await module.synchronizeWorkflowRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: oldRun,
        targets: TARGETS,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'superseded same-SHA workflow generation deletes its artifact', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun();
    var latestRun = workflowRun( {
        id: 202,
        run_number: 22,
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:10:00Z'
    } );
    var fixture = apiFixture( {
        workflowRuns: [ latestRun, oldRun ],
        runArtifacts: [ artifact() ]
    } );

    assert.deepEqual( await module.synchronizeWorkflowRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: oldRun,
        targets: TARGETS,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'repository dispatch run validates immutable PR context', async function( assert )
{
    var module = await modulePromise;
    var run = workflowRun( {
        event: 'repository_dispatch',
        head_sha: SHA_B,
        head_branch: 'master',
        head_repository: { id: 1 },
        display_title: ciTitle( { action: 'repair' } )
    } );
    var current = artifact( { workflow_run: { id: 200, head_sha: SHA_B } } );
    var fixture = apiFixture( { runArtifacts: [ current ], repositoryArtifacts: [ current ] } );

    assert.equal( ( await synchronize( module, fixture, run ) )[ 0 ].applied, true );
    assert.deepEqual( fixture.calls.commitReads, [ SHA_C ] );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: ready' ) !== -1 );
} );

QUnit.test( 'repository dispatch callback retries a transient missing merge ref', async function( assert )
{
    var module = await modulePromise;
    var current = artifact( { workflow_run: { id: 200, head_sha: SHA_B } } );
    var fixture = apiFixture( {
        mergeRefShas: [ undefined, SHA_C ],
        runArtifacts: [ current ],
        repositoryArtifacts: [ current ]
    } );

    assert.equal( ( await synchronize(
        module,
        fixture,
        workflowRun(),
        { attempts: 2, intervalMs: 0 }
    ) )[ 0 ].applied, true );
    assert.deepEqual( fixture.calls.mergeRefReads, [ 19, 19 ] );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: ready' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'repository dispatch ref exhaustion preserves its artifact for callback retry', async function( assert )
{
    var module = await modulePromise;
    var run = workflowRun();
    var current = artifact( { workflow_run: { id: 200, head_sha: SHA_B } } );
    var prior = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var fixture = apiFixture( {
        mergeRefSha: undefined,
        runArtifacts: [ current ],
        repositoryArtifacts: [ current, prior ],
        comments: [ {
            id: 401,
            body: module.renderPendingComment( {
                repository: REPOSITORY,
                run: commentRun( module, run, 'pending' )
            } ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, run ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context did not stabilize';
    } );
    assert.equal( fixture.calls.updatedComments.length, 1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: unavailable' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );

    fixture.settings.mergeRefSha = SHA_C;
    fixture.settings.repositoryArtifacts = [ current ];
    fixture.settings.comments = [ {
        id: 401,
        body: fixture.calls.updatedComments[ 0 ].body,
        user: { login: 'github-actions[bot]' }
    } ];
    assert.equal( ( await synchronize( module, fixture, run ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.updatedComments[ fixture.calls.updatedComments.length - 1 ].body
        .indexOf( 'PR VSIX: ready' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );
} );

QUnit.test( 'delayed callback failure preserves a newer ready rerun', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun();
    var oldArtifact = artifact();
    var newerRun = workflowRun( {
        run_attempt: 2,
        run_started_at: '2026-07-11T11:00:00Z',
        updated_at: '2026-07-11T11:06:00Z'
    } );
    var newerArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T11:05:00Z'
    } );
    var newerBody = renderedReadyComment( module, newerRun, newerArtifact );
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/commits/' + SHA_C +
        ': HTTP 502: upstream failure'
    );
    var fixture = apiFixture( {
        mergeCommitError: apiError,
        repositoryArtifacts: [ oldArtifact, newerArtifact ],
        comments: [ {
            id: 401,
            body: newerBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, oldRun ), function( error )
    {
        return error === apiError;
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, newerBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'terminal callback failure publishes unavailable state', async function( assert )
{
    var module = await modulePromise;
    var run = workflowRun();
    var fixture = apiFixture( { mergeRefSha: undefined } );

    await assert.rejects( synchronize( module, fixture, run ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context did not stabilize';
    } );
    var unavailableBody = fixture.calls.createdComments[ 0 ].body;
    assert.ok( unavailableBody.indexOf( 'PR VSIX: unavailable' ) !== -1 );

    assert.deepEqual( fixture.calls.updatedComments, [] );
} );

QUnit.test( 'repository dispatch callback rejects a rotated merge ref', async function( assert )
{
    var module = await modulePromise;
    var current = artifact( { workflow_run: { id: 200, head_sha: SHA_B } } );
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        runArtifacts: [ current ],
        repositoryArtifacts: [ current ]
    } );

    await assert.rejects( synchronize( module, fixture, workflowRun() ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.equal( fixture.calls.createdComments.length, 1 );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf(
        'The pull request merge ref changed before preview publication.'
    ) !== -1 );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.commitReads, [ SHA_D, SHA_D ] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'rotated merge replay removes its previously ready link before cleanup', async function( assert )
{
    var module = await modulePromise;
    var run = workflowRun();
    var current = artifact( { workflow_run: { id: 200, head_sha: SHA_B } } );
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        runArtifacts: [ current ],
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, run, current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, run ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.equal( fixture.calls.updatedComments.length, 1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: unavailable' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( '/artifacts/' ) === -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
    assert.deepEqual( fixture.calls.order, [ 'update-comment-401', 'delete-artifact-300' ] );
} );

QUnit.test( 'rotated merge failure cannot overwrite a concurrently newer source', async function( assert )
{
    var module = await modulePromise;
    var staleRun = workflowRun();
    var staleArtifact = artifact();
    var newerRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { head: SHA_D, merge: SHA_E } )
    } );
    var newerArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var newerBody = renderedReadyComment( module, newerRun, newerArtifact );
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        pullRequestResponses: [
            pullRequest(),
            pullRequest(),
            pullRequest( { head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } } } )
        ],
        runArtifacts: [ staleArtifact ],
        repositoryArtifacts: [ staleArtifact, newerArtifact ],
        comments: [ {
            id: 401,
            body: newerBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, staleRun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, newerBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'rotated merge failure preserves a newer same-source merge generation', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun( {
        run_started_at: '2026-07-11T10:20:00Z',
        updated_at: '2026-07-11T10:26:00Z'
    } );
    var oldArtifact = artifact( {
        created_at: '2026-07-11T10:25:00Z'
    } );
    var newerRun = workflowRun( {
        id: 202,
        run_number: 21,
        created_at: '2026-07-11T10:05:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { merge: SHA_D } )
    } );
    var newerArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var newerBody = renderedReadyComment( module, newerRun, newerArtifact );
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        runArtifacts: [ oldArtifact ],
        repositoryArtifacts: [ oldArtifact, newerArtifact ],
        comments: [ {
            id: 401,
            body: newerBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, oldRun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, newerBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'rotated merge failure invalidates a newer run for the obsolete merge', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun();
    var oldArtifact = artifact();
    var newerRun = workflowRun( {
        id: 202,
        run_number: 21,
        created_at: '2026-07-11T10:05:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z'
    } );
    var newerArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        runArtifacts: [ oldArtifact ],
        repositoryArtifacts: [ oldArtifact, newerArtifact ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, newerRun, newerArtifact ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, oldRun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.equal( fixture.calls.updatedComments.length, 1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: unavailable' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( '/artifacts/' ) === -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300, 301 ] );
    assert.deepEqual( fixture.calls.order, [
        'update-comment-401',
        'delete-artifact-300',
        'delete-artifact-301'
    ] );
} );

QUnit.test( 'rotated merge failure retains an older artifact for the canonical merge', async function( assert )
{
    var module = await modulePromise;
    var failedRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:00:00Z',
        run_started_at: '2026-07-11T10:00:00Z',
        updated_at: '2026-07-11T10:06:00Z'
    } );
    var failedArtifact = artifact( {
        id: 301,
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var canonicalRun = workflowRun( {
        id: 199,
        run_number: 19,
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z',
        updated_at: '2026-07-11T09:56:00Z',
        display_title: ciTitle( { merge: SHA_D } )
    } );
    var canonicalArtifact = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var canonicalBody = renderedReadyComment( module, canonicalRun, canonicalArtifact );
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        runArtifacts: [ failedArtifact ],
        repositoryArtifacts: [ canonicalArtifact, failedArtifact ],
        comments: [ {
            id: 401,
            body: canonicalBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, failedRun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, canonicalBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 301 ] );
} );

QUnit.test( 'canonical ready duplicate outranks a pending comment', async function( assert )
{
    var module = await modulePromise;
    var failedRun = workflowRun();
    var failedArtifact = artifact();
    var canonicalRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { merge: SHA_D } )
    } );
    var canonicalArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var canonicalCommentRun = commentRun( module, canonicalRun );
    var readyBody = renderedReadyComment( module, canonicalRun, canonicalArtifact );
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        runArtifacts: [ failedArtifact ],
        repositoryArtifacts: [ failedArtifact, canonicalArtifact ],
        comments: [ {
            id: 401,
            body: module.renderPendingComment( {
                repository: REPOSITORY,
                run: Object.assign( {}, canonicalCommentRun, { phase: 'pending' } )
            } ),
            user: { login: 'github-actions[bot]' }
        }, {
            id: 402,
            body: readyBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, failedRun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.deepEqual( fixture.calls.updatedComments, [ { id: 401, body: readyBody } ] );
    assert.deepEqual( fixture.calls.deletedComments, [ 401 ] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'merge ref revalidation follows a second rotation', async function( assert )
{
    var module = await modulePromise;
    var failedArtifact = artifact();
    var canonicalRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { merge: SHA_E } )
    } );
    var canonicalArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var canonicalBody = renderedReadyComment( module, canonicalRun, canonicalArtifact );
    var fixture = apiFixture( {
        mergeRefShas: [ SHA_D, SHA_E ],
        runArtifacts: [ failedArtifact ],
        repositoryArtifacts: [ failedArtifact, canonicalArtifact ],
        comments: [ {
            id: 401,
            body: canonicalBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, workflowRun() ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.canonicalMergeSha === SHA_E;
    } );
    assert.deepEqual( fixture.calls.mergeRefReads, [ 19, 19 ] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, canonicalBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'merge ref ABA revalidation resumes the original build callback', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var fixture = apiFixture( {
        mergeRefShas: [ SHA_D, SHA_C ],
        runArtifacts: [ current ],
        repositoryArtifacts: [ current ]
    } );

    var result = await synchronize( module, fixture, workflowRun() );
    assert.equal( result[ 0 ].applied, true );
    assert.deepEqual( fixture.calls.mergeRefReads, [ 19, 19 ] );
    assert.equal( fixture.calls.createdComments.length, 1 );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf( 'PR VSIX: preparing' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: ready' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'repository dispatch source drift cannot replace newer ready state', async function( assert )
{
    var module = await modulePromise;
    var staleRun = workflowRun();
    var staleArtifact = artifact();
    var newerRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { head: SHA_D, merge: SHA_D } )
    } );
    var newerArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var newerBody = renderedReadyComment( module, newerRun, newerArtifact );
    var fixture = apiFixture( {
        pullRequestResponses: [
            pullRequest(),
            pullRequest( { head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } } } )
        ],
        runArtifacts: [ staleArtifact ],
        repositoryArtifacts: [ staleArtifact, newerArtifact ],
        comments: [ {
            id: 401,
            body: newerBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.deepEqual( await synchronize( module, fixture, staleRun ), [] );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, newerBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'unassociated API failure cannot mutate a newer source generation', async function( assert )
{
    var module = await modulePromise;
    var staleRun = workflowRun();
    var staleArtifact = artifact();
    var newerRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { head: SHA_D, merge: SHA_E } )
    } );
    var newerArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var newerBody = renderedReadyComment( module, newerRun, newerArtifact );
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/pulls/19: HTTP 502: upstream failure'
    );
    var fixture = apiFixture( {
        pullRequestResponses: [
            apiError,
            pullRequest( { head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } } } )
        ],
        runArtifacts: [ staleArtifact ],
        repositoryArtifacts: [ staleArtifact, newerArtifact ],
        comments: [ {
            id: 401,
            body: newerBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, staleRun ), function( error )
    {
        return error === apiError;
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, newerBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'revalidated source can replace a later stale context after a force-push reversal', async function( assert )
{
    var module = await modulePromise;
    var currentRun = workflowRun();
    var staleRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { head: SHA_D, merge: SHA_E } )
    } );
    var staleArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var staleBody = renderedReadyComment( module, staleRun, staleArtifact );
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/commits/' + SHA_C +
        ': HTTP 502: upstream failure'
    );
    var fixture = apiFixture( {
        mergeCommitError: apiError,
        repositoryArtifacts: [ staleArtifact ],
        comments: [ {
            id: 401,
            body: staleBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, currentRun ), function( error )
    {
        return error === apiError;
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.equal( fixture.calls.updatedComments.length, 1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: unavailable' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( SHA_A.slice( 0, 12 ) ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 301 ] );
} );

QUnit.test( 'merge context requires exact commit identity and ordered parents', async function( assert )
{
    var module = await modulePromise;
    var invalidCommits = [
        { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        { sha: SHA_C, parents: [ { sha: SHA_A }, { sha: SHA_B } ] }
    ];

    for( var index = 0; index < invalidCommits.length; index++ )
    {
        var fixture = apiFixture( { mergeCommit: invalidCommits[ index ] } );
        await assert.rejects( module.waitForStablePullRequest( {
            api: fixture.api,
            pullRequestNumber: 19,
            expectedHeadSha: SHA_A,
            expectedBaseSha: SHA_B,
            retry: { attempts: 1, intervalMs: 0 }
        } ), function( error )
        {
            return error instanceof module.PrVsixInvariantError &&
                error.message === 'pull request 19: merge context did not stabilize';
        } );
    }
} );

QUnit.test( 'metadata-only CI edit is ignored without artifact mutation', async function( assert )
{
    var module = await modulePromise;
    var run = workflowRun( { display_title: ciTitle( { action: 'edited' } ), conclusion: 'skipped' } );
    var fixture = apiFixture( { repositoryArtifacts: [ artifact() ] } );

    assert.deepEqual( await synchronize( module, fixture, run ), [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'failed renewal preserves the valid artifact', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var run = workflowRun( {
        display_title: ciTitle( { action: 'renewal' } ),
        status: 'completed',
        conclusion: 'failure'
    } );
    var fixture = apiFixture( {
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    fixture.setActiveRun( run );
    assert.deepEqual( await module.synchronizeWorkflowRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: run,
        targets: TARGETS,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'successful renewal association failure preserves both preview generations', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun( {
        id: 199,
        run_number: 19,
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z',
        updated_at: '2026-07-11T09:56:00Z'
    } );
    var oldArtifact = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var renewalRun = workflowRun( {
        display_title: ciTitle( { action: 'renewal' } )
    } );
    var renewalArtifact = artifact();
    var readyBody = renderedReadyComment( module, oldRun, oldArtifact );
    var fixture = apiFixture( {
        mergeRefSha: undefined,
        runArtifacts: [ renewalArtifact ],
        repositoryArtifacts: [ oldArtifact, renewalArtifact ],
        comments: [ {
            id: 401,
            body: readyBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, renewalRun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context did not stabilize';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, readyBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'successful renewal invalidates artifacts for a rotated merge ref', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun( {
        id: 199,
        run_number: 19,
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z',
        updated_at: '2026-07-11T09:56:00Z'
    } );
    var oldArtifact = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var renewalRun = workflowRun( {
        display_title: ciTitle( { action: 'renewal' } )
    } );
    var renewalArtifact = artifact();
    var fixture = apiFixture( {
        mergeRefSha: SHA_D,
        mergeCommit: { sha: SHA_D, parents: [ { sha: SHA_B }, { sha: SHA_A } ] },
        runArtifacts: [ renewalArtifact ],
        repositoryArtifacts: [ oldArtifact, renewalArtifact ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, oldRun, oldArtifact ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, renewalRun ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context changed before publication';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.equal( fixture.calls.updatedComments.length, 1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: unavailable' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( '/artifacts/' ) === -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299, 300 ] );
} );

QUnit.test( 'publisher revokes a fork artifact when approval changes during the build', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( {
            author_association: 'NONE',
            head: { sha: SHA_A, ref: 'fork/issue-19', repo: { id: 2 } }
        } ) ],
        runArtifacts: [ current ],
        repositoryArtifacts: [ current ]
    } );

    assert.equal( ( await synchronize( module, fixture, workflowRun( {
        display_title: ciTitle( { action: 'labeled' } )
    } ) ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf( 'safe-to-test' ) !== -1 );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf( '/artifacts/' ) === -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
    assert.deepEqual( fixture.calls.mergeRefReads, [] );
} );

QUnit.test( 'failure revalidation revokes external fork artifact access', async function( assert )
{
    var module = await modulePromise;
    var allowed = pullRequest( {
        author_association: 'NONE',
        labels: [ { name: 'safe-to-test' } ],
        head: { sha: SHA_A, ref: 'fork/issue-19', repo: { id: 2 } }
    } );
    var revoked = pullRequest( {
        author_association: 'NONE',
        labels: [],
        head: { sha: SHA_A, ref: 'fork/issue-19', repo: { id: 2 } }
    } );
    var current = artifact();
    var prior = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var newer = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/commits/' + SHA_C +
        ': HTTP 502: upstream failure'
    );
    var fixture = apiFixture( {
        pullRequestResponses: [ allowed, allowed, revoked ],
        mergeCommitError: apiError,
        repositoryArtifacts: [ current, prior, newer ]
    } );

    await assert.rejects( synchronize( module, fixture, workflowRun() ), function( error )
    {
        return error === apiError;
    } );
    assert.equal( fixture.calls.createdComments.length, 1 );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf( 'safe-to-test' ) !== -1 );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf( '/artifacts/' ) === -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts.sort(), [ 299, 300, 301 ] );
} );

QUnit.test( 'authorization revocation overrides concurrent source drift and ready state', async function( assert )
{
    var module = await modulePromise;
    var allowed = pullRequest( {
        author_association: 'NONE',
        labels: [ { name: 'safe-to-test' } ],
        head: { sha: SHA_A, ref: 'fork/issue-19', repo: { id: 2 } }
    } );
    var revoked = pullRequest( {
        author_association: 'NONE',
        labels: [],
        head: { sha: SHA_D, ref: 'fork/issue-19', repo: { id: 2 } },
        base: {
            sha: SHA_E,
            ref: 'master',
            repo: { id: 1, full_name: REPOSITORY, default_branch: 'master' }
        }
    } );
    var prior = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var current = artifact();
    var newerRun = workflowRun( {
        id: 202,
        run_number: 22,
        head_sha: SHA_E,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { head: SHA_D, base: SHA_E } )
    } );
    var newer = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_E }
    } );
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/commits/' + SHA_C +
        ': HTTP 502: upstream failure'
    );
    var fixture = apiFixture( {
        pullRequestResponses: [ allowed, allowed, revoked ],
        mergeCommitError: apiError,
        repositoryArtifacts: [ prior, current, newer ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, newerRun, newer ),
            user: { login: 'github-actions[bot]' }
        }, {
            id: 402,
            body: renderedReadyComment( module, newerRun, newer ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, workflowRun() ), function( error )
    {
        return error === apiError;
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.equal( fixture.calls.updatedComments.length, 2 );
    var body = fixture.calls.updatedComments[ 0 ].body;
    var metadata = module.parseCommentMetadata( body );
    assert.ok( body.indexOf( 'safe-to-test' ) !== -1 );
    assert.ok( body.indexOf( '/artifacts/' ) === -1 );
    assert.ok( body.indexOf( '/commit/' + SHA_D ) !== -1 );
    assert.ok( body.indexOf( '/commit/' + SHA_A ) === -1 );
    assert.equal( metadata.headSha, SHA_D );
    assert.equal( metadata.baseSha, SHA_E );
    assert.equal( metadata.mergeSha, 'none' );
    assert.equal( metadata.phase, 'blocked' );
    assert.equal( metadata.artifactId, undefined );
    assert.deepEqual( fixture.calls.deletedComments, [ 402 ] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299, 300, 301 ] );
    assert.deepEqual( fixture.calls.order, [
        'update-comment-401',
        'update-comment-402',
        'delete-artifact-299',
        'delete-artifact-300',
        'delete-artifact-301'
    ] );
} );

QUnit.test( 'failure revalidation closes the current preview namespace', async function( assert )
{
    var module = await modulePromise;
    var closed = pullRequest( {
        state: 'closed',
        closed_at: '2026-07-11T10:20:00Z',
        head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } },
        base: {
            sha: SHA_E,
            ref: 'master',
            repo: { id: 1, full_name: REPOSITORY, default_branch: 'master' }
        }
    } );
    var prior = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var current = artifact();
    var newerRun = workflowRun( {
        id: 202,
        run_number: 22,
        head_sha: SHA_E,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { head: SHA_D, base: SHA_E } )
    } );
    var newer = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_E }
    } );
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/commits/' + SHA_C +
        ': HTTP 502: upstream failure'
    );
    var fixture = apiFixture( {
        pullRequestResponses: [ pullRequest(), pullRequest(), closed ],
        mergeCommitError: apiError,
        repositoryArtifacts: [ prior, current, newer ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, newerRun, newer ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, workflowRun() ), function( error )
    {
        return error === apiError;
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.equal( fixture.calls.updatedComments.length, 1 );
    var body = fixture.calls.updatedComments[ 0 ].body;
    var metadata = module.parseCommentMetadata( body );
    assert.ok( body.indexOf( 'removed when the pull request closed' ) !== -1 );
    assert.ok( body.indexOf( '/artifacts/' ) === -1 );
    assert.equal( metadata.headSha, SHA_D );
    assert.equal( metadata.baseSha, SHA_E );
    assert.equal( metadata.mergeSha, 'none' );
    assert.equal( metadata.phase, 'closed' );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299, 300, 301 ] );
} );

QUnit.test( 'stale cleanup completion preserves state after authorization reversal', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/commits/' + SHA_C +
        ': HTTP 502: upstream failure'
    );
    var cleanupRun = workflowRun( {
        display_title: ciTitle( { action: 'approval-revoked' } ),
        conclusion: 'failure'
    } );
    var fixture = apiFixture( {
        mergeCommitError: apiError,
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.deepEqual( await synchronize( module, fixture, cleanupRun ), [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
    assert.deepEqual( fixture.calls.mergeRefReads, [] );
    assert.deepEqual( fixture.calls.commitReads, [] );
} );

QUnit.test( 'stale approval revocation cleans the current unauthorized source', async function( assert )
{
    var module = await modulePromise;
    var revoked = pullRequest( {
        author_association: 'NONE',
        labels: [],
        head: { sha: SHA_D, ref: 'fork/issue-19', repo: { id: 2 } },
        base: {
            sha: SHA_E,
            ref: 'master',
            repo: { id: 1, full_name: REPOSITORY, default_branch: 'master' }
        }
    } );
    var oldArtifact = artifact();
    var currentRun = workflowRun( {
        id: 202,
        run_number: 22,
        head_sha: SHA_E,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:16:00Z',
        display_title: ciTitle( { head: SHA_D, base: SHA_E } )
    } );
    var currentArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:15:00Z',
        workflow_run: { id: 202, head_sha: SHA_E }
    } );
    var cleanupRun = workflowRun( {
        display_title: ciTitle( { action: 'approval-revoked' } )
    } );
    var fixture = apiFixture( {
        pullRequests: [ revoked ],
        repositoryArtifacts: [ oldArtifact, currentArtifact ],
        runArtifactsError: new Error( 'run artifacts must not be read' ),
        workflowRunsError: new Error( 'workflow runs must not be read' ),
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, currentRun, currentArtifact ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    var result = await synchronize( module, fixture, cleanupRun );
    assert.equal( result[ 0 ].applied, true );
    var metadata = module.parseCommentMetadata( fixture.calls.updatedComments[ 0 ].body );
    assert.equal( metadata.headSha, SHA_D );
    assert.equal( metadata.baseSha, SHA_E );
    assert.equal( metadata.mergeSha, 'none' );
    assert.equal( metadata.phase, 'blocked' );
    assert.deepEqual( fixture.calls.runArtifactReads, [] );
    assert.deepEqual( fixture.calls.workflowQueries, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300, 301 ] );
} );

QUnit.test( 'authorization cleanup deletes artifacts after comment API failure', async function( assert )
{
    var module = await modulePromise;
    var revoked = pullRequest( {
        author_association: 'NONE',
        labels: [],
        head: { sha: SHA_A, ref: 'fork/issue-19', repo: { id: 2 } }
    } );
    var current = artifact();
    var commentError = new Error( 'comment update failed' );
    var fixture = apiFixture( {
        pullRequests: [ revoked ],
        repositoryArtifacts: [ current ],
        updateCommentError: commentError,
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronize( module, fixture, workflowRun() ), function( error )
    {
        return error === commentError;
    } );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'trusted lifecycle marker posts queued state and removes the prior slot', async function( assert )
{
    var module = await modulePromise;
    var marker = lifecycleArtifact( 'synchronize' );
    var prior = artifact( { id: 299, workflow_run: { id: 199, head_sha: SHA_B } } );
    var fixture = apiFixture( {
        workflowRuns: [],
        runArtifacts: [ marker ],
        repositoryArtifacts: [ prior ]
    } );

    assert.deepEqual( await synchronizeLifecycle( module, fixture, lifecycleRun() ), [
        { pullRequestNumber: 19, applied: true, removedArtifacts: 1 }
    ] );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf( 'PR VSIX: queued' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299, 600 ] );
} );

QUnit.test( 'lifecycle monitor finalizes a completed build without a completion callback', async function( assert )
{
    var module = await modulePromise;
    var buildRun = workflowRun( {
        created_at: '2026-07-11T10:00:03Z',
        run_started_at: '2026-07-11T10:00:03Z'
    } );
    var current = artifact( { created_at: '2026-07-11T10:05:00Z' } );
    var pendingBody = module.renderPendingComment( {
        repository: REPOSITORY,
        run: {
            id: 500,
            runAttempt: 1,
            runNumber: 50,
            startedAt: '2026-07-11T10:00:01Z',
            headSha: SHA_A,
            baseSha: SHA_B,
            mergeSha: SHA_C,
            pullRequestNumber: 19,
            action: 'synchronize',
            source: 'lifecycle',
            phase: 'pending',
            conclusion: 'success'
        }
    } );
    var fixture = apiFixture( {
        workflowRuns: [ buildRun ],
        runArtifacts: [ current ],
        repositoryArtifacts: [ current ],
        comments: [ { id: 401, body: pendingBody, user: { login: 'github-actions[bot]' } } ]
    } );

    assert.deepEqual( await module.monitorLifecycleBuild( {
        api: fixture.api,
        repository: REPOSITORY,
        lifecycleRun: lifecycleRun(),
        targets: TARGETS,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        monitorOptions: {
            pollIntervalMs: 10000,
            heartbeatMs: 60000,
            timeoutMs: 120000,
            now: function() { return Date.parse( '2026-07-11T10:06:01Z' ); },
            sleep: async function() { throw new Error( 'completed build must not sleep' ); }
        }
    } ), [ { pullRequestNumber: 19, applied: true, removedArtifacts: 0 } ] );
    assert.equal( fixture.calls.workflowJobReads.length, 0 );
    assert.ok( fixture.calls.updatedComments.some( function( comment )
    {
        return comment.body.indexOf( 'PR VSIX: ready' ) !== -1;
    } ) );
} );

QUnit.test( 'lifecycle monitor publishes real build steps before terminal synchronization', async function( assert )
{
    var module = await modulePromise;
    var clock = Date.parse( '2026-07-11T10:00:04Z' );
    var running = workflowRun( {
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-07-11T10:00:03Z',
        run_started_at: '2026-07-11T10:00:03Z',
        updated_at: '2026-07-11T10:00:04Z'
    } );
    var completed = workflowRun( {
        created_at: '2026-07-11T10:00:03Z',
        run_started_at: '2026-07-11T10:00:03Z'
    } );
    var pendingBody = module.renderPendingComment( {
        repository: REPOSITORY,
        run: {
            id: 500,
            runAttempt: 1,
            runNumber: 50,
            startedAt: '2026-07-11T10:00:01Z',
            headSha: SHA_A,
            baseSha: SHA_B,
            mergeSha: SHA_C,
            pullRequestNumber: 19,
            action: 'synchronize',
            source: 'lifecycle',
            phase: 'pending',
            conclusion: 'success'
        }
    } );
    var fixture = apiFixture( {
        workflowRunResponses: [ [ running ], [ completed ] ],
        workflowJobs: [ {
            id: 700,
            name: 'Build and verify',
            status: 'in_progress',
            conclusion: null,
            steps: [
                { number: 1, name: 'Test extension', status: 'completed', conclusion: 'success' },
                { number: 2, name: 'Package VSIX', status: 'in_progress', conclusion: null }
            ]
        } ],
        runArtifacts: [ artifact() ],
        repositoryArtifacts: [ artifact() ],
        comments: [ { id: 401, body: pendingBody, user: { login: 'github-actions[bot]' } } ]
    } );

    assert.deepEqual( await module.monitorLifecycleBuild( {
        api: fixture.api,
        repository: REPOSITORY,
        lifecycleRun: lifecycleRun(),
        targets: TARGETS,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        monitorOptions: {
            pollIntervalMs: 10000,
            heartbeatMs: 60000,
            timeoutMs: 120000,
            now: function() { return clock; },
            sleep: async function( delay ) { clock += delay; }
        }
    } ), [ { pullRequestNumber: 19, applied: true, removedArtifacts: 0 } ] );
    assert.deepEqual( fixture.calls.workflowJobReads, [ 200 ] );
    assert.ok( fixture.calls.updatedComments.some( function( comment )
    {
        return comment.body.indexOf( 'PR VSIX: running' ) !== -1 &&
            comment.body.indexOf( 'Build and verify: Package VSIX | **RUNNING**' ) !== -1;
    } ) );
    assert.ok( fixture.calls.updatedComments.some( function( comment )
    {
        return comment.body.indexOf( 'PR VSIX: ready' ) !== -1;
    } ) );
} );

QUnit.test( 'merge ref exhaustion publishes unavailable state and retains retry identity', async function( assert )
{
    var module = await modulePromise;
    var pendingBody = module.renderPendingComment( {
        repository: REPOSITORY,
        run: {
            id: 500,
            runAttempt: 1,
            runNumber: 50,
            startedAt: '2026-07-11T10:00:01Z',
            headSha: SHA_A,
            baseSha: SHA_B,
            mergeSha: 'none',
            pullRequestNumber: 19,
            action: 'synchronize',
            source: 'lifecycle',
            phase: 'pending',
            conclusion: 'success'
        }
    } );
    var fixture = apiFixture( {
        workflowRuns: [],
        runArtifacts: [ lifecycleArtifact( 'synchronize' ) ],
        mergeRefSha: undefined,
        repositoryArtifacts: [ artifact( {
            id: 299,
            created_at: '2026-07-11T09:55:00Z',
            workflow_run: { id: 199, head_sha: SHA_B }
        } ) ],
        comments: [ {
            id: 401,
            body: pendingBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronizeLifecycle( module, fixture, lifecycleRun() ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context did not stabilize';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.equal( fixture.calls.updatedComments.length, 1 );
    assert.equal( fixture.calls.updatedComments[ 0 ].id, 401 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: unavailable' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'immutable merge ref' ) !== -1 );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: queued' ) === -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );

    fixture.settings.mergeRefSha = SHA_C;
    fixture.settings.repositoryArtifacts = [];
    fixture.settings.comments = [ {
        id: 401,
        body: fixture.calls.updatedComments[ 0 ].body,
        user: { login: 'github-actions[bot]' }
    } ];
    assert.deepEqual( await synchronizeLifecycle( module, fixture, lifecycleRun() ), [
        { pullRequestNumber: 19, applied: true, removedArtifacts: 0 }
    ] );
    assert.equal( fixture.calls.dispatchedEvents.length, 1 );
    assert.ok( fixture.calls.updatedComments[ 1 ].body.indexOf( 'PR VSIX: queued' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299, 600 ] );
} );

QUnit.test( 'lifecycle source drift removes only the stale retry marker', async function( assert )
{
    var module = await modulePromise;
    var fixture = apiFixture( {
        workflowRuns: [],
        runArtifacts: [ lifecycleArtifact( 'synchronize' ) ],
        pullRequestResponses: [
            pullRequest(),
            pullRequest( { head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } } } )
        ]
    } );

    assert.deepEqual( await synchronizeLifecycle( module, fixture, lifecycleRun() ), [] );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.dispatchedEvents, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 600 ] );
} );

QUnit.test( 'lifecycle revalidation drift removes its stale retry marker without comment mutation', async function( assert )
{
    var module = await modulePromise;
    var fixture = apiFixture( {
        workflowRuns: [],
        runArtifacts: [ lifecycleArtifact( 'synchronize' ) ],
        mergeRefSha: undefined,
        pullRequestResponses: [
            pullRequest(),
            pullRequest(),
            pullRequest( { head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } } } )
        ]
    } );

    await assert.rejects( synchronizeLifecycle( module, fixture, lifecycleRun() ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context did not stabilize';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.dispatchedEvents, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 600 ] );
} );

QUnit.test( 'lifecycle API failure reports its own terminal reason and remains retryable', async function( assert )
{
    var module = await modulePromise;
    var apiError = new module.PrVsixInvariantError(
        'GitHub API GET /repos/FanaticPythoner/better-todo-tree/commits/' + SHA_C +
        ': HTTP 502: upstream failure'
    );
    var fixture = apiFixture( {
        workflowRuns: [],
        runArtifacts: [ lifecycleArtifact( 'synchronize' ) ],
        mergeCommitError: apiError
    } );

    await assert.rejects( synchronizeLifecycle( module, fixture, lifecycleRun() ), function( error )
    {
        return error === apiError;
    } );
    assert.equal( fixture.calls.createdComments.length, 1 );
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf(
        'GitHub API access failed during preview reconciliation.'
    ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'delayed lifecycle failure preserves newer ready state and artifact', async function( assert )
{
    var module = await modulePromise;
    var newerRun = workflowRun( {
        id: 202,
        run_number: 22,
        created_at: '2026-07-11T10:01:00Z',
        run_started_at: '2026-07-11T10:01:00Z',
        updated_at: '2026-07-11T10:06:00Z'
    } );
    var newerArtifact = artifact( {
        id: 301,
        created_at: '2026-07-11T10:05:00Z',
        workflow_run: { id: 202, head_sha: SHA_B }
    } );
    var staleArtifact = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var newerBody = renderedReadyComment( module, newerRun, newerArtifact );
    var fixture = apiFixture( {
        workflowRuns: [],
        runArtifacts: [ lifecycleArtifact( 'synchronize' ) ],
        mergeRefSha: undefined,
        repositoryArtifacts: [ staleArtifact, newerArtifact ],
        comments: [ {
            id: 401,
            body: newerBody,
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    await assert.rejects( synchronizeLifecycle( module, fixture, lifecycleRun() ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request 19: merge context did not stabilize';
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.equal( fixture.settings.comments[ 0 ].body, newerBody );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );
} );

QUnit.test( 'target and fallback lifecycle callbacks converge on one build generation', async function( assert )
{
    var module = await modulePromise;
    var targetRun = lifecycleRun();
    var targetMarker = lifecycleArtifact( 'synchronize' );
    var fallbackRun = lifecycleRun( {
        id: 501,
        run_number: 51,
        event: 'pull_request',
        pull_requests: [ { number: 19 } ],
        created_at: '2026-07-11T10:00:02Z',
        run_started_at: '2026-07-11T10:00:02Z',
        updated_at: '2026-07-11T10:00:04Z'
    } );
    var fallbackMarker = lifecycleArtifact( 'synchronize', {
        id: 601,
        name: lifecycleArtifact( 'synchronize' ).name.replace( 'run-500', 'run-501' ),
        created_at: '2026-07-11T10:00:03Z',
        workflow_run: { id: 501, head_sha: SHA_B }
    } );
    var buildRun = workflowRun( {
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-07-11T10:00:03Z',
        run_started_at: '2026-07-11T10:00:03Z',
        updated_at: '2026-07-11T10:00:04Z'
    } );
    var fixture = apiFixture( {
        workflowRuns: [],
        runArtifactsByRun: { 500: [ targetMarker ], 501: [ fallbackMarker ] }
    } );

    await synchronizeLifecycle( module, fixture, targetRun );
    fixture.settings.workflowRuns = [ buildRun ];
    fixture.settings.comments = [ {
        id: 400,
        body: fixture.calls.createdComments[ 0 ].body,
        user: { login: 'github-actions[bot]' }
    } ];
    await synchronizeLifecycle( module, fixture, fallbackRun );

    assert.equal( fixture.calls.dispatchedEvents.length, 1 );
    assert.equal( fixture.calls.createdComments.length, 1 );
    assert.ok( fixture.calls.updatedComments.every( function( comment ) { return comment.id === 400; } ) );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 600, 601 ] );
} );

QUnit.test( 'pull-request fallback requires server-associated PR identity', async function( assert )
{
    var module = await modulePromise;
    var marker = lifecycleArtifact( 'synchronize' );
    var acceptedFixture = apiFixture( { workflowRuns: [], runArtifacts: [ marker ] } );
    var rejectedFixture = apiFixture( { workflowRuns: [], runArtifacts: [ marker ] } );

    assert.equal( ( await synchronizeLifecycle( module, acceptedFixture, lifecycleRun( {
        event: 'pull_request',
        pull_requests: [ { number: 19 } ]
    } ) ) )[ 0 ].applied, true );
    assert.deepEqual( await synchronizeLifecycle( module, rejectedFixture, lifecycleRun( {
        event: 'pull_request',
        pull_requests: []
    } ) ), [] );
    assert.deepEqual( rejectedFixture.calls.deletedArtifacts, [ 600 ] );
} );

QUnit.test( 'same-event lifecycle completion cannot replace successful CI state', async function( assert )
{
    var module = await modulePromise;
    var markerRun = lifecycleRun();
    var marker = lifecycleArtifact( 'synchronize' );
    var currentRun = workflowRun( {
        created_at: '2026-07-11T10:00:02Z',
        run_started_at: '2026-07-11T10:00:02Z'
    } );
    var current = artifact();
    var fixture = apiFixture( {
        workflowRuns: [ currentRun ],
        runArtifactsByRun: { 500: [ marker ], 200: [ current ] },
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, currentRun, current ),
            user: { login: 'github-actions[bot]' }
        } ],
        repositoryArtifacts: [ current ]
    } );

    assert.deepEqual( await synchronizeLifecycle( module, fixture, markerRun ), [
        { pullRequestNumber: 19, applied: true, removedArtifacts: 0 }
    ] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 600 ] );
} );

QUnit.test( 'successful same-event build overrides a later-started lifecycle state', async function( assert )
{
    var module = await modulePromise;
    var lifecycleState = {
        id: 500,
        runAttempt: 1,
        runNumber: 50,
        startedAt: '2026-07-11T10:01:00Z',
        headSha: SHA_A,
        baseSha: SHA_B,
        mergeSha: SHA_C,
        action: 'synchronize',
        source: 'lifecycle',
        phase: 'pending'
    };
    var provisionalBody = module.renderPendingComment( {
        repository: REPOSITORY,
        run: lifecycleState
    } );
    var currentRun = workflowRun();
    var current = artifact( { created_at: '2026-07-11T10:05:00Z' } );
    var fixture = apiFixture( {
        workflowRuns: [ currentRun ],
        runArtifacts: [ current ],
        repositoryArtifacts: [ current ],
        comments: [ { id: 401, body: provisionalBody, user: { login: 'github-actions[bot]' } } ]
    } );

    assert.equal( ( await synchronize( module, fixture, currentRun ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.updatedComments[ fixture.calls.updatedComments.length - 1 ].body.indexOf( 'PR VSIX: ready' ) !== -1 );
} );

QUnit.test( 'newer merge-conflict lifecycle state invalidates an older ready artifact', async function( assert )
{
    var module = await modulePromise;
    var oldRun = workflowRun( {
        id: 199,
        run_number: 19,
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z'
    } );
    var oldArtifact = artifact( { id: 299, workflow_run: { id: 199, head_sha: SHA_B } } );
    var marker = lifecycleArtifact( 'synchronize' );
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( { mergeable: false, mergeable_state: 'dirty' } ) ],
        workflowRuns: [ oldRun ],
        runArtifacts: [ marker ],
        repositoryArtifacts: [ oldArtifact ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, oldRun, oldArtifact ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.equal( ( await synchronizeLifecycle( module, fixture, lifecycleRun() ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'merge conflicts' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299, 600 ] );
} );

QUnit.test( 'safe-to-test removal revokes external preview access without rebuilding', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var marker = lifecycleArtifact( 'unlabeled' );
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( {
            author_association: 'NONE',
            head: { sha: SHA_D, ref: 'fork/issue-19', repo: { id: 2 } },
            base: {
                sha: SHA_E,
                ref: 'master',
                repo: { id: 1, full_name: REPOSITORY, default_branch: 'master' }
            }
        } ) ],
        runArtifacts: [ marker ],
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.equal( ( await synchronizeLifecycle( module, fixture, lifecycleRun( {
        display_title: 'PR VSIX Event #19 unlabeled'
    } ) ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'safe-to-test' ) !== -1 );
    var metadata = module.parseCommentMetadata( fixture.calls.updatedComments[ 0 ].body );
    assert.equal( metadata.headSha, SHA_D );
    assert.equal( metadata.baseSha, SHA_E );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300, 600 ] );
    assert.deepEqual( fixture.calls.dispatchedEvents, [] );
} );

QUnit.test( 'safe-to-test removal preserves previews with intrinsic authorization', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var marker = lifecycleArtifact( 'unlabeled' );
    var fixture = apiFixture( {
        runArtifacts: [ marker ],
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.deepEqual( await synchronizeLifecycle( module, fixture, lifecycleRun( {
        display_title: 'PR VSIX Event #19 unlabeled'
    } ) ), [ { pullRequestNumber: 19, applied: false, removedArtifacts: 0 } ] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 600 ] );
    assert.deepEqual( fixture.calls.dispatchedEvents, [] );
} );

QUnit.test( 'safe-to-test reapproval dispatches a build instead of reusing deleted history', async function( assert )
{
    var module = await modulePromise;
    var historicalRun = workflowRun( {
        id: 199,
        run_number: 19,
        display_title: ciTitle( { action: 'labeled' } ),
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z',
        updated_at: '2026-07-11T09:56:00Z'
    } );
    var marker = lifecycleArtifact( 'labeled' );
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( {
            author_association: 'NONE',
            labels: [ { name: 'safe-to-test' } ],
            head: { sha: SHA_A, ref: 'fork/issue-19', repo: { id: 2 } }
        } ) ],
        workflowRuns: [ historicalRun ],
        runArtifacts: [ marker ]
    } );

    assert.equal( ( await synchronizeLifecycle( module, fixture, lifecycleRun( {
        display_title: 'PR VSIX Event #19 labeled'
    } ) ) )[ 0 ].applied, true );
    assert.equal( fixture.calls.dispatchedEvents.length, 1 );
    assert.equal( fixture.calls.dispatchedEvents[ 0 ].payload.cause, 'labeled' );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 600 ] );
} );

QUnit.test( 'closed lifecycle marker ignores later base movement and removes the retained artifact', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var marker = lifecycleArtifact( 'closed' );
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( {
            state: 'closed',
            closed_at: '2026-07-11T10:01:00Z',
            merge_commit_sha: SHA_D,
            head: { sha: SHA_D, ref: 'fix/issue-19', repo: { id: 99 } },
            base: {
                sha: SHA_D,
                ref: 'master',
                repo: { id: 1, full_name: REPOSITORY, default_branch: 'master' }
            }
        } ) ],
        runArtifacts: [ marker ],
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.equal( ( await synchronizeLifecycle( module, fixture, lifecycleRun( {
        display_title: 'PR VSIX Event #19 closed'
    } ) ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'was removed when the pull request closed' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300, 600 ] );
} );

QUnit.test( 'scheduled closed repair removes an artifact after the close timestamp', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var repairRun = workflowRun( {
        id: 205,
        run_number: 25,
        head_sha: SHA_D,
        display_title: ciTitle( { action: 'closed-repair' } ),
        created_at: '2026-07-11T11:00:00Z',
        run_started_at: '2026-07-11T11:00:00Z',
        updated_at: '2026-07-11T11:00:03Z'
    } );
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( {
            state: 'closed',
            closed_at: '2026-07-11T10:10:00Z',
            merge_commit_sha: SHA_D,
            base: {
                sha: SHA_D,
                ref: 'master',
                repo: { id: 1, full_name: REPOSITORY, default_branch: 'master' }
            }
        } ) ],
        workflowRuns: [ repairRun ],
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.equal( ( await synchronize( module, fixture, repairRun ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'was removed when the pull request closed' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 300 ] );
} );

QUnit.test( 'lifecycle rerun selects its exact attempt marker and removes stale attempts', async function( assert )
{
    var module = await modulePromise;
    var attemptOne = lifecycleArtifact( 'synchronize' );
    var attemptTwo = lifecycleArtifact( 'synchronize', {
        id: 601,
        name: lifecycleArtifact( 'synchronize' ).name.replace( 'attempt-1', 'attempt-2' )
    } );
    var run = lifecycleRun( {
        run_attempt: 2,
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:10:03Z'
    } );
    var fixture = apiFixture( { workflowRuns: [], runArtifacts: [ attemptOne, attemptTwo ] } );

    assert.equal( ( await synchronizeLifecycle( module, fixture, run ) )[ 0 ].applied, true );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 600, 601 ] );
} );

QUnit.test( 'lifecycle run title must match marker identity', async function( assert )
{
    var module = await modulePromise;
    var run = lifecycleRun( {
        name: 'PR VSIX Event #20 synchronize',
        display_title: 'PR VSIX Event #20 synchronize'
    } );
    var fixture = apiFixture( { runArtifacts: [ lifecycleArtifact( 'synchronize' ) ] } );

    await assert.rejects( synchronizeLifecycle( module, fixture, run ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message.indexOf( 'run title and marker identity differ' ) !== -1;
    } );
    assert.deepEqual( fixture.calls.createdComments, [] );
    assert.deepEqual( fixture.calls.dispatchedEvents, [] );
} );

QUnit.test( 'workflow identity resolver classifies canonical titles without workflow_run.name', async function( assert )
{
    var module = await modulePromise;

    assert.deepEqual( module.resolveWorkflowIdentity( workflowRun() ), {
        source: 'ci',
        pullRequestNumber: 19,
        processable: true
    } );
    assert.deepEqual( module.resolveWorkflowIdentity( workflowRun( {
        display_title: ciTitle( { action: 'edited' } )
    } ) ), {
        source: 'ci',
        pullRequestNumber: 19,
        processable: false
    } );
    assert.deepEqual( module.resolveWorkflowIdentity( lifecycleRun() ), {
        source: 'lifecycle',
        pullRequestNumber: 19,
        processable: true
    } );
    assert.deepEqual( module.resolveWorkflowIdentity( lifecycleRun( {
        event: 'pull_request',
        name: 'runtime name is not workflow identity'
    } ) ), {
        source: 'lifecycle',
        pullRequestNumber: 19,
        processable: true
    } );
    assert.throws( function()
    {
        module.resolveWorkflowIdentity( lifecycleRun( { event: 'repository_dispatch' } ) );
    }, function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message.indexOf( 'unexpected workflow identity' ) !== -1;
    } );
    assert.throws( function()
    {
        module.resolveWorkflowIdentity( lifecycleRun( {
            display_title: 'PR VSIX Event #19 synchronize extra'
        } ) );
    }, function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message.indexOf( 'expected a canonical PR identity' ) !== -1;
    } );
    var malformedLifecycleError;
    try
    {
        module.resolveWorkflowIdentity( lifecycleRun( {
            display_title: 'PR VSIX Event'
        } ) );
    }
    catch( error )
    {
        malformedLifecycleError = error;
    }
    assert.ok( malformedLifecycleError instanceof module.PrVsixInvariantError );
    assert.equal( malformedLifecycleError.message, 'workflow run: expected a canonical PR identity' );
} );

QUnit.test( 'resolve CLI accepts the live PR 132 lifecycle payload shape', function( assert )
{
    var run = lifecycleRun( {
        id: 29188370308,
        run_number: 132,
        workflow_id: 311626908,
        name: 'PR VSIX Event #132 opened',
        display_title: 'PR VSIX Event #132 opened',
        event: 'pull_request_target',
        head_sha: 'c2b3aa1582ee2f2e3ec7f3271fac85ab182ee7dd',
        pull_requests: [ { number: 132 } ]
    } );
    var result = resolveWorkflowEvent( run );

    assert.equal( result.status, 0 );
    assert.equal( result.stdout, 'pull-request-number=132\nprocessable=true\n' );
    assert.equal( result.stderr, '' );
} );

QUnit.test( 'GitHub API adapter paginates and dispatches refresh events', async function( assert )
{
    var module = await modulePromise;
    var requests = [];
    var pageValues = Array.from( { length: 100 }, function( _, index )
    {
        return { id: index + 1 };
    } );
    var api = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        fetchImpl: async function( url, options )
        {
            var requestUrl = new URL( url );
            var page = requestUrl.searchParams.get( 'page' );
            requests.push( { url: url, options: options } );
            if( options.method === 'POST' )
            {
                return new Response( null, { status: 204 } );
            }
            return new Response( JSON.stringify( {
                artifacts: page === '1' ? pageValues : [ { id: 101 } ]
            } ) );
        }
    } );

    assert.equal( ( await api.listArtifactsByName( 'better-todo-tree-pr-19.vsix' ) ).length, 101 );
    await api.dispatchRepositoryEvent( 'refresh-pr-vsix', { pull_request_number: 19 } );
    assert.equal( requests.length, 3 );
    assert.equal( requests[ 0 ].options.headers.Authorization, 'Bearer token' );
    assert.equal( requests[ 0 ].options.headers[ 'X-GitHub-Api-Version' ], '2026-03-10' );
    assert.equal( JSON.parse( requests[ 2 ].options.body ).event_type, 'refresh-pr-vsix' );
} );

QUnit.test( 'GitHub API adapter paginates workflow jobs with step metadata', async function( assert )
{
    var module = await modulePromise;
    var requests = [];
    var pageValues = Array.from( { length: 100 }, function( _, index )
    {
        return { id: index + 1, name: 'Job ' + ( index + 1 ), steps: [] };
    } );
    var api = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        fetchImpl: async function( url )
        {
            var requestUrl = new URL( url );
            requests.push( requestUrl );
            return new Response( JSON.stringify( {
                jobs: requestUrl.searchParams.get( 'page' ) === '1' ? pageValues : [ {
                    id: 101,
                    name: 'Package',
                    steps: [ { number: 1, name: 'Pack VSIX', status: 'in_progress', conclusion: null } ]
                } ]
            } ), { status: 200 } );
        }
    } );

    var jobs = await api.listWorkflowRunJobs( 200 );
    assert.equal( jobs.length, 101 );
    assert.equal( jobs[ 100 ].steps[ 0 ].name, 'Pack VSIX' );
    assert.ok( requests.every( function( request )
    {
        return request.pathname.endsWith( '/actions/runs/200/jobs' );
    } ) );
} );

QUnit.test( 'GitHub API adapter resolves the versioned pull request merge ref', async function( assert )
{
    var module = await modulePromise;
    var requests = [];
    var responses = [
        new Response( JSON.stringify( {
            ref: 'refs/pull/19/merge',
            object: { type: 'commit', sha: SHA_C }
        } ), { status: 200 } ),
        new Response( JSON.stringify( { message: 'Not Found' } ), { status: 404 } ),
        new Response( JSON.stringify( { message: 'Conflict' } ), { status: 409 } ),
        new Response( JSON.stringify( {
            ref: 'refs/pull/19/head',
            object: { type: 'commit', sha: SHA_C }
        } ), { status: 200 } ),
        new Response( JSON.stringify( {
            ref: 'refs/pull/19/merge',
            object: { type: 'tag', sha: SHA_C }
        } ), { status: 200 } ),
        new Response( JSON.stringify( {
            ref: 'refs/pull/19/merge',
            object: { type: 'commit', sha: 'invalid' }
        } ), { status: 200 } )
    ];
    var api = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        fetchImpl: async function( url, options )
        {
            requests.push( { url: url, options: options } );
            return responses.shift();
        }
    } );

    assert.equal( await api.getPullRequestMergeSha( 19 ), SHA_C );
    assert.equal( await api.getPullRequestMergeSha( 19 ), undefined );
    assert.equal( await api.getPullRequestMergeSha( 19 ), undefined );
    for( var index = 0; index < 2; index++ )
    {
        await assert.rejects( api.getPullRequestMergeSha( 19 ), function( error )
        {
            return error instanceof module.PrVsixInvariantError &&
                error.message === 'pull request 19: invalid merge ref response';
        } );
    }
    await assert.rejects( api.getPullRequestMergeSha( 19 ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message === 'pull request merge ref SHA: expected a 40-character lowercase commit SHA';
    } );
    assert.equal( requests.length, 6 );
    assert.ok( requests.every( function( request )
    {
        return request.url.endsWith( '/repos/FanaticPythoner/better-todo-tree/git/ref/pull/19/merge' ) &&
            request.options.headers[ 'X-GitHub-Api-Version' ] === '2026-03-10';
    } ) );
} );

QUnit.test( 'GitHub API adapter exposes transport and response contract failures', async function( assert )
{
    var module = await modulePromise;
    var transportApi = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        fetchImpl: async function()
        {
            throw new Error( 'network failure' );
        }
    } );
    var jsonApi = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        fetchImpl: async function()
        {
            return new Response( '<html>', { status: 502 } );
        }
    } );

    await assert.rejects( transportApi.getPullRequest( 19 ), function( error )
    {
        return error instanceof module.PrVsixInvariantError && error.cause.message === 'network failure';
    } );
    await assert.rejects( jsonApi.getPullRequest( 19 ), function( error )
    {
        return error instanceof module.PrVsixInvariantError &&
            error.message.indexOf( 'HTTP 502: <html>' ) !== -1;
    } );
} );

QUnit.test( 'GitHub API adapter exposes batched repository artifact and comment scans', async function( assert )
{
    var module = await modulePromise;
    var requests = [];
    var api = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        fetchImpl: async function( url )
        {
            requests.push( url );
            return new Response( url.indexOf( '/issues/comments?' ) === -1 ?
                JSON.stringify( { artifacts: [] } ) : JSON.stringify( [] ), { status: 200 } );
        }
    } );

    assert.deepEqual( await api.listRepositoryArtifacts(), [] );
    assert.deepEqual(
        await api.listRepositoryIssueComments( '2026-04-11T12:00:00Z' ),
        []
    );
    assert.equal( requests.length, 2 );
    assert.ok( requests[ 1 ].indexOf( 'since=2026-04-11T12%3A00%3A00Z' ) !== -1 );
} );

QUnit.test( 'GitHub API adapter honors Retry-After before retrying rate limits', async function( assert )
{
    var module = await modulePromise;
    var calls = 0;
    var delays = [];
    var api = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        retry: {
            attempts: 2,
            baseDelayMs: 100,
            maxDelayMs: 1000,
            now: function() { return 0; },
            sleep: async function( delay ) { delays.push( delay ); }
        },
        fetchImpl: async function()
        {
            calls++;
            if( calls === 1 )
            {
                return new Response( JSON.stringify( { message: 'secondary rate limit' } ), {
                    status: 429,
                    headers: { 'Retry-After': '2' }
                } );
            }
            return new Response( JSON.stringify( pullRequest() ), { status: 200 } );
        }
    } );

    assert.equal( ( await api.getPullRequest( 19 ) ).number, 19 );
    assert.equal( calls, 2 );
    assert.deepEqual( delays, [ 2000 ] );
} );

QUnit.test( 'GitHub API adapter retries non-JSON server failures', async function( assert )
{
    var module = await modulePromise;
    var calls = 0;
    var delays = [];
    var api = module.createGitHubApi( {
        token: 'token',
        repository: REPOSITORY,
        retry: {
            attempts: 2,
            baseDelayMs: 10,
            maxDelayMs: 10,
            sleep: async function( delay ) { delays.push( delay ); }
        },
        fetchImpl: async function()
        {
            calls++;
            return calls === 1 ? new Response( '<html>', { status: 502 } ) :
                new Response( JSON.stringify( pullRequest() ), { status: 200 } );
        }
    } );

    assert.equal( ( await api.getPullRequest( 19 ) ).number, 19 );
    assert.equal( calls, 2 );
    assert.deepEqual( delays, [ 10 ] );
} );
