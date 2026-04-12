#!/usr/bin/env node

/* eslint-env node */

'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var vm = require( 'vm' );
var Module = require( 'module' );
var childProcess = require( 'child_process' );

var repoRoot = path.resolve( __dirname, '..', '..' );
var artifactRoot = path.join( repoRoot, 'artifacts', 'perf' );

function ensureDirectory( directory )
{
    fs.mkdirSync( directory, { recursive: true } );
}

function currentFilePath( relativePath )
{
    return path.join( repoRoot, relativePath );
}

function loadModuleFromSource( filename, source, stubs )
{
    var localModule = new Module( filename, module );
    var originalLoad = Module._load;

    localModule.filename = filename;
    localModule.paths = Module._nodeModulePaths( path.dirname( filename ) );

    Module._load = function( request, parent, isMain )
    {
        if( stubs && Object.prototype.hasOwnProperty.call( stubs, request ) )
        {
            return stubs[ request ];
        }

        return originalLoad.call( this, request, parent, isMain );
    };

    try
    {
        var wrapped = Module.wrap( source );
        var compiled = vm.runInThisContext( wrapped, { filename: filename } );
        compiled.call(
            localModule.exports,
            localModule.exports,
            function( request )
            {
                return Module._load( request, localModule, false );
            },
            localModule,
            filename,
            path.dirname( filename )
        );
        return localModule.exports;
    }
    finally
    {
        Module._load = originalLoad;
    }
}

function loadCurrentModule( relativePath, stubs )
{
    var filename = currentFilePath( relativePath );
    var source = fs.readFileSync( filename, 'utf8' );

    return loadModuleFromSource( filename, source, stubs );
}

function loadGitModule( relativePath, stubs )
{
    var filename = currentFilePath( relativePath );
    var source = childProcess.execFileSync( 'git', [ 'show', 'HEAD:' + relativePath ], {
        cwd: repoRoot,
        encoding: 'utf8'
    } );

    return loadModuleFromSource( filename + '#HEAD', source, stubs );
}

function createUri( fsPath )
{
    return {
        scheme: 'file',
        fsPath: fsPath,
        path: fsPath,
        toString: function()
        {
            return fsPath;
        }
    };
}

function percentile( values, fraction )
{
    if( values.length === 0 )
    {
        return 0;
    }

    var index = Math.max( 0, Math.min( values.length - 1, Math.ceil( values.length * fraction ) - 1 ) );
    return values[ index ];
}

function round( value )
{
    return Number( value.toFixed( 2 ) );
}

function createMeasurement( name, iterations, fn )
{
    var samples = [];
    var peakRss = 0;
    var lastValue;
    var index;

    for( index = 0; index < iterations; ++index )
    {
        if( typeof ( global.gc ) === 'function' )
        {
            global.gc();
        }

        var start = process.hrtime.bigint();
        lastValue = fn();
        var elapsedMs = Number( process.hrtime.bigint() - start ) / 1000000;
        samples.push( elapsedMs );
        peakRss = Math.max( peakRss, process.memoryUsage().rss );
    }

    samples.sort( function( a, b ) { return a - b; } );

    return {
        name: name,
        iterations: iterations,
        p50Ms: round( percentile( samples, 0.5 ) ),
        p95Ms: round( percentile( samples, 0.95 ) ),
        minMs: round( samples[ 0 ] ),
        maxMs: round( samples[ samples.length - 1 ] ),
        peakRssMiB: round( peakRss / 1024 / 1024 ),
        sampleMs: samples.map( round ),
        lastValue: lastValue
    };
}

function createDetectionConfig( options )
{
    return {
        tags: function()
        {
            return options.tags.slice();
        },
        regex: function()
        {
            return {
                tags: options.tags.slice(),
                regex: options.regex,
                caseSensitive: options.caseSensitive !== false,
                multiLine: options.multiLine === true
            };
        },
        subTagRegex: function()
        {
            return options.subTagRegex || '(^:\\s*)';
        }
    };
}

