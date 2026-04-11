var helpers = require( './moduleHelpers.js' );
var issue888Helpers = require( './issue888Helpers.js' );
var matrixHelpers = require( './matrixHelpers.js' );
var languageMatrix = require( './languageMatrix.js' );
var actualUtils = require( '../src/utils.js' );
var actualDetection = require( '../src/detection.js' );

var DEFAULT_INCLUDE_GLOBS = languageMatrix.findConfigurationProperty( 'better-todo-tree.filtering.includeGlobs' ).default.slice();
var DEFAULT_EXCLUDE_GLOBS = languageMatrix.findConfigurationProperty( 'better-todo-tree.filtering.excludeGlobs' ).default.slice();

function createConfigurationSection( values, explicitTarget )
{
    function getNestedValue( source, key )
    {
        return key.split( '.' ).reduce( function( current, part )
        {
            return current && current[ part ] !== undefined ? current[ part ] : undefined;
        }, source );
    }

    var section = Object.assign( {}, values );
    var target = explicitTarget || 'global';
    section.get = function( key, defaultValue )
    {
        var value = getNestedValue( values, key );
        return value === undefined ? defaultValue : value;
    };
    section.update = function()
    {
        return Promise.resolve();
    };
    section.inspect = function( key )
    {
        var value = key ? getNestedValue( values, key ) : values;
        return {
            defaultValue: value,
            globalValue: target === 'global' ? value : undefined,
            workspaceValue: target === 'workspace' ? value : undefined,
            workspaceFolderValue: target === 'workspaceFolder' ? value : undefined
        };
    };

    return section;
}

function createSearchResultsStub()
{
    var entries = new Map();
    var dirty = new Set();

    return {
        clear: function()
        {
            entries.clear();
            dirty.clear();
        },
        replaceUriResults: function( uri, results )
        {
            entries.set( uri.toString(), { uri: uri, results: results } );
            dirty.add( uri.toString() );
        },
        remove: function( uri )
        {
            entries.delete( uri.toString() );
            dirty.add( uri.toString() );
        },
        drainDirtyResults: function()
        {
            var drained = Array.from( dirty ).map( function( key )
            {
                var entry = entries.get( key );
                return {
                    uri: entry ? entry.uri : matrixHelpers.createUri( key ),
                    results: entry ? entry.results : []
                };
            } );
            dirty.clear();
            return drained;
        },
        containsMarkdown: function()
        {
            return false;
        },
        count: function()
        {
            var total = 0;
            entries.forEach( function( entry )
            {
                total += entry.results.length;
            } );
            return total;
        },
        filter: function() {},
        markAsNotAdded: function()
        {
            entries.forEach( function( entry )
            {
                dirty.add( entry.uri.toString() );
            } );
        },
        forEachResult: function( iterator )
        {
            entries.forEach( function( entry )
            {
                entry.results.forEach( iterator );
            } );
        }
    };
}

function createProviderStub()
{
    return {
        replaceCalls: [],
        refreshCalls: 0,
        clearCalls: 0,
        rebuildCalls: 0,
        finalizeCalls: [],
        clear: function() { this.clearCalls++; },
        rebuild: function() { this.rebuildCalls++; },
        replaceDocument: function( uri, results ) { this.replaceCalls.push( { uri: uri, results: results } ); },
        finalizePendingChanges: function( filter, options ) { this.finalizeCalls.push( { filter: filter, options: options } ); },
        refresh: function() { this.refreshCalls++; },
        getTagCountsForActivityBar: function() { return {}; },
        getTagCountsForStatusBar: function() { return {}; },
        exportTree: function() { return {}; },
        hasSubTags: function() { return false; },
        getChildren: function() { return []; },
        clearExpansionState: function() {},
        setExpanded: function() {},
        dispose: function() {}
    };
}

