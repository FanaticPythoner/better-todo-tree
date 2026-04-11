function isNotebookDocument( target )
{
    return target &&
        target.uri &&
        ( typeof ( target.getCells ) === 'function' || Array.isArray( target.cells ) );
}

function getNotebookKey( notebook )
{
    return notebook && notebook.uri ? notebook.uri.toString() : "";
}

function getNotebookCells( notebook )
{
    if( !isNotebookDocument( notebook ) )
    {
        return [];
    }

    if( typeof ( notebook.getCells ) === 'function' )
    {
        return notebook.getCells();
    }

    return Array.isArray( notebook.cells ) ? notebook.cells.slice() : [];
}

function createRegistry()
{
    var notebooksByKey = new Map();
    var notebookKeyByCellUri = new Map();
    var cellKeysByNotebookKey = new Map();

    function remember( notebook )
    {
        if( !isNotebookDocument( notebook ) )
        {
            return;
        }

        var notebookKey = getNotebookKey( notebook );
        var existingCellKeys = cellKeysByNotebookKey.get( notebookKey );

        if( existingCellKeys )
        {
            existingCellKeys.forEach( function( cellKey )
            {
                notebookKeyByCellUri.delete( cellKey );
            } );
        }

        var cellKeys = new Set();

        getNotebookCells( notebook ).forEach( function( cell )
        {
            if( cell && cell.document && cell.document.uri )
            {
                var cellKey = cell.document.uri.toString();
                cellKeys.add( cellKey );
                notebookKeyByCellUri.set( cellKey, notebookKey );
            }
        } );

        cellKeysByNotebookKey.set( notebookKey, cellKeys );
        notebooksByKey.set( notebookKey, notebook );
    }

    function sync( notebookDocuments )
    {
        if( !Array.isArray( notebookDocuments ) )
        {
            return;
        }

        notebookDocuments.forEach( remember );
    }

    function getForDocument( document )
    {
        if( !document || !document.uri )
        {
            return undefined;
        }

        if( document.notebook && document.notebook.uri )
        {
            remember( document.notebook );
            return document.notebook;
        }

        var notebookKey = notebookKeyByCellUri.get( document.uri.toString() );
        return notebookKey !== undefined ? notebooksByKey.get( notebookKey ) : undefined;
    }

    function isCellDocument( document )
    {
        return getForDocument( document ) !== undefined;
    }

    function forget( notebook )
    {
        var notebookKey = getNotebookKey( notebook );
        var cellKeys = cellKeysByNotebookKey.get( notebookKey ) || new Set();

        cellKeys.forEach( function( cellKey )
        {
            notebookKeyByCellUri.delete( cellKey );
        } );

        cellKeysByNotebookKey.delete( notebookKey );
        notebooksByKey.delete( notebookKey );

        return {
            notebookKey: notebookKey,
            cellKeys: Array.from( cellKeys )
        };
    }

    function all()
    {
        return Array.from( notebooksByKey.values() );
    }

    function getByKey( notebookKey )
    {
        return notebooksByKey.get( notebookKey );
    }

    return {
        remember: remember,
        sync: sync,
        getForDocument: getForDocument,
        isCellDocument: isCellDocument,
        forget: forget,
        all: all,
        getByKey: getByKey
    };
}

function createNotebookResult( notebook, cell, cellIndex, result )
{
    return Object.assign( {}, result, {
        uri: notebook.uri,
        revealUri: cell.document.uri,
        sourceId: 'notebook-cell:' + cellIndex + ':' + cell.document.uri.toString()
    } );
}

function createCellDocumentForDetection( document, commentPatternFileName )
{
    if( commentPatternFileName === undefined || commentPatternFileName === document.commentPatternFileName )
    {
        return document;
    }

    return Object.assign( {}, document, {
        commentPatternFileName: commentPatternFileName
    } );
}

function scanDocument( notebook, detection, isCellUriScannable, resolveCommentPatternFileName )
{
    return getNotebookCells( notebook ).reduce( function( results, cell, cellIndex )
    {
        if( !cell || !cell.document || typeof ( isCellUriScannable ) === 'function' && isCellUriScannable( cell.document.uri ) !== true )
        {
            return results;
        }

        var documentForDetection = createCellDocumentForDetection(
            cell.document,
            typeof ( resolveCommentPatternFileName ) === 'function' ? resolveCommentPatternFileName( cell.document ) : undefined
        );

        detection.scanDocument( documentForDetection ).forEach( function( result )
        {
            results.push( createNotebookResult( notebook, cell, cellIndex, result ) );
        } );

        return results;
    }, [] );
}

module.exports.isNotebookDocument = isNotebookDocument;
module.exports.getNotebookKey = getNotebookKey;
module.exports.getNotebookCells = getNotebookCells;
module.exports.createRegistry = createRegistry;
module.exports.scanDocument = scanDocument;
