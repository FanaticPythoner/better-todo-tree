var fs = require( 'fs' );
var path = require( 'path' );
var regexRegistry = require( '../src/regexRegistry.js' );

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
        'CHANGELOG.upstream.md',
        'Better.TODO.Tree.settings.txt'
    ].forEach( function( entry )
    {
        assert.ok( contents.indexOf( entry ) !== -1, '.vscodeignore excludes ' + entry );
    } );
} );

QUnit.test( '.npmignore excludes local workflow tooling and keeps dist package runtime', function( assert )
{
    var contents = fs.readFileSync( path.join( __dirname, '..', '.npmignore' ), 'utf8' );
    var lines = contents.split( regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' ) ).map( function( line ) { return line.trim(); } );

    [
        '.github/',
        'scripts/',
        'src/',
        'test/',
        'artifacts/',
        'TODOS_LISTS/',
        '.tools/',
        '.act-artifacts/',
        'webpack.config.js',
        'buildCodiconNames.js',
        'Better.TODO.Tree.settings.txt'
    ].forEach( function( entry )
    {
        assert.ok( contents.indexOf( entry ) !== -1, '.npmignore excludes ' + entry );
    } );

    assert.equal( lines.indexOf( 'dist/' ), -1, '.npmignore keeps the bundled runtime directory' );
    assert.ok( lines.indexOf( 'dist/extension.js.map' ) !== -1, '.npmignore excludes source map output' );
} );
