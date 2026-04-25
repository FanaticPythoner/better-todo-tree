var fs = require( 'fs' );
var bufferConstants = require( 'buffer' ).constants;

var DEFAULT_MAX_INMEMORY_SCAN_BYTES = bufferConstants.MAX_STRING_LENGTH;
var DEFAULT_STREAM_CHUNK_BYTES = 64 * 1024 * 1024;
var DEFAULT_STREAM_OVERLAP_BYTES = 1 * 1024 * 1024;

var STREAM_RESULT_OFFSET_FIELDS = [
    'commentStartOffset',
    'commentEndOffset',
    'matchStartOffset',
    'matchEndOffset',
    'tagStartOffset',
    'tagEndOffset',
    'subTagStartOffset',
    'subTagEndOffset'
];

function countNewlines( text )
{
    var count = 0;
    var length = text.length;

    for( var index = 0; index < length; index++ )
    {
        if( text.charCodeAt( index ) === 10 )
        {
            count++;
        }
    }

    return count;
}

function resolveOptions( options )
{
    options = options || {};

    var fsImpl = options.fs !== undefined ? options.fs : fs;
    var chunkBytes = options.chunkBytes !== undefined ? options.chunkBytes : DEFAULT_STREAM_CHUNK_BYTES;
    var overlapBytes = options.overlapBytes !== undefined ? options.overlapBytes : DEFAULT_STREAM_OVERLAP_BYTES;
    var maxInMemoryBytes = options.maxInMemoryBytes !== undefined ? options.maxInMemoryBytes : DEFAULT_MAX_INMEMORY_SCAN_BYTES;
    var hardCutBytes = options.hardCutBytes !== undefined ? options.hardCutBytes : ( chunkBytes * 2 );

    if( typeof ( fsImpl.createReadStream ) !== 'function' )
    {
        throw new Error( 'streamScanner: options.fs.createReadStream is required for streamed scans.' );
    }
    if( typeof ( fsImpl.stat ) !== 'function' )
    {
        throw new Error( 'streamScanner: options.fs.stat is required for streamed scans.' );
    }
    if( typeof ( fsImpl.readFile ) !== 'function' )
    {
        throw new Error( 'streamScanner: options.fs.readFile is required for streamed scans.' );
    }
    if( !( chunkBytes > 0 ) )
    {
        throw new Error( 'streamScanner: chunkBytes must be a positive integer (got ' + chunkBytes + ').' );
    }
    if( !( overlapBytes >= 0 ) || overlapBytes >= chunkBytes )
    {
        throw new Error( 'streamScanner: overlapBytes must satisfy 0 <= overlap < chunkBytes (got chunk=' + chunkBytes + ', overlap=' + overlapBytes + ').' );
    }
    if( !( maxInMemoryBytes >= 0 ) )
    {
        throw new Error( 'streamScanner: maxInMemoryBytes must be a non-negative integer (got ' + maxInMemoryBytes + ').' );
    }

    return {
        fs: fsImpl,
        chunkBytes: chunkBytes,
        overlapBytes: overlapBytes,
        maxInMemoryBytes: maxInMemoryBytes,
        hardCutBytes: hardCutBytes
    };
}

function inspectWorkspaceFile( filePath, options )
{
    var resolved = resolveOptions( options );
    var fsImpl = resolved.fs;

    return new Promise( function( resolve, reject )
    {
        fsImpl.stat( filePath, function( statError, stats )
        {
            if( statError )
            {
                reject( statError );
                return;
            }

            if( !stats || typeof stats.size !== 'number' )
            {
                reject( new Error( 'streamScanner: fs.stat returned no size for ' + filePath ) );
                return;
            }

            resolve( {
                stats: stats,
                maxInMemoryBytes: resolved.maxInMemoryBytes,
                useStreaming: stats.size > resolved.maxInMemoryBytes
            } );
        } );
    } );
}

