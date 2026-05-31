/* jshint esversion:6, node: true */

'use strict';

var acorn = require( 'acorn' );
var childProcess = require( 'child_process' );
var fs = require( 'fs' );
var Module = require( 'module' );
var path = require( 'path' );
var vm = require( 'vm' );

var regexRegistry = require( '../../src/regexRegistry.js' );
var languageMatrix = require( '../../test/languageMatrix.js' );
var stubs = require( '../../test/stubs.js' );

var REPO_ROOT = path.resolve( __dirname, '..', '..' );
var DEFAULT_BASELINE_REF = 'auto';
var BASELINE_REF_ENV = 'BETTER_TODO_TREE_REGEX_BASELINE_REF';
var KEY_SEPARATOR = String.fromCharCode( 0 );
var LINE_FEED = String.fromCharCode( 10 );
var CURRENT_SCAN_EXCLUDED_DIRECTORIES = Object.freeze( [
    '.git',
    '.tools',
    '.vscode-test',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'TODOS_LISTS',
    'test-files'
] );
var BASELINE_FILE_PATTERNS = Object.freeze( [
    'src/*.js',
    'src/runtime/*.js',
    'test/*.js',
    'test/parity/*.js',
    'scripts/**/*.js',
    'webpack.config.js',
    'buildCodiconNames.js'
] );
var STATIC_SOURCE_EXEMPTIONS = Object.freeze( [
    'src/regexRegistry.js'
] );

