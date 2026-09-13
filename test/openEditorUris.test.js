var collectOpenEditorUris = require( '../src/runtime/openEditorUris.js' ).collectOpenEditorUris;

QUnit.module( 'open editor membership' );

QUnit.test( 'text, notebook and diff tabs retain distinct document identities', function( assert )
{
    var groups = [
        { tabs: [ { input: { uri: 'file:/hidden.js' } }, { input: { uri: 'file:/book.ipynb' } } ] },
        { tabs: [ { input: { original: 'git:/left.js', modified: 'file:/right.js' } },
            { input: { uri: 'file:/hidden.js' } }, { input: {} } ] }
    ];
    assert.deepEqual( Array.from( collectOpenEditorUris( groups ) ),
        [ 'file:/hidden.js', 'file:/book.ipynb', 'git:/left.js', 'file:/right.js' ] );
    assert.equal( collectOpenEditorUris( [] ).size, 0 );
} );
