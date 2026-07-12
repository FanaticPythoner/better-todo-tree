var path = require( 'path' );
var pathToFileURL = require( 'url' ).pathToFileURL;

var contextModulePromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'resolve-pr-vsix-context.mjs' )
).href );
var refreshModulePromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'refresh-pr-vsix.mjs' )
).href );

var REPOSITORY = 'FanaticPythoner/better-todo-tree';
var SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
var SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
var SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';
var SHA_D = 'dddddddddddddddddddddddddddddddddddddddd';
var SHA_E = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function pullRequest( overrides )
{
    return Object.assign( {
        number: 19,
        state: 'open',
        mergeable: true,
        mergeable_state: 'clean',
        merge_commit_sha: null,
        author_association: 'OWNER',
        labels: [],
        head: { sha: SHA_A, repo: { id: 99 } },
        base: { sha: SHA_B, ref: 'master', repo: { id: 1, full_name: REPOSITORY } }
    }, overrides || {} );
}

function event( overrides )
{
    return Object.assign( {
        repository: { full_name: REPOSITORY },
        pull_request: pullRequest()
    }, overrides || {} );
}

function markerBody( overrides )
{
    var values = Object.assign( {
        source: 'ci',
        action: 'synchronize',
        runId: 200,
        runAttempt: 1,
        runNumber: 20,
        observedAt: '2026-07-11T10:00:00Z',
        headSha: SHA_A,
        baseSha: SHA_B,
        mergeSha: SHA_C,
        phase: 'completed',
        conclusion: 'success',
        artifactId: 300,
        artifactName: 'better-todo-tree-pr-19.vsix'
    }, overrides || {} );
    return [
        '<!-- better-todo-tree-pr-vsix',
        'source: ' + values.source,
        'action: ' + values.action,
        'run-id: ' + values.runId,
        'run-attempt: ' + values.runAttempt,
        'run-number: ' + values.runNumber,
        'observed-at: ' + values.observedAt,
        'head-sha: ' + values.headSha,
        'base-sha: ' + values.baseSha,
        'merge-sha: ' + values.mergeSha,
        'phase: ' + values.phase,
        'conclusion: ' + values.conclusion,
        'artifact-id: ' + ( values.artifactId || 'none' ),
        'artifact-name: ' + ( values.artifactName || 'none' ),
        '-->'
    ].join( '\n' );
}

function comment( body )
{
    return {
        id: 400,
        body: body,
        issue_url: 'https://api.github.com/repos/FanaticPythoner/better-todo-tree/issues/19',
        user: { login: 'github-actions[bot]' }
    };
}

function storedArtifact( overrides )
{
    return Object.assign( {
        id: 300,
        name: 'better-todo-tree-pr-19.vsix',
        expired: false,
        expires_at: '2026-10-09T10:00:00Z',
        workflow_run: { id: 200 }
    }, overrides || {} );
}

function mergeContextApi( overrides )
{
    return Object.assign( {
        getPullRequestMergeSha: async function() { return SHA_C; },
        getCommit: async function()
        {
            return { sha: SHA_C, parents: [ { sha: SHA_B }, { sha: SHA_A } ] };
        }
    }, overrides || {} );
}

function stableContext( overrides )
{
    return Object.assign( {
        pullRequestNumber: 19,
        headSha: SHA_A,
        baseSha: SHA_B,
        mergeSha: SHA_C
    }, overrides || {} );
}

QUnit.module( 'PR VSIX refresh and immutable context' );

QUnit.test( 'base refresh accepts only successful same-repository push signals', async function( assert )
{
    var module = await refreshModulePromise;
    var baseEvent = {
        action: 'completed',
        repository: { id: 1, full_name: REPOSITORY },
        workflow_run: {
            name: 'PR VSIX Base Event',
            event: 'push',
            conclusion: 'success',
            head_branch: 'release/1.x',
            head_repository: { id: 1 }
        }
    };

    assert.equal( module.workflowRunBaseBranch( baseEvent ), 'release/1.x' );
    await assert.rejects( Promise.resolve().then( function()
    {
        return module.workflowRunBaseBranch( Object.assign( {}, baseEvent, {
            workflow_run: Object.assign( {}, baseEvent.workflow_run, {
                head_repository: { id: 2 }
            } )
        } ) );
    } ), function( error )
    {
        return error.message.indexOf( 'same-repository push workflow' ) !== -1;
    } );
} );

