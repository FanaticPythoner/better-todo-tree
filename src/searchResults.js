var path = require( 'path' );

function uriKey( uri )
{
    return uri && uri.toString ? uri.toString() : String( uri );
}

function uriFsPath( uri )
{
    if( uri && uri.fsPath !== undefined )
    {
        return uri.fsPath;
    }

    return uriKey( uri );
}

function resultIdentity( result )
{
    return [
        result.sourceId || "",
        result.line || 0,
        result.column || 0,
        result.endLine || result.line || 0,
        result.endColumn || result.column || 0,
        result.actualTag || result.tag || "",
        result.subTag || ""
    ].join( '\u0000' );
}

function resultSignature( result )
{
    return [
        resultIdentity( result ),
        result.tag || "",
        result.displayText || "",
        result.before || "",
        result.after || "",
        result.match || "",
        ( result.continuationText || [] ).join( '\n' ),
        result.revealUri ? uriKey( result.revealUri ) : "",
        result.uri ? uriKey( result.uri ) : ""
    ].join( '\u0001' );
}

function toResultArray( resultMap )
{
    return Array.from( resultMap.values() );
}

function cloneCounts( counts )
{
    return Object.assign( {}, counts );
}

function createEntry( uri )
{
    return {
        uri: uri,
        results: new Map()
    };
}

function hasSameOrderedResults( entry, results )
{
    if( entry.results.size !== results.length )
    {
        return false;
    }

    var existingResults = toResultArray( entry.results );

    return existingResults.every( function( existingResult, index )
    {
        return resultSignature( existingResult ) === resultSignature( results[ index ] );
    } );
}

function updateMarkdownCountForReplacement( markdownUriCount, entry, newResults )
{
    var entryFsPath = uriFsPath( entry.uri );
    var hadMarkdown = entry.results.size > 0 && path.extname( entryFsPath ) === '.md';
    var hasMarkdown = newResults.length > 0 && path.extname( entryFsPath ) === '.md';

    if( hadMarkdown && !hasMarkdown )
    {
        markdownUriCount.value--;
    }
    else if( !hadMarkdown && hasMarkdown )
    {
        markdownUriCount.value++;
    }
}