function streamFileChunks( filePath, onChunk, options )
{
    var resolved = resolveOptions( options );
    var fsImpl = resolved.fs;
    var chunkBytes = resolved.chunkBytes;
    var overlapBytes = resolved.overlapBytes;
    var hardCutBytes = resolved.hardCutBytes;

    return new Promise( function( resolve, reject )
    {
        var stream = fsImpl.createReadStream( filePath, { encoding: 'utf8' } );
        var buffer = '';
        var charOffset = 0;
        var lineOffset = 0;
        var failed = false;

        function fail( error )
        {
            if( failed )
            {
                return;
            }

            failed = true;

            if( stream && typeof ( stream.destroy ) === 'function' )
            {
                stream.destroy();
            }

            reject( error );
        }

        function processBuffered( isLast )
        {
            while( !failed )
            {
                var processLength;

                if( isLast )
                {
                    if( buffer.length === 0 )
                    {
                        return;
                    }

                    processLength = buffer.length;
                }
                else if( buffer.length < chunkBytes )
                {
                    return;
                }
                else
                {
                    var lastNewline = buffer.lastIndexOf( '\n', chunkBytes - 1 );

                    if( lastNewline >= 0 )
                    {
                        processLength = lastNewline + 1;
                    }
                    else if( buffer.length >= hardCutBytes )
                    {
                        processLength = chunkBytes;
                    }
                    else
                    {
                        return;
                    }
                }

                var chunkText = buffer.slice( 0, processLength );
                var deliveredAll = isLast === true && processLength === buffer.length;
                var suggestedKeepStart = processLength;

                if( isLast !== true )
                {
                    var minKeep = Math.max( 0, processLength - overlapBytes );
                    var alignedKeepStart = chunkText.indexOf( '\n', minKeep );

                    if( alignedKeepStart === -1 || alignedKeepStart + 1 > processLength )
                    {
                        suggestedKeepStart = processLength;
                    }
                    else
                    {
                        suggestedKeepStart = alignedKeepStart + 1;
                    }
                }

                var chunkResponse;

                try
                {
                    chunkResponse = onChunk( chunkText, {
                        charOffset: charOffset,
                        lineOffset: lineOffset,
                        isFirst: charOffset === 0,
                        isLast: deliveredAll,
                        suggestedKeepStart: suggestedKeepStart
                    } );
                }
                catch( err )
                {
                    fail( err );
                    return;
                }

                if( failed )
                {
                    return;
                }

                var keepStart = suggestedKeepStart;

                if( isLast !== true && chunkResponse && typeof chunkResponse.retainOffset === 'number' )
                {
                    keepStart = Math.min( keepStart, Math.max( 0, chunkResponse.retainOffset ) );
                }

                if( keepStart > processLength )
                {
                    keepStart = processLength;
                }

                if( isLast !== true && keepStart === 0 )
                {
                    return;
                }

                var consumed = buffer.slice( 0, keepStart );
                charOffset += consumed.length;
                lineOffset += countNewlines( consumed );
                buffer = buffer.slice( keepStart );

                if( isLast === true && buffer.length === 0 )
                {
                    return;
                }
            }
        }

        stream.on( 'data', function( chunk )
        {
            if( failed )
            {
                return;
            }

            buffer += chunk;
            processBuffered( false );
        } );

        stream.on( 'end', function()
        {
            if( failed )
            {
                return;
            }

            processBuffered( true );

            if( !failed )
            {
                resolve();
            }
        } );

        stream.on( 'error', fail );
    } );
}

function adjustResultOffsets( entry, info )
{
    for( var index = 0; index < STREAM_RESULT_OFFSET_FIELDS.length; index++ )
    {
        var field = STREAM_RESULT_OFFSET_FIELDS[ index ];
        if( typeof entry[ field ] === 'number' )
        {
            entry[ field ] += info.charOffset;
        }
    }

    if( typeof entry.line === 'number' )
    {
        entry.line += info.lineOffset;
    }
    if( typeof entry.endLine === 'number' )
    {
        entry.endLine += info.lineOffset;
    }
}

function dedupeKey( entry )
{
    var matchStart = typeof entry.matchStartOffset === 'number' ? entry.matchStartOffset : -1;
    var matchEnd = typeof entry.matchEndOffset === 'number' ? entry.matchEndOffset : -1;
    var tagStart = typeof entry.tagStartOffset === 'number' ? entry.tagStartOffset : -1;
    var tag = entry.tag || entry.actualTag || "";

    return matchStart + ':' + matchEnd + ':' + tagStart + ':' + tag;
}