QUnit.test( 'repository dispatch resolves only a parent-bound current merge context', async function( assert )
{
    var module = await contextModulePromise;
    var dispatchEvent = event( {
        action: 'refresh-pr-vsix',
        pull_request: undefined,
        client_payload: {
            pull_request_number: 19,
            head_sha: SHA_A,
            base_sha: SHA_B,
            merge_sha: SHA_C,
            cause: 'repair'
        }
    } );
    var api = mergeContextApi( {
        getPullRequest: async function()
        {
            return pullRequest( {
                mergeable: null,
                mergeable_state: 'unknown',
                merge_commit_sha: SHA_D
            } );
        }
    } );

    var context = await module.resolveBuildContext( {
        event: dispatchEvent,
        api: api,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } );
    assert.equal( context.checkoutSha, SHA_C );
    assert.ok( context.build );
    assert.ok( module.renderOutputs( context ).indexOf( 'checkout-sha=' + SHA_C ) !== -1 );

    dispatchEvent.client_payload.base_sha = SHA_D;
    await assert.rejects( module.resolveBuildContext( {
        event: dispatchEvent,
        api: api,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), function( error )
    {
        return error.message.indexOf( 'build context changed during reconciliation' ) !== -1;
    } );
} );

QUnit.test( 'stale merge parents and unapproved external forks fail closed', async function( assert )
{
    var module = await contextModulePromise;
    var dispatchEvent = event( {
        action: 'refresh-pr-vsix',
        pull_request: undefined,
        client_payload: {
            pull_request_number: 19,
            head_sha: SHA_A,
            base_sha: SHA_B,
            merge_sha: SHA_C,
            cause: 'repair'
        }
    } );
    var staleApi = mergeContextApi( {
        getPullRequest: async function() { return pullRequest(); },
        getCommit: async function()
        {
            return { sha: SHA_C, parents: [ { sha: SHA_D }, { sha: SHA_A } ] };
        }
    } );
    await assert.rejects( module.resolveBuildContext( {
        event: dispatchEvent,
        api: staleApi,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), function( error )
    {
        return error.message.indexOf( 'merge context did not stabilize' ) !== -1;
    } );

    var external = pullRequest( {
        author_association: 'NONE',
        head: { sha: SHA_A, repo: { id: 2 } }
    } );
    var externalApi = mergeContextApi( {
        getPullRequest: async function() { return external; }
    } );
    await assert.rejects( module.resolveBuildContext( {
        event: dispatchEvent,
        api: externalApi,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), function( error )
    {
        return error.message.indexOf( 'unauthorized, stale, or unmergeable' ) !== -1;
    } );
} );

QUnit.test( 'revocation dispatch resolves to trusted cleanup without PR checkout', async function( assert )
{
    var module = await contextModulePromise;
    var external = pullRequest( {
        author_association: 'NONE',
        head: { sha: SHA_A, repo: { id: 2 } }
    } );
    var context = await module.resolveBuildContext( {
        event: event( {
            action: 'refresh-pr-vsix',
            pull_request: undefined,
            client_payload: {
                pull_request_number: 19,
                head_sha: SHA_A,
                base_sha: SHA_B,
                merge_sha: 'none',
                cause: 'approval-revoked'
            }
        } ),
        api: {
            getPullRequest: async function() { return external; }
        },
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } );

    assert.notOk( context.build );
    assert.equal( context.checkoutSha, SHA_B );
    assert.ok( module.renderOutputs( context ).indexOf( 'build=false' ) !== -1 );
} );

QUnit.test( 'closed repair resolves to trusted cleanup without PR checkout', async function( assert )
{
    var module = await contextModulePromise;
    var closed = pullRequest( {
        state: 'closed',
        merge_commit_sha: SHA_D,
        base: { sha: SHA_D, ref: 'master', repo: { id: 1, full_name: REPOSITORY } }
    } );
    var context = await module.resolveBuildContext( {
        event: event( {
            action: 'refresh-pr-vsix',
            pull_request: undefined,
            client_payload: {
                pull_request_number: 19,
                head_sha: SHA_A,
                base_sha: SHA_B,
                merge_sha: SHA_C,
                cause: 'closed-repair'
            }
        } ),
        api: {
            getPullRequest: async function() { return closed; }
        },
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } );

    assert.notOk( context.build );
    assert.equal( context.checkoutSha, SHA_D );
} );

QUnit.test( 'cleanup dispatch never becomes an untrusted build after state reversal', async function( assert )
{
    var module = await contextModulePromise;
    var approvalEvent = event( {
        action: 'refresh-pr-vsix',
        pull_request: undefined,
        client_payload: {
            pull_request_number: 19,
            head_sha: SHA_A,
            base_sha: SHA_B,
            merge_sha: SHA_C,
            cause: 'approval-revoked'
        }
    } );
    var closeEvent = event( {
        action: 'refresh-pr-vsix',
        pull_request: undefined,
        client_payload: Object.assign( {}, approvalEvent.client_payload, { cause: 'closed-repair' } )
    } );
    var api = {
        getPullRequest: async function() { return pullRequest(); },
        getCommit: async function()
        {
            assert.ok( false, 'cleanup reversal does not enter merge resolution' );
        }
    };

    await assert.rejects( module.resolveBuildContext( {
        event: approvalEvent,
        api: api,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), function( error )
    {
        return error.message.indexOf( 'cleanup context is stale or inapplicable' ) !== -1;
    } );
    await assert.rejects( module.resolveBuildContext( {
        event: closeEvent,
        api: api,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } ), function( error )
    {
        return error.message.indexOf( 'cleanup context is stale or inapplicable' ) !== -1;
    } );
} );

QUnit.test( 'scheduled refresh preserves current bundles outside the renewal window', async function( assert )
{
    var module = await refreshModulePromise;
    var refresh = module.requiresScheduledRefresh( {
        pullRequest: pullRequest(),
        context: stableContext(),
        comments: [ comment( markerBody() ) ],
        artifacts: [ storedArtifact() ],
        now: Date.parse( '2026-07-11T12:00:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000
    } );

    assert.notOk( refresh );
} );

QUnit.test( 'scheduled refresh repairs context drift, expiry, and abandoned pending state', async function( assert )
{
    var module = await refreshModulePromise;
    var input = {
        pullRequest: pullRequest(),
        context: stableContext(),
        comments: [ comment( markerBody() ) ],
        artifacts: [ storedArtifact() ],
        now: Date.parse( '2026-07-11T18:01:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000
    };

    assert.ok( module.requiresScheduledRefresh( Object.assign( {}, input, {
        comments: [ comment( markerBody( { baseSha: SHA_D } ) ) ]
    } ) ) );
    assert.ok( module.requiresScheduledRefresh( Object.assign( {}, input, {
        artifacts: [ storedArtifact( { expires_at: '2026-07-20T00:00:00Z' } ) ]
    } ) ) );
    assert.ok( module.requiresScheduledRefresh( Object.assign( {}, input, {
        artifacts: [ storedArtifact(), storedArtifact( { id: 301 } ) ]
    } ) ) );
    assert.ok( module.requiresScheduledRefresh( Object.assign( {}, input, {
        comments: [ comment( markerBody( {
            phase: 'pending',
            artifactId: undefined,
            artifactName: undefined
        } ) ) ],
        artifacts: []
    } ) ) );
    assert.notOk( module.requiresScheduledRefresh( Object.assign( {}, input, {
        comments: [ comment( markerBody( {
            phase: 'completed',
            conclusion: 'failure',
            artifactId: undefined,
            artifactName: undefined
        } ) ) ],
        artifacts: []
    } ) ) );
    assert.ok( module.requiresScheduledRefresh( Object.assign( {}, input, {
        comments: [ comment( markerBody( {
            phase: 'completed',
            conclusion: 'failure',
            artifactId: undefined,
            artifactName: undefined
        } ) ) ],
        artifacts: [ storedArtifact() ]
    } ) ) );
    assert.ok( module.requiresScheduledRefresh( Object.assign( {}, input, {
        comments: [ comment( markerBody( {
            phase: 'completed',
            conclusion: 'success',
            artifactId: undefined,
            artifactName: undefined
        } ) ) ],
        artifacts: []
    } ) ) );
} );

QUnit.test( 'base refresh dispatches build and conflict invalidation events', async function( assert )
{
    var module = await refreshModulePromise;
    var dispatched = [];
    var mergeRefPulls = [];
    var pulls = [
        pullRequest(),
        pullRequest( {
            number: 20,
            mergeable: false,
            mergeable_state: 'dirty',
            merge_commit_sha: null
        } )
    ];
    var api = mergeContextApi( {
        getPullRequestMergeSha: async function( number )
        {
            mergeRefPulls.push( number );
            return SHA_C;
        },
        listOpenPullRequests: async function( base )
        {
            assert.equal( base, 'master' );
            return pulls;
        },
        getPullRequest: async function( number )
        {
            return pulls.find( function( item ) { return item.number === number; } );
        },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    } );
    var result = await module.refreshOpenPullRequests( {
        api: api,
        base: 'master',
        scheduled: false,
        now: 0,
        renewalWindowMs: 1,
        pendingWindowMs: 1,
        concurrency: 2,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } );

    assert.deepEqual( result, {
        scanned: 2,
        dispatched: 2,
        current: 0,
        skipped: 0,
        revoked: 0,
        unsafe: 0,
        closedRepaired: 0
    } );
    dispatched.sort( function( left, right )
    {
        return left.payload.pull_request_number - right.payload.pull_request_number;
    } );
    assert.equal( dispatched[ 0 ].name, 'refresh-pr-vsix' );
    assert.deepEqual( mergeRefPulls, [ 19 ] );
    assert.deepEqual( dispatched[ 0 ].payload, {
        pull_request_number: 19,
        head_sha: SHA_A,
        base_sha: SHA_B,
        merge_sha: SHA_C,
        cause: 'base-push'
    } );
    assert.equal( dispatched[ 1 ].payload.merge_sha, 'none' );
} );

QUnit.test( 'base refresh returns a durable PR-number continuation cursor', async function( assert )
{
    var module = await refreshModulePromise;
    var pulls = [
        pullRequest(),
        pullRequest( { number: 20, head: { sha: SHA_D, repo: { id: 99 } } } ),
        pullRequest( { number: 21 } )
    ];
    var dispatched = [];
    var mergeRefPulls = [];
    var commitReads = [];
    var api = mergeContextApi( {
        getPullRequestMergeSha: async function( number )
        {
            mergeRefPulls.push( number );
            return number === 19 ? SHA_C : SHA_E;
        },
        getCommit: async function( sha )
        {
            commitReads.push( sha );
            return sha === SHA_C ?
                { sha: SHA_C, parents: [ { sha: SHA_B }, { sha: SHA_A } ] } :
                { sha: SHA_E, parents: [ { sha: SHA_B }, { sha: SHA_D } ] };
        },
        listOpenPullRequests: async function() { return pulls; },
        getPullRequest: async function( number )
        {
            return pulls.find( function( pull ) { return pull.number === number; } );
        },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    } );
    var result = await module.refreshOpenPullRequests( {
        api: api,
        base: 'master',
        scheduled: false,
        now: 0,
        renewalWindowMs: 1,
        pendingWindowMs: 1,
        concurrency: 2,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        batchSize: 2
    } );

    assert.equal( result.scanned, 2 );
    assert.equal( dispatched.length, 2 );
    assert.deepEqual( mergeRefPulls.sort(), [ 19, 20 ] );
    assert.deepEqual( commitReads.sort(), [ SHA_C, SHA_E ] );
    assert.deepEqual( dispatched.sort( function( left, right )
    {
        return left.payload.pull_request_number - right.payload.pull_request_number;
    } ).map( function( item )
    {
        return [ item.payload.pull_request_number, item.payload.merge_sha ];
    } ), [ [ 19, SHA_C ], [ 20, SHA_E ] ] );
    assert.deepEqual( result.continuation, { phase: 'open', cursor: 20 } );
} );

QUnit.test( 'continuation payload preserves scheduled and branch scan identity', async function( assert )
{
    var module = await refreshModulePromise;

    assert.deepEqual( module.continuationInvocation( {
        action: 'continue-pr-vsix-refresh',
        client_payload: {
            scheduled: false,
            base: 'release/1.x',
            phase: 'open',
            cursor: 400
        }
    } ), {
        base: 'release/1.x',
        scheduled: false,
        phase: 'open',
        cursor: 400
    } );
} );

QUnit.test( 'scheduled sweep dispatches only stale bundles', async function( assert )
{
    var module = await refreshModulePromise;
    var dispatched = [];
    var api = mergeContextApi( {
        listOpenPullRequests: async function() { return [ pullRequest() ]; },
        getPullRequest: async function() { return pullRequest(); },
        listRepositoryIssueComments: async function() { return [ comment( markerBody() ) ]; },
        listRepositoryArtifacts: async function()
        {
            return [ storedArtifact( { expires_at: '2026-07-12T00:00:00Z' } ) ];
        },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    } );
    var result = await module.refreshOpenPullRequests( {
        api: api,
        scheduled: true,
        now: Date.parse( '2026-07-11T12:00:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000,
        concurrency: 1,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        commentSince: '2026-04-11T12:00:00Z'
    } );

    assert.deepEqual( result, {
        scanned: 1,
        dispatched: 1,
        current: 0,
        skipped: 0,
        revoked: 0,
        unsafe: 0,
        closedRepaired: 0
    } );
    assert.equal( dispatched.length, 1 );
    assert.equal( dispatched[ 0 ].payload.cause, 'renewal' );
} );

QUnit.test( 'scheduled sweep revalidates the exact canonical merge ref', async function( assert )
{
    var module = await refreshModulePromise;
    var mergeSha = SHA_C;
    var mergeRefReads = [];
    var dispatched = [];
    var api = {
        listOpenPullRequests: async function() { return [ pullRequest() ]; },
        getPullRequest: async function() { return pullRequest(); },
        getPullRequestMergeSha: async function( number )
        {
            mergeRefReads.push( number );
            return mergeSha;
        },
        getCommit: async function( sha )
        {
            return { sha: sha, parents: [ { sha: SHA_B }, { sha: SHA_A } ] };
        },
        listRepositoryIssueComments: async function() { return [ comment( markerBody() ) ]; },
        listRepositoryArtifacts: async function() { return [ storedArtifact() ]; },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    };
    var options = {
        api: api,
        scheduled: true,
        now: Date.parse( '2026-07-11T12:00:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000,
        concurrency: 1,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        commentSince: '2026-04-11T12:00:00Z'
    };

    var current = await module.refreshOpenPullRequests( options );
    assert.equal( current.current, 1 );
    assert.equal( current.dispatched, 0 );
    assert.deepEqual( dispatched, [] );

    mergeSha = SHA_D;
    var repaired = await module.refreshOpenPullRequests( options );
    assert.equal( repaired.current, 0 );
    assert.equal( repaired.dispatched, 1 );
    assert.equal( dispatched.length, 1 );
    assert.deepEqual( dispatched[ 0 ].payload, {
        pull_request_number: 19,
        head_sha: SHA_A,
        base_sha: SHA_B,
        merge_sha: SHA_D,
        cause: 'repair'
    } );
    assert.deepEqual( mergeRefReads, [ 19, 19 ] );
} );

QUnit.test( 'scheduled sweep revokes authorization removed during merge reconciliation', async function( assert )
{
    var module = await refreshModulePromise;
    var allowed = pullRequest( {
        author_association: 'NONE',
        labels: [ { name: 'safe-to-test' } ],
        head: { sha: SHA_A, repo: { id: 2 } }
    } );
    var revoked = pullRequest( {
        author_association: 'NONE',
        labels: [],
        head: { sha: SHA_A, repo: { id: 2 } }
    } );
    var dispatched = [];
    var api = {
        listOpenPullRequests: async function() { return [ allowed ]; },
        getPullRequest: async function() { return revoked; },
        getPullRequestMergeSha: async function()
        {
            throw new Error( 'merge ref must not be read after revocation' );
        },
        listRepositoryIssueComments: async function() { return [ comment( markerBody() ) ]; },
        listRepositoryArtifacts: async function() { return [ storedArtifact() ]; },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    };

    var result = await module.refreshOpenPullRequests( {
        api: api,
        scheduled: true,
        now: Date.parse( '2026-07-11T12:00:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000,
        concurrency: 1,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        commentSince: '2026-04-11T12:00:00Z'
    } );

    assert.equal( result.revoked, 1 );
    assert.equal( result.unsafe, 0 );
    assert.equal( dispatched.length, 1 );
    assert.equal( dispatched[ 0 ].payload.cause, 'approval-revoked' );
    assert.equal( dispatched[ 0 ].payload.merge_sha, 'none' );
} );

QUnit.test( 'scheduled sweep repairs closure observed during merge reconciliation', async function( assert )
{
    var module = await refreshModulePromise;
    var closed = pullRequest( {
        state: 'closed',
        closed_at: '2026-07-11T11:00:00Z'
    } );
    var dispatched = [];
    var api = {
        listOpenPullRequests: async function() { return [ pullRequest() ]; },
        getPullRequest: async function() { return closed; },
        getPullRequestMergeSha: async function()
        {
            throw new Error( 'merge ref must not be read after closure' );
        },
        listRepositoryIssueComments: async function() { return [ comment( markerBody() ) ]; },
        listRepositoryArtifacts: async function() { return [ storedArtifact() ]; },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    };

    var result = await module.refreshOpenPullRequests( {
        api: api,
        scheduled: true,
        now: Date.parse( '2026-07-11T12:00:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000,
        concurrency: 1,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        commentSince: '2026-04-11T12:00:00Z'
    } );

    assert.equal( result.closedRepaired, 1 );
    assert.equal( result.skipped, 0 );
    assert.equal( dispatched.length, 1 );
    assert.equal( dispatched[ 0 ].payload.cause, 'closed-repair' );
    assert.equal( dispatched[ 0 ].payload.merge_sha, 'none' );
} );

QUnit.test( 'refresh sweep does not execute unapproved external fork code', async function( assert )
{
    var module = await refreshModulePromise;
    var dispatched = [];
    var external = pullRequest( {
        author_association: 'NONE',
        head: { sha: SHA_A, repo: { id: 2 } }
    } );
    var api = {
        listOpenPullRequests: async function() { return [ external ]; },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    };
    var result = await module.refreshOpenPullRequests( {
        api: api,
        scheduled: false,
        now: 0,
        renewalWindowMs: 1,
        pendingWindowMs: 1,
        concurrency: 1,
        mergeRetry: { attempts: 1, intervalMs: 0 }
    } );

    assert.deepEqual( result, {
        scanned: 1,
        dispatched: 0,
        current: 0,
        skipped: 0,
        revoked: 0,
        unsafe: 1,
        closedRepaired: 0
    } );
    assert.deepEqual( dispatched, [] );
} );

QUnit.test( 'scheduled sweep reconciles revoked external preview state', async function( assert )
{
    var module = await refreshModulePromise;
    var dispatched = [];
    var external = pullRequest( {
        author_association: 'NONE',
        head: { sha: SHA_A, repo: { id: 2 } }
    } );
    var api = {
        listOpenPullRequests: async function() { return [ external ]; },
        listRepositoryIssueComments: async function() { return [ comment( markerBody() ) ]; },
        listRepositoryArtifacts: async function() { return [ storedArtifact() ]; },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    };
    var result = await module.refreshOpenPullRequests( {
        api: api,
        scheduled: true,
        now: Date.parse( '2026-07-11T12:00:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000,
        concurrency: 1,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        commentSince: '2026-04-11T12:00:00Z'
    } );

    assert.deepEqual( result, {
        scanned: 1,
        dispatched: 0,
        current: 0,
        skipped: 0,
        revoked: 1,
        unsafe: 0,
        closedRepaired: 0
    } );
    assert.equal( dispatched.length, 1 );
    assert.equal( dispatched[ 0 ].payload.cause, 'approval-revoked' );
} );

QUnit.test( 'scheduled sweep reconciles artifacts orphaned by a missed close event', async function( assert )
{
    var module = await refreshModulePromise;
    var dispatched = [];
    var closed = pullRequest( {
        state: 'closed',
        closed_at: '2026-07-11T10:30:00Z'
    } );
    var api = {
        listOpenPullRequests: async function() { return []; },
        listRepositoryIssueComments: async function() { return [ comment( markerBody() ) ]; },
        listRepositoryArtifacts: async function() { return [ storedArtifact() ]; },
        getPullRequest: async function( number )
        {
            assert.equal( number, 19 );
            return closed;
        },
        dispatchRepositoryEvent: async function( name, payload )
        {
            dispatched.push( { name: name, payload: payload } );
        }
    };
    var result = await module.refreshOpenPullRequests( {
        api: api,
        scheduled: true,
        now: Date.parse( '2026-07-11T12:00:00Z' ),
        renewalWindowMs: 14 * 24 * 60 * 60 * 1000,
        pendingWindowMs: 6 * 60 * 60 * 1000,
        concurrency: 1,
        mergeRetry: { attempts: 1, intervalMs: 0 },
        commentSince: '2026-04-11T12:00:00Z',
        phase: 'closed'
    } );

    assert.equal( result.closedRepaired, 1 );
    assert.equal( dispatched.length, 1 );
    assert.equal( dispatched[ 0 ].payload.cause, 'closed-repair' );
} );

QUnit.test( 'scheduled grouping ignores artifact namespaces without trusted bot metadata', async function( assert )
{
    var module = await refreshModulePromise;
    var grouped = module.groupScheduledState( [], [], [ storedArtifact() ] );

    assert.deepEqual( grouped.closedCandidates, [] );
    assert.equal( grouped.artifactsByName.size, 0 );
} );

QUnit.test( 'scheduled grouping retains orphan artifacts after blocked comment cleanup failure', async function( assert )
{
    var module = await refreshModulePromise;
    var blocked = comment( markerBody( {
        phase: 'blocked',
        artifactId: undefined,
        artifactName: undefined
    } ) );
    var grouped = module.groupScheduledState( [ pullRequest() ], [ blocked ], [ storedArtifact() ] );

    assert.equal( grouped.artifactsByName.get( 'better-todo-tree-pr-19.vsix' ).length, 1 );
    assert.notOk( module.requiresAuthorizationRevocation( {
        pullRequest: pullRequest(),
        comments: [ blocked ],
        artifacts: []
    } ) );
    assert.ok( module.requiresAuthorizationRevocation( {
        pullRequest: pullRequest(),
        comments: [ blocked ],
        artifacts: grouped.artifactsByName.get( 'better-todo-tree-pr-19.vsix' )
    } ) );
} );

QUnit.test( 'concurrent mapping processes all items before reporting failures', async function( assert )
{
    var module = await refreshModulePromise;
    var processed = [];
    await assert.rejects( module.mapConcurrent( [ 1, 2, 3 ], 2, async function( value )
    {
        processed.push( value );
        if( value === 2 )
        {
            throw new Error( 'fixture failure' );
        }
        return value;
    } ), function( error )
    {
        return error instanceof AggregateError && error.errors.length === 1;
    } );
    assert.deepEqual( processed.sort(), [ 1, 2, 3 ] );
} );

QUnit.test( 'dispatch scheduler serializes mutations at the configured interval', async function( assert )
{
    var module = await refreshModulePromise;
    var clock = 0;
    var dispatchedAt = [];
    var dispatch = module.createDispatchScheduler( {
        dispatchRepositoryEvent: async function()
        {
            dispatchedAt.push( clock );
        }
    }, {
        intervalMs: 1000,
        now: function() { return clock; },
        sleep: async function( delay ) { clock += delay; }
    } );

    await Promise.all( [
        dispatch( 'refresh-pr-vsix', { pull_request_number: 1 } ),
        dispatch( 'refresh-pr-vsix', { pull_request_number: 2 } ),
        dispatch( 'refresh-pr-vsix', { pull_request_number: 3 } )
    ] );
    assert.deepEqual( dispatchedAt, [ 0, 1000, 2000 ] );
} );

QUnit.test( 'dispatch scheduler holds the queue after an exhausted rate limit', async function( assert )
{
    var module = await refreshModulePromise;
    var clock = 0;
    var calls = 0;
    var dispatchedAt = [];
    var dispatch = module.createDispatchScheduler( {
        dispatchRepositoryEvent: async function()
        {
            calls++;
            dispatchedAt.push( clock );
            if( calls === 1 )
            {
                var error = new Error( 'rate limited' );
                error.retryAfterMs = 5000;
                throw error;
            }
        }
    }, {
        intervalMs: 1000,
        now: function() { return clock; },
        sleep: async function( delay ) { clock += delay; }
    } );

    var first = dispatch( 'refresh-pr-vsix', { pull_request_number: 1 } ).catch( function( error )
    {
        return error.message;
    } );
    var second = dispatch( 'refresh-pr-vsix', { pull_request_number: 2 } );
    assert.equal( await first, 'rate limited' );
    await second;
    assert.deepEqual( dispatchedAt, [ 0, 5000 ] );
} );
