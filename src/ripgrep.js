/* jshint esversion:6, node: true */
/* eslint-env node */

'use strict';

var child_process = require( 'child_process' );
var fs = require( 'fs' );
var regexEngine = require( './regexEngine.js' );
var regexRegistry = require( './regexRegistry.js' );

var currentProcess;
var currentProcessState;
var whitespaceCharacterRegex = regexRegistry.createRegExp( 'whitespaceCharacter' );

var MAX_DEBUG_PREVIEW_LINES = 10;
var MAX_DEBUG_TEXT_LENGTH = 2048;

function RipgrepError( error, stderr, cancelled )
{
    Error.call( this );
    this.name = 'RipgrepError';
    this.message = error;
    this.stderr = stderr;
    this.cancelled = cancelled === true;

    if( Error.captureStackTrace )
    {
        Error.captureStackTrace( this, RipgrepError );
    }
}

RipgrepError.prototype = Object.create( Error.prototype );
RipgrepError.prototype.constructor = RipgrepError;

function debugWithChannel( options, text )
{
    if( options.outputChannel )
    {
        var now = new Date();
        options.outputChannel.appendLine( now.toLocaleTimeString( 'en', { hour12: false } ) + "." + String( now.getMilliseconds() ).padStart( 3, '0' ) + " " + text );
    }
}

function appendBoundedText( text, addition, maxLength )
{
    if( !addition )
    {
        return text;
    }

    var combined = text + addition;
    if( combined.length <= maxLength )
    {
        return combined;
    }

    return combined.slice( 0, maxLength );
}

function addPreviewLine( state, line )
{
    if( state.previewLines.length < MAX_DEBUG_PREVIEW_LINES )
    {
        state.previewLines.push( line );
    }
}

function parseArgumentString( input )
{
    var args = [];
    var current = "";
    var quote;
    var escaped = false;

    if( !input )
    {
        return args;
    }

    Array.from( input ).forEach( function( character )
    {
        if( escaped )
        {
            current += character;
            escaped = false;
            return;
        }

        if( character === '\\' )
        {
            escaped = true;
            return;
        }

        if( quote )
        {
            if( character === quote )
            {
                quote = undefined;
            }
            else
            {
                current += character;
            }
            return;
        }

        if( character === '"' || character === "'" )
        {
            quote = character;
            return;
        }

        if( whitespaceCharacterRegex.test( character ) )
        {
            if( current.length > 0 )
            {
                args.push( current );
                current = "";
            }
            return;
        }

        current += character;
    } );

    if( escaped )
    {
        current += '\\';
    }

    if( current.length > 0 )
    {
        args.push( current );
    }

    return args;
}

function buildArgs( options )
{
    var additionalArgs = parseArgumentString( options.additional );
    var args = [
        '--no-messages',
        '--json',
        '--color',
        'never'
    ].concat( regexEngine.buildRegexEngineArgs( options.regex, additionalArgs ) ).concat( additionalArgs );

    if( options.multiline )
    {
        args.push( '-U' );
    }

    if( options.patternFilePath )
    {
        args.push( '-f', options.patternFilePath );
    }
    else
    {
        args.push( '-e', options.regex );
    }

    ( options.globs || [] ).forEach( function( glob )
    {
        args.push( '-g', glob );
    } );

    if( options.filename )
    {
        args.push( options.filename );
    }
    else
    {
        args.push( '.' );
    }

    return args;
}

function decodeJsonValue( value )
{
    if( value === undefined || value === null )
    {
        return undefined;
    }

    if( value.text !== undefined )
    {
        return value.text;
    }

    if( value.bytes !== undefined )
    {
        return Buffer.from( value.bytes, 'base64' ).toString( 'utf8' );
    }

    return undefined;
}

function preparePatternFile( options )
{
    if( !options.patternFilePath )
    {
        return Promise.resolve();
    }

    debugWithChannel( options, "Writing pattern file: " + options.patternFilePath );
    debugWithChannel( options, "Pattern: " + options.unquotedRegex );

    return fs.promises.writeFile( options.patternFilePath, options.unquotedRegex + '\n', 'utf8' );
}

function cleanupPatternFile( patternFilePath )
{
    if( !patternFilePath )
    {
        return Promise.resolve();
    }

    return fs.promises.unlink( patternFilePath ).catch( function( error )
    {
        if( error && error.code === 'ENOENT' )
        {
            return;
        }

        throw error;
    } );
}

function processStdoutChunk( chunk, state, onEvent )
{
    var combined = state.stdoutTail + chunk.toString();
    var lines = combined.split( '\n' );

    state.stdoutTail = lines.pop();

    lines.forEach( function( line )
    {
        if( line.length === 0 )
        {
            return;
        }

        addPreviewLine( state, line );
        state.outputLineCount++;

        var message = JSON.parse( line );
        if( message.type === 'match' )
        {
            state.matchCount++;
        }
        if( message.type === 'summary' )
        {
            state.summary = message.data;
        }

        onEvent( message );
    } );
}

function toRipgrepError( error, stderr, cancelled )
{
    if( error instanceof RipgrepError )
    {
        return error;
    }

    return new RipgrepError( error && error.message ? error.message : String( error ), stderr, cancelled );
}

function normalizeSearchOptions( options )
{
    if( options === undefined || options === null )
    {
        throw new RipgrepError( 'No search term provided', '', false );
    }

    if( !options.rgPath )
    {
        throw new RipgrepError( 'No ripgrep executable provided', '', false );
    }

    if( options.globs !== undefined && Array.isArray( options.globs ) !== true )
    {
        throw new RipgrepError( 'ripgrep globs must be an array', '', false );
    }

    var normalizedOptions = Object.assign( {}, options );
    normalizedOptions.regex = normalizedOptions.regex || '';
    normalizedOptions.unquotedRegex = normalizedOptions.unquotedRegex !== undefined ?
        normalizedOptions.unquotedRegex :
        normalizedOptions.regex;
    normalizedOptions.additional = normalizedOptions.additional || '';
    normalizedOptions.globs = options.globs ? options.globs.slice() : [];

    return normalizedOptions;
}