function createVscodeStub( options )
{
    var commandHandlers = {};
    var workspaceListeners = {};
    var windowListeners = {};
    var executedCommands = [];
    var filteringDefaults = Object.assign( {
        passGlobsToRipgrep: true,
        includeGlobs: DEFAULT_INCLUDE_GLOBS.slice(),
        excludeGlobs: DEFAULT_EXCLUDE_GLOBS.slice(),
        includeHiddenFiles: false,
        useBuiltInExcludes: 'none'
    }, options.filteringOverrides || {} );

    var rootSection = createConfigurationSection( {
        tree: {
            buttons: {
                reveal: false,
                scanMode: false,
                viewStyle: false,
                groupByTag: false,
                groupBySubTag: false,
                filter: false,
                refresh: false,
                expand: false,
                export: false
            },
            trackFile: false,
            expanded: false,
            flat: false,
            tagsOnly: false,
            groupedByTag: false,
            groupedBySubTag: false,
            hideTreeWhenEmpty: false,
            autoRefresh: true,
            scanAtStartup: true,
            scanMode: options.scanMode
        },
        filtering: filteringDefaults,
        general: {
            debug: false,
            automaticGitRefreshInterval: 0,
            periodicRefreshInterval: 0,
            rootFolder: "",
            tags: languageMatrix.DEFAULT_TAGS.slice(),
            statusBar: 'total'
        },
        ripgrep: {
            ripgrepArgs: '',
            ripgrepMaxBuffer: 200,
            usePatternFile: false
        }
    } );

    var generalSection = createConfigurationSection( {
            debug: false,
            automaticGitRefreshInterval: 0,
            periodicRefreshInterval: 0,
            rootFolder: "",
            exportPath: '/tmp/todo-tree.txt',
            statusBar: 'total',
            statusBarClickBehaviour: '',
            showActivityBarBadge: false,
            tags: languageMatrix.DEFAULT_TAGS.slice(),
            tagGroups: {},
            schemes: [ 'file' ]
        } );
    var treeSection = createConfigurationSection( {
            autoRefresh: true,
            trackFile: false,
            showCountsInTree: false,
            showBadges: false,
            scanMode: options.scanMode,
            showCurrentScanMode: false,
            scanAtStartup: true,
            hideTreeWhenEmpty: false,
            buttons: rootSection.get( 'tree.buttons' )
        } );
    var filteringSection = createConfigurationSection( {
            passGlobsToRipgrep: filteringDefaults.passGlobsToRipgrep,
            includeGlobs: filteringDefaults.includeGlobs.slice(),
            excludeGlobs: filteringDefaults.excludeGlobs.slice(),
            includeHiddenFiles: filteringDefaults.includeHiddenFiles,
            includedWorkspaces: [],
            excludedWorkspaces: [],
            useBuiltInExcludes: filteringDefaults.useBuiltInExcludes,
            scopes: []
        } );
    var regexSection = createConfigurationSection( {
            regex: options.regexSource || '($TAGS)',
            regexCaseSensitive: true,
            enableMultiLine: false,
            subTagRegex: ''
        } );
    var ripgrepSection = createConfigurationSection( {
            ripgrepArgs: '',
            ripgrepMaxBuffer: 200,
            usePatternFile: false
        } );

    var sections = {
        'todo-tree': rootSection,
        'better-todo-tree': rootSection,
        'todo-tree.general': generalSection,
        'better-todo-tree.general': generalSection,
        'todo-tree.tree': treeSection,
        'better-todo-tree.tree': treeSection,
        'todo-tree.filtering': filteringSection,
        'better-todo-tree.filtering': filteringSection,
        'todo-tree.regex': regexSection,
        'better-todo-tree.regex': regexSection,
        'todo-tree.ripgrep': ripgrepSection,
        'better-todo-tree.ripgrep': ripgrepSection,
        'files.exclude': createConfigurationSection( {} ),
        'search.exclude': createConfigurationSection( {} ),
        'explorer': createConfigurationSection( { compactFolders: false } )
    };

    function registerListener( store, name, listener )
    {
        store[ name ] = listener;
        return { dispose: function() {} };
    }

    function createTreeView()
    {
        return {
            badge: undefined,
            title: 'Tree',
            message: '',
            visible: false,
            onDidExpandElement: function( listener ) { return registerListener( windowListeners, 'expand', listener ); },
            onDidCollapseElement: function( listener ) { return registerListener( windowListeners, 'collapse', listener ); }
        };
    }

    return {
        commandHandlers: commandHandlers,
        workspaceListeners: workspaceListeners,
        executedCommands: executedCommands,
        extensions: {
            all: options.extensions || [ {
                packageJSON: {
                    contributes: {
                        languages: [
                            { id: 'python', extensions: [ '.py' ] },
                            { id: 'markdown', extensions: [ '.md' ] },
                            { id: 'javascript', extensions: [ '.js' ] },
                            { id: 'typescriptreact', extensions: [ '.tsx', '.ts' ] }
                        ]
                    }
                }
            } ]
        },
        StatusBarAlignment: { Left: 0 },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        ThemeColor: function( name ) { this.name = name; },
        Position: function( line, character ) { this.line = line; this.character = character; },
        Range: function( start, end ) { this.start = start; this.end = end; },
        Selection: function( start, end ) { this.start = start; this.end = end; },
        Uri: {
            file: function( fsPath )
            {
                return matrixHelpers.createUri( fsPath );
            },
            parse: function( value )
            {
                return { path: value, fsPath: value, toString: function() { return value; } };
            }
        },
        env: {
            openExternal: function() { return Promise.resolve(); }
        },
        commands: {
            executeCommand: function( command )
            {
                executedCommands.push( Array.prototype.slice.call( arguments ) );
                return Promise.resolve();
            },
            registerCommand: function( name, handler )
            {
                commandHandlers[ name ] = handler;
                return { dispose: function() {} };
            }
        },
        window: {
            visibleTextEditors: options.visibleTextEditors || [],
            activeTextEditor: options.activeTextEditor,
            activeNotebookEditor: options.activeNotebookEditor,
            createStatusBarItem: function()
            {
                return {
                    text: '',
                    tooltip: '',
                    command: undefined,
                    show: function() {},
                    hide: function() {},
                    dispose: function() {}
                };
            },
            createTreeView: function()
            {
                return createTreeView();
            },
            createOutputChannel: function()
            {
                return {
                    appendLine: function() {},
                    dispose: function() {}
                };
            },
            showInformationMessage: function() { return Promise.resolve(); },
            showWarningMessage: function() { return Promise.resolve(); },
            showErrorMessage: function() { return Promise.resolve(); },
            showInputBox: function() { return Promise.resolve(); },
            showQuickPick: function() { return Promise.resolve(); },
            showTextDocument: function() { return Promise.resolve(); },
            onDidChangeActiveTextEditor: function( listener ) { return registerListener( workspaceListeners, 'activeEditor', listener ); }
        },
        workspace: {
            workspaceFolders: options.workspaceFolders || [],
            registerTextDocumentContentProvider: function()
            {
                return { dispose: function() {} };
            },
            getConfiguration: function( section )
            {
                return sections[ section ] || createConfigurationSection( {} );
            },
            notebookDocuments: options.notebookDocuments || [],
            onDidSaveTextDocument: function( listener ) { return registerListener( workspaceListeners, 'save', listener ); },
            onDidOpenTextDocument: function( listener ) { return registerListener( workspaceListeners, 'open', listener ); },
            onDidCloseTextDocument: function( listener ) { return registerListener( workspaceListeners, 'close', listener ); },
            onDidOpenNotebookDocument: function( listener ) { return registerListener( workspaceListeners, 'openNotebook', listener ); },
            onDidChangeNotebookDocument: function( listener ) { return registerListener( workspaceListeners, 'changeNotebook', listener ); },
            onDidCloseNotebookDocument: function( listener ) { return registerListener( workspaceListeners, 'closeNotebook', listener ); },
            onDidChangeConfiguration: function( listener ) { return registerListener( workspaceListeners, 'configuration', listener ); },
            onDidChangeWorkspaceFolders: function( listener ) { return registerListener( workspaceListeners, 'workspaceFolders', listener ); },
            onDidChangeTextDocument: function( listener ) { return registerListener( workspaceListeners, 'changeText', listener ); },
            openTextDocument: function() { return Promise.resolve(); }
        }
    };
}

