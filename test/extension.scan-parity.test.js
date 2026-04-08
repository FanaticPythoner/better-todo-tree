var helpers = require( './moduleHelpers.js' );
var matrixHelpers = require( './matrixHelpers.js' );
var languageMatrix = require( './languageMatrix.js' );

function createConfigurationSection( values )
{
    function getNestedValue( source, key )
    {
        return key.split( '.' ).reduce( function( current, part )
        {
            return current && current[ part ] !== undefined ? current[ part ] : undefined;
        }, source );
    }

    var section = Object.assign( {}, values );
    section.get = function( key, defaultValue )
    {
        var value = getNestedValue( values, key );
        return value === undefined ? defaultValue : value;
    };
    section.update = function()
    {
        return Promise.resolve();
    };
    section.inspect = function()
    {
        return {};
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
        filtering: {
            passGlobsToRipgrep: true,
            includeGlobs: [],
            excludeGlobs: [],
            includeHiddenFiles: false,
            useBuiltInExcludes: 'none'
        },
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

    var sections = {
        'todo-tree': rootSection,
        'todo-tree.general': createConfigurationSection( {
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
        } ),
        'todo-tree.tree': createConfigurationSection( {
            autoRefresh: true,
            trackFile: false,
            showCountsInTree: false,
            showBadges: false,
            scanMode: options.scanMode,
            showCurrentScanMode: false,
            scanAtStartup: true,
            hideTreeWhenEmpty: false,
            buttons: rootSection.get( 'tree.buttons' )
        } ),
        'todo-tree.filtering': createConfigurationSection( {
            passGlobsToRipgrep: true,
            includeGlobs: [],
            excludeGlobs: [],
            includeHiddenFiles: false,
            includedWorkspaces: [],
            excludedWorkspaces: [],
            useBuiltInExcludes: 'none',
            scopes: []
        } ),
        'todo-tree.regex': createConfigurationSection( {
            regex: options.regexSource || '($TAGS)',
            regexCaseSensitive: true,
            enableMultiLine: false,
            subTagRegex: ''
        } ),
        'todo-tree.ripgrep': createConfigurationSection( {
            ripgrepArgs: '',
            ripgrepMaxBuffer: 200,
            usePatternFile: false
        } ),
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
            onDidSaveTextDocument: function( listener ) { return registerListener( workspaceListeners, 'save', listener ); },
            onDidOpenTextDocument: function( listener ) { return registerListener( workspaceListeners, 'open', listener ); },
            onDidCloseTextDocument: function( listener ) { return registerListener( workspaceListeners, 'close', listener ); },
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
            isValidScheme: function( uri ) { return uri && uri.scheme === 'file'; },
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
            getRegexSource: function() { return options.regexSource || '($TAGS)'; },
            getTagRegexSource: function() { return 'TODO|FIXME|BUG|HACK|XXX|\\[ \\]|\\[x\\]'; },
            isIncluded: function() { return true; },
            isHidden: function() { return false; },
            replaceEnvironmentVariables: function( value ) { return value; },
            getSubmoduleExcludeGlobs: function() { return []; },
            formatLabel: function( template ) { return template; },
            toGlobArray: function( value ) { return value || []; },
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
                return options.documentResults || [];
            },
            scanText: function( uri, text )
            {
                scanTextCalls.push( { uri: uri, text: text } );
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
