var path = require( 'path' );
var pathToFileURL = require( 'url' ).pathToFileURL;

var modulePromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'pr-vsix-progress.mjs' )
).href );

QUnit.module( 'PR VSIX workflow progress' );

QUnit.test( 'derives the current stage from real job steps', async function( assert )
{
    var module = await modulePromise;
    var progress = module.workflowProgress( [ {
        name: 'Build | verify',
        status: 'in_progress',
        conclusion: null,
        steps: [
            { name: 'Test', status: 'completed', conclusion: 'success' },
            { name: 'Bundle', status: 'in_progress', conclusion: null },
            { name: 'Package', status: 'queued', conclusion: null }
        ]
    } ] );

    assert.equal( progress.stage, 'Build \\| verify: Bundle' );
    assert.deepEqual( progress.rows.map( function( row ) { return row.state; } ), [
        'PASS', 'RUNNING', 'WAITING'
    ] );
    assert.equal( module.renderProgressTable( progress ), [
        '| Gate | State |',
        '| --- | --- |',
        '| Build \\| verify: Test | **PASS** |',
        '| Build \\| verify: Bundle | **RUNNING** |',
        '| Build \\| verify: Package | **WAITING** |'
    ].join( '\n' ) );
} );

QUnit.test( 'prioritizes terminal failure over remaining work', async function( assert )
{
    var module = await modulePromise;
    var progress = module.workflowProgress( [
        { name: 'Tests', status: 'completed', conclusion: 'failure', steps: [] },
        { name: 'Package', status: 'queued', conclusion: null, steps: [] }
    ] );

    assert.equal( progress.stage, 'Tests' );
    assert.deepEqual( progress.rows, [
        { name: 'Tests', state: 'FAIL' },
        { name: 'Package', state: 'WAITING' }
    ] );
} );

QUnit.test( 'renders explicit runner wait before jobs exist', async function( assert )
{
    var module = await modulePromise;
    var progress = module.workflowProgress( [] );

    assert.equal( progress.stage, 'Waiting for GitHub Actions runner' );
    assert.ok( module.renderProgressTable( progress ).indexOf( 'GitHub Actions runner | **WAITING**' ) !== -1 );
} );

QUnit.test( 'surfaces runner startup failure as the current stage', async function( assert )
{
    var module = await modulePromise;
    var progress = module.workflowProgress( [ {
        name: 'Build',
        status: 'completed',
        conclusion: 'startup_failure',
        steps: []
    } ] );

    assert.equal( progress.stage, 'Build' );
    assert.equal( progress.rows[ 0 ].state, 'STARTUP FAILURE' );
} );

QUnit.test( 'rejects malformed job metadata', async function( assert )
{
    var module = await modulePromise;

    assert.throws( function() { module.workflowProgress( null ); }, function( error )
    {
        return error instanceof module.PrVsixProgressError &&
            error.message.indexOf( 'expected an array' ) !== -1;
    } );
    assert.throws( function() { module.workflowProgress( [ { name: '' } ] ); }, function( error )
    {
        return error instanceof module.PrVsixProgressError &&
            error.message.indexOf( 'workflow job name' ) !== -1;
    } );
} );
