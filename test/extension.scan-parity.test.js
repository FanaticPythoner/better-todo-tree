var fs = require( 'fs' );
var path = require( 'path' );
var Module = require( 'module' );
var vm = require( 'vm' );
var helpers = require( './moduleHelpers.js' );
var issue888Helpers = require( './issue888Helpers.js' );
var matrixHelpers = require( './matrixHelpers.js' );
var languageMatrix = require( './languageMatrix.js' );
var actualUtils = require( '../src/utils.js' );
var actualDetection = require( '../src/detection.js' );
var actualNotebooks = require( '../src/notebooks.js' );

var DEFAULT_INCLUDE_GLOBS = languageMatrix.findConfigurationProperty( 'better-todo-tree.filtering.includeGlobs' ).default.slice();
var DEFAULT_EXCLUDE_GLOBS = languageMatrix.findConfigurationProperty( 'better-todo-tree.filtering.excludeGlobs' ).default.slice();

function loadWithStubsAndTimers( modulePath, stubs, timerStubs )
{
    var originalLoad = Module._load;
    var filename = require.resolve( modulePath );
    var loadedModule = new Module( filename, module );
    var previousTimers = global.__betterTodoTreeTestTimers;
    var prologue = [
        'var setTimeout = global.__betterTodoTreeTestTimers.setTimeout;',
        'var clearTimeout = global.__betterTodoTreeTestTimers.clearTimeout;',
        'var setInterval = global.__betterTodoTreeTestTimers.setInterval;',
        'var clearInterval = global.__betterTodoTreeTestTimers.clearInterval;'
    ].join( '\n' ) + '\n';

    delete require.cache[ filename ];

    loadedModule.filename = filename;
    loadedModule.paths = Module._nodeModulePaths( path.dirname( filename ) );

    Module._load = function( request, parent, isMain )
    {
        if( stubs && Object.prototype.hasOwnProperty.call( stubs, request ) )
        {
            return stubs[ request ];
        }

        return originalLoad.call( this, request, parent, isMain );
    };

    global.__betterTodoTreeTestTimers = timerStubs;

    try
    {
        var wrapped = Module.wrap( prologue + fs.readFileSync( filename, 'utf8' ) );
        var compiled = vm.runInThisContext( wrapped, { filename: filename } );
        var customRequire = function( request )
        {
            return Module._load( request, loadedModule, false );
        };

        compiled.call( loadedModule.exports, loadedModule.exports, customRequire, loadedModule, filename, path.dirname( filename ) );
        require.cache[ filename ] = loadedModule;

        return loadedModule.exports;
    }
    finally
    {
        Module._load = originalLoad;
        global.__betterTodoTreeTestTimers = previousTimers;
    }
}

function createConfigurationSection( values, explicitTarget, updateLog )
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
    section.update = function( key, value, target )
    {
        if( Array.isArray( updateLog ) )
        {
            updateLog.push( {
                key: key,
                value: value,
                target: target
            } );
        }
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
    function createStore()
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
                return true;
            },
            remove: function( uri )
            {
                entries.delete( uri.toString() );
                dirty.add( uri.toString() );
                return true;
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
            },
            forEachUriResults: function( iterator )
            {
                entries.forEach( function( entry )
                {
                    iterator( entry.uri, entry.results );
                } );
            }
        };
    }

    var defaultStore = createStore();

    return {
        createStore: createStore,
        clear: function()
        {
            return defaultStore.clear();
        },
        replaceUriResults: function( uri, results )
        {
            return defaultStore.replaceUriResults( uri, results );
        },
        remove: function( uri )
        {
            return defaultStore.remove( uri );
        },
        drainDirtyResults: function()
        {
            return defaultStore.drainDirtyResults();
        },
        containsMarkdown: function()
        {
            return defaultStore.containsMarkdown();
        },
        count: function()
        {
            return defaultStore.count();
        },
        filter: function()
        {
            return defaultStore.filter.apply( defaultStore, arguments );
        },
        markAsNotAdded: function()
        {
            return defaultStore.markAsNotAdded();
        },
        forEachResult: function( iterator )
        {
            return defaultStore.forEachResult( iterator );
        }
    };
}

