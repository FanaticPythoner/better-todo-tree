function uriKey( uri )
{
    return uri && uri.toString ? uri.toString() : String( uri );
}

function cacheKey( uri, version, signature, patternFileName )
{
    return [
        uriKey( uri ),
        version === undefined ? "" : String( version ),
        signature || "",
        patternFileName || ""
    ].join( '\u0000' );
}

function createDocumentScanCache()
{
    var entries = new Map();
    var keysByUri = new Map();
    var keysBySignature = new Map();

    function indexKey( index, key, value )
    {
        if( !index.has( key ) )
        {
            index.set( key, new Set() );
        }

        index.get( key ).add( value );
    }

    function removeIndexedKey( index, key, value )
    {
        if( !index.has( key ) )
        {
            return;
        }

        var bucket = index.get( key );
        bucket.delete( value );

        if( bucket.size === 0 )
        {
            index.delete( key );
        }
    }

    function removeEntry( key )
    {
        if( !entries.has( key ) )
        {
            return;
        }

        var entry = entries.get( key );
        entries.delete( key );
        removeIndexedKey( keysByUri, entry.uriKey, key );
        removeIndexedKey( keysBySignature, entry.signature, key );
    }

    function get( uri, version, signature, patternFileName )
    {
        var key = cacheKey( uri, version, signature, patternFileName );
        var entry = entries.get( key );
        return entry ? entry.results : undefined;
    }

    function set( uri, version, signature, patternFileName, results )
    {
        var key = cacheKey( uri, version, signature, patternFileName );
        var normalizedUriKey = uriKey( uri );

        removeEntry( key );
        entries.set( key, {
            key: key,
            uriKey: normalizedUriKey,
            signature: signature || "",
            results: results
        } );
        indexKey( keysByUri, normalizedUriKey, key );
        indexKey( keysBySignature, signature || "", key );
    }

    function deleteByUri( uri )
    {
        var normalizedUriKey = uriKey( uri );
        var keys = Array.from( keysByUri.get( normalizedUriKey ) || [] );
        keys.forEach( removeEntry );
    }

    function clearGeneration( signature )
    {
        var keys = Array.from( keysBySignature.get( signature || "" ) || [] );
        keys.forEach( removeEntry );
    }

    function clear()
    {
        entries = new Map();
        keysByUri = new Map();
        keysBySignature = new Map();
    }

    return {
        get: get,
        set: set,
        deleteByUri: deleteByUri,
        clearGeneration: clearGeneration,
        clear: clear
    };
}

module.exports.createDocumentScanCache = createDocumentScanCache;
