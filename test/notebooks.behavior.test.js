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

QUnit.test( 'registry sync replaces notebook membership and reports added and forgotten notebooks', function( assert )
{
    var firstCodeCell = matrixHelpers.createNotebookCellDocument( '/workspace/first.ipynb', 'code', '# TODO first', 'python' );
    var secondCodeCell = matrixHelpers.createNotebookCellDocument( '/workspace/second.ipynb', 'code', '# TODO second', 'python' );
    var firstNotebook = matrixHelpers.createNotebookDocument( '/workspace/first.ipynb', [ firstCodeCell ] );
    var secondNotebook = matrixHelpers.createNotebookDocument( '/workspace/second.ipynb', [ secondCodeCell ] );
    var registry = notebooks.createRegistry();
    var firstSync = registry.sync( [ firstNotebook ] );

    assert.deepEqual( firstSync.added, [ firstNotebook ] );
    assert.deepEqual( firstSync.forgotten, [] );
    assert.equal( registry.getForDocument( firstCodeCell ), firstNotebook );

    var secondSync = registry.sync( [ secondNotebook ] );

    assert.equal( secondSync.added.length, 1 );
    assert.equal( secondSync.added[ 0 ], secondNotebook );
    assert.equal( secondSync.forgotten.length, 1 );
    assert.equal( secondSync.forgotten[ 0 ].notebook, firstNotebook );
    assert.equal( registry.getForDocument( firstCodeCell ), undefined );
    assert.equal( registry.getForDocument( secondCodeCell ), secondNotebook );
    assert.equal( registry.all().length, 1 );
} );

QUnit.test( 'registry only resolves notebook-cell owners after the notebook is tracked', function( assert )
{
    var codeCell = matrixHelpers.createNotebookCellDocument( '/workspace/notebook.ipynb', 'code', '# TODO code', 'python' );
    var notebook = matrixHelpers.createNotebookDocument( '/workspace/notebook.ipynb', [ codeCell ] );
    var registry = notebooks.createRegistry();

    assert.equal( registry.getForDocument( codeCell ), undefined );

    registry.sync( [ notebook ] );

    assert.equal( registry.getForDocument( codeCell ), notebook );

    registry.sync( [] );

    assert.equal( registry.getForDocument( codeCell ), undefined );
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