function createExtensionHarness( options )
{
    var provider = createProviderStub();
    var searchResults = createSearchResultsStub();
    var ripgrepSearchCalls = [];
    var scanDocumentCalls = [];
    var scanTextCalls = [];
    var normalizeCalls = [];
    var readFileCalls = [];
    var validSchemes = options.validSchemes || [ 'file', 'vscode-notebook-cell' ];

    var vscodeStub = createVscodeStub( options );
    var context = {
        subscriptions: { push: function() {} },
        workspaceState: matrixHelpers.createWorkspaceState(),
        globalState: matrixHelpers.createWorkspaceState(),
        storageUri: matrixHelpers.createUri( '/tmp/storage' ),
        globalStorageUri: matrixHelpers.createUri( '/tmp/global-storage' )
    };

    var extension = helpers.loadWithStubs( '../src/extension.js', {
        vscode: vscodeStub,
        './ripgrep': {
            search: function( root, searchOptions )
            {
                ripgrepSearchCalls.push( searchOptions );
                return Promise.resolve( options.ripgrepMatches || [] );
            },
            kill: function() {}
        },
        './tree.js': {
            TreeNodeProvider: function()
            {
                return provider;
            },
            locateWorkspaceNode: function()
            {
                return undefined;
            }
        },
        './colours.js': {
            validateColours: function() { return undefined; },
            validateIconColours: function() { return undefined; }
        },
        './icons.js': {
            validateIcons: function() { return undefined; }
        },
        './highlights.js': {
            init: function() {},
            triggerHighlight: function() {}
        },
        './config.js': {
            init: function() {},
            refreshTagGroupLookup: function() {},
            ripgrepPath: function() { return '/tmp/rg'; },
            scanMode: function() { return options.scanMode; },
            shouldIgnoreGitSubmodules: function() { return false; },
            shouldUseBuiltInFileExcludes: function() { return false; },
            shouldUseBuiltInSearchExcludes: function() { return false; },
            shouldShowActivityBarBadge: function() { return false; },
            shouldFlatten: function() { return false; },
            shouldShowTagsOnly: function() { return false; },
            clickingStatusBarShouldRevealTree: function() { return false; },
            clickingStatusBarShouldToggleHighlights: function() { return false; },
            tags: function() { return languageMatrix.DEFAULT_TAGS.slice(); },
            shouldShowIconsInsteadOfTagsInStatusBar: function() { return false; },
            shouldCompactFolders: function() { return false; },
            isValidScheme: function( uri ) { return uri && validSchemes.indexOf( uri.scheme ) !== -1; },
            labelFormat: function() { return '${tag} ${after}'; },
            shouldShowScanModeInTree: function() { return false; },
            shouldExpand: function() { return false; },
            shouldGroupByTag: function() { return false; },
            shouldGroupBySubTag: function() { return false; },
            shouldShowCounts: function() { return false; },
            shouldHideIconsWhenGroupedByTag: function() { return false; },
            tooltipFormat: function() { return '${filepath}, ${line}'; },
            showFilterCaseSensitive: function() { return false; },
            isRegexCaseSensitive: function() { return true; },
            shouldHideFromTree: function() { return false; },
            shouldHideFromStatusBar: function() { return false; },
            shouldHideFromActivityBar: function() { return false; },
            shouldSortTree: function() { return true; },
            showBadges: function() { return false; },
            shouldUseColourScheme: function() { return false; },
            defaultHighlight: function() { return {}; },
            customHighlight: function() { return {}; },
            foregroundColourScheme: function() { return []; },
            backgroundColourScheme: function() { return []; },
            tagGroup: function() { return undefined; }
        },
        './utils.js': {
            init: function() {},
            isCodicon: function() { return false; },
            getCommentPattern: function( candidate ) { return actualUtils.getCommentPattern( candidate ); },
            getRegexSource: function() { return options.regexSource || '($TAGS)'; },
            getTagRegexSource: function() { return 'TODO|FIXME|BUG|HACK|XXX|\\[ \\]|\\[x\\]'; },
            isIncluded: function( name, includes, excludes )
            {
                if( typeof ( options.isIncludedImpl ) === 'function' )
                {
                    return options.isIncludedImpl( name, includes, excludes );
                }

                return actualUtils.isIncluded( name, includes, excludes );
            },
            isHidden: function( filePath )
            {
                if( typeof ( options.isHiddenImpl ) === 'function' )
                {
                    return options.isHiddenImpl( filePath );
                }

                return actualUtils.isHidden( filePath );
            },
            replaceEnvironmentVariables: function( value ) { return value; },
            getSubmoduleExcludeGlobs: function() { return []; },
            formatLabel: function( template ) { return template; },
            toGlobArray: function( value ) { return actualUtils.toGlobArray( value ); },
            createFolderGlob: function() { return '**/*'; }
        },
        './attributes.js': {
            init: function() {},
            getIcon: function() { return 'check'; }
        },
        './searchResults.js': searchResults,
        './detection.js': {
            resolveResourceConfig: function() { return options.resourceConfig; },
            scanDocument: function( document )
            {
                scanDocumentCalls.push( document );
                if( typeof ( options.scanDocumentImpl ) === 'function' )
                {
                    return options.scanDocumentImpl( document );
                }
                return options.documentResults || [];
            },
            scanText: function( uri, text )
            {
                scanTextCalls.push( { uri: uri, text: text } );
                if( typeof ( options.scanTextImpl ) === 'function' )
                {
                    return options.scanTextImpl( uri, text );
                }
                return options.workspaceResults || [];
            },
            normalizeRegexMatch: function( uri, text, match )
            {
                normalizeCalls.push( { uri: uri, text: text, match: match } );
                return options.normalizeResult ? options.normalizeResult( match ) : match;
            }
        },
        fs: {
            existsSync: function() { return true; },
            mkdirSync: function() {},
            readFileSync: function( filePath )
            {
                readFileCalls.push( filePath );
                return options.fileContents[ filePath ];
            }
        },
        treeify: { asTree: function() { return ''; } },
        child_process: {
            execFile: function( executable, args, execOptions, callback )
            {
                callback( null, 'head', '' );
            }
        }
    } );

    return {
        extension: extension,
        context: context,
        provider: provider,
        ripgrepSearchCalls: ripgrepSearchCalls,
        scanDocumentCalls: scanDocumentCalls,
        scanTextCalls: scanTextCalls,
        normalizeCalls: normalizeCalls,
        readFileCalls: readFileCalls,
        vscode: vscodeStub
    };
}

