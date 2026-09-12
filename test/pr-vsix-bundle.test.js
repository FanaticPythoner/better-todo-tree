var path = require( 'path' );
var pathToFileURL = require( 'url' ).pathToFileURL;

var verifierPromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'verify-pr-vsix.mjs' )
).href );
var packageMetadata = require( '../package.json' );
var targets = require( '../scripts/release/targets.json' );

function messageContains( fragment )
{
    return function( error )
    {
        return error && error.message.indexOf( fragment ) !== -1;
    };
}

function metadataEntries()
{
    return [
        'extension/dist/ripgrep/LICENSE',
        'extension/dist/ripgrep/README.md',
        'extension/dist/ripgrep/manifest.json'
    ];
}

QUnit.module( 'PR VSIX platform bundle verification' );

QUnit.test( 'bundle filenames cover the complete canonical target matrix', async function( assert )
{
    var verifier = await verifierPromise;
    var expected = targets.map( function( target )
    {
        return packageMetadata.name + '-' + packageMetadata.version + '-' + target + '.vsix';
    } ).sort();

    assert.equal( targets.length, 9 );
    assert.deepEqual( verifier.expectedBundleFileNames( packageMetadata, targets ), expected );
    verifier.verifyTargetMap( targets );
} );

QUnit.test( 'native targets contain one matching executable and metadata set', async function( assert )
{
    var verifier = await verifierPromise;
    var expected = [ 'extension/dist/ripgrep/linux-x64/rg' ];
    var entries = expected.concat( metadataEntries() );

    assert.deepEqual( verifier.expectedRipgrepEntries( 'linux-x64' ), expected );
    assert.deepEqual( verifier.verifyEntrySet( entries, 'linux-x64' ), expected );
    assert.throws( function()
    {
        verifier.verifyEntrySet( entries.concat( 'extension/dist/ripgrep/win32-x64/rg.exe' ), 'linux-x64' );
    }, messageContains( 'ripgrep entries mismatch' ) );
    assert.throws( function()
    {
        verifier.verifyEntrySet( entries.slice( 0, -1 ), 'linux-x64' );
    }, messageContains( 'metadata entries mismatch' ) );
} );

QUnit.test( 'every published target requires one native executable and metadata set', async function( assert )
{
    var verifier = await verifierPromise;

    targets.forEach( function( target )
    {
        var expected = verifier.expectedRipgrepEntries( target );

        assert.equal( expected.length, 1, target + ' has one executable' );
        assert.deepEqual( verifier.verifyEntrySet( expected.concat( metadataEntries() ), target ), expected );
    } );

    assert.notOk( targets.includes( 'web' ) );
    assert.throws( function()
    {
        verifier.expectedRipgrepEntries( 'web' );
    }, messageContains( 'Unsupported VSIX target' ) );
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
        verifier.expectedRipgrepEntries( 'unknown-target' );
    }, messageContains( 'Unsupported VSIX target' ) );
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

QUnit.test( 'bundle verifier reports unreadable paths through its typed boundary', async function( assert )
{
    var verifier = await verifierPromise;

    assert.throws( function()
    {
        verifier.verifyPrVsixBundle( 'artifacts/vsix/missing-platform-bundle', packageMetadata, targets );
    }, function( error )
    {
        return error instanceof verifier.PrVsixVerificationError &&
            error.message === 'PR VSIX bundle: path is not readable';
    } );
} );