function createProviderStub()
{
    return {
        replaceCalls: [],
        latestResultsByUri: new Map(),
        refreshCalls: 0,
        clearCalls: 0,
        rebuildCalls: 0,
        finalizeCalls: [],
        clear: function()
        {
            this.clearCalls++;
            this.latestResultsByUri.clear();
        },
        rebuild: function() { this.rebuildCalls++; },
        replaceDocument: function( uri, results )
        {
            var entry = { uri: uri, results: results };
            this.replaceCalls.push( entry );
            this.latestResultsByUri.set( uri.toString(), entry );
        },
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

function instrumentProvider( provider )
{
    provider.replaceCalls = [];
    provider.latestResultsByUri = new Map();
    provider.refreshCalls = 0;
    provider.clearCalls = 0;
    provider.rebuildCalls = 0;
    provider.finalizeCalls = [];

    var originalClear = provider.clear ? provider.clear.bind( provider ) : function() {};
    var originalRebuild = provider.rebuild ? provider.rebuild.bind( provider ) : function() {};
    var originalReplaceDocument = provider.replaceDocument ? provider.replaceDocument.bind( provider ) : function() {};
    var originalFinalizePendingChanges = provider.finalizePendingChanges ? provider.finalizePendingChanges.bind( provider ) : function() {};
    var originalRefresh = provider.refresh ? provider.refresh.bind( provider ) : function() {};

    provider.clear = function()
    {
        this.clearCalls++;
        this.latestResultsByUri.clear();
        return originalClear.apply( this, arguments );
    };
    provider.rebuild = function()
    {
        this.rebuildCalls++;
        return originalRebuild.apply( this, arguments );
    };
    provider.replaceDocument = function( uri, results )
    {
        var entry = { uri: uri, results: results };
        this.replaceCalls.push( entry );
        this.latestResultsByUri.set( uri.toString(), entry );
        return originalReplaceDocument.apply( this, arguments );
    };
    provider.finalizePendingChanges = function( filter, options )
    {
        this.finalizeCalls.push( { filter: filter, options: options } );
        return originalFinalizePendingChanges.apply( this, arguments );
    };
    provider.refresh = function()
    {
        this.refreshCalls++;
        return originalRefresh.apply( this, arguments );
    };

    return provider;
}

function createVscodeStub( options )
{
    var commandHandlers = {};
    var workspaceListeners = {};
    var windowListeners = {};
    var executedCommands = [];
    var warningMessages = [];
    var errorMessages = [];
    var progressSessions = [];
    var statusBarItems = [];
    var treeViews = [];
    var configurationUpdates = [];
    var automaticGitRefreshInterval = options.automaticGitRefreshInterval !== undefined ? options.automaticGitRefreshInterval : 0;
    var periodicRefreshInterval = options.periodicRefreshInterval !== undefined ? options.periodicRefreshInterval : 0;
    var visibleNotebookEditors = Object.prototype.hasOwnProperty.call( options, 'visibleNotebookEditors' ) ?
        options.visibleNotebookEditors :
        ( options.notebookDocuments || [] ).map( function( notebook )
        {
            return { notebook: notebook };
        } );
    var activeNotebookEditor = options.activeNotebookEditor !== undefined ?
        options.activeNotebookEditor :
        ( visibleNotebookEditors.length > 0 ? visibleNotebookEditors[ 0 ] : undefined );
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
            automaticGitRefreshInterval: automaticGitRefreshInterval,
            periodicRefreshInterval: periodicRefreshInterval,
            rootFolder: "",
            tags: languageMatrix.DEFAULT_TAGS.slice(),
            statusBar: 'total'
        },
        ripgrep: {
            ripgrepArgs: '',
            ripgrepMaxBuffer: 200,
            usePatternFile: false
        }
    }, undefined, configurationUpdates );

    var generalSection = createConfigurationSection( {
            debug: false,
            automaticGitRefreshInterval: automaticGitRefreshInterval,
            periodicRefreshInterval: periodicRefreshInterval,
            rootFolder: "",
            exportPath: '/tmp/todo-tree.txt',
            statusBar: 'total',
            statusBarClickBehaviour: '',
            showActivityBarBadge: false,
            tags: languageMatrix.DEFAULT_TAGS.slice(),
            tagGroups: {},
            schemes: [ 'file' ]
        }, undefined, configurationUpdates );
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
        }, undefined, configurationUpdates );
    var filteringSection = createConfigurationSection( {
            passGlobsToRipgrep: filteringDefaults.passGlobsToRipgrep,
            includeGlobs: filteringDefaults.includeGlobs.slice(),
            excludeGlobs: filteringDefaults.excludeGlobs.slice(),
            includeHiddenFiles: filteringDefaults.includeHiddenFiles,
            includedWorkspaces: [],
            excludedWorkspaces: [],
            useBuiltInExcludes: filteringDefaults.useBuiltInExcludes,
            scopes: []
        }, undefined, configurationUpdates );
    var regexSection = createConfigurationSection( {
            regex: options.resourceConfig && options.resourceConfig.isDefaultRegex === true ?
                actualUtils.DEFAULT_REGEX_SOURCE :
                ( options.regexSource || '($TAGS)' ),
            regexCaseSensitive: true,
            enableMultiLine: false,
            subTagRegex: options.resourceConfig && options.resourceConfig.subTagRegex ? options.resourceConfig.subTagRegex : ''
        }, undefined, configurationUpdates );
    var ripgrepSection = createConfigurationSection( {
            ripgrepArgs: '',
            ripgrepMaxBuffer: 200,
            usePatternFile: false
        }, undefined, configurationUpdates );

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
        'files.exclude': createConfigurationSection( {}, undefined, configurationUpdates ),
        'search.exclude': createConfigurationSection( {}, undefined, configurationUpdates ),
        'explorer': createConfigurationSection( { compactFolders: false }, undefined, configurationUpdates )
    };

    function registerListener( store, name, listener )
    {
        store[ name ] = listener;
        return { dispose: function() {} };
    }

    function createTreeView( id, options )
    {
        var view = {
            badge: undefined,
            title: 'Tree',
            message: '',
            visible: false,
            treeDataProvider: options && options.treeDataProvider,
            revealCalls: [],
            onDidExpandElement: function( listener ) { return registerListener( windowListeners, 'expand', listener ); },
            onDidCollapseElement: function( listener ) { return registerListener( windowListeners, 'collapse', listener ); },
            reveal: function( element, revealOptions )
            {
                this.revealCalls.push( {
                    element: element,
                    options: revealOptions
                } );
                return Promise.resolve();
            }
        };

        treeViews.push( view );
        return view;
    }

    function createProgressSession( options, callback )
    {
        var cancellationListeners = [];
        var session = {
            options: options,
            reports: [],
            completed: false,
            cancel: function()
            {
                cancellationListeners.forEach( function( listener )
                {
                    listener();
                } );
            }
        };
        var progress = {
            report: function( value )
            {
                session.reports.push( value );
            }
        };
        var token = {
            onCancellationRequested: function( listener )
            {
                cancellationListeners.push( listener );
                return { dispose: function() {} };
            }
        };

        progressSessions.push( session );

        session.promise = Promise.resolve( callback( progress, token ) ).then( function( value )
        {
            session.completed = true;
            return value;
        } );

        return session.promise;
    }

    function EventEmitter()
    {
        this.event = function() {};
        this.fire = function() {};
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

    return {
        commandHandlers: commandHandlers,
        workspaceListeners: workspaceListeners,
        windowListeners: windowListeners,
        executedCommands: executedCommands,
        progressSessions: progressSessions,
        statusBarItems: statusBarItems,
        treeViews: treeViews,
        configurationUpdates: configurationUpdates,
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
        ProgressLocation: { Notification: 15, Window: 10 },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        EventEmitter: EventEmitter,
        TreeItem: TreeItem,
        ThemeIcon: ThemeIcon,
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2
        },
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
            activeNotebookEditor: activeNotebookEditor,
            visibleNotebookEditors: visibleNotebookEditors,
            createStatusBarItem: function()
            {
                var item = {
                    text: '',
                    tooltip: '',
                    command: undefined,
                    show: function() {},
                    hide: function() {},
                    dispose: function() {}
                };
                statusBarItems.push( item );
                return item;
            },
            createTreeView: function()
            {
                return createTreeView.apply( undefined, arguments );
            },
            withProgress: function( progressOptions, task )
            {
                return createProgressSession( progressOptions, task );
            },
            createOutputChannel: function()
            {
                return {
                    appendLine: function() {},
                    dispose: function() {}
                };
            },
            showInformationMessage: function() { return Promise.resolve(); },
            showWarningMessage: function( message )
            {
                warningMessages.push( message );
                return Promise.resolve();
            },
            showErrorMessage: function( message )
            {
                errorMessages.push( message );
                return Promise.resolve();
            },
            showInputBox: function() { return Promise.resolve(); },
            showQuickPick: function() { return Promise.resolve(); },
            showTextDocument: function() { return Promise.resolve(); },
            onDidChangeActiveTextEditor: function( listener ) { return registerListener( workspaceListeners, 'activeEditor', listener ); },
            onDidChangeVisibleNotebookEditors: function( listener ) { return registerListener( windowListeners, 'visibleNotebookEditors', listener ); }
        },
        warningMessages: warningMessages,
        errorMessages: errorMessages,
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
    var provider = options.useActualTreeProvider === true ? undefined : createProviderStub();
    var searchResults = createSearchResultsStub();
    var ripgrepSearchCalls = [];
    var scanDocumentCalls = [];
    var scanTextCalls = [];
    var normalizeCalls = [];
    var readFileCalls = [];
    var ripgrepMatchLookup = new Map();
    var validSchemes = options.validSchemes || [ 'file', 'vscode-notebook-cell' ];
    var treeStateOverrides = {};
    var notebookMetrics = {
        syncCalls: 0,
        getForDocumentCalls: 0,
        rememberCalls: 0,
        forgetCalls: 0,
        allCalls: 0,
        getByKeyCalls: 0
    };

    var vscodeStub = createVscodeStub( options );
    var identityStub = helpers.loadWithStubs( '../src/extensionIdentity.js', {
        vscode: vscodeStub
    } );
    var extensionIdentity = Object.assign( {}, identityStub, {
        getSetting: function( setting, defaultValue, uri )
        {
            if( setting === 'general.periodicRefreshInterval' && options.periodicRefreshInterval !== undefined )
            {
                return options.periodicRefreshInterval;
            }

            if( setting === 'general.automaticGitRefreshInterval' && options.automaticGitRefreshInterval !== undefined )
            {
                return options.automaticGitRefreshInterval;
            }

            return identityStub.getSetting( setting, defaultValue, uri );
        }
    } );
    var context = {
        subscriptions: { push: function() {} },
        workspaceState: options.workspaceState || matrixHelpers.createWorkspaceState(),
        globalState: options.globalState || matrixHelpers.createWorkspaceState(),
        storageUri: matrixHelpers.createUri( '/tmp/storage' ),
        globalStorageUri: matrixHelpers.createUri( '/tmp/global-storage' )
    };
    var notebooksModule = Object.assign( {}, actualNotebooks, {
        createRegistry: function()
        {
            var registry = actualNotebooks.createRegistry();

            return {
                remember: function( notebook )
                {
                    notebookMetrics.rememberCalls++;
                    return registry.remember( notebook );
                },
                sync: function( notebookDocuments )
                {
                    notebookMetrics.syncCalls++;
                    return registry.sync( notebookDocuments );
                },
                getForDocument: function( document )
                {
                    notebookMetrics.getForDocumentCalls++;
                    return registry.getForDocument( document );
                },
                isCellDocument: function( document )
                {
                    return registry.isCellDocument( document );
                },
                forget: function( notebook )
                {
                    notebookMetrics.forgetCalls++;
                    return registry.forget( notebook );
                },
                all: function()
                {
                    notebookMetrics.allCalls++;
                    return registry.all();
                },
                getByKey: function( notebookKey )
                {
                    notebookMetrics.getByKeyCalls++;
                    return registry.getByKey( notebookKey );
                }
            };
        }
    } );
    var configStub = {
        init: function() {},
        refreshTagGroupLookup: function() {},
        setTreeStateOverride: function( key, value )
        {
            if( value === undefined )
            {
                delete treeStateOverrides[ key ];
                return;
            }

            treeStateOverrides[ key ] = value;
        },
        setTreeStateOverrides: function( values )
        {
            Object.keys( values || {} ).forEach( function( key )
            {
                this.setTreeStateOverride( key, values[ key ] );
            }, this );
        },
        ripgrepPath: function() { return '/tmp/rg'; },
        regex: function()
        {
            return {
                tags: languageMatrix.DEFAULT_TAGS.slice(),
                regex: options.resourceConfig && options.resourceConfig.isDefaultRegex === true ?
                    actualUtils.DEFAULT_REGEX_SOURCE :
                    ( options.regexSource || '($TAGS)' ),
                caseSensitive: options.resourceConfig && options.resourceConfig.regexCaseSensitive !== false,
                multiLine: options.resourceConfig && options.resourceConfig.enableMultiLine === true
            };
        },
        subTagRegex: function()
        {
            return options.resourceConfig && options.resourceConfig.subTagRegex ? options.resourceConfig.subTagRegex : '(^:\\s*)';
        },
        scanMode: function() { return options.scanMode; },
        shouldIgnoreGitSubmodules: function() { return false; },
        shouldUseBuiltInFileExcludes: function() { return false; },
        shouldUseBuiltInSearchExcludes: function() { return false; },
        shouldShowActivityBarBadge: function() { return false; },
        shouldFlatten: function() { return Object.prototype.hasOwnProperty.call( treeStateOverrides, 'flat' ) ? treeStateOverrides.flat : context.workspaceState.get( 'flat', false ); },
        shouldShowTagsOnly: function() { return Object.prototype.hasOwnProperty.call( treeStateOverrides, 'tagsOnly' ) ? treeStateOverrides.tagsOnly : context.workspaceState.get( 'tagsOnly', false ); },
        clickingStatusBarShouldRevealTree: function() { return false; },
        clickingStatusBarShouldToggleHighlights: function() { return false; },
        tags: function() { return languageMatrix.DEFAULT_TAGS.slice(); },
        shouldShowIconsInsteadOfTagsInStatusBar: function() { return false; },
        shouldCompactFolders: function() { return false; },
        isValidScheme: function( uri ) { return uri && validSchemes.indexOf( uri.scheme ) !== -1; },
        labelFormat: function() { return '${tag} ${after}'; },
        shouldShowScanModeInTree: function() { return false; },
        shouldExpand: function() { return Object.prototype.hasOwnProperty.call( treeStateOverrides, 'expanded' ) ? treeStateOverrides.expanded : context.workspaceState.get( 'expanded', false ); },
        shouldGroupByTag: function() { return Object.prototype.hasOwnProperty.call( treeStateOverrides, 'groupedByTag' ) ? treeStateOverrides.groupedByTag : context.workspaceState.get( 'groupedByTag', false ); },
        shouldGroupBySubTag: function() { return Object.prototype.hasOwnProperty.call( treeStateOverrides, 'groupedBySubTag' ) ? treeStateOverrides.groupedBySubTag : context.workspaceState.get( 'groupedBySubTag', false ); },
        shouldShowCounts: function() { return false; },
        shouldHideIconsWhenGroupedByTag: function() { return false; },
        tooltipFormat: function() { return '${filepath}, ${line}'; },
        showFilterCaseSensitive: function() { return false; },
        isRegexCaseSensitive: function() { return true; },
        shouldHideFromTree: function() { return false; },
        shouldHideFromStatusBar: function() { return false; },
        shouldHideFromActivityBar: function() { return false; },
        shouldSortTree: function() { return true; },
        shouldSortTagsOnlyViewAlphabetically: function() { return false; },
        showBadges: function() { return false; },
        shouldUseColourScheme: function() { return false; },
        defaultHighlight: function() { return {}; },
        customHighlight: function() { return {}; },
        foregroundColourScheme: function() { return []; },
        backgroundColourScheme: function() { return []; },
        tagGroup: function() { return undefined; }
    };
    var utilsStub = {
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
        clearSubmoduleExcludeGlobCache: function() {},
        formatLabel: function( template ) { return template; },
        toGlobArray: function( value ) { return actualUtils.toGlobArray( value ); },
        createFolderGlob: function() { return '**/*'; }
    };
    var treeIconsStub = {
        getTreeIcon: function()
        {
            return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
        }
    };
    var treeModule = options.useActualTreeProvider === true ?
        helpers.loadWithStubs( '../src/tree.js', {
            vscode: vscodeStub,
            './config.js': configStub,
            './utils.js': utilsStub,
            './icons.js': treeIconsStub,
            './extensionIdentity.js': extensionIdentity
        } ) :
        undefined;
    var treeStub = options.useActualTreeProvider === true ?
        {
            TreeNodeProvider: function()
            {
                provider = instrumentProvider( new treeModule.TreeNodeProvider( arguments[ 0 ], arguments[ 1 ], arguments[ 2 ] ) );
                return provider;
            },
            locateWorkspaceNode: treeModule.locateWorkspaceNode
        } :
        {
            TreeNodeProvider: function()
            {
                return provider;
            },
            locateWorkspaceNode: function()
            {
                return undefined;
            }
        };

    var extensionStubs = {
        vscode: vscodeStub,
        './extensionIdentity.js': extensionIdentity,
        './ripgrep': {
            search: function( root, searchOptions, onEvent )
            {
                ripgrepSearchCalls.push( searchOptions );

                if( typeof ( options.ripgrepSearchImpl ) === 'function' )
                {
                    return options.ripgrepSearchImpl( root, searchOptions, onEvent );
                }

                var matchesByFile = new Map();

                ( options.ripgrepMatches || [] ).forEach( function( match )
                {
                    var line = match.line || 1;
                    var column = match.column || 1;
                    var matchText = match.match || '';
                    var lookupKey = [ match.fsPath, line, column, matchText ].join( '\u0000' );

                    ripgrepMatchLookup.set( lookupKey, match );

                    if( matchesByFile.has( match.fsPath ) !== true )
                    {
                        matchesByFile.set( match.fsPath, [] );
                    }

                    matchesByFile.get( match.fsPath ).push( match );
                } );

                matchesByFile.forEach( function( fileMatches, filePath )
                {
                    fileMatches.forEach( function( match )
                    {
                        var line = match.line || 1;
                        var column = match.column || 1;
                        var matchText = match.match || '';

                        if( typeof ( onEvent ) === 'function' )
                        {
                            onEvent( {
                                type: 'match',
                                data: {
                                    path: { text: filePath },
                                    lines: { text: matchText },
                                    line_number: line,
                                    absolute_offset: match.absoluteOffset || 0,
                                    submatches: [ {
                                        match: { text: matchText },
                                        start: Math.max( column - 1, 0 ),
                                        end: Math.max( column - 1, 0 ) + matchText.length
                                    } ]
                                }
                            } );
                        }
                    } );

                    if( typeof ( onEvent ) === 'function' )
                    {
                        onEvent( {
                            type: 'end',
                            data: {
                                path: { text: filePath }
                            }
                        } );
                    }
                } );

                return Promise.resolve( { stats: { matches: ( options.ripgrepMatches || [] ).length } } );
            },
            kill: function() {},
            decodeJsonValue: function( value )
            {
                return value && value.text !== undefined ? value.text : value;
            }
        },
        './tree.js': treeStub,
        './colours.js': {
            validateColours: function() { return undefined; },
            validateIconColours: function() { return undefined; }
        },
        './icons.js': {
            validateIcons: function() { return undefined; }
        },
        './highlights.js': {
            init: function() {},
            triggerHighlight: function() {},
            setScanResultsProvider: function() {},
            resetCaches: function() {}
        },
        './config.js': configStub,
        './utils.js': utilsStub,
        './attributes.js': {
            init: function() {},
            getIcon: function() { return 'check'; }
        },
        './notebooks.js': notebooksModule,
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
            },
            createScanContext: function( uri, text, snapshot, detectionOptions )
            {
                return {
                    uri: uri,
                    text: text,
                    snapshot: snapshot,
                    options: detectionOptions || {}
                };
            },
            scanDocumentWithContext: function( context )
            {
                var document = {
                    uri: context.uri,
                    fileName: context.uri && context.uri.fsPath,
                    version: context.options && context.options.version,
                    commentPatternFileName: context.options ? context.options.patternFileName : undefined,
                    getText: function() { return context.text; }
                };
                return this.scanDocument( document );
            },
            scanTextWithContext: function( context )
            {
                return this.scanText( context.uri, context.text );
            },
            normalizeRegexMatchWithContext: function( context, match )
            {
                var lookupKey = [ match.fsPath, match.line || 1, match.column || 1, match.match || '' ].join( '\u0000' );
                var originalMatch = ripgrepMatchLookup.get( lookupKey ) || match;

                normalizeCalls.push( { uri: context.uri, text: context.text, match: originalMatch } );
                return options.normalizeResult ? options.normalizeResult( originalMatch ) : originalMatch;
            }
        },
        fs: {
            existsSync: function() { return true; },
            mkdirSync: function() {},
            readFile: function( filePath, encoding, callback )
            {
                readFileCalls.push( filePath );
                if( typeof ( options.readFileImpl ) === 'function' )
                {
                    return options.readFileImpl( filePath, encoding, callback );
                }
                if( options.readFileErrors && options.readFileErrors[ filePath ] )
                {
                    callback( options.readFileErrors[ filePath ] );
                    return;
                }
                callback( null, options.fileContents[ filePath ] );
            },
            promises: {
                mkdir: function() { return Promise.resolve(); },
                readFile: function( filePath )
                {
                    readFileCalls.push( filePath );
                    if( typeof ( options.readFilePromiseImpl ) === 'function' )
                    {
                        return options.readFilePromiseImpl( filePath );
                    }
                    if( options.readFileErrors && options.readFileErrors[ filePath ] )
                    {
                        return Promise.reject( options.readFileErrors[ filePath ] );
                    }
                    return Promise.resolve( options.fileContents[ filePath ] );
                },
                readdir: function() { return Promise.resolve( [] ); },
                unlink: function() { return Promise.resolve(); }
            }
        },
        treeify: { asTree: function() { return ''; } },
        child_process: {
            execFile: function( executable, args, execOptions, callback )
            {
                callback( null, 'head', '' );
            }
        }
    };
    var extension = options.timerStubs ?
        loadWithStubsAndTimers( '../src/extension.js', extensionStubs, options.timerStubs ) :
        helpers.loadWithStubs( '../src/extension.js', extensionStubs );

    return {
        extension: extension,
        context: context,
        get provider()
        {
            return provider;
        },
        ripgrepSearchCalls: ripgrepSearchCalls,
        scanDocumentCalls: scanDocumentCalls,
        scanTextCalls: scanTextCalls,
        normalizeCalls: normalizeCalls,
        readFileCalls: readFileCalls,
        notebookMetrics: notebookMetrics,
        vscode: vscodeStub,
        windowListeners: vscodeStub.windowListeners,
        warningMessages: vscodeStub.warningMessages,
        errorMessages: vscodeStub.errorMessages
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

function createDeferred()
{
    var resolve;
    var reject;
    var promise = new Promise( function( promiseResolve, promiseReject )
    {
        resolve = promiseResolve;
        reject = promiseReject;
    } );

    return {
        promise: promise,
        resolve: resolve,
        reject: reject
    };
}

function summarizeNotebookResults( results )
{
    return results.map( function( result )
    {
        return [ result.actualTag, result.displayText, result.revealUri.toString(), result.uri.fsPath ];
    } );
}

function expectedNotebookResults( fixture )
{
    return [
        [ 'TODO', 'code cell item', fixture.codeCell.uri.toString(), fixture.notebook.uri.fsPath ],
        [ '[ ]', 'markdown cell item', fixture.markdownCell.uri.toString(), fixture.notebook.uri.fsPath ]
    ];
}

function assertNotebookResults( assert, results, fixture )
{
    assert.deepEqual( summarizeNotebookResults( results ), expectedNotebookResults( fixture ) );
}

function findReplaceCallsForPath( harness, fsPath )
{
    return harness.provider.replaceCalls.filter( function( call )
    {
        return call.uri.fsPath === fsPath;
    } );
}

function getLatestReplaceCallForPath( harness, fsPath )
{
    var calls = findReplaceCallsForPath( harness, fsPath );
    return calls.length > 0 ? calls[ calls.length - 1 ] : undefined;
}

function setVisibleNotebookEditors( harness, notebooksToShow, activeNotebook )
{
    harness.vscode.window.visibleNotebookEditors = notebooksToShow.map( function( notebook )
    {
        return { notebook: notebook };
    } );
    harness.vscode.window.activeNotebookEditor = activeNotebook ? { notebook: activeNotebook } :
        ( harness.vscode.window.visibleNotebookEditors[ 0 ] || undefined );
}

function fireVisibleNotebookEditorsChanged( harness, notebooksToShow, activeNotebook )
{
    setVisibleNotebookEditors( harness, notebooksToShow, activeNotebook );

    if( typeof ( harness.windowListeners.visibleNotebookEditors ) === 'function' )
    {
        return harness.windowListeners.visibleNotebookEditors( harness.vscode.window.visibleNotebookEditors );
    }

    return undefined;
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

QUnit.test( "default workspace startup keeps plain visible editors on the O(1) non-notebook path", function( assert )
{
    var firstDocument = matrixHelpers.createDocument( '/workspace/src/first.js', '// TODO first item' );
    var secondDocument = matrixHelpers.createDocument( '/workspace/src/second.js', '// TODO second item' );
    var hiddenNotebookFixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        notebookDocuments: [ hiddenNotebookFixture.notebook ],
        visibleNotebookEditors: [],
        visibleTextEditors: [ { document: firstDocument }, { document: secondDocument } ],
        activeTextEditor: { document: firstDocument },
        documentResults: [ {
            uri: matrixHelpers.createUri( '/workspace/src/first.js' ),
            actualTag: 'TODO',
            displayText: 'first item',
            continuationText: []
        } ],
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.notebookMetrics.syncCalls, 1 );
        assert.equal( harness.notebookMetrics.getForDocumentCalls, 0 );

        harness.vscode.window.activeTextEditor = { document: secondDocument };
        return harness.vscode.workspaceListeners.activeEditor( { document: secondDocument } );
    } ).then( function()
    {
        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.notebookMetrics.syncCalls, 1 );
        assert.equal( harness.notebookMetrics.getForDocumentCalls, 0 );
        assert.equal( findReplaceCallsForPath( harness, hiddenNotebookFixture.notebook.uri.fsPath ).length, 0 );
    } );
} );