function buildDefaultDetectionText( lineCount )
{
    var lines = [];
    var index;

    for( index = 0; index < lineCount; ++index )
    {
        if( index % 17 === 0 )
        {
            lines.push( '// TODO item ' + index );
        }
        else
        {
            lines.push( 'const value' + index + ' = ' + index + ';' );
        }
    }

    return lines.join( '\n' );
}

function buildCustomDetectionText( lineCount )
{
    var lines = [];
    var index;

    for( index = 0; index < lineCount; ++index )
    {
        if( index % 13 === 0 )
        {
            lines.push( '/* TODO: custom item ' + index + ' */' );
        }
        else
        {
            lines.push( 'const custom' + index + ' = "value";' );
        }
    }

    return lines.join( '\n' );
}

function benchmarkDetectionScans()
{
    var currentUtils = loadCurrentModule( 'src/utils.js' );
    var currentDetection = loadCurrentModule( 'src/detection.js', {
        './utils.js': currentUtils
    } );
    var baselineUtils = loadGitModule( 'src/utils.js' );
    var baselineDetection = loadGitModule( 'src/detection.js', {
        './utils.js': baselineUtils
    } );
    var defaultConfig = createDetectionConfig( {
        tags: [ 'TODO', 'FIXME', 'BUG', 'HACK', 'XXX', '[ ]', '[x]' ],
        regex: currentUtils.DEFAULT_REGEX_SOURCE
    } );
    var customConfig = createDetectionConfig( {
        tags: [ 'TODO' ],
        regex: '(TODO):\\s*[^\\n]+',
        multiLine: false
    } );
    var defaultText = buildDefaultDetectionText( 50000 );
    var customText = buildCustomDetectionText( 50000 );
    var defaultUri = createUri( '/tmp/large-default.js' );
    var customUri = createUri( '/tmp/large-custom.js' );

    currentUtils.init( defaultConfig );
    baselineUtils.init( defaultConfig );
    var currentDefault = createMeasurement( 'scan-large-default-current', 15, function()
    {
        return currentDetection.scanText( defaultUri, defaultText ).length;
    } );
    var baselineDefault = createMeasurement( 'scan-large-default-baseline', 15, function()
    {
        return baselineDetection.scanText( defaultUri, defaultText ).length;
    } );

    currentUtils.init( customConfig );
    baselineUtils.init( customConfig );
    var currentCustom = createMeasurement( 'scan-large-custom-regex-current', 15, function()
    {
        return currentDetection.scanText( customUri, customText ).length;
    } );
    var baselineCustom = createMeasurement( 'scan-large-custom-regex-baseline', 15, function()
    {
        return baselineDetection.scanText( customUri, customText ).length;
    } );

    return [
        {
            name: 'scan-large-default',
            current: currentDefault,
            baseline: baselineDefault
        },
        {
            name: 'scan-large-custom-regex',
            current: currentCustom,
            baseline: baselineCustom
        }
    ];
}

function createTreeVscodeStub()
{
    function EventEmitter()
    {
        this._listener = undefined;
        this.event = function( listener )
        {
            this._listener = listener;
        }.bind( this );
        this.fire = function( value )
        {
            if( this._listener )
            {
                this._listener( value );
            }
        }.bind( this );
    }

    function TreeItem( label )
    {
        this.label = label;
    }

    function ThemeIcon( name )
    {
        this.id = name;
    }

    ThemeIcon.Folder = new ThemeIcon( 'folder' );
    ThemeIcon.File = new ThemeIcon( 'file' );

    function Position( line, character )
    {
        this.line = line;
        this.character = character;
    }

    function Selection( start, end )
    {
        this.start = start;
        this.end = end;
    }

    return {
        EventEmitter: EventEmitter,
        TreeItem: TreeItem,
        ThemeIcon: ThemeIcon,
        Position: Position,
        Selection: Selection,
        Uri: {
            file: createUri
        },
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2
        },
        workspace: {
            getConfiguration: function()
            {
                return {
                    compactFolders: false,
                    get: function( key, defaultValue )
                    {
                        return key === 'revealBehaviour' ? 'start of todo' : defaultValue;
                    },
                    inspect: function( key )
                    {
                        return {
                            defaultValue: key === 'revealBehaviour' ? 'start of todo' : undefined,
                            globalValue: undefined,
                            workspaceValue: undefined,
                            workspaceFolderValue: undefined
                        };
                    }
                };
            }
        }
    };
}