function createNotebookFixture( notebookPath )
{
    notebookPath = notebookPath || '/workspace/notebook.ipynb';
    var codeCell = matrixHelpers.createNotebookCellDocument( notebookPath, 'code', '# TODO code cell item', 'python' );
    var markdownCell = matrixHelpers.createNotebookCellDocument( notebookPath, 'markdown', '- [ ] markdown cell item', 'markdown' );
    var notebook = matrixHelpers.createNotebookDocument( notebookPath, [ codeCell, markdownCell ] );

    function scanDocumentImpl( document )
    {
        if( document.uri.toString() === codeCell.uri.toString() )
        {
            return [ {
                uri: codeCell.uri,
                actualTag: 'TODO',
                displayText: 'code cell item',
                continuationText: []
            } ];
        }

        return [ {
            uri: markdownCell.uri,
            actualTag: '[ ]',
            displayText: 'markdown cell item',
            continuationText: []
        } ];
    }

    return {
        notebook: notebook,
        codeCell: codeCell,
        markdownCell: markdownCell,
        scanDocumentImpl: scanDocumentImpl
    };
}

function waitForDelay( delay )
{
    return new Promise( function( resolve )
    {
        setTimeout( resolve, delay );
    } );
}

QUnit.module( "extension scan parity" );

QUnit.test( "open-files mode stores canonical document results through the refresh pipeline", function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/tmp/open.js' ),
        actualTag: 'TODO',
        displayText: 'open item',
        continuationText: []
    } ];
    var document = matrixHelpers.createDocument( '/tmp/open.js', '// TODO open item' );
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        visibleTextEditors: [ { document: document } ],
        documentResults: fixture,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 1 );
        assert.equal( harness.scanDocumentCalls[ 0 ].fileName, '/tmp/open.js' );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, fixture );
    } );
} );

QUnit.test( "issue #883 open-files mode scans every cell in an open notebook instead of only the active cell", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assert.equal( harness.provider.replaceCalls.length, 1 );
        assert.equal( harness.provider.replaceCalls[ 0 ].uri.fsPath, '/workspace/notebook.ipynb' );
        assert.deepEqual(
            harness.provider.replaceCalls[ 0 ].results.map( function( result )
            {
                return [ result.actualTag, result.displayText, result.revealUri.toString(), result.uri.fsPath ];
            } ),
            [
                [ 'TODO', 'code cell item', fixture.codeCell.uri.toString(), '/workspace/notebook.ipynb' ],
                [ '[ ]', 'markdown cell item', fixture.markdownCell.uri.toString(), '/workspace/notebook.ipynb' ]
            ]
        );
    } );
} );

QUnit.test( "issue #905 open-files mode keeps Go documents included when filtering uses manifest defaults", function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/workspace/cmd/main.go' ),
        actualTag: 'TODO',
        displayText: 'go document item',
        continuationText: []
    } ];
    var document = matrixHelpers.createDocument( '/workspace/cmd/main.go', '// TODO go document item' );
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        visibleTextEditors: [ { document: document } ],
        documentResults: fixture,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 1 );
        assert.equal( harness.scanDocumentCalls[ 0 ].fileName, '/workspace/cmd/main.go' );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, fixture );
    } );
} );