function normalizeScanResponse( response )
{
    if( Array.isArray( response ) )
    {
        return {
            results: response,
            retainOffset: undefined
        };
    }

    if( response && Array.isArray( response.results ) )
    {
        return {
            results: response.results,
            retainOffset: response.retainOffset
        };
    }

    return {
        results: [],
        retainOffset: response && typeof response.retainOffset === 'number' ? response.retainOffset : undefined
    };
}

function getEntryEndOffset( entry )
{
    var endOffset;

    STREAM_RESULT_OFFSET_FIELDS.forEach( function( field )
    {
        if( /EndOffset$/.test( field ) && typeof entry[ field ] === 'number' && ( endOffset === undefined || entry[ field ] > endOffset ) )
        {
            endOffset = entry[ field ];
        }
    } );

    if( Array.isArray( entry.captureGroupOffsets ) )
    {
        entry.captureGroupOffsets.forEach( function( range )
        {
            if( range && typeof range[ 1 ] === 'number' && ( endOffset === undefined || range[ 1 ] > endOffset ) )
            {
                endOffset = range[ 1 ];
            }
        } );
    }

    return endOffset;
}

function getCommitBoundary( info, scanResponse, chunkText )
{
    if( info.isLast === true )
    {
        return chunkText.length;
    }

    if( scanResponse && typeof scanResponse.retainOffset === 'number' )
    {
        return Math.min( info.suggestedKeepStart, Math.max( 0, scanResponse.retainOffset ) );
    }

    return info.suggestedKeepStart;
}

function streamScanFile( filePath, scanFn, options )
{
    var aggregated = [];
    var seenKeys = new Set();

    return streamFileChunks( filePath, function( chunkText, info )
    {
        var scanResponse = normalizeScanResponse( scanFn( chunkText, info ) );
        var chunkResults = scanResponse.results;
        var commitBoundary = getCommitBoundary( info, scanResponse, chunkText );

        if( !Array.isArray( chunkResults ) )
        {
            return scanResponse;
        }

        for( var index = 0; index < chunkResults.length; index++ )
        {
            var entry = chunkResults[ index ];

            if( !entry )
            {
                continue;
            }

            if( info.isLast !== true )
            {
                var endOffset = getEntryEndOffset( entry );

                if( typeof endOffset === 'number' && endOffset > commitBoundary )
                {
                    continue;
                }
            }

            adjustResultOffsets( entry, info );

            var key = dedupeKey( entry );

            if( seenKeys.has( key ) )
            {
                continue;
            }

            seenKeys.add( key );
            aggregated.push( entry );
        }

        return scanResponse;
    }, options ).then( function()
    {
        return aggregated;
    } );
}

function scanWorkspaceFileWithText( filePath, scanFn, options )
{
    var resolved = resolveOptions( options );
    var fsImpl = resolved.fs;

    return inspectWorkspaceFile( filePath, options ).then( function( scanInfo )
    {
        if( scanInfo.useStreaming === true )
        {
            return streamScanFile( filePath, scanFn, options );
        }

        return new Promise( function( resolve, reject )
        {
            fsImpl.readFile( filePath, 'utf8', function( error, text )
            {
                if( error )
                {
                    reject( error );
                    return;
                }

                try
                {
                    var scanResponse = normalizeScanResponse( scanFn( text, {
                        charOffset: 0,
                        lineOffset: 0,
                        isFirst: true,
                        isLast: true,
                        suggestedKeepStart: text.length
                    } ) );
                    resolve( scanResponse.results.slice() );
                }
                catch( err )
                {
                    reject( err );
                }
            } );
        } );
    } );
}

module.exports.DEFAULT_MAX_INMEMORY_SCAN_BYTES = DEFAULT_MAX_INMEMORY_SCAN_BYTES;
module.exports.DEFAULT_STREAM_CHUNK_BYTES = DEFAULT_STREAM_CHUNK_BYTES;
module.exports.DEFAULT_STREAM_OVERLAP_BYTES = DEFAULT_STREAM_OVERLAP_BYTES;
module.exports.STREAM_RESULT_OFFSET_FIELDS = STREAM_RESULT_OFFSET_FIELDS;
module.exports.inspectWorkspaceFile = inspectWorkspaceFile;
module.exports.streamFileChunks = streamFileChunks;
module.exports.streamScanFile = streamScanFile;
module.exports.scanWorkspaceFileWithText = scanWorkspaceFileWithText;