function createTreeConfig()
{
    return {
        tags: function() { return [ 'TODO', 'FIXME' ]; },
        shouldGroupByTag: function() { return false; },
        shouldGroupBySubTag: function() { return false; },
        shouldShowTagsOnly: function() { return false; },
        shouldFlatten: function() { return false; },
        shouldCompactFolders: function() { return false; },
        shouldExpand: function() { return false; },
        shouldShowScanModeInTree: function() { return false; },
        scanMode: function() { return 'workspace'; },
        showBadges: function() { return false; },
        shouldShowCounts: function() { return true; },
        shouldHideIconsWhenGroupedByTag: function() { return false; },
        tooltipFormat: function() { return '${filepath}, ${line}'; },
        labelFormat: function() { return '${tag} ${after}'; },
        subTagClickUrl: function() { return ''; },
        isRegexCaseSensitive: function() { return true; },
        shouldHideFromTree: function() { return false; },
        shouldHideFromStatusBar: function() { return false; },
        shouldHideFromActivityBar: function() { return false; },
        shouldSortTree: function() { return true; },
        shouldSortTagsOnlyViewAlphabetically: function() { return false; },
        showFilterCaseSensitive: function() { return false; },
        tagGroup: function() { return undefined; }
    };
}

function createWorkspaceState()
{
    var store = {};
    return {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( store, key ) ? store[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            store[ key ] = value;
            return Promise.resolve();
        }
    };
}

function createTreeResults()
{
    var resultsByUri = new Map();
    var fileIndex;
    var todoIndex;

    for( fileIndex = 0; fileIndex < 400; ++fileIndex )
    {
        var uri = createUri( '/workspace/src/file-' + fileIndex + '.js' );
        var fileResults = [];

        for( todoIndex = 0; todoIndex < 30; ++todoIndex )
        {
            fileResults.push( {
                uri: uri,
                line: todoIndex + 1,
                column: 1,
                endLine: todoIndex + 1,
                endColumn: 12,
                actualTag: todoIndex % 2 === 0 ? 'TODO' : 'FIXME',
                displayText: 'item ' + fileIndex + ':' + todoIndex,
                continuationText: [],
                match: 'TODO item ' + fileIndex + ':' + todoIndex
            } );
        }

        resultsByUri.set( uri.toString(), {
            uri: uri,
            results: fileResults
        } );
    }

    return Array.from( resultsByUri.values() );
}

function loadTreeModule(relativePath)
{
    var vscodeStub = createTreeVscodeStub();
    var configStub = createTreeConfig();

    return loadCurrentModule( relativePath, {
        vscode: vscodeStub,
        './utils.js': {
            formatLabel: function( template, node ) { return node.label || template; },
            toGlobArray: function( value ) { return Array.isArray( value ) ? value : []; }
        },
        './icons.js': {
            getTreeIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            }
        },
        './config.js': configStub,
        './extensionIdentity.js': {
            COMMANDS: {
                revealInFile: 'better-todo-tree.revealInFile',
                openUrl: 'better-todo-tree.openUrl'
            },
            getSetting: function( setting, defaultValue )
            {
                return setting === 'general.revealBehaviour' ? 'start of todo' : defaultValue;
            }
        }
    } );
}