QUnit.test( "current-file mode clears stale results when the active editor changes to a file without matches", function( assert )
{
    var firstDocument = matrixHelpers.createDocument( '/tmp/first.js', '// TODO first item' );
    var secondDocument = matrixHelpers.createDocument( '/tmp/second.js', 'const clean = true;' );
    var harness = createExtensionHarness( {
        scanMode: 'current file',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        visibleTextEditors: [ { document: firstDocument }, { document: secondDocument } ],
        activeTextEditor: { document: firstDocument },
        scanDocumentImpl: function( document )
        {
            if( document.fileName === '/tmp/first.js' )
            {
                return [ {
                    uri: matrixHelpers.createUri( '/tmp/first.js' ),
                    actualTag: 'TODO',
                    displayText: 'first item',
                    continuationText: []
                } ];
            }

            return [];
        },
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 1 );
        assert.equal( harness.provider.replaceCalls[ 0 ].uri.fsPath, '/tmp/first.js' );
        assert.equal( harness.provider.replaceCalls[ 0 ].results.length, 1 );

        harness.vscode.window.activeTextEditor = { document: secondDocument };
        return harness.vscode.workspaceListeners.activeEditor( { document: secondDocument } );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var lastReplaceCall = harness.provider.replaceCalls[ harness.provider.replaceCalls.length - 1 ];

        assert.equal( harness.scanDocumentCalls.length, 2 );
        assert.equal( harness.scanDocumentCalls[ 1 ].fileName, '/tmp/second.js' );
        assert.equal( lastReplaceCall.uri.fsPath, '/tmp/second.js' );
        assert.deepEqual( lastReplaceCall.results, [] );
    } );
} );

QUnit.test( "issue #883 current-file mode keeps notebook results at notebook scope when the active cell changes", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'current file',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell }, { document: fixture.markdownCell } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.provider.replaceCalls[ 0 ].uri.fsPath, '/workspace/notebook.ipynb' );
        assert.equal( harness.provider.replaceCalls[ 0 ].results.length, 2 );

        harness.vscode.window.activeTextEditor = { document: fixture.markdownCell };
        return harness.vscode.workspaceListeners.activeEditor( { document: fixture.markdownCell } );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var lastReplaceCall = harness.provider.replaceCalls[ harness.provider.replaceCalls.length - 1 ];

        assert.equal( lastReplaceCall.uri.fsPath, '/workspace/notebook.ipynb' );
        assert.equal( lastReplaceCall.results.length, 2 );
        assert.equal( harness.scanDocumentCalls.length, 4 );
    } );
} );

QUnit.test( "workspace mode built-in scanning reparses candidate files through detection.scanText", function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
        actualTag: 'HACK',
        displayText: 'workspace item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/file.js' } ],
        workspaceResults: fixture,
        fileContents: {
            '/workspace/src/file.js': '// HACK workspace item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.ripgrepSearchCalls.length, 1 );
        assert.equal( harness.scanTextCalls.length, 1 );
        assert.equal( harness.scanTextCalls[ 0 ].uri.fsPath, '/workspace/src/file.js' );
        assert.equal( harness.readFileCalls[ 0 ], '/workspace/src/file.js' );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, fixture );
        assert.equal( harness.normalizeCalls.length, 0 );
    } );
} );

QUnit.test( "issue #883 workspace mode keeps open notebook scans even when the notebook is inside a workspace root", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assert.equal( harness.provider.replaceCalls.length, 1 );
        assert.equal( harness.provider.replaceCalls[ 0 ].uri.fsPath, '/workspace/notebook.ipynb' );
        assert.deepEqual(
            harness.provider.replaceCalls[ 0 ].results.map( function( result ) { return result.actualTag; } ),
            [ 'TODO', '[ ]' ]
        );
    } );
} );

QUnit.test( "issue #883 open notebook events scan the full notebook after activation", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 0 );
        return harness.vscode.workspaceListeners.openNotebook( fixture.notebook );
    } ).then( function()
    {
        return waitForDelay( 250 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assert.equal( harness.provider.replaceCalls[ 0 ].uri.fsPath, '/workspace/notebook.ipynb' );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results.map( function( result ) { return result.actualTag; } ), [ 'TODO', '[ ]' ] );
    } );
} );

QUnit.test( "issue #883 notebook change events rescan every cell and replace notebook-scoped results", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 2 );
        fixture.notebook.version += 1;
        fixture.codeCell.version += 1;
        fixture.markdownCell.version += 1;

        return harness.vscode.workspaceListeners.changeNotebook( { notebook: fixture.notebook } );
    } ).then( function()
    {
        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var lastReplaceCall = harness.provider.replaceCalls[ harness.provider.replaceCalls.length - 1 ];

        assert.equal( harness.scanDocumentCalls.length, 4 );
        assert.equal( lastReplaceCall.uri.fsPath, '/workspace/notebook.ipynb' );
        assert.deepEqual( lastReplaceCall.results.map( function( result ) { return result.actualTag; } ), [ 'TODO', '[ ]' ] );
    } );
} );

QUnit.test( "issue #883 closing a notebook removes notebook-scoped results once and ignores cell close churn", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.provider.replaceCalls.length, 1 );

        harness.vscode.workspaceListeners.close( fixture.codeCell );
        assert.equal( harness.provider.replaceCalls.length, 1 );

        harness.vscode.workspaceListeners.closeNotebook( fixture.notebook );
        assert.equal( harness.provider.replaceCalls.length, 2 );
        assert.equal( harness.provider.replaceCalls[ 1 ].uri.fsPath, '/workspace/notebook.ipynb' );
        assert.deepEqual( harness.provider.replaceCalls[ 1 ].results, [] );
    } );
} );

QUnit.test( "issue #883 workspace-only mode ignores notebooks outside workspace roots", function( assert )
{
    var fixture = createNotebookFixture( '/external/notebook.ipynb' );
    var harness = createExtensionHarness( {
        scanMode: 'workspace only',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 0 );
        assert.deepEqual( harness.provider.replaceCalls, [] );
    } );
} );