function createStore()
{
    var resultsByUri = new Map();
    var dirtyUris = new Map();
    var totalResultCount = 0;
    var markdownUriCount = { value: 0 };

    function getOrCreateEntry( uri )
    {
        var key = uriKey( uri );
        var entry = resultsByUri.get( key );
        if( entry === undefined )
        {
            entry = createEntry( uri );
            resultsByUri.set( key, entry );
        }
        return entry;
    }

    function markDirty( uri )
    {
        dirtyUris.set( uriKey( uri ), uri );
    }

    function clear()
    {
        resultsByUri = new Map();
        dirtyUris = new Map();
        totalResultCount = 0;
        markdownUriCount.value = 0;
    }

    function add( result )
    {
        var entry = getOrCreateEntry( result.uri );
        var key = resultIdentity( result );

        if( entry.results.has( key ) )
        {
            entry.results.set( key, result );
            markDirty( result.uri );
            return;
        }

        if( entry.results.size === 0 && path.extname( uriFsPath( result.uri ) ) === '.md' )
        {
            markdownUriCount.value++;
        }

        entry.results.set( key, result );
        totalResultCount++;
        markDirty( result.uri );
    }

    function replaceUriResults( uri, results )
    {
        var key = uriKey( uri );
        var entry = resultsByUri.get( key );

        if( entry !== undefined && hasSameOrderedResults( entry, results ) )
        {
            return false;
        }

        entry = getOrCreateEntry( uri );
        updateMarkdownCountForReplacement( markdownUriCount, entry, results );

        totalResultCount -= entry.results.size;
        entry.results = new Map();

        results.forEach( function( result )
        {
            entry.results.set( resultIdentity( result ), result );
        } );

        totalResultCount += entry.results.size;

        if( entry.results.size === 0 )
        {
            resultsByUri.delete( key );
        }

        markDirty( uri );
        return true;
    }

    function remove( uri )
    {
        var key = uriKey( uri );
        var entry = resultsByUri.get( key );
        if( entry === undefined )
        {
            return false;
        }

        totalResultCount -= entry.results.size;
        if( entry.results.size > 0 && path.extname( uriFsPath( entry.uri ) ) === '.md' )
        {
            markdownUriCount.value--;
        }

        resultsByUri.delete( key );
        dirtyUris.set( key, entry.uri );
        return true;
    }

    function drainDirtyResults()
    {
        var dirtyEntries = [];

        dirtyUris.forEach( function( uri, key )
        {
            var entry = resultsByUri.get( key );
            dirtyEntries.push( {
                uri: entry ? entry.uri : uri,
                uriKey: key,
                results: entry ? toResultArray( entry.results ) : []
            } );
        } );

        dirtyUris.clear();

        return dirtyEntries;
    }

    function containsMarkdown()
    {
        return markdownUriCount.value > 0;
    }

    function count()
    {
        return totalResultCount;
    }

    function forEachResult( iterator )
    {
        resultsByUri.forEach( function( entry )
        {
            entry.results.forEach( function( result )
            {
                iterator( result );
            } );
        } );
    }

    function forEachUriResults( iterator )
    {
        resultsByUri.forEach( function( entry )
        {
            iterator( entry.uri, toResultArray( entry.results ) );
        } );
    }

    function markAsNotAdded()
    {
        resultsByUri.forEach( function( entry )
        {
            if( entry.results.size > 0 )
            {
                markDirty( entry.uri );
            }
        } );
    }

    function filter( filterFunction )
    {
        resultsByUri.forEach( function( entry, key )
        {
            var filteredResults = toResultArray( entry.results ).filter( filterFunction );

            if( filteredResults.length === 0 )
            {
                remove( entry.uri );
                return;
            }

            updateMarkdownCountForReplacement( markdownUriCount, entry, filteredResults );
            totalResultCount -= entry.results.size;
            entry.results = new Map();
            filteredResults.forEach( function( result )
            {
                entry.results.set( resultIdentity( result ), result );
            } );
            totalResultCount += entry.results.size;
            markDirty( entry.uri );

            if( entry.results.size === 0 )
            {
                resultsByUri.delete( key );
            }
        } );
    }

    return {
        clear: clear,
        add: add,
        replaceUriResults: replaceUriResults,
        remove: remove,
        drainDirtyResults: drainDirtyResults,
        containsMarkdown: containsMarkdown,
        count: count,
        forEachResult: forEachResult,
        forEachUriResults: forEachUriResults,
        markAsNotAdded: markAsNotAdded,
        filter: filter
    };
}

var defaultStore = createStore();

module.exports.createStore = createStore;
module.exports.clear = function() { return defaultStore.clear.apply( defaultStore, arguments ); };
module.exports.add = function() { return defaultStore.add.apply( defaultStore, arguments ); };
module.exports.replaceUriResults = function() { return defaultStore.replaceUriResults.apply( defaultStore, arguments ); };
module.exports.remove = function() { return defaultStore.remove.apply( defaultStore, arguments ); };
module.exports.drainDirtyResults = function() { return defaultStore.drainDirtyResults.apply( defaultStore, arguments ); };
module.exports.containsMarkdown = function() { return defaultStore.containsMarkdown.apply( defaultStore, arguments ); };
module.exports.count = function() { return defaultStore.count.apply( defaultStore, arguments ); };
module.exports.forEachResult = function() { return defaultStore.forEachResult.apply( defaultStore, arguments ); };
module.exports.forEachUriResults = function() { return defaultStore.forEachUriResults.apply( defaultStore, arguments ); };
module.exports.markAsNotAdded = function() { return defaultStore.markAsNotAdded.apply( defaultStore, arguments ); };
module.exports.filter = function() { return defaultStore.filter.apply( defaultStore, arguments ); };