QUnit.test( "plain file open save and change events never consult notebook ownership", function( assert )
{
    var hiddenNotebookFixture = createNotebookFixture();
    var document = matrixHelpers.createDocument( '/workspace/src/plain.js', '// TODO plain item' );
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ hiddenNotebookFixture.notebook ],
        visibleNotebookEditors: [],
        visibleTextEditors: [ { document: document } ],
        activeTextEditor: { document: document },
        documentResults: [ {
            uri: matrixHelpers.createUri( '/workspace/src/plain.js' ),
            actualTag: 'TODO',
            displayText: 'plain item',
            continuationText: []
        } ],
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        var openedDocument = matrixHelpers.createDocument( '/workspace/src/opened.js', '// TODO opened item' );

        harness.vscode.workspaceListeners.open( openedDocument );
        harness.vscode.workspaceListeners.save( document );
        harness.vscode.workspaceListeners.changeText( { document: document } );

        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.notebookMetrics.syncCalls, 1 );
        assert.equal( harness.notebookMetrics.getForDocumentCalls, 0 );
        assert.equal( findReplaceCallsForPath( harness, hiddenNotebookFixture.notebook.uri.fsPath ).length, 0 );
    } );
} );

QUnit.test( "workspace notebook documents that are not visible are ignored by the open-file refresh path", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        notebookDocuments: [ fixture.notebook ],
        visibleNotebookEditors: [],
        visibleTextEditors: [],
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 0 );
        assert.equal( harness.notebookMetrics.syncCalls, 1 );
        assert.deepEqual( harness.provider.replaceCalls, [] );
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
        assertNotebookResults( assert, harness.provider.replaceCalls[ 0 ].results, fixture );
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
        assertNotebookResults( assert, harness.provider.replaceCalls[ 0 ].results, fixture );

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
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assertNotebookResults( assert, lastReplaceCall.results, fixture );
    } );
} );