QUnit.test( "issue #905 workspace mode keeps Go files in scope without adding file-type include globs", function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/workspace/cmd/main.go' ),
        actualTag: 'TODO',
        displayText: 'workspace go item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/cmd/main.go' } ],
        workspaceResults: fixture,
        fileContents: {
            '/workspace/cmd/main.go': '// TODO workspace go item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.ripgrepSearchCalls.length, 1 );
        assert.equal( harness.scanTextCalls.length, 1 );
        assert.equal( harness.scanTextCalls[ 0 ].uri.fsPath, '/workspace/cmd/main.go' );
        assert.deepEqual( harness.ripgrepSearchCalls[ 0 ].globs, [ '!**/node_modules/*/**' ] );
        assert.ok( harness.ripgrepSearchCalls[ 0 ].globs.every( function( glob ) { return glob.indexOf( '.go' ) === -1; } ) );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, fixture );
    } );
} );

QUnit.test( "workspace-only mode ignores external open documents", function( assert )
{
    var externalDocument = matrixHelpers.createDocument( '/external/open.js', '// TODO external item' );
    var workspaceFixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
        actualTag: 'TODO',
        displayText: 'workspace item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace only',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        visibleTextEditors: [ { document: externalDocument } ],
        activeTextEditor: { document: externalDocument },
        ripgrepMatches: [ { fsPath: '/workspace/src/file.js' } ],
        workspaceResults: workspaceFixture,
        documentResults: [ {
            uri: matrixHelpers.createUri( '/external/open.js' ),
            actualTag: 'TODO',
            displayText: 'external item',
            continuationText: []
        } ],
        fileContents: {
            '/workspace/src/file.js': '// TODO workspace item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.ripgrepSearchCalls.length, 1 );
        assert.equal( harness.scanTextCalls.length, 1 );
        assert.equal( harness.scanDocumentCalls.length, 0 );
        assert.deepEqual( harness.provider.replaceCalls.map( function( call ) { return call.uri.fsPath; } ), [
            '/workspace/src/file.js'
        ] );
    } );
} );

QUnit.test( "issue #820 workspace mode uses tag-only candidate search before reparsing Python files", function( assert )
{
    var pythonText = [
        "\"\"\"",
        "TODO first",
        "detail line",
        "\"\"\"",
        "# TODO second"
    ].join( "\n" );
    var fixture = [
        {
            uri: matrixHelpers.createUri( '/workspace/app.py' ),
            actualTag: 'TODO',
            displayText: 'first',
            continuationText: [ 'detail line' ]
        },
        {
            uri: matrixHelpers.createUri( '/workspace/app.py' ),
            actualTag: 'TODO',
            displayText: 'second',
            continuationText: []
        }
    ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/app.py' } ],
        workspaceResults: fixture,
        fileContents: {
            '/workspace/app.py': pythonText
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.ripgrepSearchCalls.length, 1 );
        assert.equal( harness.ripgrepSearchCalls[ 0 ].regex, '(TODO|FIXME|BUG|HACK|XXX|\\[ \\]|\\[x\\])' );
        assert.equal( harness.ripgrepSearchCalls[ 0 ].unquotedRegex, '(TODO|FIXME|BUG|HACK|XXX|\\[ \\]|\\[x\\])' );
        assert.equal( harness.scanTextCalls.length, 1 );
        assert.equal( harness.scanTextCalls[ 0 ].uri.fsPath, '/workspace/app.py' );
        assert.equal( harness.scanTextCalls[ 0 ].text, pythonText );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, fixture );
        assert.equal( harness.normalizeCalls.length, 0 );
    } );
} );

QUnit.test( "workspace scan mode merges workspace results with external open documents only", function( assert )
{
    var externalDocument = matrixHelpers.createDocument( '/external/open.js', '// TODO external item' );
    var workspaceFixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
        actualTag: 'HACK',
        displayText: 'workspace item',
        continuationText: []
    } ];
    var externalFixture = [ {
        uri: matrixHelpers.createUri( '/external/open.js' ),
        actualTag: 'TODO',
        displayText: 'external item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        visibleTextEditors: [ { document: externalDocument } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/file.js' } ],
        workspaceResults: workspaceFixture,
        documentResults: externalFixture,
        fileContents: {
            '/workspace/src/file.js': '// HACK workspace item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.ripgrepSearchCalls.length, 1 );
        assert.equal( harness.scanTextCalls.length, 1 );
        assert.equal( harness.scanTextCalls[ 0 ].uri.fsPath, '/workspace/src/file.js' );
        assert.equal( harness.scanDocumentCalls.length, 1 );
        assert.equal( harness.scanDocumentCalls[ 0 ].fileName, '/external/open.js' );
        assert.deepEqual( harness.provider.replaceCalls.map( function( call ) { return call.uri.fsPath; } ), [
            '/workspace/src/file.js',
            '/external/open.js'
        ] );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, workspaceFixture );
        assert.deepEqual( harness.provider.replaceCalls[ 1 ].results, externalFixture );
    } );
} );

QUnit.test( "open-files mode removes document-backed results when a document closes", function( assert )
{
    var document = matrixHelpers.createDocument( '/tmp/open.js', '// TODO open item' );
    var fixture = [ {
        uri: matrixHelpers.createUri( '/tmp/open.js' ),
        actualTag: 'TODO',
        displayText: 'open item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        visibleTextEditors: [ { document: document } ],
        documentResults: fixture,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, fixture );

        harness.vscode.workspaceListeners.close( document );

        var lastReplaceCall = harness.provider.replaceCalls[ harness.provider.replaceCalls.length - 1 ];
        assert.equal( lastReplaceCall.uri.fsPath, '/tmp/open.js' );
        assert.deepEqual( lastReplaceCall.results, [] );
    } );
} );

