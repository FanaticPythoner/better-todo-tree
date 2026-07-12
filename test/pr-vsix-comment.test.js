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
var TARGETS = require( '../scripts/release/targets.json' );

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
        name: 'PR VSIX Build',
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
        merge_commit_sha: SHA_C,
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
        name: 'PR VSIX Event',
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
            '-merge-' + SHA_C + '-' + action + '-run-500-attempt-1',
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
        updatedComments: [],
        deletedComments: [],
        deletedArtifacts: [],
        dispatchedEvents: [],
        workflowQueries: [],
        order: []
    };
    var api = {
        getPullRequest: async function( number )
        {
            return ( settings.pullRequests || [ pullRequest() ] ).find( function( item )
            {
                return item.number === number;
            } );
        },
        getCommit: async function()
        {
            return settings.mergeCommit || { sha: SHA_C, parents: [ { sha: SHA_B }, { sha: SHA_A } ] };
        },
        listRunArtifacts: async function( runId )
        {
            if( settings.runArtifactsByRun )
            {
                return settings.runArtifactsByRun[ runId ] || [];
            }
            return settings.runArtifacts || [];
        },
        listWorkflowRuns: async function( workflow, filters )
        {
            calls.workflowQueries.push( { workflow: workflow, filters: filters } );
            return ( settings.workflowRuns || [ activeRun ] ).filter( function( item )
            {
                return ( !filters || !filters.createdAfter ||
                    Date.parse( item.created_at ) >= Date.parse( filters.createdAfter ) ) &&
                    ( !filters || !filters.headSha || item.head_sha === filters.headSha );
            } );
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
            return { id: id };
        },
        deleteIssueComment: async function( id )
        {
            calls.deletedComments.push( id );
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

function synchronize( module, fixture, run, action )
{
    fixture.setActiveRun( run );
    return module.synchronizeWorkflowRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: run,
        targets: TARGETS,
        action: action || 'completed'
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

QUnit.test( 'successful current run publishes one raw VSIX link and removes duplicate namespace artifacts', async function( assert )
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
    assert.ok( body.indexOf( '`win32-x64`' ) !== -1 );
    assert.ok( body.indexOf( '`web`' ) === -1 );
    assert.ok( body.indexOf( 'unreviewed code from this pull request' ) !== -1 );
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

QUnit.test( 'noncanonical build run name fails closed', async function( assert )
{
    var module = await modulePromise;
    var fixture = apiFixture();
    var run = workflowRun( { display_title: 'PR VSIX Build' } );

    await assert.rejects( synchronize( module, fixture, run ), function( error )
    {
        return error.message.indexOf( 'missing canonical PR run name' ) !== -1;
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

QUnit.test( 'new same-context CI generation replaces completed state immediately', async function( assert )
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
    var currentRun = workflowRun( {
        id: 202,
        run_number: 22,
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-07-11T10:10:00Z',
        run_started_at: '2026-07-11T10:10:00Z',
        updated_at: '2026-07-11T10:10:00Z'
    } );
    var fixture = apiFixture( {
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, oldRun, oldArtifact ),
            user: { login: 'github-actions[bot]' }
        } ],
        repositoryArtifacts: [ oldArtifact ]
    } );

    assert.deepEqual( await synchronize( module, fixture, currentRun, 'in_progress' ), [
        { pullRequestNumber: 19, applied: true, removedArtifacts: 1 }
    ] );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: building' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );
} );

QUnit.test( 'completed state blocks a delayed pending callback from the same generation', async function( assert )
{
    var module = await modulePromise;
    var run = workflowRun( { status: 'in_progress', conclusion: null } );
    var current = artifact();
    var fixture = apiFixture( {
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ],
        repositoryArtifacts: [ current ]
    } );

    assert.deepEqual( await synchronize( module, fixture, run, 'in_progress' ), [
        { pullRequestNumber: 19, applied: false, removedArtifacts: 0 }
    ] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
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
        action: 'completed'
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
        action: 'completed'
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
        action: 'completed'
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
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: ready' ) !== -1 );
} );

QUnit.test( 'metadata-only CI edit is ignored without artifact mutation', async function( assert )
{
    var module = await modulePromise;
    var run = workflowRun( { display_title: ciTitle( { action: 'edited' } ), conclusion: 'skipped' } );
    var fixture = apiFixture( { repositoryArtifacts: [ artifact() ] } );

    assert.deepEqual( await synchronize( module, fixture, run ), [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'renewal preserves the valid artifact through pending and failed builds', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var run = workflowRun( {
        display_title: ciTitle( { action: 'renewal' } ),
        status: 'in_progress',
        conclusion: null
    } );
    var fixture = apiFixture( {
        repositoryArtifacts: [ current ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, workflowRun(), current ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.deepEqual( await synchronize( module, fixture, run, 'in_progress' ), [] );
    run.status = 'completed';
    run.conclusion = 'failure';
    fixture.setActiveRun( run );
    assert.deepEqual( await module.synchronizeWorkflowRun( {
        api: fixture.api,
        repository: REPOSITORY,
        run: run,
        targets: TARGETS,
        action: 'completed'
    } ), [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
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
} );

QUnit.test( 'stale cleanup completion preserves state after authorization reversal', async function( assert )
{
    var module = await modulePromise;
    var current = artifact();
    var cleanupRun = workflowRun( {
        display_title: ciTitle( { action: 'approval-revoked' } ),
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

    assert.deepEqual( await synchronize( module, fixture, cleanupRun ), [] );
    assert.deepEqual( fixture.calls.updatedComments, [] );
    assert.deepEqual( fixture.calls.deletedArtifacts, [] );
} );

QUnit.test( 'base-push conflict invalidates the previous merge artifact', async function( assert )
{
    var module = await modulePromise;
    var old = artifact( {
        id: 299,
        created_at: '2026-07-11T09:55:00Z',
        workflow_run: { id: 199, head_sha: SHA_B }
    } );
    var oldRun = workflowRun( {
        id: 199,
        run_number: 19,
        created_at: '2026-07-11T09:50:00Z',
        run_started_at: '2026-07-11T09:50:00Z',
        updated_at: '2026-07-11T09:56:00Z'
    } );
    var run = workflowRun( {
        id: 202,
        run_number: 22,
        status: 'in_progress',
        conclusion: null,
        display_title: ciTitle( { merge: 'none', action: 'base-push' } )
    } );
    var fixture = apiFixture( {
        pullRequests: [ pullRequest( {
            mergeable: false,
            mergeable_state: 'dirty',
            merge_commit_sha: null
        } ) ],
        repositoryArtifacts: [ old ],
        comments: [ {
            id: 401,
            body: renderedReadyComment( module, oldRun, old ),
            user: { login: 'github-actions[bot]' }
        } ]
    } );

    assert.equal( ( await synchronize( module, fixture, run, 'in_progress' ) )[ 0 ].applied, true );
    assert.ok( fixture.calls.updatedComments[ 0 ].body.indexOf( 'PR VSIX: building' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299 ] );
} );

QUnit.test( 'trusted lifecycle marker posts building state and removes the prior slot', async function( assert )
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
    assert.ok( fixture.calls.createdComments[ 0 ].body.indexOf( 'PR VSIX: building' ) !== -1 );
    assert.deepEqual( fixture.calls.deletedArtifacts, [ 299, 600 ] );
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
            head: { sha: SHA_A, ref: 'fork/issue-19', repo: { id: 2 } }
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

QUnit.test( 'workflow identity resolver covers CI and lifecycle events', async function( assert )
{
    var module = await modulePromise;

    assert.deepEqual( module.resolveWorkflowIdentity( workflowRun() ), {
        pullRequestNumber: 19,
        processable: true
    } );
    assert.deepEqual( module.resolveWorkflowIdentity( workflowRun( {
        display_title: ciTitle( { action: 'edited' } )
    } ) ), {
        pullRequestNumber: 19,
        processable: false
    } );
    assert.deepEqual( module.resolveWorkflowIdentity( lifecycleRun() ), {
        pullRequestNumber: 19,
        processable: true
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