QUnit.test( "issue #883 open-files mode keeps notebook results when focus moves from a notebook cell to a regular file", function( assert )
{
    var fixture = createNotebookFixture();
    var regularDocument = matrixHelpers.createDocument( '/workspace/clean.js', 'const clean = true;' );
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell }, { document: regularDocument } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: function( document )
        {
            if( document.uri.toString() === regularDocument.uri.toString() )
            {
                return [];
            }

            return fixture.scanDocumentImpl( document );
        },
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( findReplaceCallsForPath( harness, fixture.notebook.uri.fsPath ).length, 1 );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );

        harness.vscode.window.activeTextEditor = { document: regularDocument };
        return harness.vscode.workspaceListeners.activeEditor( { document: regularDocument } );
    } ).then( function()
    {
        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( findReplaceCallsForPath( harness, fixture.notebook.uri.fsPath ).length, 1 );
        assert.equal( harness.scanDocumentCalls.length, 3 );
        assert.equal( harness.scanDocumentCalls[ 0 ].fileName, regularDocument.fileName );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );
    } );
} );

QUnit.test( "issue #883 open-files mode rescans the full notebook when the active cell changes", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'open files',
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
        assert.equal( findReplaceCallsForPath( harness, fixture.notebook.uri.fsPath ).length, 1 );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );

        harness.vscode.window.activeTextEditor = { document: fixture.markdownCell };
        return harness.vscode.workspaceListeners.activeEditor( { document: fixture.markdownCell } );
    } ).then( function()
    {
        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( findReplaceCallsForPath( harness, fixture.notebook.uri.fsPath ).length, 2 );
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );
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
        assertNotebookResults( assert, harness.provider.replaceCalls[ 0 ].results, fixture );
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
        fireVisibleNotebookEditorsChanged( harness, [ fixture.notebook ], fixture.notebook );
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
        assertNotebookResults( assert, harness.provider.replaceCalls[ 0 ].results, fixture );
    } );
} );

QUnit.test( "notebook change events are ignored until the notebook becomes visible", function( assert )
{
    var fixture = createNotebookFixture();
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ fixture.notebook ],
        visibleNotebookEditors: [],
        scanDocumentImpl: fixture.scanDocumentImpl,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        fixture.notebook.version += 1;
        return harness.vscode.workspaceListeners.changeNotebook( { notebook: fixture.notebook } );
    } ).then( function()
    {
        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 0 );

        fireVisibleNotebookEditorsChanged( harness, [ fixture.notebook ], fixture.notebook );
        return waitForDelay( 250 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 2 );

        fixture.notebook.version += 1;
        return harness.vscode.workspaceListeners.changeNotebook( { notebook: fixture.notebook } );
    } ).then( function()
    {
        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );
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
        assertNotebookResults( assert, lastReplaceCall.results, fixture );
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

        fireVisibleNotebookEditorsChanged( harness, [], undefined );
        harness.vscode.workspaceListeners.closeNotebook( fixture.notebook );

        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
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

QUnit.test( "issue #883 workspace-only mode scans notebooks within workspace roots", function( assert )
{
    var fixture = createNotebookFixture();
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
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assert.equal( findReplaceCallsForPath( harness, fixture.notebook.uri.fsPath ).length, 1 );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );
    } );
} );