function loadBaselineTreeModule()
{
    var vscodeStub = createTreeVscodeStub();
    var configStub = createTreeConfig();

    return loadGitModule( 'src/tree.js', {
        vscode: vscodeStub,
        './utils.js': {
            formatLabel: function( template, node ) { return node.label || template; },
            toGlobArray: function( value ) { return Array.isArray( value ) ? value : []; }
        },
        './icons.js': {
            getTreeIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            }
        },
        './config.js': configStub,
        './extensionIdentity.js': {
            COMMANDS: {
                revealInFile: 'better-todo-tree.revealInFile',
                openUrl: 'better-todo-tree.openUrl'
            },
            getSetting: function( setting, defaultValue )
            {
                return setting === 'general.revealBehaviour' ? 'start of todo' : defaultValue;
            }
        }
    } );
}

function renderTree(provider)
{
    function visit(node)
    {
        provider.getTreeItem( node );
        ( provider.getChildren( node ) || [] ).forEach( visit );
    }

    ( provider.getChildren() || [] ).forEach( visit );
    return provider.getChildren().length;
}

function benchmarkTreeRender()
{
    var currentTree = loadTreeModule( 'src/tree.js' );
    var baselineTree = loadBaselineTreeModule();
    var workspaceState = createWorkspaceState();
    var workspaceFolder = {
        name: 'workspace',
        uri: {
            scheme: 'file',
            fsPath: '/workspace'
        }
    };
    var treeEntries = createTreeResults();
    var currentProvider = new currentTree.TreeNodeProvider( { workspaceState: workspaceState }, function() {}, function() {} );
    var baselineProvider = new baselineTree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    currentProvider.clear( [ workspaceFolder ] );
    baselineProvider.clear( [ workspaceFolder ] );

    treeEntries.forEach( function( entry )
    {
        currentProvider.replaceDocument( entry.uri, entry.results );
        baselineProvider.replaceDocument( entry.uri, entry.results );
    } );

    currentProvider.finalizePendingChanges( undefined, { fullSort: true, refilterAll: true } );
    baselineProvider.finalizePendingChanges( undefined, { fullSort: true, refilterAll: true } );

    return {
        name: 'tree-render-counts',
        current: createMeasurement( 'tree-render-counts-current', 15, function()
        {
            return renderTree( currentProvider );
        } ),
        baseline: createMeasurement( 'tree-render-counts-baseline', 15, function()
        {
            return renderTree( baselineProvider );
        } )
    };
}

