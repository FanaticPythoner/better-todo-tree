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
    var store;

    hooks.beforeEach( function()
    {
        store = searchResults.createStore();
    } );

    hooks.afterEach( function()
    {
        store.clear();
    } );

    QUnit.test( "replaceUriResults replaces a single document without touching others", function( assert )
    {
        store.replaceUriResults( createUri( "/tmp/one.js" ), [
            createResult( "/tmp/one.js", 1, 1, "TODO first" ),
            createResult( "/tmp/one.js", 2, 1, "FIXME second" )
        ] );
        store.replaceUriResults( createUri( "/tmp/two.js" ), [
            createResult( "/tmp/two.js", 10, 2, "TODO third" )
        ] );
        store.replaceUriResults( createUri( "/tmp/one.js" ), [
            createResult( "/tmp/one.js", 3, 1, "TODO replacement" )
        ] );

        var seen = {};
        store.forEachUriResults( function( uri, results )
        {
            seen[ uri.toString() ] = results.map( function( result ) { return result.match; } );
        } );

        assert.deepEqual( seen[ "/tmp/one.js" ], [ "TODO replacement" ] );
        assert.deepEqual( seen[ "/tmp/two.js" ], [ "TODO third" ] );
        assert.equal( store.count(), 2 );
    } );

    QUnit.test( "drainDirtyResults returns only changed documents", function( assert )
    {
        store.replaceUriResults( createUri( "/tmp/one.js" ), [
            createResult( "/tmp/one.js", 1, 1, "TODO first" )
        ] );
        store.replaceUriResults( createUri( "/tmp/two.js" ), [
            createResult( "/tmp/two.js", 2, 1, "FIXME second" )
        ] );
        store.drainDirtyResults();

        store.replaceUriResults( createUri( "/tmp/two.js" ), [
            createResult( "/tmp/two.js", 20, 4, "TODO changed" )
        ] );

        var dirtyEntries = store.drainDirtyResults();

        assert.equal( dirtyEntries.length, 1 );
        assert.equal( dirtyEntries[ 0 ].uri.toString(), "/tmp/two.js" );
        assert.deepEqual( dirtyEntries[ 0 ].results.map( function( result ) { return result.match; } ), [ "TODO changed" ] );
        assert.equal( store.drainDirtyResults().length, 0 );
    } );

    QUnit.test( "remove preserves markdown counting for remaining files", function( assert )
    {
        store.replaceUriResults( createUri( "/tmp/readme.md" ), [
            createResult( "/tmp/readme.md", 1, 1, "TODO docs" )
        ] );
        store.replaceUriResults( createUri( "/tmp/file.js" ), [
            createResult( "/tmp/file.js", 1, 1, "TODO code" )
        ] );

        assert.equal( store.containsMarkdown(), true );

        store.remove( createUri( "/tmp/readme.md" ) );

        assert.equal( store.containsMarkdown(), false );
        assert.equal( store.count(), 1 );
    } );

    QUnit.test( "replaceUriResults short-circuits unchanged ordered results", function( assert )
    {
        var uri = createUri( "/tmp/one.js" );
        var firstResults = [
            createResult( "/tmp/one.js", 1, 1, "TODO first" ),
            createResult( "/tmp/one.js", 2, 1, "FIXME second" )
        ];

        assert.equal( store.replaceUriResults( uri, firstResults ), true );
        store.drainDirtyResults();

        assert.equal( store.replaceUriResults( uri, firstResults ), false );
        assert.equal( store.drainDirtyResults().length, 0 );
    } );

    QUnit.test( "replaceUriResults treats text changes at the same identity as dirty", function( assert )
    {
        var uri = createUri( "/tmp/one.js" );
        var firstResults = [
            createResult( "/tmp/one.js", 1, 1, "TODO first" ),
            createResult( "/tmp/one.js", 2, 1, "FIXME second" )
        ];
        var secondResults = [
            createResult( "/tmp/one.js", 1, 1, "changed text but same identity" ),
            createResult( "/tmp/one.js", 2, 1, "other text same identity" )
        ];

        assert.equal( store.replaceUriResults( uri, firstResults ), true );
        store.drainDirtyResults();

        assert.equal( store.replaceUriResults( uri, secondResults ), true );
        assert.deepEqual(
            store.drainDirtyResults()[ 0 ].results.map( function( result ) { return result.match; } ),
            [ "changed text but same identity", "other text same identity" ]
        );
    } );

    QUnit.test( "filter updates entries in place without clearing untouched documents", function( assert )
    {
        var uriOne = createUri( "/tmp/one.js" );
        var uriTwo = createUri( "/tmp/two.js" );

        store.replaceUriResults( uriOne, [
            createResult( "/tmp/one.js", 1, 1, "TODO first" ),
            createResult( "/tmp/one.js", 2, 1, "FIXME second" )
        ] );
        store.replaceUriResults( uriTwo, [
            createResult( "/tmp/two.js", 3, 1, "TODO keep" )
        ] );
        store.drainDirtyResults();

        store.filter( function( result )
        {
            return result.line !== 2;
        } );

        var seen = {};
        store.forEachUriResults( function( uri, results )
        {
            seen[ uri.toString() ] = results.map( function( result ) { return result.line; } );
        } );

        assert.deepEqual( seen[ "/tmp/one.js" ], [ 1 ] );
        assert.deepEqual( seen[ "/tmp/two.js" ], [ 3 ] );
        assert.equal( store.count(), 2 );
    } );
} );