QUnit.test( "issue #883 notebook results survive tree view and grouping commands", function( assert )
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
    var commandNames = [
        'better-todo-tree.showFlatView',
        'better-todo-tree.showTagsOnlyView',
        'better-todo-tree.showTreeView',
        'better-todo-tree.groupByTag',
        'better-todo-tree.ungroupByTag'
    ];

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );

        return commandNames.reduce( function( promise, commandName )
        {
            return promise.then( function()
            {
                harness.vscode.commandHandlers[ commandName ]();
                return matrixHelpers.flushAsyncWork();
            } ).then( function()
            {
                assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );
            } );
        }, Promise.resolve() );
    } ).then( function()
    {
        assert.equal( findReplaceCallsForPath( harness, fixture.notebook.uri.fsPath ).length, 1 + commandNames.length );
    } );
} );

QUnit.test( "issue #883 periodic refresh re-scans open notebooks through the standard rebuild pipeline", function( assert )
{
    var fixture = createNotebookFixture();
    var intervalHandles = [];
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        periodicRefreshInterval: 1,
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        notebookDocuments: [ fixture.notebook ],
        visibleTextEditors: [ { document: fixture.codeCell } ],
        activeTextEditor: { document: fixture.codeCell },
        scanDocumentImpl: fixture.scanDocumentImpl,
        timerStubs: {
            setTimeout: function( callback )
            {
                callback();
                return { callback: callback };
            },
            clearTimeout: function() {},
            setInterval: function( callback, delay )
            {
                var handle = { callback: callback, delay: delay };
                intervalHandles.push( handle );
                return handle;
            },
            clearInterval: function() {}
        },
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( intervalHandles.length, 1 );
        assert.equal( intervalHandles[ 0 ].delay, 60000 );
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );

        intervalHandles[ 0 ].callback();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 2 );
        assert.equal( findReplaceCallsForPath( harness, fixture.notebook.uri.fsPath ).length, 2 );
        assertNotebookResults( assert, getLatestReplaceCallForPath( harness, fixture.notebook.uri.fsPath ).results, fixture );
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

QUnit.test( "workspace scan resolves root-relative ripgrep paths back to absolute workspace files", function( assert )
{
    var fixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/relative.py' ),
        actualTag: 'TODO',
        displayText: 'relative workspace item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: 'src/relative.py' } ],
        workspaceResults: fixture,
        fileContents: {
            '/workspace/src/relative.py': '# TODO relative workspace item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.readFileCalls.length, 1 );
        assert.equal( harness.readFileCalls[ 0 ], '/workspace/src/relative.py' );
        assert.equal( harness.scanTextCalls.length, 1 );
        assert.equal( harness.scanTextCalls[ 0 ].uri.fsPath, '/workspace/src/relative.py' );
        assert.deepEqual( harness.provider.replaceCalls[ 0 ].results, fixture );
    } );
} );

QUnit.test( "workspace and open files mode does not rescan workspace-covered documents when focus changes", function( assert )
{
    var firstDocument = matrixHelpers.createDocument( '/workspace/src/first.py', '# TODO first item' );
    var secondDocument = matrixHelpers.createDocument( '/workspace/src/second.py', '# TODO second item' );
    var workspaceFixture = [ {
        uri: matrixHelpers.createUri( '/workspace/src/workspace.py' ),
        actualTag: 'TODO',
        displayText: 'workspace item',
        continuationText: []
    } ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        visibleTextEditors: [ { document: firstDocument }, { document: secondDocument } ],
        activeTextEditor: { document: firstDocument },
        ripgrepMatches: [ { fsPath: '/workspace/src/workspace.py' } ],
        workspaceResults: workspaceFixture,
        fileContents: {
            '/workspace/src/workspace.py': '# TODO workspace item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 0 );
        assert.equal( harness.scanTextCalls.length, 1 );

        harness.vscode.window.activeTextEditor = { document: secondDocument };
        return harness.vscode.workspaceListeners.activeEditor( { document: secondDocument } );
    } ).then( function()
    {
        return waitForDelay( 550 );
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.scanDocumentCalls.length, 0 );
        assert.equal( harness.scanTextCalls.length, 1 );
        assert.deepEqual( harness.provider.replaceCalls.map( function( call ) { return call.uri.fsPath; } ), [
            '/workspace/src/workspace.py'
        ] );
    } );
} );

QUnit.test( "workspace candidate scanning streams results before ripgrep finishes the workspace walk", function( assert )
{
    var releaseSearch = createDeferred();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        scanTextImpl: function( uri )
        {
            return [ {
                uri: uri,
                actualTag: 'TODO',
                displayText: path.basename( uri.fsPath ),
                continuationText: []
            } ];
        },
        ripgrepSearchImpl: function( root, searchOptions, onEvent )
        {
            onEvent( {
                type: 'match',
                data: {
                    path: { text: './a.js' }
                }
            } );
            onEvent( {
                type: 'end',
                data: {
                    path: { text: './a.js' }
                }
            } );

            return releaseSearch.promise.then( function()
            {
                onEvent( {
                    type: 'match',
                    data: {
                        path: { text: './b.js' }
                    }
                } );
                onEvent( {
                    type: 'end',
                    data: {
                        path: { text: './b.js' }
                    }
                } );

                return { stats: { matches: 2 } };
            } );
        },
        timerStubs: {
            setTimeout: function( callback )
            {
                callback();
                return { callback: callback };
            },
            clearTimeout: function() {},
            setInterval: function() { return {}; },
            clearInterval: function() {}
        },
        fileContents: {
            '/workspace/a.js': '# TODO a',
            '/workspace/b.js': '# TODO b'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.deepEqual( harness.provider.replaceCalls.map( function( call ) { return call.uri.fsPath; } ), [
            '/workspace/a.js'
        ] );
        assert.equal( harness.provider.finalizeCalls.some( function( call )
        {
            return call.options.forceFullRefresh === true;
        } ), true );

        releaseSearch.resolve();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( harness.provider.replaceCalls.map( function( call ) { return call.uri.fsPath; } ), [
            '/workspace/a.js',
            '/workspace/b.js'
        ] );
    } );
} );

QUnit.test( "view commands preserve streamed workspace results while a rebuild is still in flight", function( assert )
{
    var releaseSearch = createDeferred();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        scanTextImpl: function( uri )
        {
            return [ {
                uri: uri,
                actualTag: 'TODO',
                displayText: 'streamed item',
                continuationText: []
            } ];
        },
        ripgrepSearchImpl: function( root, searchOptions, onEvent )
        {
            onEvent( {
                type: 'match',
                data: {
                    path: { text: './streamed.js' }
                }
            } );
            onEvent( {
                type: 'end',
                data: {
                    path: { text: './streamed.js' }
                }
            } );

            return releaseSearch.promise.then( function()
            {
                return { stats: { matches: 1 } };
            } );
        },
        timerStubs: {
            setTimeout: function( callback )
            {
                callback();
                return { callback: callback };
            },
            clearTimeout: function() {},
            setInterval: function() { return {}; },
            clearInterval: function() {}
        },
        fileContents: {
            '/workspace/streamed.js': '# TODO streamed item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.provider.latestResultsByUri.has( '/workspace/streamed.js' ), true );

        harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ]();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.provider.latestResultsByUri.has( '/workspace/streamed.js' ), true );
        assert.equal( harness.provider.latestResultsByUri.get( '/workspace/streamed.js' ).results.length, 1 );

        releaseSearch.resolve();
        return matrixHelpers.flushAsyncWork();
    } );
} );

QUnit.test( "view commands wait for all workspace-state writes before refreshing", function( assert )
{
    var tagsOnlyWrite = createDeferred();
    var workspaceStateValues = {};
    var workspaceState = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            workspaceStateValues[ key ] = value;
            if( key === 'tagsOnly' )
            {
                return tagsOnlyWrite.promise;
            }

            return Promise.resolve();
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        var clearCallsBeforeRefresh = harness.provider.clearCalls;
        harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ]();

        return matrixHelpers.flushAsyncWork().then( function()
        {
            assert.equal( harness.provider.clearCalls, clearCallsBeforeRefresh );

            tagsOnlyWrite.resolve();
            return matrixHelpers.flushAsyncWork();
        } ).then( function()
        {
            assert.ok( harness.provider.clearCalls > clearCallsBeforeRefresh );
            assert.equal( workspaceState.get( 'flat' ), true );
            assert.equal( workspaceState.get( 'tagsOnly' ), false );
        } );
    } );
} );