function createHighlightModule(relativePath)
{
    var creationCount = { value: 0 };
    var matches = [];
    var index;

    for( index = 0; index < 200; ++index )
    {
        matches.push( {
            actualTag: 'TODO',
            commentStartOffset: index * 20,
            commentEndOffset: index * 20 + 18,
            matchStartOffset: index * 20 + 3,
            matchEndOffset: index * 20 + 12,
            tagStartOffset: index * 20 + 3,
            tagEndOffset: index * 20 + 7
        } );
    }

    var moduleExports = loadCurrentModule( relativePath, {
        vscode: {
            ThemeColor: function( name ) { this.name = name; },
            Position: function( line, character )
            {
                this.line = line;
                this.character = character;
            },
            Range: function( start, end )
            {
                this.start = start;
                this.end = end;
            },
            window: {
                createTextEditorDecorationType: function( options )
                {
                    creationCount.value++;
                    return Object.assign( {
                        dispose: function() {}
                    }, options );
                }
            }
        },
        './config.js': {
            customHighlight: function() { return {}; },
            subTagRegex: function() { return '(^:\\s*)'; },
            tagGroup: function() { return undefined; }
        },
        './utils.js': {
            isHexColour: function() { return false; },
            isRgbColour: function() { return false; },
            isValidColour: function() { return true; },
            isThemeColour: function() { return false; },
            hexToRgba: function( value ) { return value; },
            complementaryColour: function() { return '#ffffff'; },
            setRgbAlpha: function( value ) { return value; }
        },
        './attributes.js': {
            getForeground: function() { return undefined; },
            getBackground: function() { return undefined; },
            hasCustomHighlight: function() { return false; },
            getAttribute: function( tag, attribute, defaultValue )
            {
                if( attribute === 'type' )
                {
                    return 'tag';
                }
                return defaultValue;
            }
        },
        './icons.js': {
            getGutterIcon: function()
            {
                return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
            }
        },
        './detection.js': {
            scanDocument: function()
            {
                return matches;
            }
        },
        './extensionIdentity.js': {
            getSetting: function( setting, defaultValue )
            {
                return defaultValue;
            }
        }
    } );
    var text = Array.from( { length: 200 }, function( _, indexValue )
    {
        return '// TODO item ' + indexValue;
    } ).join( '\n' );
    var editor = {
        viewColumn: 1,
        document: {
            uri: createUri( '/tmp/highlight.js' ),
            version: 1,
            getText: function() { return text; },
            positionAt: function( offset )
            {
                return { line: Math.floor( offset / 20 ), character: offset % 20 };
            },
            lineAt: function( line )
            {
                return { range: { end: { line: line, character: 18 } } };
            }
        },
        setDecorations: function() {}
    };

    moduleExports.init( { subscriptions: { push: function() {} } }, function() {} );

    return {
        module: moduleExports,
        editor: editor,
        creationCount: creationCount
    };
}

function createBaselineHighlightModule()
{
    var creationCount = { value: 0 };
    var matches = [];
    var index;

    for( index = 0; index < 200; ++index )
    {
        matches.push( {
            actualTag: 'TODO',
            commentStartOffset: index * 20,
            commentEndOffset: index * 20 + 18,
            matchStartOffset: index * 20 + 3,
            matchEndOffset: index * 20 + 12,
            tagStartOffset: index * 20 + 3,
            tagEndOffset: index * 20 + 7
        } );
    }

    var moduleExports = loadGitModule( 'src/highlights.js', {
        vscode: {
            ThemeColor: function( name ) { this.name = name; },
            Position: function( line, character )
            {
                this.line = line;
                this.character = character;
            },
            Range: function( start, end )
            {
                this.start = start;
                this.end = end;
            },
            window: {
                createTextEditorDecorationType: function( options )
                {
                    creationCount.value++;
                    return Object.assign( {
                        dispose: function() {}
                    }, options );
                }
            }
        },
        './config.js': {
            customHighlight: function() { return {}; },
            subTagRegex: function() { return '(^:\\s*)'; },
            tagGroup: function() { return undefined; }
        },
        './utils.js': {
            isHexColour: function() { return false; },
            isRgbColour: function() { return false; },
            isValidColour: function() { return true; },
            isThemeColour: function() { return false; },
            hexToRgba: function( value ) { return value; },
            complementaryColour: function() { return '#ffffff'; },
            setRgbAlpha: function( value ) { return value; }
        },
        './attributes.js': {
            getForeground: function() { return undefined; },
            getBackground: function() { return undefined; },
            getAttribute: function( tag, attribute, defaultValue )
            {
                if( attribute === 'type' )
                {
                    return 'tag';
                }
                return defaultValue;
            }
        },
        './icons.js': {
            getGutterIcon: function()
            {
                return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
            }
        },
        './detection.js': {
            scanDocument: function()
            {
                return matches;
            }
        },
        './extensionIdentity.js': {
            getSetting: function( setting, defaultValue )
            {
                return defaultValue;
            }
        }
    } );
    var text = Array.from( { length: 200 }, function( _, indexValue )
    {
        return '// TODO item ' + indexValue;
    } ).join( '\n' );
    var editor = {
        viewColumn: 1,
        document: {
            uri: createUri( '/tmp/highlight.js' ),
            version: 1,
            getText: function() { return text; },
            positionAt: function( offset )
            {
                return { line: Math.floor( offset / 20 ), character: offset % 20 };
            },
            lineAt: function( line )
            {
                return { range: { end: { line: line, character: 18 } } };
            }
        },
        setDecorations: function() {}
    };

    moduleExports.init( { subscriptions: { push: function() {} } }, function() {} );

    return {
        module: moduleExports,
        editor: editor,
        creationCount: creationCount
    };
}