function clearCurrentProcess( processRef )
{
    if( currentProcess && ( processRef === undefined || currentProcess === processRef ) )
    {
        currentProcess = undefined;
        currentProcessState = undefined;
    }
}

function rejectAfterPatternCleanup( options, state, reject, error, beforeCleanup, processRef )
{
    if( typeof ( beforeCleanup ) === 'function' )
    {
        beforeCleanup();
    }

    return cleanupPatternFile( options.patternFilePath ).then( function()
    {
        clearCurrentProcess( processRef );
        reject( toRipgrepError( error, state.stderr, false ) );
    }, function( cleanupError )
    {
        clearCurrentProcess( processRef );
        reject( toRipgrepError( cleanupError, state.stderr, false ) );
    } );
}

module.exports.search = function ripGrep( cwd, options, onEvent )
{
    if( !cwd )
    {
        return Promise.reject( new RipgrepError( 'No `cwd` provided', '', false ) );
    }

    try
    {
        options = normalizeSearchOptions( options );
    }
    catch( error )
    {
        return Promise.reject( error );
    }

    return Promise.all( [
        fs.promises.access( options.rgPath, fs.constants.X_OK ),
        fs.promises.access( cwd, fs.constants.F_OK ),
        preparePatternFile( options )
    ] ).then( function()
    {
        var args = buildArgs( options );
        debugWithChannel( options, "Command: " + [ options.rgPath ].concat( args ).join( ' ' ) );

        return new Promise( function( resolve, reject )
        {
            var state = {
                outputLineCount: 0,
                previewLines: [],
                stderr: "",
                stdoutTail: "",
                matchCount: 0,
                summary: undefined
            };
            var eventHandler = typeof ( onEvent ) === 'function' ? onEvent : function() {};

            try
            {
                currentProcess = child_process.spawn( options.rgPath, args, { cwd: cwd, windowsHide: true } );
            }
            catch( error )
            {
                rejectAfterPatternCleanup( options, state, reject, error, undefined, null );
                return;
            }

            var searchProcess = currentProcess;
            currentProcessState = state;

            searchProcess.stdout.on( 'data', function( data )
            {
                try
                {
                    processStdoutChunk( data, state, eventHandler );
                }
                catch( error )
                {
                    rejectAfterPatternCleanup( options, state, reject, error, function()
                    {
                        if( currentProcess === searchProcess )
                        {
                            searchProcess.kill( 'SIGINT' );
                        }
                    }, searchProcess );
                }
            } );

            searchProcess.stderr.on( 'data', function( data )
            {
                state.stderr = appendBoundedText( state.stderr, data.toString(), MAX_DEBUG_TEXT_LENGTH );
            } );

            searchProcess.on( 'error', function( error )
            {
                rejectAfterPatternCleanup( options, state, reject, error, undefined, searchProcess );
            } );

            searchProcess.on( 'close', function( code, signal )
            {
                var completion = Promise.resolve();

                if( state.stdoutTail.length > 0 )
                {
                    addPreviewLine( state, state.stdoutTail );
                    state.outputLineCount++;
                    completion = completion.then( function()
                    {
                        var trailingMessage = JSON.parse( state.stdoutTail );
                        if( trailingMessage.type === 'match' )
                        {
                            state.matchCount++;
                        }
                        if( trailingMessage.type === 'summary' )
                        {
                            state.summary = trailingMessage.data;
                        }
                        eventHandler( trailingMessage );
                    } );
                }

                completion.then( function()
                {
                    return cleanupPatternFile( options.patternFilePath );
                } ).then( function()
                {
                    clearCurrentProcess( searchProcess );

                    if( state.previewLines.length > 0 )
                    {
                        debugWithChannel( options, "Search preview:\n" + state.previewLines.join( '\n' ) );
                    }

                    debugWithChannel( options, "Search produced " + state.matchCount + " matches from " + state.outputLineCount + " output lines" );

                    if( state.cancellationRequested === true || signal === 'SIGINT' )
                    {
                        reject( new RipgrepError( "Search cancelled", state.stderr, true ) );
                        return;
                    }

                    if( code === 0 || code === 1 )
                    {
                        resolve( state.summary || { stats: { matches: state.matchCount } } );
                        return;
                    }

                    reject( new RipgrepError( "ripgrep failed with exit code " + code, state.stderr, false ) );
                } ).catch( function( error )
                {
                    clearCurrentProcess( searchProcess );
                    reject( toRipgrepError( error, state.stderr, false ) );
                } );
            } );
        } );
    } ).catch( function( error )
    {
        if( error && error.code === 'ENOENT' )
        {
            if( error.path === options.rgPath )
            {
                throw new RipgrepError( "ripgrep executable not found (" + options.rgPath + ")", '', false );
            }

            if( error.path === cwd )
            {
                throw new RipgrepError( "root folder not found (" + cwd + ")", '', false );
            }
        }

        throw error;
    } );
};

module.exports.kill = function()
{
    if( currentProcess !== undefined )
    {
        if( currentProcessState )
        {
            currentProcessState.cancellationRequested = true;
        }
        currentProcess.kill( 'SIGINT' );
    }
};

module.exports.decodeJsonValue = decodeJsonValue;
module.exports.buildArgs = buildArgs;
module.exports.parseArgumentString = parseArgumentString;
module.exports.RipgrepError = RipgrepError;