QUnit.test( "workspace mode keeps workspace-backed results when a workspace document closes", function( assert )
{
    var workspaceDocument = matrixHelpers.createDocument( '/workspace/src/file.js', '// TODO workspace item' );
    var workspaceFixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
        actualTag: 'TODO',
        displayText: 'workspace item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        visibleTextEditors: [ { document: workspaceDocument } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/file.js' } ],
        workspaceResults: workspaceFixture,
        fileContents: {
            '/workspace/src/file.js': '// TODO workspace item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.provider.replaceCalls.length, 1 );

        harness.vscode.workspaceListeners.close( workspaceDocument );

        assert.equal( harness.provider.replaceCalls.length, 1 );
    } );
} );

QUnit.test( "workspace mode custom regex scanning normalizes ripgrep matches into canonical results", function( assert )
{
    var canonicalFixture = [
        {
            uri: matrixHelpers.createUri( '/workspace/src/custom.js' ),
            actualTag: 'TODO',
            displayText: 'first custom item',
            continuationText: []
        },
        {
            uri: matrixHelpers.createUri( '/workspace/src/custom.js' ),
            actualTag: 'TODO',
            displayText: 'second custom item',
            continuationText: []
        }
    ];
    var ripgrepMatches = [
        { fsPath: '/workspace/src/custom.js', line: 1, column: 1, match: 'TODO first custom item' },
        { fsPath: '/workspace/src/custom.js', line: 2, column: 1, match: 'TODO second custom item' }
    ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        regexSource: '($TAGS)',
        resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: ripgrepMatches,
        normalizeResult: function( match )
        {
            return canonicalFixture[ ripgrepMatches.indexOf( match ) ];
        },
        fileContents: {
            '/workspace/src/custom.js': 'TODO first custom item\nTODO second custom item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.normalizeCalls.length, 2 );
        assert.equal( harness.scanTextCalls.length, 0 );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, canonicalFixture );
    } );
} );

QUnit.test( "workspace mode forwards multiline remote-path regex matches through normalization", function( assert )
{
    var remotePath = '/home/azureuser/localfiles/my-project/pipeline-deploy-api-policies.yaml';
    var canonicalFixture = [
        {
            uri: matrixHelpers.createUri( remotePath ),
            actualTag: 'TODO',
            displayText: 'first custom item',
            continuationText: [ 'second line', 'END' ]
        }
    ];
    var ripgrepMatches = [
        {
            fsPath: remotePath,
            line: 1,
            column: 1,
            match: 'TODO: first custom item',
            extraLines: [ { match: 'second line' }, { match: 'END' } ]
        }
    ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        regexSource: '($TAGS):[\\s\\S]*?END',
        resourceConfig: { isDefaultRegex: false, enableMultiLine: true, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/home/azureuser/localfiles/my-project' ), name: 'my-project' } ],
        ripgrepMatches: ripgrepMatches,
        normalizeResult: function( match )
        {
            return canonicalFixture[ ripgrepMatches.indexOf( match ) ];
        },
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.normalizeCalls.length, 1 );
        assert.equal( harness.normalizeCalls[ 0 ].uri.fsPath, remotePath );
        assert.equal( harness.normalizeCalls[ 0 ].match.extraLines.length, 2 );
        assert.deepEqual( harness.normalizeCalls[ 0 ].match.extraLines.map( function( line ) { return line.match; } ), [ 'second line', 'END' ] );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, canonicalFixture );
    } );
} );

QUnit.test( "remote custom-regex workspace results stay in parity with open-file results for issue-style yaml content", function( assert )
{
    function stripCaptureGroupOffsets( results )
    {
        return results.map( function( result )
        {
            var copy = Object.assign( {}, result );
            delete copy.captureGroupOffsets;
            return copy;
        } );
    }

    var remotePath = '/home/azureuser/localfiles/my-project/pipeline-deploy-api-policies.yaml';
    var remoteText = [
        'TODO This is a test TODO',
        'BUG',
        'FIXME'
    ].join( '\n' );
    var remoteUri = matrixHelpers.createUri( remotePath );
    var actualConfig = matrixHelpers.createConfig( {
        tagList: [ 'TODO', 'FIXME', 'BUG' ],
        regexSource: '($TAGS).*',
        shouldBeCaseSensitive: true
    } );
    var openDocument = matrixHelpers.createDocument( remotePath, remoteText );

    actualUtils.init( actualConfig );

    var openResults = actualDetection.scanText( remoteUri, remoteText );
    var ripgrepMatches = openResults.map( function( result )
    {
        return {
            fsPath: remotePath,
            line: result.line,
            column: result.column,
            match: result.match
        };
    } );
    var workspaceResults = ripgrepMatches.map( function( match )
    {
        return actualDetection.normalizeRegexMatch( remoteUri, remoteText, match );
    } );

    var openFilesHarness = createExtensionHarness( {
        scanMode: 'open files',
        regexSource: '($TAGS).*',
        resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
        visibleTextEditors: [ { document: openDocument } ],
        documentResults: openResults,
        fileContents: {}
    } );
    var workspaceHarness = createExtensionHarness( {
        scanMode: 'workspace',
        regexSource: '($TAGS).*',
        resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/home/azureuser/localfiles/my-project' ), name: 'my-project' } ],
        ripgrepMatches: ripgrepMatches,
        normalizeResult: function( match )
        {
            return workspaceResults[ ripgrepMatches.indexOf( match ) ];
        },
        fileContents: {
            '/home/azureuser/localfiles/my-project/pipeline-deploy-api-policies.yaml': remoteText
        }
    } );

    openFilesHarness.extension.activate( openFilesHarness.context );
    workspaceHarness.extension.activate( workspaceHarness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( openResults.length, 3 );
        assert.deepEqual( openResults.map( function( result ) { return result.actualTag; } ), [ 'TODO', 'BUG', 'FIXME' ] );
        assert.deepEqual( stripCaptureGroupOffsets( workspaceResults ), stripCaptureGroupOffsets( openResults ) );
        assert.equal( openFilesHarness.scanDocumentCalls.length, 1 );
        assert.equal( workspaceHarness.normalizeCalls.length, 3 );
        assert.equal( workspaceHarness.readFileCalls[ 0 ], remotePath );
        assert.deepEqual( stripCaptureGroupOffsets( openFilesHarness.provider.replaceCalls[ 0 ].results ), stripCaptureGroupOffsets( openResults ) );
        assert.deepEqual( stripCaptureGroupOffsets( workspaceHarness.provider.replaceCalls[ 0 ].results ), stripCaptureGroupOffsets( openResults ) );
    } );
} );

