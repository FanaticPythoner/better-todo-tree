var searchResults = require( '../src/searchResults.js' );

function createUri( fsPath )
{
    return {
        fsPath: fsPath,
        toString: function()
        {
            return fsPath;
        }
    };
}

function createResult( fsPath, line, column, match )
{
    return {
        uri: createUri( fsPath ),
        line: line,
        column: column,
        match: match
    };
}

QUnit.module( "searchResults indexed store", function( hooks )
{
    hooks.beforeEach( function()
    {
        searchResults.clear();
    } );

    hooks.afterEach( function()
    {
        searchResults.clear();
    } );

    QUnit.test( "replaceUriResults replaces a single document without touching others", function( assert )
    {
        searchResults.replaceUriResults( createUri( "/tmp/one.js" ), [
            createResult( "/tmp/one.js", 1, 1, "TODO first" ),
            createResult( "/tmp/one.js", 2, 1, "FIXME second" )
        ] );
        searchResults.replaceUriResults( createUri( "/tmp/two.js" ), [
            createResult( "/tmp/two.js", 10, 2, "TODO third" )
        ] );
        searchResults.replaceUriResults( createUri( "/tmp/one.js" ), [
            createResult( "/tmp/one.js", 3, 1, "TODO replacement" )
        ] );

        var seen = {};
        searchResults.forEachUriResults( function( uri, results )
        {
            seen[ uri.toString() ] = results.map( function( result ) { return result.match; } );
        } );

        assert.deepEqual( seen[ "/tmp/one.js" ], [ "TODO replacement" ] );
        assert.deepEqual( seen[ "/tmp/two.js" ], [ "TODO third" ] );
        assert.equal( searchResults.count(), 2 );
    } );

    QUnit.test( "drainDirtyResults returns only changed documents", function( assert )
    {
        searchResults.replaceUriResults( createUri( "/tmp/one.js" ), [
            createResult( "/tmp/one.js", 1, 1, "TODO first" )
        ] );
        searchResults.replaceUriResults( createUri( "/tmp/two.js" ), [
            createResult( "/tmp/two.js", 2, 1, "FIXME second" )
        ] );
        searchResults.drainDirtyResults();

        searchResults.replaceUriResults( createUri( "/tmp/two.js" ), [
            createResult( "/tmp/two.js", 20, 4, "TODO changed" )
        ] );

        var dirtyEntries = searchResults.drainDirtyResults();

        assert.equal( dirtyEntries.length, 1 );
        assert.equal( dirtyEntries[ 0 ].uri.toString(), "/tmp/two.js" );
        assert.deepEqual( dirtyEntries[ 0 ].results.map( function( result ) { return result.match; } ), [ "TODO changed" ] );
        assert.equal( searchResults.drainDirtyResults().length, 0 );
    } );

    QUnit.test( "remove preserves markdown counting for remaining files", function( assert )
    {
        searchResults.replaceUriResults( createUri( "/tmp/readme.md" ), [
            createResult( "/tmp/readme.md", 1, 1, "TODO docs" )
        ] );
        searchResults.replaceUriResults( createUri( "/tmp/file.js" ), [
            createResult( "/tmp/file.js", 1, 1, "TODO code" )
        ] );

        assert.equal( searchResults.containsMarkdown(), true );

        searchResults.remove( createUri( "/tmp/readme.md" ) );

        assert.equal( searchResults.containsMarkdown(), false );
        assert.equal( searchResults.count(), 1 );
    } );
} );