function benchmarkHighlights()
{
    var currentHarness = createHighlightModule( 'src/highlights.js' );
    var baselineHarness = createBaselineHighlightModule();

    return {
        name: 'highlight-repeat-visible-doc',
        current: createMeasurement( 'highlight-repeat-visible-doc-current', 25, function()
        {
            currentHarness.module.highlight( currentHarness.editor );
            return currentHarness.creationCount.value;
        } ),
        baseline: createMeasurement( 'highlight-repeat-visible-doc-baseline', 25, function()
        {
            baselineHarness.module.highlight( baselineHarness.editor );
            return baselineHarness.creationCount.value;
        } )
    };
}

function createAttributesConfig(customHighlightCount)
{
    var customHighlights = {};
    var index;

    for( index = 0; index < customHighlightCount; ++index )
    {
        customHighlights[ 'TAG' + index ] = {
            foreground: 'red',
            background: 'yellow',
            icon: 'check',
            type: 'tag'
        };
    }

    return {
        isRegexCaseSensitive: function() { return false; },
        customHighlight: function() { return customHighlights; },
        defaultHighlight: function() { return { background: 'blue' }; },
        shouldUseColourScheme: function() { return false; },
        backgroundColourScheme: function() { return []; },
        foregroundColourScheme: function() { return []; },
        tags: function()
        {
            return Object.keys( customHighlights );
        }
    };
}

function benchmarkAttributes()
{
    var config = createAttributesConfig( 200 );
    var currentAttributes = loadCurrentModule( 'src/attributes.js' );
    var baselineAttributes = loadGitModule( 'src/attributes.js' );
    var lookupTags = Array.from( { length: 100000 }, function( _, index )
    {
        return 'TAG' + ( index % 200 );
    } );

    currentAttributes.init( config );
    baselineAttributes.init( config );

    return {
        name: 'attributes-custom-highlight',
        current: createMeasurement( 'attributes-custom-highlight-current', 10, function()
        {
            return lookupTags.reduce( function( count, tag )
            {
                return count + ( currentAttributes.getAttribute( tag, 'foreground', undefined ) ? 1 : 0 );
            }, 0 );
        } ),
        baseline: createMeasurement( 'attributes-custom-highlight-baseline', 10, function()
        {
            return lookupTags.reduce( function( count, tag )
            {
                return count + ( baselineAttributes.getAttribute( tag, 'foreground', undefined ) ? 1 : 0 );
            }, 0 );
        } )
    };
}

function createWorkspaceFileEntry(fileIndex, matchesPerFile)
{
    var filePath = '/workspace/src/file-' + fileIndex + '.txt';
    var lines = [];
    var matches = [];
    var matchIndex;
    var lineNumber = 1;

    for( matchIndex = 0; matchIndex < matchesPerFile; ++matchIndex )
    {
        var text = 'TODO: workspace item ' + fileIndex + ':' + matchIndex;
        lines.push( text );
        matches.push( {
            fsPath: filePath,
            line: lineNumber,
            column: 1,
            match: text
        } );
        lineNumber++;
        lines.push( 'const filler' + matchIndex + ' = 1;' );
        lineNumber++;
    }

    return {
        filePath: filePath,
        text: lines.join( '\n' ),
        matches: matches
    };
}

