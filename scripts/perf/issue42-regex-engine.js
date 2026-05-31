/* jshint esversion:6, node: true */

'use strict';

var childProcess = require( 'child_process' );
var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var performance = require( 'perf_hooks' ).performance;

var detection = require( '../../src/detection.js' );
var regexRegistry = require( '../../src/regexRegistry.js' );
var utils = require( '../../src/utils.js' );

var TAGS = Object.freeze( [ 'BUG', 'HACK', 'FIXME', 'TODO', 'XXX', '[ ]', '[x]' ] );
var FILE_COUNT = 160;
var TASKS_PER_FILE = 8;
var ITERATIONS = 31;
var DEFAULT_DERIVED_REGEX = regexRegistry.pattern( 'defaultTodoWithoutSemicolon' );

var resourceConfig = {
    tags: TAGS.slice(),
    regex: DEFAULT_DERIVED_REGEX,
    regexCaseSensitive: true,
    enableMultiLine: false,
    subTagRegex: regexRegistry.pattern( 'subTagPrefix' ),
    isDefaultRegex: false
};
var config = {
    tags: function() { return TAGS.slice(); },
    regex: function()
    {
        return {
            tags: TAGS.slice(),
            regex: DEFAULT_DERIVED_REGEX,
            caseSensitive: true,
            multiLine: false
        };
    },
    subTagRegex: function() { return regexRegistry.pattern( 'subTagPrefix' ); }
};
var snapshot = {
    getResourceConfig: function() { return resourceConfig; }
};

function resolveRipgrepPath()
{
    var executableName = process.platform === 'win32' ? 'rg.exe' : 'rg';
    var platformArch = process.platform + '-' + process.arch;
    var rgPath = path.resolve(
        __dirname,
        '..',
        '..',
        'node_modules',
        '@vscode',
        'ripgrep-universal',
        'bin',
        platformArch,
        executableName
    );

    if( fs.existsSync( rgPath ) !== true )
    {
        throw new Error( 'ripgrep benchmark binary missing: ' + rgPath );
    }

    return rgPath;
}

function createUri( filePath )
{
    return {
        scheme: 'file',
        fsPath: filePath,
        path: filePath,
        toString: function() { return 'file://' + filePath; }
    };
}

function createCorpus( root )
{
    var fileIndex;
    var taskIndex;

    for( fileIndex = 0; fileIndex < FILE_COUNT; fileIndex++ )
    {
        var lines = [];

        for( taskIndex = 0; taskIndex < TASKS_PER_FILE; taskIndex++ )
        {
            lines.push( '- [ ] Task ' + fileIndex + '-' + taskIndex );
            lines.push( 'plain text ' + fileIndex + '-' + taskIndex );
        }

        fs.writeFileSync( path.join( root, 'todo-' + fileIndex + '.md' ), lines.join( '\n' ) + '\n', 'utf8' );
    }
}

