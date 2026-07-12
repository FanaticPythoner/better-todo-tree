var path = require( 'path' );
var pathToFileURL = require( 'url' ).pathToFileURL;

var modulePromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'pr-vsix-monitor.mjs' )
).href );

QUnit.module( 'PR VSIX workflow monitor' );

QUnit.test( 'publishes state transitions, heartbeat, and terminal synchronization', async function( assert )
{
    var module = await modulePromise;
    var clock = Date.parse( '2026-07-12T12:00:00Z' );
    var observations = [
        undefined,
        { id: 200, status: 'queued', conclusion: null },
        { id: 200, status: 'in_progress', conclusion: null },
        { id: 200, status: 'in_progress', conclusion: null },
        { id: 200, status: 'in_progress', conclusion: null },
        { id: 200, status: 'completed', conclusion: 'success' }
    ];
    var jobs = [
        { id: 1, status: 'queued', conclusion: null, steps: [] }
    ];
    var events = [];

    var result = await module.monitorWorkflow( {
        findRun: async function() { return observations.shift(); },
        readJobs: async function( run ) { return run.status === 'queued' ? [] : jobs; },
        onWaiting: async function( observedAt ) { events.push( [ 'waiting', observedAt ] ); },
        onProgress: async function( run, currentJobs, observedAt )
        {
            events.push( [ 'progress', run.status, currentJobs.length, observedAt ] );
        },
        onCompleted: async function( run, observedAt )
        {
            events.push( [ 'completed', run.conclusion, observedAt ] );
            return 'synchronized';
        },
        options: {
            pollIntervalMs: 30000,
            heartbeatMs: 60000,
            timeoutMs: 300000,
            now: function() { return clock; },
            sleep: async function( delay ) { clock += delay; }
        }
    } );

    assert.equal( result, 'synchronized' );
    assert.deepEqual( events.map( function( event ) { return event.slice( 0, 3 ); } ), [
        [ 'waiting', '2026-07-12T12:00:00.000Z' ],
        [ 'progress', 'queued', 0 ],
        [ 'progress', 'in_progress', 1 ],
        [ 'progress', 'in_progress', 1 ],
        [ 'completed', 'success', '2026-07-12T12:02:30.000Z' ]
    ] );
} );

QUnit.test( 'publishes changed step state without waiting for heartbeat', async function( assert )
{
    var module = await modulePromise;
    var clock = 0;
    var reads = 0;
    var published = [];

    await module.monitorWorkflow( {
        findRun: async function()
        {
            return reads === 2 ? { id: 200, status: 'completed', conclusion: 'failure' } :
                { id: 200, status: 'in_progress', conclusion: null };
        },
        readJobs: async function()
        {
            reads += 1;
            return [ {
                id: 1,
                status: 'in_progress',
                conclusion: null,
                steps: [ {
                    number: 1,
                    status: reads === 1 ? 'in_progress' : 'completed',
                    conclusion: reads === 1 ? null : 'success'
                } ]
            } ];
        },
        onWaiting: async function() {},
        onProgress: async function( run, jobs ) { published.push( jobs[ 0 ].steps[ 0 ].status ); },
        onCompleted: async function( run ) { published.push( run.conclusion ); },
        options: {
            pollIntervalMs: 10000,
            heartbeatMs: 60000,
            timeoutMs: 120000,
            now: function() { return clock; },
            sleep: async function( delay ) { clock += delay; }
        }
    } );

    assert.deepEqual( published, [ 'in_progress', 'completed', 'failure' ] );
} );

QUnit.test( 'fails explicitly at the configured deadline', async function( assert )
{
    var module = await modulePromise;
    var clock = 0;

    await assert.rejects( module.monitorWorkflow( {
        findRun: async function() { return undefined; },
        readJobs: async function() { return []; },
        onWaiting: async function() {},
        onProgress: async function() {},
        onCompleted: async function() {},
        options: {
            pollIntervalMs: 10000,
            heartbeatMs: 20000,
            timeoutMs: 30000,
            now: function() { return clock; },
            sleep: async function( delay ) { clock += delay; }
        }
    } ), function( error )
    {
        return error instanceof module.PrVsixMonitorError &&
            error.message === 'PR VSIX monitor exceeded 30000 ms';
    } );
} );

QUnit.test( 'rejects incoherent monitor intervals', async function( assert )
{
    var module = await modulePromise;

    assert.throws( function()
    {
        module.requireMonitorOptions( {
            pollIntervalMs: 60000,
            heartbeatMs: 10000,
            timeoutMs: 120000
        } );
    }, function( error )
    {
        return error instanceof module.PrVsixMonitorError &&
            error.message.indexOf( 'monitor timing' ) !== -1;
    } );
} );