QUnit.test( "later view commands are ignored while an earlier view write is still busy", function( assert )
{
    var flatViewWrite = createDeferred();
    var workspaceStateValues = {};
    var workspaceState = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            if( key === 'flat' && value === true )
            {
                return flatViewWrite.promise.then( function()
                {
                    workspaceStateValues[ key ] = value;
                } );
            }

            workspaceStateValues[ key ] = value;
            return Promise.resolve();
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.showTreeView' ]();

        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( workspaceState.get( 'flat', false ), false );

        flatViewWrite.resolve();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( workspaceState.get( 'flat', false ), true );
        assert.equal( workspaceState.get( 'tagsOnly', false ), false );
    } );
} );

QUnit.test( "cycleViewStyle uses live workspace state for deterministic view transitions", function( assert )
{
    var workspaceStateValues = {
        flat: false,
        tagsOnly: false
    };
    var workspaceState = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            workspaceStateValues[ key ] = value;
            return Promise.resolve();
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( workspaceStateValues, { flat: true, tagsOnly: false } );
        return harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( workspaceStateValues, { flat: false, tagsOnly: true } );
        return harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( workspaceStateValues, { flat: false, tagsOnly: false } );
    } );
} );

QUnit.test( "cycleViewStyle uses immediate tree-state overrides when workspace persistence lags behind reads", function( assert )
{
    var visibleStateValues = {
        flat: false,
        tagsOnly: false
    };
    var updateCalls = [];
    var workspaceState = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( visibleStateValues, key ) ? visibleStateValues[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            updateCalls.push( { key: key, value: value } );
            return Promise.resolve();
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        return harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( updateCalls.slice( 0, 4 ), [
            { key: 'tagsOnly', value: false },
            { key: 'flat', value: true },
            { key: 'flat', value: false },
            { key: 'tagsOnly', value: true }
        ] );
    } );
} );

QUnit.test( "cycleViewStyle ignores repeated clicks while the current view mutation is still in flight", function( assert )
{
    var writeDeferred = createDeferred();
    var updateCalls = [];
    var workspaceState = {
        get: function( key, defaultValue )
        {
            if( key === 'flat' )
            {
                return false;
            }

            if( key === 'tagsOnly' )
            {
                return false;
            }

            return defaultValue;
        },
        update: function( key, value )
        {
            updateCalls.push( { key: key, value: value } );
            return writeDeferred.promise;
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();

        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( updateCalls, [
            { key: 'tagsOnly', value: false },
            { key: 'flat', value: true }
        ] );

        writeDeferred.resolve();
        return matrixHelpers.flushAsyncWork();
    } );
} );

QUnit.test( "explicit view changes refresh the tree immediately instead of waiting for the generic debounce", function( assert )
{
    var scheduledTimeouts = [];
    var workspaceStateValues = {
        flat: false,
        tagsOnly: false
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: {
            get: function( key, defaultValue )
            {
                return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
            },
            update: function( key, value )
            {
                workspaceStateValues[ key ] = value;
                return Promise.resolve();
            }
        },
        timerStubs: {
            setTimeout: function( callback, delay )
            {
                scheduledTimeouts.push( { callback: callback, delay: delay } );
                return { callback: callback, delay: delay };
            },
            clearTimeout: function() {},
            setInterval: function() { return {}; },
            clearInterval: function() {}
        },
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        var baselineRefreshCalls = harness.provider.refreshCalls;
        var baselineDebouncedRefreshTimers = scheduledTimeouts.filter( function( entry )
        {
            return entry.delay === 200;
        } ).length;
        return harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ]().then( function()
        {
            return matrixHelpers.flushAsyncWork().then( function()
            {
                assert.equal( harness.provider.refreshCalls, baselineRefreshCalls + 1 );
                assert.equal( scheduledTimeouts.filter( function( entry )
                {
                    return entry.delay === 200;
                } ).length, baselineDebouncedRefreshTimers );
            } );
        } );
    } );
} );