QUnit.test( "issue #888 workspace custom-regex normalization matches the open-file canonical banner result", function( assert )
{
    function stripCaptureGroupOffsets( results )
    {
        return results.map( function( result )
        {
            var copy = Object.assign( {}, result );
            delete copy.captureGroupOffsets;
            return copy;
        } );
    }

    var uri = matrixHelpers.createUri( '/tmp/issue-888.js' );
    var text = issue888Helpers.createIssue888Text();
    var config = issue888Helpers.createIssue888Config();
    var openResults;
    var workspaceResults;

    actualUtils.init( config );

    openResults = actualDetection.scanText( uri, text );
    workspaceResults = [
        actualDetection.normalizeRegexMatch( uri, text, issue888Helpers.createIssue888RipgrepMatch( uri.fsPath ) )
    ];

    assert.equal( openResults.length, 1 );
    assert.deepEqual( stripCaptureGroupOffsets( workspaceResults ), stripCaptureGroupOffsets( openResults ) );
    assert.equal( workspaceResults[ 0 ].actualTag, '*' );
    assert.equal( workspaceResults[ 0 ].displayText, 'Helpers' );
    assert.equal( workspaceResults[ 0 ].line, 2 );
    assert.equal( workspaceResults[ 0 ].column, 2 );
} );

QUnit.test( "issue #885 workspace and open-file scans keep every repeated hash-prefixed markdown tag", function( assert )
{
    function stripCaptureGroupOffsets( results )
    {
        return results.map( function( result )
        {
            var copy = Object.assign( {}, result );
            delete copy.captureGroupOffsets;
            return copy;
        } );
    }

    var remotePath = '/tmp/issue-885.md';
    var remoteText = [
        '#LATER alpha',
        '#LATER beta',
        '#LATER #TODO gamma',
        '#LATER delta'
    ].join( '\n' );
    var remoteUri = matrixHelpers.createUri( remotePath );
    var actualConfig = matrixHelpers.createConfig( {
        tagList: [ '#LATER' ],
        regexSource: '($TAGS).*',
        shouldBeCaseSensitive: true
    } );
    var openDocument = matrixHelpers.createDocument( remotePath, remoteText );

    actualUtils.init( actualConfig );

    var openResults = actualDetection.scanText( remoteUri, remoteText );
    var ripgrepMatches = openResults.map( function( result )
    {
        return {
            fsPath: remotePath,
            line: result.line,
            column: result.column,
            match: result.match
        };
    } );
    var workspaceResults = ripgrepMatches.map( function( match )
    {
        return actualDetection.normalizeRegexMatch( remoteUri, remoteText, match );
    } );

    var openFilesHarness = createExtensionHarness( {
        scanMode: 'open files',
        regexSource: '($TAGS).*',
        resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
        visibleTextEditors: [ { document: openDocument } ],
        documentResults: openResults,
        fileContents: {}
    } );
    var workspaceHarness = createExtensionHarness( {
        scanMode: 'workspace',
        regexSource: '($TAGS).*',
        resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/tmp' ), name: 'tmp' } ],
        ripgrepMatches: ripgrepMatches,
        normalizeResult: function( match )
        {
            return workspaceResults[ ripgrepMatches.indexOf( match ) ];
        },
        fileContents: {
            '/tmp/issue-885.md': remoteText
        }
    } );

    openFilesHarness.extension.activate( openFilesHarness.context );
    workspaceHarness.extension.activate( workspaceHarness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( openResults.length, 4 );
        assert.deepEqual(
            openResults.map( function( result ) { return result.displayText; } ),
            [ 'alpha', 'beta', '#TODO gamma', 'delta' ]
        );
        assert.deepEqual( stripCaptureGroupOffsets( workspaceResults ), stripCaptureGroupOffsets( openResults ) );
        assert.equal( openFilesHarness.scanDocumentCalls.length, 1 );
        assert.equal( workspaceHarness.normalizeCalls.length, 4 );
        assert.equal( workspaceHarness.readFileCalls[ 0 ], remotePath );
        assert.deepEqual( stripCaptureGroupOffsets( openFilesHarness.provider.replaceCalls[ 0 ].results ), stripCaptureGroupOffsets( openResults ) );
        assert.deepEqual( stripCaptureGroupOffsets( workspaceHarness.provider.replaceCalls[ 0 ].results ), stripCaptureGroupOffsets( openResults ) );
    } );
} );
