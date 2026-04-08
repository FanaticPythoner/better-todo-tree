/* jshint esversion:6, node: true */
/* eslint-env node */

/**
 * This is a modified version of the ripgrep-js module from npm
 * written by alexlafroscia (github.com/alexlafroscia/ripgrep-js)
 * Instead of assuming that ripgrep is in the users path, it uses the
 * ripgrep binary downloaded via vscode-ripgrep.
 */

'use strict';
const child_process = require( 'child_process' );
const fs = require( 'fs' );
const utils = require( './utils' );

var currentProcess;
var currentCancellationRequested = false;

var MAX_DEBUG_PREVIEW_LINES = 10;
var MAX_DEBUG_TEXT_LENGTH = 2048;

function RipgrepError( error, stderr, cancelled )
{
    this.message = error;
    this.stderr = stderr;
    this.cancelled = cancelled === true;
}

function debugWithChannel( options, text )
{
    if( options.outputChannel )
    {
        var now = new Date();
        options.outputChannel.appendLine( now.toLocaleTimeString( 'en', { hour12: false } ) + "." + String( now.getMilliseconds() ).padStart( 3, '0' ) + " " + text );
    }
}

function cleanupPatternFile( patternFilePath, options )
{
    if( !patternFilePath )
    {
        return;
    }

    if( fs.existsSync( patternFilePath ) )
    {
        try
        {
            fs.unlinkSync( patternFilePath );
        }
        catch( error )
        {
            debugWithChannel( options, "Failed to remove pattern file " + patternFilePath + ": " + error.message );
        }
    }
}

function stripTrailingCarriageReturn( line )
{
    if( line.endsWith( '\r' ) )
    {
        return line.slice( 0, -1 );
    }
    return line;
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

        if( /\s/.test( character ) )
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
    var args = [
        '--no-messages',
        '--vimgrep',
        '-H',
        '--column',
        '--line-number',
        '--color',
        'never'
    ].concat( parseArgumentString( options.additional ) );

    if( options.multiline )
    {
        args.push( '-U' );
    }

    if( options.patternFilePath )
    {
        debugWithChannel( options, "Writing pattern file: " + options.patternFilePath );
        fs.writeFileSync( options.patternFilePath, options.unquotedRegex + '\n' );
        args.push( '-f', options.patternFilePath );
        debugWithChannel( options, "Pattern: " + options.unquotedRegex );
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

function Match( matchText )
{
    var regex = RegExp( /^(?<file>.*):(?<line>\d+):(?<column>\d+):(?<todo>.*)/ );
    var match = regex.exec( matchText );

    if( match && match.groups )
    {
        this.fsPath = match.groups.file;
        this.line = parseInt( match.groups.line );
        this.column = parseInt( match.groups.column );
        this.match = match.groups.todo;
    }
    else
    {
        this.fsPath = "";

        if( matchText.length > 1 && matchText[ 1 ] === ':' )
        {
            this.fsPath = matchText.substr( 0, 2 );
            matchText = matchText.substr( 2 );
        }

        var parts = matchText.split( ':' );
        var hasColumn = ( parts.length === 4 );
        this.fsPath += parts.shift();
        this.line = parseInt( parts.shift() );
        this.column = hasColumn === true ? parseInt( parts.shift() ) : 1;
        this.match = parts.join( ':' );
    }
}

function createLineProcessor( multiline, results )
{
    if( multiline === true )
    {
        var regex = utils.getRegexForEditorSearch( true );
        var matches = [];
        var text = "";

        return function( line )
        {
            if( !line )
            {
                return;
            }

            var resultMatch = new Match( line );
            matches.push( resultMatch );
            text = text === "" ? resultMatch.match : text + '\n' + resultMatch.match;
            regex.lastIndex = 0;

            if( regex.test( text ) )
            {
                resultMatch = matches[ 0 ];
                resultMatch.extraLines = matches.slice( 1 );
                results.push( resultMatch );
                matches = [];
                text = "";
                regex.lastIndex = 0;
            }
        };
    }

    return function( line )
    {
        if( !line )
        {
            return;
        }

        results.push( new Match( line ) );
    };
}

function processStdoutChunk( chunk, state )
{
    var combined = state.stdoutTail + chunk.toString();
    var lines = combined.split( '\n' );

    state.stdoutTail = lines.pop();

    lines.forEach( function( line )
    {
        var cleanLine = stripTrailingCarriageReturn( line );
        addPreviewLine( state, cleanLine );
        state.outputLineCount++;
        state.processLine( cleanLine );
    } );
}

module.exports.search = function ripGrep( cwd, options )
{
    if( !cwd )
    {
        return Promise.reject( { error: 'No `cwd` provided' } );
    }

    if( arguments.length === 1 )
    {
        return Promise.reject( { error: 'No search term provided' } );
    }

    options.regex = options.regex || '';
    options.globs = options.globs || [];

    if( !fs.existsSync( options.rgPath ) )
    {
        return Promise.reject( { error: "ripgrep executable not found (" + options.rgPath + ")" } );
    }

    if( !fs.existsSync( cwd ) )
    {
        return Promise.reject( { error: "root folder not found (" + cwd + ")" } );
    }

    var args = buildArgs( options );
    debugWithChannel( options, "Command: " + [ options.rgPath ].concat( args ).join( ' ' ) );

    return new Promise( function( resolve, reject )
    {
        var results = [];
        var state = {
            outputLineCount: 0,
            previewLines: [],
            stderr: "",
            stdoutTail: "",
            processLine: createLineProcessor( options.multiline, results )
        };

        currentCancellationRequested = false;
        currentProcess = child_process.spawn( options.rgPath, args, { cwd: cwd, windowsHide: true } );

        currentProcess.stdout.on( 'data', function( data )
        {
            processStdoutChunk( data, state );
        } );

        currentProcess.stderr.on( 'data', function( data )
        {
            state.stderr = appendBoundedText( state.stderr, data.toString(), MAX_DEBUG_TEXT_LENGTH );
        } );

        currentProcess.on( 'error', function( error )
        {
            cleanupPatternFile( options.patternFilePath, options );

            if( currentProcess )
            {
                currentProcess = undefined;
            }

            reject( new RipgrepError( error.message, state.stderr, false ) );
        } );

        currentProcess.on( 'close', function( code, signal )
        {
            if( state.stdoutTail.length > 0 )
            {
                var trailingLine = stripTrailingCarriageReturn( state.stdoutTail );
                addPreviewLine( state, trailingLine );
                state.outputLineCount++;
                state.processLine( trailingLine );
            }

            cleanupPatternFile( options.patternFilePath, options );

            if( currentProcess )
            {
                currentProcess = undefined;
            }

            if( state.previewLines.length > 0 )
            {
                debugWithChannel( options, "Search preview:\n" + state.previewLines.join( '\n' ) );
            }

            debugWithChannel( options, "Search produced " + results.length + " matches from " + state.outputLineCount + " output lines" );

            if( currentCancellationRequested === true || signal === 'SIGINT' )
            {
                reject( new RipgrepError( "Search cancelled", state.stderr, true ) );
                return;
            }

            if( code === 0 || code === 1 )
            {
                resolve( results );
                return;
            }

            reject( new RipgrepError( "ripgrep failed with exit code " + code, state.stderr, false ) );
        } );
    } );
};

module.exports.kill = function()
{
    if( currentProcess !== undefined )
    {
        currentCancellationRequested = true;
        currentProcess.kill( 'SIGINT' );
    }
};

module.exports.Match = Match;
module.exports.buildArgs = buildArgs;
module.exports.parseArgumentString = parseArgumentString;
