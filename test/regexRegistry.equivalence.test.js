var childProcess = require( 'child_process' );
var path = require( 'path' );

var REPO_ROOT = path.resolve( __dirname, '..' );
var AUDIT_SCRIPT = [
    'var harness = require( "./scripts/evidence/regexRegistryEquivalenceHarness.js" );',
    'process.stdout.write( JSON.stringify( harness.runEquivalenceAudit() ) );'
].join( '' );

function createAuditChildError( result )
{
    var stderr = String( result.stderr || '' ).trim();

    if( result.error )
    {
        return new Error( 'equivalence audit spawn failed: ' + result.error.message );
    }

    if( result.signal )
    {
        return new Error( 'equivalence audit terminated by signal ' + result.signal + ': ' + stderr );
    }

    if( result.status !== 0 )
    {
        return new Error( 'equivalence audit exited with status ' + result.status + ': ' + stderr );
    }

    return null;
}

function parseAuditResult( result )
{
    var error = createAuditChildError( result );

    if( error !== null )
    {
        throw error;
    }

    try
    {
        return JSON.parse( result.stdout );
    }
    catch( parseError )
    {
        throw new Error( 'equivalence audit emitted invalid JSON: ' + parseError.message );
    }
}

function runAuditChild()
{
    return parseAuditResult( childProcess.spawnSync( process.execPath, [ '-e', AUDIT_SCRIPT ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    } ) );
}

function captureError( fn )
{
    try
    {
        fn();
    }
    catch( error )
    {
        return error;
    }

    return null;
}

QUnit.module( 'regex registry equivalence' );

QUnit.test( 'child process errors stop before JSON parsing', function( assert )
{
    var error = captureError( function()
    {
        parseAuditResult( {
            error: null,
            status: 1,
            signal: null,
            stderr: 'baseline regex entries missing: origin/master',
            stdout: ''
        } );
    } );

    assert.ok( error instanceof Error );
    assert.equal(
        error.message,
        'equivalence audit exited with status 1: baseline regex entries missing: origin/master'
    );
} );

QUnit.test( 'invalid child JSON reports the output contract failure', function( assert )
{
    var error = captureError( function()
    {
        parseAuditResult( {
            error: null,
            status: 0,
            signal: null,
            stderr: '',
            stdout: ''
        } );
    } );

    assert.ok( error instanceof Error );
    assert.equal(
        error.message.indexOf( 'equivalence audit emitted invalid JSON:' ),
        0
    );
} );

QUnit.test( 'registry refactor preserves extracted baseline regex behavior', function( assert )
{
    var audit = runAuditChild();

    assert.equal( audit.currentHardcodedRegexEntries.length, 0 );
    assert.equal( audit.sourceCoverage.missing.length, 0 );
    assert.equal( audit.behaviorParity.failures.length, 0 );
    assert.ok( audit.metrics.baselineRegexEntries > 0 );
    assert.equal( audit.metrics.behaviorParityPassed, audit.metrics.behaviorParityTotal );
} );