QUnit.test( "showTreeView rebuilds the actual provider even when workspace state already says tree", function( assert )
{
    var workspaceState = matrixHelpers.createWorkspaceState( {
        flat: false,
        tagsOnly: true
    } );
    var workspaceResult = {
        uri: matrixHelpers.createUri( '/workspace/src/nested/file.js' ),
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 5,
        actualTag: 'TODO',
        displayText: 'view item',
        before: '',
        after: 'view item',
        continuationText: [],
        match: 'TODO view item'
    };
    var harness = createExtensionHarness( {
        useActualTreeProvider: true,
        scanMode: 'workspace',
        workspaceState: workspaceState,
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/nested/file.js' } ],
        workspaceResults: [ workspaceResult ],
        fileContents: {
            '/workspace/src/nested/file.js': '// TODO view item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.provider.getChildren()[ 0 ].label, 'TODO view item' );

        return workspaceState.update( 'tagsOnly', false );
    } ).then( function()
    {
        return harness.vscode.commandHandlers[ 'better-todo-tree.showTreeView' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var rootNode = harness.provider.getChildren()[ 0 ];

        assert.equal( harness.vscode.treeViews[ 0 ].title, 'Tree' );
        assert.equal( rootNode.label, 'workspace' );
        assert.equal( harness.provider.getChildren( rootNode )[ 0 ].label, 'src' );
    } );
} );

QUnit.test( "cycleViewStyle rebuilds the actual provider layout on every click", function( assert )
{
    var workspaceResult = {
        uri: matrixHelpers.createUri( '/workspace/src/nested/file.js' ),
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 5,
        actualTag: 'TODO',
        displayText: 'view item',
        before: '',
        after: 'view item',
        continuationText: [],
        match: 'TODO view item'
    };
    var harness = createExtensionHarness( {
        useActualTreeProvider: true,
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/nested/file.js' } ],
        workspaceResults: [ workspaceResult ],
        fileContents: {
            '/workspace/src/nested/file.js': '// TODO view item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        var treeRoot = harness.provider.getChildren()[ 0 ];

        assert.equal( harness.vscode.treeViews[ 0 ].title, 'Tree' );
        assert.equal( treeRoot.label, 'workspace' );
        assert.equal( harness.provider.getChildren( treeRoot )[ 0 ].label, 'src' );

        return harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var flatRoot = harness.provider.getChildren()[ 0 ];

        assert.equal( harness.vscode.treeViews[ 0 ].title, 'Flat' );
        assert.equal( flatRoot.label, 'workspace' );
        assert.equal( harness.provider.getChildren( flatRoot )[ 0 ].label, 'file.js' );

        return harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.vscode.treeViews[ 0 ].title, 'Tags' );
        assert.equal( harness.provider.getChildren()[ 0 ].label, 'TODO view item' );

        return harness.vscode.commandHandlers[ 'better-todo-tree.cycleViewStyle' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var treeRoot = harness.provider.getChildren()[ 0 ];

        assert.equal( harness.vscode.treeViews[ 0 ].title, 'Tree' );
        assert.equal( treeRoot.label, 'workspace' );
        assert.equal( harness.provider.getChildren( treeRoot )[ 0 ].label, 'src' );
    } );
} );

QUnit.test( "grouping commands rebuild the actual provider roots between grouped and ungrouped tags", function( assert )
{
    var workspaceState = matrixHelpers.createWorkspaceState( {
        flat: false,
        tagsOnly: true,
        groupedByTag: false
    } );
    var workspaceResults = [
        {
            uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 5,
            actualTag: 'TODO',
            displayText: 'todo item one',
            before: '',
            after: 'todo item one',
            continuationText: [],
            match: 'TODO todo item one'
        },
        {
            uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
            line: 2,
            column: 1,
            endLine: 2,
            endColumn: 6,
            actualTag: 'FIXME',
            displayText: 'fixme item one',
            before: '',
            after: 'fixme item one',
            continuationText: [],
            match: 'FIXME fixme item one'
        },
        {
            uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
            line: 3,
            column: 1,
            endLine: 3,
            endColumn: 5,
            actualTag: 'TODO',
            displayText: 'todo item two',
            before: '',
            after: 'todo item two',
            continuationText: [],
            match: 'TODO todo item two'
        },
        {
            uri: matrixHelpers.createUri( '/workspace/src/file.js' ),
            line: 4,
            column: 1,
            endLine: 4,
            endColumn: 6,
            actualTag: 'FIXME',
            displayText: 'fixme item two',
            before: '',
            after: 'fixme item two',
            continuationText: [],
            match: 'FIXME fixme item two'
        }
    ];
    var harness = createExtensionHarness( {
        useActualTreeProvider: true,
        scanMode: 'workspace',
        workspaceState: workspaceState,
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/file.js' } ],
        workspaceResults: workspaceResults,
        fileContents: {
            '/workspace/src/file.js': '// TODO todo item one\n// FIXME fixme item one\n// TODO todo item two\n// FIXME fixme item two'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.deepEqual( harness.provider.getChildren().map( function( node ) { return node.label; } ), [
            'FIXME fixme item one',
            'FIXME fixme item two',
            'TODO todo item one',
            'TODO todo item two'
        ] );
        return harness.vscode.commandHandlers[ 'better-todo-tree.groupByTag' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var roots = harness.provider.getChildren();

        assert.deepEqual( roots.map( function( node ) { return node.label; } ), [ 'FIXME', 'TODO' ] );
        assert.deepEqual( harness.provider.getChildren( roots[ 0 ] ).map( function( node ) { return node.label; } ), [
            'fixme item one',
            'fixme item two'
        ] );
        assert.deepEqual( harness.provider.getChildren( roots[ 1 ] ).map( function( node ) { return node.label; } ), [
            'todo item one',
            'todo item two'
        ] );

        return harness.vscode.commandHandlers[ 'better-todo-tree.ungroupByTag' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( harness.provider.getChildren().map( function( node ) { return node.label; } ), [
            'FIXME fixme item one',
            'FIXME fixme item two',
            'TODO todo item one',
            'TODO todo item two'
        ] );
    } );
} );

QUnit.test( "expansion commands rebuild the actual provider collapsible state", function( assert )
{
    var workspaceState = matrixHelpers.createWorkspaceState( {
        expanded: false
    } );
    var workspaceResult = {
        uri: matrixHelpers.createUri( '/workspace/src/nested/file.js' ),
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 5,
        actualTag: 'TODO',
        displayText: 'expand item',
        before: '',
        after: 'expand item',
        continuationText: [],
        match: 'TODO expand item'
    };
    var harness = createExtensionHarness( {
        useActualTreeProvider: true,
        scanMode: 'workspace',
        workspaceState: workspaceState,
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/nested/file.js' } ],
        workspaceResults: [ workspaceResult ],
        fileContents: {
            '/workspace/src/nested/file.js': '// TODO expand item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        var rootNode = harness.provider.getChildren()[ 0 ];
        assert.equal( harness.provider.getTreeItem( rootNode ).collapsibleState, harness.vscode.TreeItemCollapsibleState.Collapsed );
        assert.deepEqual( harness.vscode.treeViews[ 0 ].revealCalls, [] );

        return harness.vscode.commandHandlers[ 'better-todo-tree.expand' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var rootNode = harness.provider.getChildren()[ 0 ];
        assert.equal( harness.provider.getTreeItem( rootNode ).collapsibleState, harness.vscode.TreeItemCollapsibleState.Expanded );
        assert.equal( harness.vscode.treeViews[ 0 ].revealCalls.length, 1 );
        assert.strictEqual( harness.vscode.treeViews[ 0 ].revealCalls[ 0 ].element, rootNode );
        assert.ok( harness.vscode.treeViews[ 0 ].revealCalls[ 0 ].options.expand >= 1 );
        assert.deepEqual( harness.vscode.executedCommands.filter( function( call )
        {
            return call[ 0 ] === 'workbench.actions.treeView.todo-tree-view.collapseAll';
        } ), [] );

        return harness.vscode.commandHandlers[ 'better-todo-tree.collapse' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var rootNode = harness.provider.getChildren()[ 0 ];
        assert.equal( harness.provider.getTreeItem( rootNode ).collapsibleState, harness.vscode.TreeItemCollapsibleState.Collapsed );
        assert.deepEqual( harness.vscode.executedCommands.filter( function( call )
        {
            return call[ 0 ] === 'workbench.actions.treeView.todo-tree-view.collapseAll';
        } ), [
            [ 'workbench.actions.treeView.todo-tree-view.collapseAll' ]
        ] );
    } );
} );

QUnit.test( "toggleTreeExpansion drives live expand and collapse operations on the actual tree view", function( assert )
{
    var workspaceStateValues = {
        expanded: false
    };
    var workspaceState = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            workspaceStateValues[ key ] = value;
            return Promise.resolve();
        }
    };
    var workspaceResult = {
        uri: matrixHelpers.createUri( '/workspace/src/deep/nested/file.js' ),
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 5,
        actualTag: 'TODO',
        displayText: 'toggle item',
        before: '',
        after: 'toggle item',
        continuationText: [],
        match: 'TODO toggle item'
    };
    var harness = createExtensionHarness( {
        useActualTreeProvider: true,
        scanMode: 'workspace',
        workspaceState: workspaceState,
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/deep/nested/file.js' } ],
        workspaceResults: [ workspaceResult ],
        fileContents: {
            '/workspace/src/deep/nested/file.js': '// TODO toggle item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return harness.vscode.commandHandlers[ 'better-todo-tree.toggleTreeExpansion' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( workspaceStateValues.expanded, true );
        assert.equal( harness.vscode.treeViews[ 0 ].revealCalls.length, 1 );
        assert.ok( harness.vscode.treeViews[ 0 ].revealCalls[ 0 ].options.expand >= 3 );

        return harness.vscode.commandHandlers[ 'better-todo-tree.toggleTreeExpansion' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( workspaceStateValues.expanded, false );
        assert.deepEqual( harness.vscode.executedCommands.filter( function( call )
        {
            return call[ 0 ] === 'workbench.actions.treeView.todo-tree-view.collapseAll';
        } ), [
            [ 'workbench.actions.treeView.todo-tree-view.collapseAll' ]
        ] );
    } );
} );

QUnit.test( "view changes and expansion mutations stay serialized across the actual tree view", function( assert )
{
    var workspaceStateValues = {
        flat: false,
        tagsOnly: false,
        expanded: false
    };
    var workspaceState = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            workspaceStateValues[ key ] = value;
            return Promise.resolve();
        }
    };
    var workspaceResult = {
        uri: matrixHelpers.createUri( '/workspace/src/deep/nested/file.js' ),
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 5,
        actualTag: 'TODO',
        displayText: 'mixed action item',
        before: '',
        after: 'mixed action item',
        continuationText: [],
        match: 'TODO mixed action item'
    };
    var harness = createExtensionHarness( {
        useActualTreeProvider: true,
        scanMode: 'workspace',
        workspaceState: workspaceState,
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: [ { fsPath: '/workspace/src/deep/nested/file.js' } ],
        workspaceResults: [ workspaceResult ],
        fileContents: {
            '/workspace/src/deep/nested/file.js': '// TODO mixed action item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.expand' ]();

        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        var flatRoot = harness.provider.getChildren()[ 0 ];

        assert.equal( harness.vscode.treeViews[ 0 ].title, 'Flat' );
        assert.equal( workspaceStateValues.flat, true );
        assert.equal( workspaceStateValues.expanded, true );
        assert.equal( flatRoot.label, 'workspace' );
        assert.equal( harness.provider.getChildren( flatRoot )[ 0 ].label, 'file.js' );
        assert.equal( harness.vscode.treeViews[ 0 ].revealCalls.length, 1 );

        harness.vscode.commandHandlers[ 'better-todo-tree.showTagsOnlyView' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.collapse' ]();

        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.vscode.treeViews[ 0 ].title, 'Tags' );
        assert.equal( workspaceStateValues.tagsOnly, true );
        assert.equal( workspaceStateValues.expanded, false );
        assert.equal( harness.provider.getChildren()[ 0 ].label, 'TODO mixed action item' );
        assert.deepEqual( harness.vscode.executedCommands.filter( function( call )
        {
            return call[ 0 ] === 'workbench.actions.treeView.todo-tree-view.collapseAll';
        } ), [
            [ 'workbench.actions.treeView.todo-tree-view.collapseAll' ]
        ] );
    } );
} );

QUnit.test( "grouping commands ignore repeated clicks while the current grouping mutation is still in flight", function( assert )
{
    var writeDeferred = createDeferred();
    var updateCalls = [];
    var workspaceState = {
        get: function( key, defaultValue )
        {
            if( key === 'groupedByTag' )
            {
                return false;
            }

            return defaultValue;
        },
        update: function( key, value )
        {
            updateCalls.push( { key: key, value: value } );
            return writeDeferred.promise;
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        harness.vscode.commandHandlers[ 'better-todo-tree.groupByTag' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.groupByTag' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.groupByTag' ]();

        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( updateCalls, [
            { key: 'groupedByTag', value: true }
        ] );

        writeDeferred.resolve();
        return matrixHelpers.flushAsyncWork();
    } );
} );

QUnit.test( "expansion commands ignore repeated clicks while the current expansion mutation is still in flight", function( assert )
{
    var writeDeferred = createDeferred();
    var updateCalls = [];
    var workspaceState = {
        get: function( key, defaultValue )
        {
            if( key === 'expanded' )
            {
                return false;
            }

            return defaultValue;
        },
        update: function( key, value )
        {
            updateCalls.push( { key: key, value: value } );
            return writeDeferred.promise;
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        harness.vscode.commandHandlers[ 'better-todo-tree.expand' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.expand' ]();
        harness.vscode.commandHandlers[ 'better-todo-tree.expand' ]();

        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.deepEqual( updateCalls, [
            { key: 'expanded', value: true }
        ] );

        writeDeferred.resolve();
        return matrixHelpers.flushAsyncWork();
    } );
} );

QUnit.test( "scan mode button commands return the underlying setting write promise", function( assert )
{
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        var commands = [
            'better-todo-tree.scanWorkspaceAndOpenFiles',
            'better-todo-tree.scanOpenFilesOnly',
            'better-todo-tree.scanCurrentFileOnly',
            'better-todo-tree.scanWorkspaceOnly'
        ];

        return commands.reduce( function( promise, commandName )
        {
            return promise.then( function()
            {
                return harness.vscode.commandHandlers[ commandName ]();
            } );
        }, Promise.resolve() );
    } ).then( function()
    {
        assert.deepEqual( harness.vscode.configurationUpdates.slice( -4 ), [
            { key: 'tree.scanMode', value: 'workspace', target: harness.vscode.ConfigurationTarget.Workspace },
            { key: 'tree.scanMode', value: 'open files', target: harness.vscode.ConfigurationTarget.Workspace },
            { key: 'tree.scanMode', value: 'current file', target: harness.vscode.ConfigurationTarget.Workspace },
            { key: 'tree.scanMode', value: 'workspace only', target: harness.vscode.ConfigurationTarget.Workspace }
        ] );
    } );
} );

QUnit.test( "toggleTreeExpansion uses live workspace state for deterministic expansion toggles", function( assert )
{
    var workspaceStateValues = {
        expanded: false
    };
    var workspaceState = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            workspaceStateValues[ key ] = value;
            return Promise.resolve();
        }
    };
    var harness = createExtensionHarness( {
        scanMode: 'open files',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceState: workspaceState,
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        return harness.vscode.commandHandlers[ 'better-todo-tree.toggleTreeExpansion' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( workspaceStateValues.expanded, true );
        return harness.vscode.commandHandlers[ 'better-todo-tree.toggleTreeExpansion' ]();
    } ).then( function()
    {
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( workspaceStateValues.expanded, false );
    } );
} );

QUnit.test( "workspace scans publish progress, current target, and clear the tree message when complete", function( assert )
{
    var releaseSearch = createDeferred();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        scanTextImpl: function( uri )
        {
            return [ {
                uri: uri,
                actualTag: 'TODO',
                displayText: path.basename( uri.fsPath ),
                continuationText: []
            } ];
        },
        ripgrepSearchImpl: function( root, searchOptions, onEvent )
        {
            onEvent( {
                type: 'match',
                data: {
                    path: { text: './tracked.js' }
                }
            } );
            onEvent( {
                type: 'end',
                data: {
                    path: { text: './tracked.js' }
                }
            } );

            return releaseSearch.promise.then( function()
            {
                return { stats: { matches: 1 } };
            } );
        },
        fileContents: {
            '/workspace/tracked.js': '# TODO tracked'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.vscode.progressSessions.length, 1 );
        assert.equal( harness.vscode.progressSessions[ 0 ].options.location, harness.vscode.ProgressLocation.Notification );
        assert.equal( harness.vscode.progressSessions[ 0 ].reports.length > 0, true );
        assert.equal( harness.vscode.progressSessions[ 0 ].reports.some( function( report )
        {
            return typeof report.message === 'string' && report.message.indexOf( 'tracked.js' ) >= 0;
        } ), true );
        assert.equal( harness.vscode.treeViews[ 0 ].message.indexOf( 'tracked.js' ) >= 0, true );
        assert.equal( harness.vscode.statusBarItems[ 0 ].text.indexOf( 'Better Todo Tree' ) >= 0, true );
        assert.equal( harness.vscode.statusBarItems[ 0 ].text.indexOf( '100%' ) === -1, true );

        releaseSearch.resolve();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.vscode.progressSessions[ 0 ].completed, true );
        assert.equal( harness.vscode.treeViews[ 0 ].message, '' );
        assert.equal( harness.vscode.statusBarItems[ 0 ].text.indexOf( '100%' ) === -1, true );
    } );
} );

QUnit.test( "scan progress cancellation interrupts the active scan and surfaces a cancellation message", function( assert )
{
    var releaseSearch = createDeferred();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepSearchImpl: function()
        {
            return releaseSearch.promise;
        },
        fileContents: {}
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.vscode.progressSessions.length, 1 );
        harness.vscode.progressSessions[ 0 ].cancel();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.vscode.progressSessions[ 0 ].completed, true );
        assert.equal( harness.vscode.statusBarItems[ 0 ].text, 'Better Todo Tree: Scanning interrupted.' );
        assert.equal( harness.vscode.treeViews[ 0 ].message, 'Scan cancelled.' );
    } );
} );

