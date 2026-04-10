var fs = require( 'fs' );
var path = require( 'path' );

QUnit.module( 'packaging ignore rules' );

QUnit.test( '.vscodeignore excludes local workflow tooling and release-only documents', function( assert )
{
    var contents = fs.readFileSync( path.join( __dirname, '..', '.vscodeignore' ), 'utf8' );

    [
        '.github/',
        'scripts/',
        'TODOS_LISTS/',
        '.tools/',
        '.act-artifacts/',
        'MIGRATION.md',
        'OPEN_VSX_CERTIFICATE_REPORT.md',
        'CHANGELOG.upstream.md'
    ].forEach( function( entry )
    {
        assert.ok( contents.indexOf( entry ) !== -1, '.vscodeignore excludes ' + entry );
    } );
} );