function runRipgrep( rgPath, root, args )
{
    return childProcess.spawnSync( rgPath, args, { cwd: root, encoding: 'utf8' } );
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

function parseJsonLines( stdout )
{
    return stdout.split( '\n' ).filter( function( line )
    {
        return line.length > 0;
    } ).map( function( line )
    {
        return JSON.parse( line );
    } );
}

function resolveResultPath( root, value )
{
    var filePath = decodeJsonValue( value );

    return path.isAbsolute( filePath ) ? filePath : path.resolve( root, filePath );
}

function toWorkspaceMatch( root, message )
{
    var data = message.data;
    var submatches = Array.isArray( data.submatches ) ? data.submatches.map( function( submatch )
    {
        return {
            match: decodeJsonValue( submatch.match ),
            start: submatch.start,
            end: submatch.end
        };
    } ) : [];
    var firstSubmatch = submatches[ 0 ] || { start: 0, match: decodeJsonValue( data.lines ) || '' };

    return {
        fsPath: resolveResultPath( root, data.path ),
        line: data.line_number,
        column: firstSubmatch.start + 1,
        match: firstSubmatch.match,
        absoluteOffset: data.absolute_offset,
        submatches: submatches,
        lines: decodeJsonValue( data.lines )
    };
}

function quantile( values, q )
{
    var sorted = values.slice().sort( function( a, b ) { return a - b; } );
    var index = Math.ceil( q * sorted.length ) - 1;

    return sorted[ Math.max( 0, Math.min( sorted.length - 1, index ) ) ];
}

function pcre2RawStrategy( rgPath, root, fullRegex )
{
    var result = runRipgrep( rgPath, root, [ '--no-messages', '--json', '--color', 'never', '--pcre2', '-e', fullRegex, '.' ] );
    var matchesByFile = new Map();
    var count = 0;

    if( result.status !== 0 )
    {
        throw new Error( result.stderr.trim() );
    }

    parseJsonLines( result.stdout ).filter( function( message )
    {
        return message.type === 'match';
    } ).forEach( function( message )
    {
        var match = toWorkspaceMatch( root, message );

        if( matchesByFile.has( match.fsPath ) !== true )
        {
            matchesByFile.set( match.fsPath, [] );
        }

        matchesByFile.get( match.fsPath ).push( match );
    } );

    matchesByFile.forEach( function( matches, filePath )
    {
        matches.map( function( match )
        {
            return detection.normalizeWorkspaceRegexMatch( createUri( filePath ), match, snapshot );
        } ).filter( function( normalized )
        {
            return normalized !== undefined;
        } ).forEach( function()
        {
            count++;
        } );
    } );

    return count;
}

function candidateStrategy( rgPath, root, candidateRegex )
{
    var result = runRipgrep( rgPath, root, [ '--no-messages', '--json', '--color', 'never', '-e', candidateRegex, '.' ] );
    var files = new Set();
    var count = 0;

    if( result.status !== 0 )
    {
        throw new Error( result.stderr.trim() );
    }

    parseJsonLines( result.stdout ).filter( function( message )
    {
        return message.type === 'match';
    } ).forEach( function( message )
    {
        files.add( resolveResultPath( root, message.data.path ) );
    } );

    files.forEach( function( filePath )
    {
        count += detection.scanText( createUri( filePath ), fs.readFileSync( filePath, 'utf8' ) ).length;
    } );

    return count;
}

function measure( name, expectedMatches, fn )
{
    var durations = [];
    var count = 0;
    var peakRss = 0;
    var index;

    for( index = 0; index < ITERATIONS; index++ )
    {
        if( global.gc )
        {
            global.gc();
        }

        var start = performance.now();
        count = fn();
        var duration = performance.now() - start;

        if( count !== expectedMatches )
        {
            throw new Error( name + ' match count mismatch: expected ' + expectedMatches + ', got ' + count );
        }

        if( index > 0 )
        {
            durations.push( duration );
        }

        peakRss = Math.max( peakRss, process.memoryUsage().rss );
    }

    var p50 = quantile( durations, 0.50 );
    var p95 = quantile( durations, 0.95 );

    return {
        name: name,
        count: count,
        p50_ms: Number( p50.toFixed( 3 ) ),
        p95_ms: Number( p95.toFixed( 3 ) ),
        throughput_matches_per_s: Number( ( count / ( p50 / 1000 ) ).toFixed( 1 ) ),
        peak_rss_mib: Number( ( peakRss / 1048576 ).toFixed( 2 ) )
    };
}

function run()
{
    var rgPath = resolveRipgrepPath();
    var root = fs.mkdtempSync( path.join( os.tmpdir(), 'issue42-bench-' ) );
    var expectedMatches = FILE_COUNT * TASKS_PER_FILE;
    var fullRegex;
    var candidateRegex;
    var brokenRaw;

    utils.init( config );
    createCorpus( root );
    fullRegex = DEFAULT_DERIVED_REGEX.replace(
        regexRegistry.TAG_CAPTURE_PLACEHOLDER,
        regexRegistry.captureSource( utils.getTagRegexSource( undefined, TAGS ) )
    );
    candidateRegex = regexRegistry.captureSource( utils.getTagRegexSource( undefined, TAGS ) );

    try
    {
        brokenRaw = runRipgrep( rgPath, root, [ '--no-messages', '--json', '--color', 'never', '-e', fullRegex, '.' ] );

        return {
            corpus: {
                fileCount: FILE_COUNT,
                tasksPerFile: TASKS_PER_FILE,
                expectedMatches: expectedMatches
            },
            brokenRawExit: brokenRaw.status,
            brokenRawHasLookaroundError: regexRegistry
                .createRegExp( 'lookAroundDiagnostic' )
                .test( brokenRaw.stderr ),
            pcre2Raw: measure( 'pcre2Raw', expectedMatches, function()
            {
                return pcre2RawStrategy( rgPath, root, fullRegex );
            } ),
            candidateRoute: measure( 'candidateRoute', expectedMatches, function()
            {
                return candidateStrategy( rgPath, root, candidateRegex );
            } )
        };
    }
    finally
    {
        fs.rmSync( root, { recursive: true, force: true } );
    }
}

if( require.main === module )
{
    process.stdout.write( JSON.stringify( run(), null, 2 ) + '\n' );
}

module.exports.run = run;