function runGit( args )
{
    var result = childProcess.spawnSync( 'git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    } );

    if( result.error )
    {
        throw new Error( 'git ' + args.join( ' ' ) + ' failed: ' + result.error.message );
    }

    if( result.status !== 0 )
    {
        throw new Error(
            'git ' + args.join( ' ' ) + ' exited with status ' + result.status + ': ' +
            String( result.stderr || '' ).trim()
        );
    }

    return String( result.stdout || '' );
}

function gitRefExists( ref )
{
    var result = childProcess.spawnSync( 'git', [ 'rev-parse', '--verify', ref + '^{commit}' ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    } );

    return result.status === 0;
}

function pushUniqueCandidate( candidates, ref )
{
    if( typeof ref === 'string' && ref.length > 0 && candidates.indexOf( ref ) === -1 )
    {
        candidates.push( ref );
    }
}

function baselineRefCandidates()
{
    var candidates = [];

    pushUniqueCandidate( candidates, process.env[ BASELINE_REF_ENV ] );
    if( typeof process.env.GITHUB_BASE_REF === 'string' && process.env.GITHUB_BASE_REF.length > 0 )
    {
        pushUniqueCandidate( candidates, 'origin/' + process.env.GITHUB_BASE_REF );
    }
    pushUniqueCandidate( candidates, 'HEAD^1' );
    pushUniqueCandidate( candidates, 'origin/master' );
    pushUniqueCandidate( candidates, 'master' );
    pushUniqueCandidate( candidates, 'HEAD' );

    return candidates;
}

function expandFirstParentCandidates( ref )
{
    if( gitRefExists( ref ) !== true )
    {
        return [];
    }

    return splitLines( runGit( [ 'rev-list', '--first-parent', ref ] ) ).filter( function( candidate )
    {
        return candidate !== '';
    } );
}

function expandBaselineRefCandidates( seeds )
{
    var candidates = [];

    seeds.forEach( function( seed )
    {
        expandFirstParentCandidates( seed ).forEach( function( candidate )
        {
            pushUniqueCandidate( candidates, candidate );
        } );
    } );

    return candidates;
}

function resolveBaselineRef( requestedRef )
{
    var candidates;
    var entriesByRef = new Map();
    var selected = null;

    if( requestedRef !== DEFAULT_BASELINE_REF )
    {
        return {
            ref: requestedRef,
            entries: collectBaselineRegexEntries( requestedRef )
        };
    }

    candidates = expandBaselineRefCandidates( baselineRefCandidates() );
    candidates.some( function( candidate )
    {
        var entries = entriesByRef.get( candidate );

        if( entries === undefined )
        {
            entries = collectBaselineRegexEntries( candidate );
            entriesByRef.set( candidate, entries );
        }

        if( entries.length > 0 )
        {
            selected = {
                ref: candidate,
                entries: entries
            };
            return true;
        }

        return false;
    } );

    if( selected === null )
    {
        throw new Error( 'baseline regex entries missing: ' + candidates.join( ', ' ) );
    }

    return selected;
}

function splitLines( value )
{
    var lines = [];
    var lineStart = 0;
    var index;

    for( index = 0; index < value.length; index++ )
    {
        if( value[ index ] === LINE_FEED )
        {
            lines.push( value.slice( lineStart, index ) );
            lineStart = index + 1;
        }
    }

    if( lineStart < value.length )
    {
        lines.push( value.slice( lineStart ) );
    }

    return lines;
}

function listBaselineFiles()
{
    return splitLines( runGit( [ 'ls-files' ].concat( BASELINE_FILE_PATTERNS ) ) ).filter( function( file )
    {
        return file !== '';
    } ).sort();
}

function readBaselineFile( baselineRef, relativePath )
{
    return runGit( [ 'show', baselineRef + ':' + relativePath ] );
}

function parseJavaScript( source, filename )
{
    try
    {
        return acorn.parse( source, {
            ecmaVersion: 'latest',
            sourceType: 'script',
            locations: true
        } );
    }
    catch( error )
    {
        throw new Error( filename + ': parse failed: ' + error.message );
    }
}

function walkAst( node, visitor )
{
    if( !node || typeof node.type !== 'string' )
    {
        return;
    }

    visitor( node );

    Object.keys( node ).forEach( function( key )
    {
        var value = node[ key ];

        if( key === 'parent' || value === undefined || value === null )
        {
            return;
        }

        if( Array.isArray( value ) )
        {
            value.forEach( function( child )
            {
                walkAst( child, visitor );
            } );
            return;
        }

        if( value && typeof value.type === 'string' )
        {
            walkAst( value, visitor );
        }
    } );
}

function isLiteralString( node )
{
    return node && node.type === 'Literal' && typeof node.value === 'string';
}

function isNewRegExp( node )
{
    return node &&
        node.type === 'NewExpression' &&
        node.callee &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'RegExp';
}

function createRegexEntry( origin, relativePath, node, kind, source, flags, raw )
{
    return {
        origin: origin,
        file: relativePath,
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        kind: kind,
        source: source,
        flags: flags || '',
        raw: raw
    };
}

function extractRegexEntries( origin, relativePath, source )
{
    var ast = parseJavaScript( source, relativePath );
    var entries = [];

    walkAst( ast, function( node )
    {
        if( node.type === 'Literal' && node.regex )
        {
            entries.push( createRegexEntry(
                origin,
                relativePath,
                node,
                'literal',
                node.regex.pattern,
                node.regex.flags,
                source.slice( node.start, node.end )
            ) );
            return;
        }

        if( isNewRegExp( node ) === true && isLiteralString( node.arguments[ 0 ] ) === true )
        {
            entries.push( createRegexEntry(
                origin,
                relativePath,
                node,
                'new-regexp',
                node.arguments[ 0 ].value,
                isLiteralString( node.arguments[ 1 ] ) ? node.arguments[ 1 ].value : '',
                source.slice( node.start, node.end )
            ) );
        }
    } );

    return entries;
}

function collectBaselineRegexEntries( baselineRef )
{
    var entries = [];

    listBaselineFiles().forEach( function( file )
    {
        try
        {
            entries = entries.concat( extractRegexEntries(
                baselineRef,
                file,
                readBaselineFile( baselineRef, file )
            ) );
        }
        catch( error )
        {
            if( error.message.indexOf( 'exists on disk, but not in' ) === -1 )
            {
                throw error;
            }
        }
    } );

    return entries.sort( sortEntries );
}

function shouldSkipCurrentDirectory( directoryName )
{
    return CURRENT_SCAN_EXCLUDED_DIRECTORIES.indexOf( directoryName ) !== -1;
}

function collectCurrentJavaScriptFiles( directory )
{
    var files = [];

    fs.readdirSync( directory, { withFileTypes: true } ).forEach( function( entry )
    {
        var absolutePath = path.join( directory, entry.name );
        var relativePath = path.relative( REPO_ROOT, absolutePath ).split( path.sep ).join( path.posix.sep );

        if( entry.isDirectory() === true )
        {
            if( shouldSkipCurrentDirectory( entry.name ) !== true )
            {
                files = files.concat( collectCurrentJavaScriptFiles( absolutePath ) );
            }
            return;
        }

        if( entry.isFile() === true && path.extname( entry.name ) === '.js' )
        {
            files.push( relativePath );
        }
    } );

    return files.sort();
}

function collectCurrentHardcodedRegexEntries()
{
    var entries = [];

    collectCurrentJavaScriptFiles( REPO_ROOT ).forEach( function( file )
    {
        if( STATIC_SOURCE_EXEMPTIONS.indexOf( file ) !== -1 )
        {
            return;
        }

        entries = entries.concat( extractRegexEntries(
            'working-tree',
            file,
            fs.readFileSync( path.join( REPO_ROOT, file ), 'utf8' )
        ) );
    } );

    return entries.sort( sortEntries );
}

function sortEntries( left, right )
{
    return [
        left.file.localeCompare( right.file ),
        left.line - right.line,
        left.column - right.column,
        left.source.localeCompare( right.source ),
        left.flags.localeCompare( right.flags )
    ].find( function( value )
    {
        return value !== 0;
    } ) || 0;
}

function regexKey( source, flags )
{
    return source + KEY_SEPARATOR + ( flags || '' );
}

function groupBaselineEntries( entries )
{
    var grouped = new Map();

    entries.forEach( function( entry )
    {
        var key = regexKey( entry.source, entry.flags );
        var record = grouped.get( key );

        if( record === undefined )
        {
            record = {
                source: entry.source,
                flags: entry.flags,
                count: 0,
                refs: []
            };
            grouped.set( key, record );
        }

        record.count++;
        record.refs.push( entry.file + ':' + entry.line );
    } );

    return Array.from( grouped.values() ).sort( function( left, right )
    {
        return regexKey( left.source, left.flags ).localeCompare( regexKey( right.source, right.flags ) );
    } );
}

function collectRegistrySources()
{
    var sources = [];

    regexRegistry.fragmentNames().forEach( function( name )
    {
        sources.push( {
            kind: 'fragment',
            name: name,
            source: regexRegistry.fragment( name )
        } );
    } );

    regexRegistry.patternNames().forEach( function( name )
    {
        sources.push( {
            kind: 'pattern',
            name: name,
            source: regexRegistry.pattern( name )
        } );
    } );

    return sources.sort( function( left, right )
    {
        return ( left.kind + ':' + left.name ).localeCompare( right.kind + ':' + right.name );
    } );
}

function createRegistrySourceIndex()
{
    var index = new Map();

    collectRegistrySources().forEach( function( entry )
    {
        var bucket = index.get( entry.source );

        if( bucket === undefined )
        {
            bucket = [];
            index.set( entry.source, bucket );
        }

        bucket.push( entry.kind + ':' + entry.name );
    } );

    return index;
}

function compareSourceCoverage( baselineGroups )
{
    var sourceIndex = createRegistrySourceIndex();
    var rows = baselineGroups.map( function( group )
    {
        var registryNames = sourceIndex.get( group.source ) || [];

        return {
            source: group.source,
            flags: group.flags,
            baselineCount: group.count,
            baselineRefs: group.refs,
            registryNames: registryNames,
            covered: registryNames.length > 0
        };
    } );
    var missing = rows.filter( function( row )
    {
        return row.covered !== true;
    } );

    return {
        total: rows.length,
        covered: rows.length - missing.length,
        missing: missing,
        rows: rows
    };
}

function createSourceModuleLoader( sourceReader, suffix )
{
    var cache = new Map();

    function loadSourceModule( relativePath )
    {
        var normalized = relativePath;

        if( path.posix.extname( normalized ) === '' )
        {
            normalized += '.js';
        }

        if( cache.has( normalized ) )
        {
            return cache.get( normalized ).exports;
        }

        var filename = path.join( REPO_ROOT, normalized ) + suffix;
        var source = sourceReader( normalized );
        var localModule = new Module( filename, module );

        localModule.filename = filename;
        localModule.paths = Module._nodeModulePaths( path.dirname( path.join( REPO_ROOT, normalized ) ) );
        cache.set( normalized, localModule );

        function localRequire( request )
        {
            if( request.indexOf( './' ) === 0 || request.indexOf( '../' ) === 0 )
            {
                return loadSourceModule( path.posix.normalize( path.posix.join( path.posix.dirname( normalized ), request ) ) );
            }

            return require( request );
        }

        var compiled = vm.runInThisContext( Module.wrap( source ), { filename: filename } );
        compiled.call(
            localModule.exports,
            localModule.exports,
            localRequire,
            localModule,
            filename,
            path.dirname( filename )
        );

        return localModule.exports;
    }

    return loadSourceModule;
}

function createRefModuleLoader( baselineRef )
{
    return createSourceModuleLoader( function( relativePath )
    {
        return readBaselineFile( baselineRef, relativePath );
    }, '#' + baselineRef );
}

function createCurrentModuleLoader()
{
    return createSourceModuleLoader( function( relativePath )
    {
        return fs.readFileSync( path.join( REPO_ROOT, relativePath ), 'utf8' );
    }, '#working-tree' );
}

function cloneConfig( overrides )
{
    var config = stubs.getTestConfig();

    Object.keys( overrides || {} ).forEach( function( key )
    {
        config[ key ] = overrides[ key ];
    } );

    return config;
}

function createUri( fsPath )
{
    return {
        fsPath: fsPath,
        path: fsPath,
        scheme: 'file',
        toString: function()
        {
            return fsPath;
        }
    };
}

function stableValue( value )
{
    if( value instanceof RegExp )
    {
        return {
            source: value.source,
            flags: value.flags
        };
    }

    if( Array.isArray( value ) )
    {
        return value.map( stableValue );
    }

    if( value && typeof value === 'object' )
    {
        var copy = {};
        Object.keys( value ).sort().forEach( function( key )
        {
            if( key !== 'uri' && key !== 'range' && key !== 'captureGroupOffsets' )
            {
                copy[ key ] = stableValue( value[ key ] );
            }
        } );
        return copy;
    }

    return value;
}

function stringifyStable( value )
{
    return JSON.stringify( stableValue( value ) );
}

function recordComparison( rows, name, baselineValue, currentValue )
{
    var baselineStable = stableValue( baselineValue );
    var currentStable = stableValue( currentValue );
    var passed = stringifyStable( baselineStable ) === stringifyStable( currentStable );

    rows.push( {
        name: name,
        passed: passed,
        baseline: baselineStable,
        current: currentStable
    } );
}

function runUtilityParity( baselineLoader )
{
    var baselineUtils = baselineLoader( 'src/utils.js' );
    var currentUtils = createCurrentModuleLoader()( 'src/utils.js' );
    var rows = [];
    var tags = languageMatrix.DEFAULT_TAGS.slice();
    var primaryTag = tags.filter( function( tag )
    {
        return tag === regexRegistry.pattern( 'todoLiteral' );
    } )[ 0 ];
    var metaTags = [
        primaryTag,
        primaryTag + '(api)',
        'A|B',
        'slash\\tag',
        'tag.with.dot',
        '[x]'
    ];
    var config = cloneConfig( {
        tagList: metaTags,
        regexSource: regexRegistry.TAG_CAPTURE_PLACEHOLDER,
        shouldBeCaseSensitive: true,
        enableMultiLineFlag: false,
        subTagRegexString: regexRegistry.pattern( 'subTagPrefixCapture' )
    } );
    var uri = createUri( '/workspace/src/parity.js' );

    baselineUtils.init( config );
    currentUtils.init( cloneConfig( config ) );

    recordComparison( rows, 'DEFAULT_REGEX_SOURCE', baselineUtils.DEFAULT_REGEX_SOURCE, currentUtils.DEFAULT_REGEX_SOURCE );
    recordComparison( rows, 'getRegexSource metachar tags', baselineUtils.getRegexSource( uri ), currentUtils.getRegexSource( uri ) );
    recordComparison( rows, 'getRegexForEditorSearch', baselineUtils.getRegexForEditorSearch( uri ), currentUtils.getRegexForEditorSearch( uri ) );
    recordComparison( rows, 'getRegexForRipGrep', baselineUtils.getRegexForRipGrep( uri ), currentUtils.getRegexForRipGrep( uri ) );
    recordComparison( rows, 'isRgbColour rgb', baselineUtils.isRgbColour( 'rgb(1, 2, 3)' ), currentUtils.isRgbColour( 'rgb(1, 2, 3)' ) );
    recordComparison( rows, 'isRgbColour rgba', baselineUtils.isRgbColour( 'rgba(1, 2, 3, 0.5)' ), currentUtils.isRgbColour( 'rgba(1, 2, 3, 0.5)' ) );
    recordComparison( rows, 'isHexColour short', baselineUtils.isHexColour( '#abc' ), currentUtils.isHexColour( '#abc' ) );
    recordComparison( rows, 'isHexColour alpha', baselineUtils.isHexColour( '#aabbccdd' ), currentUtils.isHexColour( '#aabbccdd' ) );
    recordComparison( rows, 'getCodiconName', baselineUtils.getCodiconName( '$(check-all)' ), currentUtils.getCodiconName( '$(check-all)' ) );
    recordComparison( rows, 'isCodicon true', baselineUtils.isCodicon( '$(check-all)' ), currentUtils.isCodicon( '$(check-all)' ) );
    recordComparison( rows, 'createFolderGlob slash collapse',
        baselineUtils.createFolderGlob( '/repo/src/pkg', '/repo', '/**//*' ),
        currentUtils.createFolderGlob( '/repo/src/pkg', '/repo', '/**//*' )
    );

    return rows;
}

function runAttributeParity( baselineLoader )
{
    var baselineAttributes = baselineLoader( 'src/attributes.js' );
    var currentAttributes = createCurrentModuleLoader()( 'src/attributes.js' );
    var rows = [];
    var customHighlight = {
        'A|B': { icon: 'alert' },
        'slash\\tag': { icon: 'beaker' },
        'tag.with.dot': { icon: 'bug' },
        '[x]': { icon: 'check' }
    };
    var config = {
        isRegexCaseSensitive: function()
        {
            return true;
        },
        customHighlight: function()
        {
            return customHighlight;
        },
        defaultHighlight: function()
        {
            return {};
        },
        tags: function()
        {
            return Object.keys( customHighlight );
        },
        shouldUseColourScheme: function()
        {
            return false;
        },
        foregroundColourScheme: function()
        {
            return [];
        },
        backgroundColourScheme: function()
        {
            return [];
        }
    };

    baselineAttributes.init( config );
    currentAttributes.init( config );

    Object.keys( customHighlight ).forEach( function( tag )
    {
        recordComparison(
            rows,
            'custom highlight ' + tag,
            baselineAttributes.getCustomHighlight( tag ),
            currentAttributes.getCustomHighlight( tag )
        );
    } );

    recordComparison(
        rows,
        'custom highlight miss',
        baselineAttributes.getCustomHighlight( 'plain' ),
        currentAttributes.getCustomHighlight( 'plain' )
    );

    return rows;
}

function normalizeScanResults( results )
{
    return results.map( function( result )
    {
        return {
            actualTag: result.actualTag,
            line: result.line,
            column: result.column,
            endLine: result.endLine,
            endColumn: result.endColumn,
            before: result.before,
            after: result.after,
            displayText: result.displayText,
            match: result.match,
            fullText: result.fullText,
            continuationText: result.continuationText
        };
    } );
}

function runDetectionCase( modules, testCase )
{
    var config = cloneConfig( {
        tagList: testCase.tags,
        regexSource: testCase.regexSource,
        shouldBeCaseSensitive: testCase.caseSensitive,
        enableMultiLineFlag: testCase.multiLine,
        subTagRegexString: testCase.subTagRegex
    } );

    modules.utils.init( config );

    return normalizeScanResults( modules.detection.scanText( createUri( testCase.fsPath ), testCase.text ) );
}

function runDetectionParity( baselineLoader )
{
    var currentLoader = createCurrentModuleLoader();
    var baseline = {
        utils: baselineLoader( 'src/utils.js' ),
        detection: baselineLoader( 'src/detection.js' )
    };
    var current = {
        utils: currentLoader( 'src/utils.js' ),
        detection: currentLoader( 'src/detection.js' )
    };
    var rows = [];
    var tags = languageMatrix.DEFAULT_TAGS.slice();
    var primaryTag = tags.filter( function( tag )
    {
        return tag === regexRegistry.pattern( 'todoLiteral' );
    } )[ 0 ];
    var customTags = [ primaryTag, 'A|B', '[x]' ];
    var cases = [
        {
            name: 'default single-line prefix',
            fsPath: '/workspace/default.js',
            tags: tags,
            regexSource: regexRegistry.DEFAULT_REGEX_SOURCE,
            caseSensitive: true,
            multiLine: false,
            subTagRegex: '',
            text: '// ' + primaryTag + ' alpha'
        },
        {
            name: 'custom metachar tags',
            fsPath: '/workspace/custom.js',
            tags: customTags,
            regexSource: regexRegistry.TAG_CAPTURE_PLACEHOLDER,
            caseSensitive: true,
            multiLine: false,
            subTagRegex: '',
            text: customTags.join( ' item' + LINE_FEED ) + ' item'
        },
        {
            name: 'custom capture without placeholder',
            fsPath: '/workspace/note.js',
            tags: tags,
            regexSource: regexRegistry.pattern( 'noteCapture' ),
            caseSensitive: true,
            multiLine: false,
            subTagRegex: '',
            text: 'NOTE customer text'
        },
        {
            name: 'explicit newline custom regex',
            fsPath: '/workspace/multiline.js',
            tags: [ primaryTag ],
            regexSource: regexRegistry.pattern( 'tagNewlineSecondLine' ),
            caseSensitive: true,
            multiLine: false,
            subTagRegex: '',
            text: primaryTag + LINE_FEED + 'second line'
        },
        {
            name: 'subtag prefix trim',
            fsPath: '/workspace/subtag.js',
            tags: [ primaryTag ],
            regexSource: regexRegistry.pattern( 'tagColonFollowUp' ),
            caseSensitive: true,
            multiLine: false,
            subTagRegex: regexRegistry.pattern( 'subTagPrefix' ),
            text: primaryTag + ': follow up'
        }
    ];

    cases.forEach( function( testCase )
    {
        recordComparison(
            rows,
            testCase.name,
            runDetectionCase( baseline, testCase ),
            runDetectionCase( current, testCase )
        );
    } );

    return rows;
}

function runRegexEngineParity( baselineLoader )
{
    var baselineEngine = baselineLoader( 'src/regexEngine.js' );
    var currentEngine = createCurrentModuleLoader()( 'src/regexEngine.js' );
    var rows = [];
    var patternNames = [
        'tagCapturePlaceholder',
        'tagCaptureNotIdentifierSuffix',
        'tagPositiveHashLookbehind',
        'tagEscapedLookaheadLiteral',
        'tagLookaroundSyntaxCharacterClass',
        'tagBackreferenceOne',
        'namedBackreferenceAngle',
        'namedBackreferenceBrace',
        'namedBackreferenceGBrace',
        'tagWhitespaceBackreference',
        'namedBackreferencePython',
        'tagEscapedBackreferenceOne',
        'tagNegativeXLookahead'
    ];
    var methodNames = [
        'containsLookAround',
        'containsBackreference',
        'containsJavaScriptIncompatibleBackreference',
        'requiresPcre2'
    ];

    patternNames.forEach( function( patternName )
    {
        var source = regexRegistry.pattern( patternName );

        methodNames.forEach( function( methodName )
        {
            recordComparison(
                rows,
                methodName + ' ' + patternName,
                baselineEngine[ methodName ]( source ),
                currentEngine[ methodName ]( source )
            );
        } );
    } );

    return rows;
}

function runBehaviorParity( baselineRef )
{
    var baselineLoader = createRefModuleLoader( baselineRef );
    var groups = [
        {
            name: 'utils',
            rows: runUtilityParity( baselineLoader )
        },
        {
            name: 'attributes',
            rows: runAttributeParity( baselineLoader )
        },
        {
            name: 'detection',
            rows: runDetectionParity( baselineLoader )
        },
        {
            name: 'regexEngine',
            rows: runRegexEngineParity( baselineLoader )
        }
    ];
    var failures = [];

    groups.forEach( function( group )
    {
        group.rows.forEach( function( row )
        {
            if( row.passed !== true )
            {
                failures.push( {
                    group: group.name,
                    row: row
                } );
            }
        } );
    } );

    return {
        total: groups.reduce( function( total, group )
        {
            return total + group.rows.length;
        }, 0 ),
        passed: groups.reduce( function( total, group )
        {
            return total + group.rows.filter( function( row )
            {
                return row.passed === true;
            } ).length;
        }, 0 ),
        failures: failures,
        groups: groups
    };
}

function compileBaselineRegexSamples( baselineGroups )
{
    var samples = [
        '',
        ' ',
        'alpha',
        'NOTE customer text',
        '${workspaceFolder}/src/file.js',
        'rgb(1, 2, 3)',
        'rgba(1, 2, 3, 0.5)',
        '#aabbcc',
        'chunkBytes',
        'release_sha=0123456789abcdef0123456789abcdef01234567',
        '// ' + regexRegistry.pattern( 'todoLiteral' ) + ' sample',
        regexRegistry.pattern( 'todoLiteral' ) + LINE_FEED + 'second line'
    ];
    var compiled = [];

    baselineGroups.forEach( function( group )
    {
        var regex;

        try
        {
            regex = new RegExp( group.source, group.flags );
        }
        catch( error )
        {
            compiled.push( {
                source: group.source,
                flags: group.flags,
                compiled: false,
                error: error.message
            } );
            return;
        }

        compiled.push( {
            source: group.source,
            flags: group.flags,
            compiled: true,
            sampleMatches: samples.filter( function( sample )
            {
                regex.lastIndex = 0;
                return regex.test( sample ) === true;
            } ).length
        } );
    } );

    return compiled;
}

function runEquivalenceAudit( options )
{
    options = options || {};

    var baseline = resolveBaselineRef( options.baselineRef || DEFAULT_BASELINE_REF );
    var baselineRef = baseline.ref;
    var startedAt = process.hrtime.bigint();
    var baselineEntries = baseline.entries;
    var baselineGroups = groupBaselineEntries( baselineEntries );
    var currentHardcodedEntries = collectCurrentHardcodedRegexEntries();
    var sourceCoverage = compareSourceCoverage( baselineGroups );
    var behaviorParity = runBehaviorParity( baselineRef );
    var compiledBaselineRegexes = compileBaselineRegexSamples( baselineGroups );
    var elapsedMs = Number( process.hrtime.bigint() - startedAt ) / 1000000;

    return {
        generatedAt: new Date().toISOString(),
        baselineRef: baselineRef,
        metrics: {
            baselineRegexEntries: baselineEntries.length,
            baselineUniqueRegexes: baselineGroups.length,
            currentHardcodedRegexEntries: currentHardcodedEntries.length,
            registryFragments: regexRegistry.fragmentNames().length,
            registryPatterns: regexRegistry.patternNames().length,
            sourceCoverageCovered: sourceCoverage.covered,
            sourceCoverageTotal: sourceCoverage.total,
            behaviorParityPassed: behaviorParity.passed,
            behaviorParityTotal: behaviorParity.total,
            compiledBaselineRegexes: compiledBaselineRegexes.filter( function( row )
            {
                return row.compiled === true;
            } ).length,
            elapsedMs: Number( elapsedMs.toFixed( 3 ) )
        },
        baselineRegexEntries: baselineEntries,
        baselineRegexGroups: baselineGroups,
        currentHardcodedRegexEntries: currentHardcodedEntries,
        sourceCoverage: sourceCoverage,
        behaviorParity: behaviorParity,
        compiledBaselineRegexes: compiledBaselineRegexes
    };
}

module.exports.runEquivalenceAudit = runEquivalenceAudit;
module.exports.collectBaselineRegexEntries = collectBaselineRegexEntries;
module.exports.collectCurrentHardcodedRegexEntries = collectCurrentHardcodedRegexEntries;
module.exports.compareSourceCoverage = compareSourceCoverage;
module.exports.runBehaviorParity = runBehaviorParity;