QUnit.test( "view refreshes during a streamed rebuild keep earlier workspace results after later streamed files arrive", function( assert )
{
    var releaseSearch = createDeferred();
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        scanTextImpl: function( uri )
        {
            return [ {
                uri: uri,
                actualTag: 'TODO',
                displayText: path.basename( uri.fsPath ),
                continuationText: []
            } ];
        },
        ripgrepSearchImpl: function( root, searchOptions, onEvent )
        {
            onEvent( {
                type: 'match',
                data: {
                    path: { text: './first.js' }
                }
            } );
            onEvent( {
                type: 'end',
                data: {
                    path: { text: './first.js' }
                }
            } );

            return releaseSearch.promise.then( function()
            {
                onEvent( {
                    type: 'match',
                    data: {
                        path: { text: './second.js' }
                    }
                } );
                onEvent( {
                    type: 'end',
                    data: {
                        path: { text: './second.js' }
                    }
                } );

                return { stats: { matches: 2 } };
            } );
        },
        timerStubs: {
            setTimeout: function( callback )
            {
                callback();
                return { callback: callback };
            },
            clearTimeout: function() {},
            setInterval: function() { return {}; },
            clearInterval: function() {}
        },
        fileContents: {
            '/workspace/first.js': '# TODO first',
            '/workspace/second.js': '# TODO second'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.provider.latestResultsByUri.has( '/workspace/first.js' ), true );

        harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ]();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        releaseSearch.resolve();
        return matrixHelpers.flushAsyncWork();
    } ).then( function()
    {
        assert.equal( harness.provider.latestResultsByUri.has( '/workspace/first.js' ), true );
        assert.equal( harness.provider.latestResultsByUri.has( '/workspace/second.js' ), true );
    } );
} );

QUnit.test( "workspace scan keeps successful results when one workspace file read fails", function( assert )
{
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        scanTextImpl: function( uri )
        {
            return [ {
                uri: uri,
                actualTag: 'TODO',
                displayText: path.basename( uri.fsPath ),
                continuationText: []
            } ];
        },
        ripgrepMatches: [
            { fsPath: './good.js' },
            { fsPath: './bad.js' }
        ],
        readFileErrors: {
            '/workspace/bad.js': new Error( 'read failed' )
        },
        fileContents: {
            '/workspace/good.js': '# TODO good'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.deepEqual( harness.provider.replaceCalls.map( function( call ) { return call.uri.fsPath; } ), [
            '/workspace/good.js'
        ] );
        assert.equal( harness.warningMessages.length, 1 );
        assert.equal( harness.warningMessages[ 0 ].indexOf( '/workspace/bad.js' ) > -1, true );
        assert.equal( harness.errorMessages.length, 0 );
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

QUnit.test( "workspace mode custom regex scanning resolves root-relative ripgrep paths before normalization", function( assert )
{
    var canonicalFixture = [
        {
            uri: matrixHelpers.createUri( '/workspace/src/relative-custom.js' ),
            actualTag: 'TODO',
            displayText: 'relative custom item',
            continuationText: []
        }
    ];
    var ripgrepMatches = [
        { fsPath: 'src/relative-custom.js', line: 1, column: 1, match: 'TODO relative custom item' }
    ];
    var harness = createExtensionHarness( {
        scanMode: 'workspace',
        regexSource: '($TAGS)',
        resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
        workspaceFolders: [ { uri: matrixHelpers.createUri( '/workspace' ), name: 'workspace' } ],
        ripgrepMatches: ripgrepMatches,
        normalizeResult: function()
        {
            return canonicalFixture[ 0 ];
        },
        fileContents: {
            '/workspace/src/relative-custom.js': 'TODO relative custom item'
        }
    } );

    harness.extension.activate( harness.context );

    return matrixHelpers.flushAsyncWork().then( function()
    {
        assert.equal( harness.readFileCalls.length, 1 );
        assert.equal( harness.readFileCalls[ 0 ], '/workspace/src/relative-custom.js' );
        assert.equal( harness.normalizeCalls.length, 1 );
        assert.equal( harness.normalizeCalls[ 0 ].uri.fsPath, '/workspace/src/relative-custom.js' );
        assert.equal( harness.normalizeCalls[ 0 ].match.fsPath, '/workspace/src/relative-custom.js' );
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
