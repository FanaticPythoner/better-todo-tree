function isNotebookDocument( target )
{
    return target &&
        target.uri &&
        ( typeof ( target.getCells ) === 'function' || Array.isArray( target.cells ) );
}

function isNotebookCellDocument( document )
{
    return document && document.uri && document.uri.scheme === 'vscode-notebook-cell';
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

    function forgetByKey( notebookKey )
    {
        var notebook = notebooksByKey.get( notebookKey );
        var cellKeys = cellKeysByNotebookKey.get( notebookKey ) || new Set();

        cellKeys.forEach( function( cellKey )
        {
            notebookKeyByCellUri.delete( cellKey );
        } );

        cellKeysByNotebookKey.delete( notebookKey );
        notebooksByKey.delete( notebookKey );

        return {
            notebook: notebook,
            notebookKey: notebookKey,
            cellKeys: Array.from( cellKeys )
        };
    }

    function sync( notebookDocuments )
    {
        var existingNotebookKeys = new Set( notebooksByKey.keys() );
        var visibleNotebookKeys = new Set();
        var added = [];
        var forgotten = [];

        if( !Array.isArray( notebookDocuments ) )
        {
            notebookDocuments = [];
        }

        notebookDocuments.forEach( function( notebook )
        {
            if( !isNotebookDocument( notebook ) )
            {
                return;
            }

            var notebookKey = getNotebookKey( notebook );
            if( visibleNotebookKeys.has( notebookKey ) )
            {
                return;
            }

            visibleNotebookKeys.add( notebookKey );
            if( existingNotebookKeys.has( notebookKey ) !== true )
            {
                added.push( notebook );
            }
            remember( notebook );
        } );

        Array.from( notebooksByKey.keys() ).forEach( function( notebookKey )
        {
            if( visibleNotebookKeys.has( notebookKey ) !== true )
            {
                forgotten.push( forgetByKey( notebookKey ) );
            }
        } );

        return {
            added: added,
            forgotten: forgotten
        };
    }

    function getForDocument( document )
    {
        if( !document || !document.uri )
        {
            return undefined;
        }

        if( document.notebook && document.notebook.uri )
        {
            var notebookKeyFromDocument = getNotebookKey( document.notebook );

            if( notebooksByKey.has( notebookKeyFromDocument ) )
            {
                remember( document.notebook );
                return document.notebook;
            }

            return undefined;
        }

        if( isNotebookCellDocument( document ) !== true )
        {
            return undefined;
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
        return forgetByKey( getNotebookKey( notebook ) );
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
module.exports.isNotebookCellDocument = isNotebookCellDocument;
module.exports.getNotebookKey = getNotebookKey;
module.exports.getNotebookCells = getNotebookCells;
module.exports.createRegistry = createRegistry;
module.exports.scanDocument = scanDocument;
