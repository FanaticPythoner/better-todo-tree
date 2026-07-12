var path = require( 'path' );
var pathToFileURL = require( 'url' ).pathToFileURL;

var verifierPromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'verify-pr-vsix.mjs' )
).href );
var targets = require( '../scripts/release/targets.json' );

function messageContains( fragment )
{
    return function( error )
    {
        return error && error.message.indexOf( fragment ) !== -1;
    };
}

QUnit.module( 'PR VSIX preview verification' );

QUnit.test( 'canonical targets resolve to seven unique native binaries', async function( assert )
{
    var verifier = await verifierPromise;
    var expected = [
        'extension/dist/ripgrep/darwin-arm64/rg',
        'extension/dist/ripgrep/darwin-x64/rg',
        'extension/dist/ripgrep/linux-arm/rg',
        'extension/dist/ripgrep/linux-arm64/rg',
        'extension/dist/ripgrep/linux-x64/rg',
        'extension/dist/ripgrep/win32-arm64/rg.exe',
        'extension/dist/ripgrep/win32-x64/rg.exe'
    ];

    assert.equal( targets.length, 10 );
    assert.deepEqual( verifier.expectedRipgrepEntries( targets ), expected );
    verifier.verifyTargetMap( targets );
} );

QUnit.test( 'entry verifier accepts only the exact native executable set and metadata', async function( assert )
{
    var verifier = await verifierPromise;
    var entries = verifier.expectedRipgrepEntries( targets ).concat( [
        'extension/dist/ripgrep/LICENSE',
        'extension/dist/ripgrep/README.md',
        'extension/dist/ripgrep/manifest.json'
    ] );

    assert.deepEqual( verifier.verifyEntrySet( entries, targets ), verifier.expectedRipgrepEntries( targets ) );
    assert.throws( function()
    {
        verifier.verifyEntrySet( entries.slice( 1 ), targets );
    }, messageContains( 'ripgrep entries mismatch' ) );
    assert.throws( function()
    {
        verifier.verifyEntrySet( entries.concat( entries[ 0 ] ), targets );
    }, messageContains( 'duplicate ripgrep executable entries' ) );
    assert.throws( function()
    {
        verifier.verifyEntrySet( entries.filter( function( entry )
        {
            return entry !== 'extension/dist/ripgrep/LICENSE';
        } ), targets );
    }, messageContains( 'missing extension/dist/ripgrep/LICENSE' ) );
} );

QUnit.test( 'target map verifier rejects order and membership drift', async function( assert )
{
    var verifier = await verifierPromise;

    assert.throws( function()
    {
        verifier.verifyTargetMap( targets.slice().reverse() );
    }, messageContains( 'must match targets.json order and membership' ) );
    assert.throws( function()
    {
        verifier.expectedRipgrepEntries( targets.concat( 'unknown-target' ) );
    }, messageContains( 'Unsupported ripgrep target' ) );
} );

QUnit.test( 'executable mode verifier requires Unix execute bits', async function( assert )
{
    var verifier = await verifierPromise;
    var entry = 'extension/dist/ripgrep/linux-x64/rg';

    verifier.verifyExecutableModes( [ '-rwxr-xr-x  6.3 unx 1 b- 1 defN 00-Jan-01 00:00 ' + entry ], [ entry ] );
    assert.throws( function()
    {
        verifier.verifyExecutableModes( [ '-rw-r--r--  6.3 unx 1 b- 1 defN 00-Jan-01 00:00 ' + entry ], [ entry ] );
    }, messageContains( 'executable mode mismatch' ) );
} );
