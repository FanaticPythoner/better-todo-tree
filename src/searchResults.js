var path = require( 'path' );

var resultsByUri = new Map();
var dirtyUris = new Map();
var totalResultCount = 0;
var markdownUriCount = 0;

function uriKey( uri )
{
    return uri.toString ? uri.toString() : String( uri );
}

function uriFsPath( uri )
{
    if( uri && uri.fsPath !== undefined )
    {
        return uri.fsPath;
    }

    return uriKey( uri );
}

function matchKey( result )
{
    return result.line + ":" + result.column + ":" + result.match;
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

function updateMarkdownCountForReplacement( entry, newResults )
{
    var entryFsPath = uriFsPath( entry.uri );
    var hadMarkdown = entry.results.size > 0 && path.extname( entryFsPath ) === '.md';
    var hasMarkdown = newResults.length > 0 && path.extname( entryFsPath ) === '.md';

    if( hadMarkdown && !hasMarkdown )
    {
        markdownUriCount--;
    }
    else if( !hadMarkdown && hasMarkdown )
    {
        markdownUriCount++;
    }
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
    markdownUriCount = 0;
}

function add( result )
{
    var entry = getOrCreateEntry( result.uri );
    var key = matchKey( result );

    if( entry.results.has( key ) )
    {
        entry.results.set( key, result );
        markDirty( result.uri );
        return;
    }

    if( entry.results.size === 0 && path.extname( uriFsPath( result.uri ) ) === '.md' )
    {
        markdownUriCount++;
    }

    entry.results.set( key, result );
    totalResultCount++;
    markDirty( result.uri );
}

function replaceUriResults( uri, results )
{
    var entry = getOrCreateEntry( uri );
    updateMarkdownCountForReplacement( entry, results );

    totalResultCount -= entry.results.size;
    entry.results = new Map();

    results.forEach( function( result )
    {
        entry.results.set( matchKey( result ), result );
    } );

    totalResultCount += entry.results.size;

    if( entry.results.size === 0 )
    {
        resultsByUri.delete( uriKey( uri ) );
    }

    markDirty( uri );
}

function remove( uri )
{
    var key = uriKey( uri );
    var entry = resultsByUri.get( key );
    if( entry === undefined )
    {
        return;
    }

    totalResultCount -= entry.results.size;
    if( entry.results.size > 0 && path.extname( uriFsPath( entry.uri ) ) === '.md' )
    {
        markdownUriCount--;
    }

    resultsByUri.delete( key );
    dirtyUris.set( key, entry.uri );
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
    return markdownUriCount > 0;
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
    var filteredResults = [];

    forEachResult( function( result )
    {
        if( filterFunction( result ) )
        {
            filteredResults.push( result );
        }
    } );

    clear();
    filteredResults.forEach( add );
}

module.exports.clear = clear;
module.exports.add = add;
module.exports.replaceUriResults = replaceUriResults;
module.exports.remove = remove;
module.exports.drainDirtyResults = drainDirtyResults;
module.exports.containsMarkdown = containsMarkdown;
module.exports.count = count;
module.exports.forEachResult = forEachResult;
module.exports.forEachUriResults = forEachUriResults;
module.exports.markAsNotAdded = markAsNotAdded;
module.exports.filter = filter;
