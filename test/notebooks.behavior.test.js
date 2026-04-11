var notebooks = require( '../src/notebooks.js' );
var matrixHelpers = require( './matrixHelpers.js' );

QUnit.module( 'behavioral notebooks' );

QUnit.test( 'registry resolves notebook owners from notebook cell documents', function( assert )
{
    var codeCell = matrixHelpers.createNotebookCellDocument( '/workspace/notebook.ipynb', 'code', '# TODO code', 'python' );
    var markdownCell = matrixHelpers.createNotebookCellDocument( '/workspace/notebook.ipynb', 'markdown', '- [ ] note', 'markdown' );
    var notebook = matrixHelpers.createNotebookDocument( '/workspace/notebook.ipynb', [ codeCell, markdownCell ] );
    var registry = notebooks.createRegistry();

    registry.remember( notebook );

    assert.equal( registry.getForDocument( codeCell ), notebook );
    assert.equal( registry.getForDocument( markdownCell ), notebook );
    assert.equal( registry.all().length, 1 );
} );

QUnit.test( 'scanDocument lifts cell results to notebook scope while preserving reveal targets', function( assert )
{
    var codeCell = matrixHelpers.createNotebookCellDocument( '/workspace/notebook.ipynb', 'code', '# TODO code', 'python' );
    var markdownCell = matrixHelpers.createNotebookCellDocument( '/workspace/notebook.ipynb', 'markdown', '- [ ] note', 'markdown' );
    var notebook = matrixHelpers.createNotebookDocument( '/workspace/notebook.ipynb', [ codeCell, markdownCell ] );
    var results = notebooks.scanDocument( notebook, {
        scanDocument: function( document )
        {
            if( document.uri.toString() === codeCell.uri.toString() )
            {
                return [ {
                    uri: codeCell.uri,
                    actualTag: 'TODO',
                    displayText: 'code',
                    continuationText: []
                } ];
            }

            return [ {
                uri: markdownCell.uri,
                actualTag: '[ ]',
                displayText: 'note',
                continuationText: []
            } ];
        }
    }, function()
    {
        return true;
    } );

    assert.deepEqual(
        results.map( function( result )
        {
            return [ result.uri.fsPath, result.revealUri.toString(), result.actualTag, result.displayText, result.sourceId.indexOf( 'notebook-cell:' ) === 0 ];
        } ),
        [
            [ '/workspace/notebook.ipynb', codeCell.uri.toString(), 'TODO', 'code', true ],
            [ '/workspace/notebook.ipynb', markdownCell.uri.toString(), '[ ]', 'note', true ]
        ]
    );
} );
