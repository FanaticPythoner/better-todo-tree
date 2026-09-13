var fs = require( 'fs' );
var path = require( 'path' );
var helpers = require( './moduleHelpers.js' );
var upstreamCommit = require( './parity/upstreamGitLoader.js' ).UPSTREAM_COMMIT;

function createHarness()
{
    var calls = [];
    var state = { installStatus: 0 };
    var fixture = path.join( 'src', 'ci-bootstrap-fixture.js' );
    var loader = helpers.loadWithStubs( './parity/upstreamGitLoader.js', {
        fs: Object.assign( {}, fs, {
            existsSync: function() { return true; },
            readFileSync: function( filename, encoding )
            {
                if( filename.endsWith( fixture ) )
                {
                    calls.push( 'source' );
                    return 'module.exports = { loaded: true };';
                }
                if( filename.endsWith( '.upstream-build-hash' ) )
                {
                    calls.push( 'build-hash' );
                    return upstreamCommit;
                }
                return fs.readFileSync( filename, encoding );
            }
        } ),
        child_process: {
            spawnSync: function( executable, args, options )
            {
                if( executable === 'git' )
                {
                    if( args[ 0 ] === 'cat-file' ) { return { status: 0 }; }
                    if( args.join( ' ' ) === 'rev-parse HEAD' )
                    {
                        return { status: 0, stdout: upstreamCommit };
                    }
                    throw new Error( 'unexpected Git operation: ' + args.join( ' ' ) );
                }
                if( executable !== 'npm' || args.join( ' ' ) !== 'ci' )
                {
                    throw new Error( 'unexpected bootstrap command: ' + executable + ' ' + args.join( ' ' ) );
                }
                calls.push( { command: 'npm ci', cwd: options.cwd } );
                return { status: state.installStatus, error: state.installError };
            }
        }
    } );
    return { loader: loader, calls: calls, state: state, fixture: fixture };
}

QUnit.module( 'upstream dependency bootstrap' );

QUnit.test( 'source loading installs upstream dependencies once before execution', function( assert )
{
    var harness = createHarness();
    assert.deepEqual( harness.loader.loadModule( harness.fixture ), { loaded: true } );
    assert.deepEqual( harness.loader.loadModule( harness.fixture ), { loaded: true } );
    assert.equal( harness.loader.ensureUpstreamDependencies(), harness.loader.UPSTREAM_DIR );
    assert.deepEqual( harness.calls, [
        { command: 'npm ci', cwd: harness.loader.UPSTREAM_DIR }, 'source'
    ] );
} );

QUnit.test( 'a cached bundle still prepares its own dependencies before reuse', function( assert )
{
    var harness = createHarness();
    var expected = path.join( harness.loader.UPSTREAM_DIR, harness.loader.COMPILED_BUNDLE_RELATIVE );
    assert.equal( harness.loader.ensureUpstreamBuild(), expected );
    assert.equal( harness.loader.ensureUpstreamBuild(), expected );
    assert.deepEqual( harness.loader.loadModule( harness.fixture ), { loaded: true } );
    assert.deepEqual( harness.calls, [
        { command: 'npm ci', cwd: harness.loader.UPSTREAM_DIR }, 'build-hash', 'source'
    ] );
} );

[ 'exit', 'spawn' ].forEach( function( failure )
{
    QUnit.test( 'dependency ' + failure + ' failure prevents execution and permits retry', function( assert )
    {
        var harness = createHarness();
        harness.state.installStatus = 1;
        if( failure === 'spawn' ) { harness.state.installError = new Error( 'npm unavailable' ); }
        assert.throws( function() { harness.loader.loadModule( harness.fixture ); }, function( error )
        {
            return error.message.includes( failure === 'spawn' ? 'npm unavailable' : 'exited with status 1' );
        } );
        assert.deepEqual( harness.calls, [ { command: 'npm ci', cwd: harness.loader.UPSTREAM_DIR } ] );
        harness.state.installStatus = 0;
        harness.state.installError = undefined;
        assert.deepEqual( harness.loader.loadModule( harness.fixture ), { loaded: true } );
        assert.deepEqual( harness.calls, [
            { command: 'npm ci', cwd: harness.loader.UPSTREAM_DIR },
            { command: 'npm ci', cwd: harness.loader.UPSTREAM_DIR }, 'source'
        ] );
    } );
} );
