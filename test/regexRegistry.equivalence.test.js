var childProcess = require( 'child_process' );
var path = require( 'path' );

QUnit.module( 'regex registry equivalence' );

QUnit.test( 'registry refactor preserves extracted baseline regex behavior', function( assert )
{
    var repoRoot = path.resolve( __dirname, '..' );
    var result = childProcess.spawnSync( process.execPath, [
        '-e',
        [
            'var harness = require( "./scripts/evidence/regexRegistryEquivalenceHarness.js" );',
            'process.stdout.write( JSON.stringify( harness.runEquivalenceAudit( { baselineRef: "HEAD" } ) ) );'
        ].join( '' )
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    } );
    var audit;

    assert.equal( result.status, 0, result.stderr );
    audit = JSON.parse( result.stdout );

    assert.equal( audit.currentHardcodedRegexEntries.length, 0 );
    assert.equal( audit.sourceCoverage.missing.length, 0 );
    assert.equal( audit.behaviorParity.failures.length, 0 );
    assert.ok( audit.metrics.baselineRegexEntries > 0 );
    assert.equal( audit.metrics.behaviorParityPassed, audit.metrics.behaviorParityTotal );
} );