function benchmarkWorkspaceStreaming()
{
    var currentUtils = loadCurrentModule( 'src/utils.js' );
    var currentDetection = loadCurrentModule( 'src/detection.js', {
        './utils.js': currentUtils
    } );
    var config = createDetectionConfig( {
        tags: [ 'TODO' ],
        regex: '(TODO):\\s*[^\\n]+'
    } );
    var fileCount = 1500;
    var matchesPerFile = 20;

    currentUtils.init( config );

    function normalizeFile(filePath, text, fileMatches)
    {
        var uri = createUri( filePath );
        var context = currentDetection.createScanContext( uri, text );
        return fileMatches.map( function( match )
        {
            return currentDetection.normalizeRegexMatchWithContext( context, match );
        } ).filter( Boolean ).length;
    }

    return {
        name: 'workspace-json-streaming',
        current: createMeasurement( 'workspace-json-streaming-current', 10, function()
        {
            var total = 0;
            var fileIndex;

            for( fileIndex = 0; fileIndex < fileCount; ++fileIndex )
            {
                var entry = createWorkspaceFileEntry( fileIndex, matchesPerFile );
                total += normalizeFile( entry.filePath, entry.text, entry.matches );
            }

            return total;
        } ),
        baseline: createMeasurement( 'workspace-json-streaming-baseline', 10, function()
        {
            var allMatches = [];
            var groupedMatches = new Map();
            var fileTexts = new Map();
            var total = 0;
            var fileIndex;

            for( fileIndex = 0; fileIndex < fileCount; ++fileIndex )
            {
                var entry = createWorkspaceFileEntry( fileIndex, matchesPerFile );
                allMatches = allMatches.concat( entry.matches );
                fileTexts.set( entry.filePath, entry.text );
            }

            allMatches.forEach( function( match )
            {
                if( groupedMatches.has( match.fsPath ) !== true )
                {
                    groupedMatches.set( match.fsPath, [] );
                }

                groupedMatches.get( match.fsPath ).push( match );
            } );

            groupedMatches.forEach( function( fileMatches, filePath )
            {
                total += normalizeFile( filePath, fileTexts.get( filePath ), fileMatches );
            } );

            return total;
        } )
    };
}

function renderMarkdownReport(results)
{
    return [
        '# Runtime Benchmarks',
        '',
        '| Scenario | Baseline p50 ms | Current p50 ms | Baseline p95 ms | Current p95 ms | Baseline RSS MiB | Current RSS MiB |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    ].concat( results.map( function( entry )
    {
        return '| ' + entry.name +
            ' | ' + ( entry.baseline ? entry.baseline.p50Ms : '-' ) +
            ' | ' + entry.current.p50Ms +
            ' | ' + ( entry.baseline ? entry.baseline.p95Ms : '-' ) +
            ' | ' + entry.current.p95Ms +
            ' | ' + ( entry.baseline ? entry.baseline.peakRssMiB : '-' ) +
            ' | ' + entry.current.peakRssMiB + ' |';
    } ) ).join( '\n' ) + '\n';
}

function main()
{
    ensureDirectory( artifactRoot );

    var results = []
        .concat( benchmarkDetectionScans() )
        .concat( [ benchmarkTreeRender() ] )
        .concat( [ benchmarkHighlights() ] )
        .concat( [ benchmarkWorkspaceStreaming() ] )
        .concat( [ benchmarkAttributes() ] );

    var jsonPath = path.join( artifactRoot, 'runtime-benchmarks.json' );
    var markdownPath = path.join( artifactRoot, 'runtime-benchmarks.md' );
    var payload = {
        generatedAt: new Date().toISOString(),
        node: process.version,
        results: results
    };

    fs.writeFileSync( jsonPath, JSON.stringify( payload, null, 2 ) + '\n' );
    fs.writeFileSync( markdownPath, renderMarkdownReport( results ) );

    process.stdout.write( JSON.stringify( payload, null, 2 ) + '\n' );
}

main();
