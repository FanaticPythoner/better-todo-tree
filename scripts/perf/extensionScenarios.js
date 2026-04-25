'use strict';

var path = require( 'path' );

module.exports.buildExtensionScenarioDefinitions = function( deps )
{
    var traceScenarios = process.env.PERF_TRACE_SCENARIOS === '1';
    var matrixHelpers = require( path.join( deps.repoRoot, 'test', 'matrixHelpers.js' ) );
    var languageMatrix = require( path.join( deps.repoRoot, 'test', 'languageMatrix.js' ) );
    var actualUtils = require( path.join( deps.repoRoot, 'src', 'utils.js' ) );
    var USER_FLOW_ITERATIONS = Object.freeze( {
        openFileRefresh: 10,
        treeMutation: 10,
        workspaceRefresh: 10,
        highlight: 10,
        clickBurst: 10
    } );

    var DEFAULT_INCLUDE_GLOBS = languageMatrix.findConfigurationProperty( 'better-todo-tree.filtering.includeGlobs' ).default.slice();
    var DEFAULT_EXCLUDE_GLOBS = languageMatrix.findConfigurationProperty( 'better-todo-tree.filtering.excludeGlobs' ).default.slice();

    function flushAsyncWork()
    {
        return new Promise( function( resolve )
        {
            setImmediate( function()
            {
                setImmediate( resolve );
            } );
        } );
    }

    function createImmediateTimerStubs()
    {
        var handles = new Set();

        return {
            setTimeout: function( callback )
            {
                var args = Array.prototype.slice.call( arguments, 2 );
                var handle = { active: true };
                handles.add( handle );
                setImmediate( function()
                {
                    if( handle.active === true )
                    {
                        callback.apply( undefined, args );
                        handles.delete( handle );
                    }
                } );
                return handle;
            },
            clearTimeout: function( handle )
            {
                if( handle )
                {
                    handle.active = false;
                    handles.delete( handle );
                }
            },
            setInterval: function( callback )
            {
                var args = Array.prototype.slice.call( arguments, 2 );
                var handle = { active: true };
                handles.add( handle );

                function tick()
                {
                    if( handle.active !== true )
                    {
                        return;
                    }

                    setImmediate( function()
                    {
                        if( handle.active !== true )
                        {
                            return;
                        }

                        callback.apply( undefined, args );
                        tick();
                    } );
                }

                tick();
                return handle;
            },
            clearInterval: function( handle )
            {
                if( handle )
                {
                    handle.active = false;
                    handles.delete( handle );
                }
            },
            dispose: function()
            {
                handles.forEach( function( handle )
                {
                    handle.active = false;
                } );
                handles.clear();
            }
        };
    }

    function resolveConfiguredTags( options )
    {
        return Array.isArray( options.tags ) && options.tags.length > 0 ?
            options.tags.slice() :
            languageMatrix.DEFAULT_TAGS.slice();
    }

    function resolveHighlightSettings( options )
    {
        return Object.assign( {
            enabled: true,
            highlight: 'tag',
            highlightDelay: 0,
            useColourScheme: false,
            foregroundColourScheme: [],
            backgroundColourScheme: [],
            defaultHighlight: {},
            customHighlight: {}
        }, options.highlightOverrides || {} );
    }

    function resolveRipgrepSearchRoot( root, searchOptions )
    {
        if( searchOptions && searchOptions.filename )
        {
            return searchOptions.filename;
        }

        return root;
    }

    function resolveRipgrepFixturePath( rootPath, filePath )
    {
        if( !filePath )
        {
            return filePath;
        }

        if( path.isAbsolute( filePath ) )
        {
            return filePath;
        }

        return path.join( rootPath || '/', filePath );
    }

    function extractLegacyTodoTag( text )
    {
        var trimmed = String( text || '' ).trim();
        var parts = trimmed.split( /\s+/ );
        var tag = parts[ 0 ] || 'TODO';
        var remainder = trimmed.slice( tag.length ).trim();

        return {
            tag: tag.replace( /:$/, '' ),
            withoutTag: remainder,
            before: '',
            after: remainder,
            subTag: undefined
        };
    }

    function createHarnessSnapshot( harness )
    {
        return JSON.stringify( {
            executedCommands: harness.vscode.executedCommands.length,
            progressSessions: harness.vscode.progressSessions.length,
            pendingProgressSessions: harness.vscode.progressSessions.filter( function( session )
            {
                return session.completed !== true;
            } ).length,
            replaceCalls: harness.provider ? harness.provider.replaceCalls.length : 0,
            refreshCalls: harness.provider ? harness.provider.refreshCalls : 0,
            clearCalls: harness.provider ? harness.provider.clearCalls : 0,
            rebuildCalls: harness.provider ? harness.provider.rebuildCalls : 0,
            finalizeCalls: harness.provider ? harness.provider.finalizeCalls.length : 0,
            latestResults: harness.provider ? harness.provider.latestResultsByUri.size : 0,
            readFileCalls: harness.readFileCalls.length,
            scanDocumentCalls: harness.scanDocumentCalls.length,
            scanTextCalls: harness.scanTextCalls.length
        } );
    }

    async function waitForHarnessIdle( harness, minimumStablePasses )
    {
        var stablePassesRequired = minimumStablePasses || 3;
        var stablePasses = 0;
        var previousSnapshot;
        var iteration;

        for( iteration = 0; iteration < 50 && stablePasses < stablePassesRequired; ++iteration )
        {
            await flushAsyncWork();
            var currentSnapshot = createHarnessSnapshot( harness );
            var pendingProgressSessions = harness.vscode.progressSessions.filter( function( session )
            {
                return session.completed !== true;
            } ).length;

            if( currentSnapshot === previousSnapshot && pendingProgressSessions === 0 )
            {
                stablePasses++;
            }
            else
            {
                stablePasses = 0;
            }

            previousSnapshot = currentSnapshot;
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
        section.update = function( key, value, updateTarget )
        {
            if( Array.isArray( updateLog ) )
            {
                updateLog.push( {
                    key: key,
                    value: value,
                    target: updateTarget
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
        var legacyResults = [];

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
                            uri: entry ? entry.uri : deps.createUri( key ),
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

        return {
            clear: function()
            {
                legacyResults = [];
            },
            add: function( result )
            {
                legacyResults.push( result );
            },
            remove: function( uri )
            {
                var uriKey = uri.toString();

                legacyResults = legacyResults.filter( function( result )
                {
                    return result.uri.toString() !== uriKey;
                } );
            },
            addToTree: function( tree )
            {
                legacyResults.forEach( function( result )
                {
                    if( result.added === true )
                    {
                        return;
                    }

                    tree.add( result );
                    result.added = true;
                } );
            },
            containsMarkdown: function()
            {
                return legacyResults.some( function( result )
                {
                    return result.uri && /\.md$/i.test( result.uri.fsPath || '' );
                } );
            },
            count: function()
            {
                return legacyResults.length;
            },
            contains: function( candidate )
            {
                return legacyResults.some( function( result )
                {
                    return result.uri.toString() === candidate.uri.toString() &&
                        result.line === candidate.line &&
                        result.column === candidate.column;
                } );
            },
            markAsNotAdded: function()
            {
                legacyResults.forEach( function( result )
                {
                    result.added = false;
                } );
            },
            filter: function( predicate )
            {
                legacyResults = legacyResults.filter( predicate );
            },
            createStore: createStore
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
            rebuild: function()
            {
                this.rebuildCalls++;
            },
            replaceDocument: function( uri, results )
            {
                // Defensive copy: results may be the searchResults stub's
                // stored reference; sharing it with add() below would mutate
                // the caller's input.
                var entry = { uri: uri, results: results.slice() };
                this.replaceCalls.push( entry );
                this.latestResultsByUri.set( uri.toString(), entry );
            },
            add: function( result )
            {
                var uriKey = result.uri.toString();
                var entry = this.latestResultsByUri.get( uriKey );

                if( entry === undefined )
                {
                    entry = {
                        uri: result.uri,
                        results: []
                    };
                    this.latestResultsByUri.set( uriKey, entry );
                }

                entry.results.push( result );
            },
            reset: function( uri )
            {
                this.latestResultsByUri.delete( uri.toString() );
            },
            remove: function( callback, uri )
            {
                this.latestResultsByUri.delete( uri.toString() );
                if( typeof ( callback ) === 'function' )
                {
                    callback();
                }
            },
            finalizePendingChanges: function( filter, options )
            {
                this.finalizeCalls.push( { filter: filter, options: options } );
            },
            refresh: function()
            {
                this.refreshCalls++;
            },
            filter: function() {},
            clearTreeFilter: function() {},
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
        var originalAdd = provider.add ? provider.add.bind( provider ) : function() {};
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
            // Aliasing input results would let the wrapped add() below mutate
            // the caller-supplied array (drainDirtyResults entries hold the
            // same reference), causing O(2^N) growth across view-mode refreshes.
            var entry = { uri: uri, results: [] };
            this.replaceCalls.push( entry );
            this.latestResultsByUri.set( uri.toString(), entry );
            return originalReplaceDocument.apply( this, arguments );
        };
        provider.add = function( result )
        {
            var uriKey = result.uri.toString();
            var entry = this.latestResultsByUri.get( uriKey );

            if( entry === undefined )
            {
                entry = {
                    uri: result.uri,
                    results: []
                };
                this.latestResultsByUri.set( uriKey, entry );
            }

            entry.results.push( result );
            return originalAdd.apply( this, arguments );
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
        var filteringDefaults = Object.assign( {
            passGlobsToRipgrep: true,
            includeGlobs: DEFAULT_INCLUDE_GLOBS.slice(),
            excludeGlobs: DEFAULT_EXCLUDE_GLOBS.slice(),
            includeHiddenFiles: false,
            useBuiltInExcludes: 'none'
        }, options.filteringOverrides || {} );
        var configuredTags = resolveConfiguredTags( options );
        var highlightSettings = resolveHighlightSettings( options );
        var decorationTypeCreations = [];
        var sections = {};

        function registerListener( store, name, listener )
        {
            store[ name ] = listener;
            return { dispose: function() {} };
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

        function createTreeView( id, viewOptions )
        {
            var view = {
                badge: undefined,
                title: 'Tree',
                message: '',
                visible: false,
                treeDataProvider: viewOptions && viewOptions.treeDataProvider,
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

        function createProgressSession( progressOptions, task )
        {
            var cancellationListeners = [];
            var session = {
                options: progressOptions,
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
            session.promise = Promise.resolve( task( progress, token ) ).then( function( value )
            {
                session.completed = true;
                return value;
            } );

            return session.promise;
        }

        sections[ 'todo-tree' ] = createConfigurationSection( {
            tree: {
                buttons: {
                    reveal: false,
                    scanMode: true,
                    viewStyle: true,
                    groupByTag: true,
                    groupBySubTag: false,
                    filter: false,
                    refresh: true,
                    expand: true,
                    export: false
                },
                trackFile: false,
                expanded: false,
                flat: false,
                tagsOnly: false,
                groupedByTag: false,
                groupedBySubTag: false,
                hideTreeWhenEmpty: false,
                autoRefresh: options.autoRefresh !== false,
                scanAtStartup: options.scanAtStartup !== false,
                scanMode: options.scanMode
            },
            filtering: filteringDefaults,
            general: {
                debug: false,
                automaticGitRefreshInterval: 0,
                periodicRefreshInterval: 0,
                rootFolder: '',
                tags: configuredTags.slice(),
                statusBar: 'total'
            },
            highlights: {
                enabled: highlightSettings.enabled,
                highlight: highlightSettings.highlight,
                highlightDelay: highlightSettings.highlightDelay,
                useColourScheme: highlightSettings.useColourScheme,
                foregroundColourScheme: highlightSettings.foregroundColourScheme.slice(),
                backgroundColourScheme: highlightSettings.backgroundColourScheme.slice(),
                defaultHighlight: highlightSettings.defaultHighlight,
                customHighlight: highlightSettings.customHighlight
            },
            ripgrep: {
                ripgrepArgs: '',
                ripgrepMaxBuffer: 200,
                usePatternFile: false
            }
        }, undefined, configurationUpdates );
        sections[ 'better-todo-tree' ] = sections[ 'todo-tree' ];
        sections[ 'todo-tree.general' ] = createConfigurationSection( {
            debug: false,
            automaticGitRefreshInterval: 0,
            periodicRefreshInterval: 0,
            rootFolder: '',
            exportPath: '/tmp/todo-tree.txt',
            statusBar: 'total',
            statusBarClickBehaviour: '',
            showActivityBarBadge: false,
            tags: configuredTags.slice(),
            tagGroups: {},
            schemes: [ 'file' ]
        }, undefined, configurationUpdates );
        sections[ 'better-todo-tree.general' ] = sections[ 'todo-tree.general' ];
        sections[ 'todo-tree.tree' ] = createConfigurationSection( {
            autoRefresh: options.autoRefresh !== false,
            trackFile: false,
            showCountsInTree: false,
            showBadges: false,
            scanMode: options.scanMode,
            showCurrentScanMode: false,
            scanAtStartup: options.scanAtStartup !== false,
            hideTreeWhenEmpty: false,
            buttons: sections[ 'todo-tree' ].get( 'tree.buttons' )
        }, undefined, configurationUpdates );
        sections[ 'better-todo-tree.tree' ] = sections[ 'todo-tree.tree' ];
        sections[ 'todo-tree.filtering' ] = createConfigurationSection( {
            passGlobsToRipgrep: filteringDefaults.passGlobsToRipgrep,
            includeGlobs: filteringDefaults.includeGlobs.slice(),
            excludeGlobs: filteringDefaults.excludeGlobs.slice(),
            includeHiddenFiles: filteringDefaults.includeHiddenFiles,
            includedWorkspaces: [],
            excludedWorkspaces: [],
            useBuiltInExcludes: filteringDefaults.useBuiltInExcludes,
            scopes: []
        }, undefined, configurationUpdates );
        sections[ 'better-todo-tree.filtering' ] = sections[ 'todo-tree.filtering' ];
        sections[ 'todo-tree.regex' ] = createConfigurationSection( {
            regex: options.resourceConfig && options.resourceConfig.isDefaultRegex === true ?
                actualUtils.DEFAULT_REGEX_SOURCE :
                ( options.regexSource || '($TAGS)' ),
            regexCaseSensitive: true,
            enableMultiLine: false,
            subTagRegex: options.resourceConfig && options.resourceConfig.subTagRegex ? options.resourceConfig.subTagRegex : ''
        }, undefined, configurationUpdates );
        sections[ 'better-todo-tree.regex' ] = sections[ 'todo-tree.regex' ];
        sections[ 'todo-tree.ripgrep' ] = createConfigurationSection( {
            ripgrepArgs: '',
            ripgrepMaxBuffer: 200,
            usePatternFile: false
        }, undefined, configurationUpdates );
        sections[ 'better-todo-tree.ripgrep' ] = sections[ 'todo-tree.ripgrep' ];
        sections[ 'todo-tree.highlights' ] = createConfigurationSection( {
            enabled: highlightSettings.enabled,
            highlight: highlightSettings.highlight,
            highlightDelay: highlightSettings.highlightDelay,
            useColourScheme: highlightSettings.useColourScheme,
            foregroundColourScheme: highlightSettings.foregroundColourScheme.slice(),
            backgroundColourScheme: highlightSettings.backgroundColourScheme.slice(),
            defaultHighlight: highlightSettings.defaultHighlight,
            customHighlight: highlightSettings.customHighlight
        }, undefined, configurationUpdates );
        sections[ 'better-todo-tree.highlights' ] = sections[ 'todo-tree.highlights' ];
        sections[ 'files.exclude' ] = createConfigurationSection( {}, undefined, configurationUpdates );
        sections[ 'search.exclude' ] = createConfigurationSection( {}, undefined, configurationUpdates );
        sections[ 'explorer' ] = createConfigurationSection( { compactFolders: false }, undefined, configurationUpdates );

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
                all: [ {
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
                    return deps.createUri( fsPath );
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
                activeNotebookEditor: undefined,
                visibleNotebookEditors: [],
                createTextEditorDecorationType: function( decorationOptions )
                {
                    var decoration = Object.assign( {
                        dispose: function() {}
                    }, decorationOptions );
                    decorationTypeCreations.push( decoration );
                    return decoration;
                },
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
                showInputBox: function( inputOptions )
                {
                    if( typeof ( options.inputBoxValue ) === 'function' )
                    {
                        return Promise.resolve( options.inputBoxValue( inputOptions ) );
                    }

                    return Promise.resolve( options.inputBoxValue );
                },
                showQuickPick: function() { return Promise.resolve(); },
                showTextDocument: function() { return Promise.resolve(); },
                onDidChangeActiveTextEditor: function( listener ) { return registerListener( workspaceListeners, 'activeEditor', listener ); },
                onDidChangeVisibleNotebookEditors: function( listener ) { return registerListener( windowListeners, 'visibleNotebookEditors', listener ); }
            },
            warningMessages: warningMessages,
            errorMessages: errorMessages,
            decorationTypeCreations: decorationTypeCreations,
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
                notebookDocuments: [],
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

    function createNotebooksStub()
    {
        return {
            createRegistry: function()
            {
                return {
                    remember: function() {},
                    sync: function() {},
                    getForDocument: function() { return undefined; },
                    isCellDocument: function() { return false; },
                    forget: function() {},
                    all: function() { return []; },
                    getByKey: function() { return undefined; }
                };
            },
            isNotebookDocument: function() { return false; },
            isNotebookCellDocument: function() { return false; },
            getNotebookKey: function( notebook )
            {
                return notebook && notebook.uri ? notebook.uri.toString() : undefined;
            },
            scanDocument: function() { return []; }
        };
    }

    function createTextDocument( fsPath, text, version )
    {
        var uri = deps.createUri( fsPath );
        var lineOffsets = [ 0 ];
        var index;

        for( index = 0; index < text.length; ++index )
        {
            if( text[ index ] === '\n' )
            {
                lineOffsets.push( index + 1 );
            }
        }

        function positionAt( offset )
        {
            var low = 0;
            var high = lineOffsets.length - 1;

            while( low <= high )
            {
                var mid = Math.floor( ( low + high ) / 2 );

                if( lineOffsets[ mid ] <= offset )
                {
                    if( mid === lineOffsets.length - 1 || lineOffsets[ mid + 1 ] > offset )
                    {
                        return {
                            line: mid,
                            character: offset - lineOffsets[ mid ]
                        };
                    }

                    low = mid + 1;
                }
                else
                {
                    high = mid - 1;
                }
            }

            return {
                line: 0,
                character: offset
            };
        }

        return {
            version: version,
            uri: uri,
            fileName: fsPath,
            getText: function()
            {
                return text;
            },
            positionAt: positionAt,
            offsetAt: function( position )
            {
                return lineOffsets[ position.line ] + position.character;
            },
            lineAt: function( input )
            {
                var line = typeof ( input ) === 'number' ? input : input.line;
                var start = lineOffsets[ line ];
                var end = line + 1 < lineOffsets.length ? lineOffsets[ line + 1 ] - 1 : text.length;

                return {
                    text: text.slice( start, end ),
                    range: {
                        start: {
                            line: line,
                            character: 0
                        },
                        end: {
                            line: line,
                            character: end - start
                        }
                    }
                };
            }
        };
    }

    function createTextEditor( document )
    {
        var decorationCalls = [];

        return {
            viewColumn: 1,
            document: document,
            selections: [],
            decorationCalls: decorationCalls,
            setDecorations: function( decoration, ranges )
            {
                decorationCalls.push( {
                    decoration: decoration,
                    rangeCount: Array.isArray( ranges ) ? ranges.length : 0
                } );
            },
            revealRange: function() {}
        };
    }

    function createExtensionHarness( moduleLoader, options )
    {
        var provider = options.useActualTreeProvider === true ? undefined : createProviderStub();
        var ripgrepSearchCalls = [];
        var scanDocumentCalls = [];
        var scanTextCalls = [];
        var normalizeCalls = [];
        var readFileCalls = [];
        var ripgrepMatchLookup = new Map();
        var treeStateOverrides = {};
        var validSchemes = [ 'file', 'vscode-notebook-cell' ];
        var configuredTags = resolveConfiguredTags( options );
        var highlightSettings = resolveHighlightSettings( options );
        var vscodeStub = createVscodeStub( options );
        var extensionIdentity = deps.loadCurrentModule( 'src/extensionIdentity.js', {
            vscode: vscodeStub
        } );
        var context = {
            subscriptions: { push: function() {} },
            workspaceState: options.workspaceState || deps.createWorkspaceState(),
            globalState: deps.createWorkspaceState(),
            storageUri: deps.createUri( '/tmp/storage' ),
            globalStorageUri: deps.createUri( '/tmp/global-storage' )
        };
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
            tags: function() { return configuredTags.slice(); },
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
            shouldUseColourScheme: function() { return highlightSettings.useColourScheme === true; },
            defaultHighlight: function() { return highlightSettings.defaultHighlight; },
            customHighlight: function() { return highlightSettings.customHighlight; },
            foregroundColourScheme: function() { return highlightSettings.foregroundColourScheme.slice(); },
            backgroundColourScheme: function() { return highlightSettings.backgroundColourScheme.slice(); },
            tagGroup: function() { return undefined; }
        };
        var fallbackUtilsStub = {
            init: function() {},
            isCodicon: function() { return false; },
            getCommentPattern: function( candidate ) { return actualUtils.getCommentPattern( candidate ); },
            getRegexSource: function() { return options.regexSource || '($TAGS)'; },
            getTagRegexSource: function() { return 'TODO|FIXME|BUG|HACK|XXX|\\[ \\]|\\[x\\]'; },
            removeBlockComments: function( text, fileName ) { return actualUtils.removeBlockComments( text, fileName ); },
            extractTag: function( text ) { return extractLegacyTodoTag( text ); },
            isIncluded: function( name, includes, excludes )
            {
                return actualUtils.isIncluded( name, includes, excludes );
            },
            isHidden: function( filePath )
            {
                return actualUtils.isHidden( filePath );
            },
            replaceEnvironmentVariables: function( value ) { return value; },
            getSubmoduleExcludeGlobs: function() { return []; },
            clearSubmoduleExcludeGlobCache: function() {},
            formatLabel: function( template ) { return template; },
            toGlobArray: function( value ) { return actualUtils.toGlobArray( value ); },
            createFolderGlob: function() { return '**/*'; }
        };
        var utilsModule = options.useActualUtilsModule === true ? moduleLoader( 'src/utils.js' ) : fallbackUtilsStub;
        var searchResults = options.useActualSearchResultsModule === true ? moduleLoader( 'src/searchResults.js' ) : createSearchResultsStub();
        var attributesModule = options.useActualAttributesModule === true ?
            moduleLoader( 'src/attributes.js' ) :
            {
                init: function() {},
                hasCustomHighlight: function() { return false; },
                getForeground: function() { return undefined; },
                getBackground: function() { return undefined; },
                getIcon: function() { return 'check'; },
                getAttribute: function( tag, attribute, defaultValue )
                {
                    if( attribute === 'type' )
                    {
                        return highlightSettings.highlight;
                    }

                    return defaultValue;
                }
            };
        var detectionModule;
        var treeIconsStub = {
            getIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            },
            getTreeIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            }
        };

        if( typeof ( utilsModule.init ) === 'function' )
        {
            utilsModule.init( configStub );
        }

        if( typeof ( attributesModule.init ) === 'function' )
        {
            attributesModule.init( configStub );
        }

        if( options.useActualDetectionModule === true )
        {
            detectionModule = moduleLoader( 'src/detection.js', {
                './utils.js': utilsModule
            } );
        }

        var treeModule = options.useActualTreeProvider === true ?
            moduleLoader( 'src/tree.js', {
                vscode: vscodeStub,
                './config.js': configStub,
                './utils.js': utilsModule,
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
        var highlightsIconsStub = {
            getGutterIcon: function()
            {
                return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
            }
        };
        var highlightsModule = options.useActualHighlightsModule === true ?
            moduleLoader( 'src/highlights.js', {
                vscode: vscodeStub,
                './config.js': configStub,
                './utils.js': utilsModule,
                './attributes.js': attributesModule,
                './icons.js': highlightsIconsStub,
                './detection.js': detectionModule || {
                    scanDocument: function() { return []; }
                },
                './extensionIdentity.js': extensionIdentity
            }, options.timerStubs ) :
            {
                init: function() {},
                triggerHighlight: function() {},
                setScanResultsProvider: function() {},
                resetCaches: function() {}
            };
        var extension = moduleLoader( 'src/extension.js', {
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

                    var searchRoot = resolveRipgrepSearchRoot( root, searchOptions );
                    var matchesByFile = new Map();
                    var legacyMatches = [];

                    ( options.ripgrepMatches || [] ).forEach( function( match )
                    {
                        var line = match.line || 1;
                        var column = match.column || 1;
                        var matchText = match.match || '';
                        var absoluteFsPath = resolveRipgrepFixturePath( searchRoot, match.fsPath );
                        var lookupKey = [ match.fsPath, line, column, matchText ].join( '\u0000' );
                        var absoluteLookupKey = [ absoluteFsPath, line, column, matchText ].join( '\u0000' );

                        ripgrepMatchLookup.set( lookupKey, match );
                        ripgrepMatchLookup.set( absoluteLookupKey, match );

                        if( matchesByFile.has( match.fsPath ) !== true )
                        {
                            matchesByFile.set( match.fsPath, [] );
                        }

                        matchesByFile.get( match.fsPath ).push( match );
                        legacyMatches.push( {
                            fsPath: absoluteFsPath,
                            line: line,
                            column: column,
                            match: matchText
                        } );
                    } );

                    if( typeof ( onEvent ) !== 'function' )
                    {
                        return Promise.resolve( legacyMatches );
                    }

                    matchesByFile.forEach( function( fileMatches, filePath )
                    {
                        fileMatches.forEach( function( match )
                        {
                            if( typeof ( onEvent ) === 'function' )
                            {
                                onEvent( {
                                    type: 'match',
                                    data: {
                                        path: { text: filePath },
                                        lines: { text: match.match || '' },
                                        line_number: match.line || 1,
                                        absolute_offset: match.absoluteOffset || 0,
                                        submatches: [ {
                                            match: { text: match.match || '' },
                                            start: Math.max( ( match.column || 1 ) - 1, 0 ),
                                            end: Math.max( ( match.column || 1 ) - 1, 0 ) + ( match.match || '' ).length
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
            './highlights.js': highlightsModule,
            './config.js': configStub,
            './utils.js': utilsModule,
            './attributes.js': attributesModule,
            './notebooks.js': createNotebooksStub(),
            './searchResults.js': searchResults,
            './detection.js': detectionModule || {
                resolveResourceConfig: function() { return options.resourceConfig; },
                scanDocument: function( document )
                {
                    scanDocumentCalls.push( document );
                    if( typeof ( options.scanDocumentImpl ) === 'function' )
                    {
                        return options.scanDocumentImpl( document );
                    }
                    return [];
                },
                scanText: function( uri, text )
                {
                    scanTextCalls.push( { uri: uri, text: text } );
                    if( typeof ( options.scanTextImpl ) === 'function' )
                    {
                        return options.scanTextImpl( uri, text );
                    }
                    return [];
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
                scanDocumentWithContext: function( scanContext )
                {
                    return this.scanDocument( {
                        uri: scanContext.uri,
                        fileName: scanContext.uri && scanContext.uri.fsPath,
                        getText: function() { return scanContext.text; }
                    } );
                },
                scanTextWithContext: function( scanContext )
                {
                    return this.scanText( scanContext.uri, scanContext.text );
                },
                normalizeRegexMatchWithContext: function( scanContext, match )
                {
                    var lookupKey = [ match.fsPath, match.line || 1, match.column || 1, match.match || '' ].join( '\u0000' );
                    var originalMatch = ripgrepMatchLookup.get( lookupKey ) || match;

                    normalizeCalls.push( { uri: scanContext.uri, text: scanContext.text, match: originalMatch } );
                    return options.normalizeResult ? options.normalizeResult( originalMatch ) : originalMatch;
                }
            },
            fs: {
                existsSync: function() { return true; },
                mkdirSync: function() {},
                readFile: function( filePath, encoding, callback )
                {
                    readFileCalls.push( filePath );
                    callback( null, options.fileContents[ filePath ] );
                },
                promises: {
                    mkdir: function() { return Promise.resolve(); },
                    readFile: function( filePath )
                    {
                        readFileCalls.push( filePath );
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
        }, options.timerStubs );

        return {
            extension: extension,
            context: context,
            identity: extensionIdentity,
            timerStubs: options.timerStubs,
            get provider()
            {
                return provider;
            },
            ripgrepSearchCalls: ripgrepSearchCalls,
            scanDocumentCalls: scanDocumentCalls,
            scanTextCalls: scanTextCalls,
            normalizeCalls: normalizeCalls,
            readFileCalls: readFileCalls,
            vscode: vscodeStub,
            editors: ( options.visibleTextEditors || [] ).slice(),
            warningMessages: vscodeStub.warningMessages,
            errorMessages: vscodeStub.errorMessages
        };
    }

    function createWorkspaceFolder( rootPath )
    {
        return {
            uri: deps.createUri( rootPath ),
            name: path.basename( rootPath ) || 'workspace'
        };
    }

    function createDefaultWorkspaceFixture( options )
    {
        var rootPath = options.rootPath || '/workspace';
        var fileContents = {};
        var resultsByPath = {};
        var ripgrepMatches = [];
        var fileIndex;

        for( fileIndex = 0; fileIndex < options.fileCount; ++fileIndex )
        {
            var relativePath = path.join( 'src', 'pkg-' + Math.floor( fileIndex / 40 ), 'feature-' + ( fileIndex % 10 ), 'file-' + fileIndex + '.js' );
            var absolutePath = path.join( rootPath, relativePath );
            var uri = deps.createUri( absolutePath );
            var lines = [];
            var results = [];
            var todoIndex;
            var lineNumber = 1;

            for( todoIndex = 0; todoIndex < options.todosPerFile; ++todoIndex )
            {
                var tag = options.tags[ todoIndex % options.tags.length ];
                var text = 'item ' + fileIndex + ':' + todoIndex;

                lines.push( '// ' + tag + ' ' + text );
                results.push( {
                    uri: uri,
                    line: lineNumber,
                    column: 4,
                    endLine: lineNumber,
                    endColumn: 4 + tag.length + 1 + text.length,
                    actualTag: tag,
                    displayText: text,
                    before: '',
                    after: text,
                    continuationText: [],
                    match: tag + ' ' + text
                } );
                lineNumber += 1;
                lines.push( 'const value' + todoIndex + ' = ' + todoIndex + ';' );
                lineNumber += 1;
            }

            fileContents[ absolutePath ] = lines.join( '\n' );
            resultsByPath[ absolutePath ] = results;
            ripgrepMatches.push( {
                fsPath: options.relativePaths === true ? relativePath : absolutePath,
                line: 1,
                column: 1,
                match: results[ 0 ].match
            } );
        }

        return {
            rootPath: rootPath,
            fileContents: fileContents,
            ripgrepMatches: ripgrepMatches,
            scanTextImpl: function( uri )
            {
                return resultsByPath[ uri.fsPath ] || [];
            }
        };
    }

    function createCustomRegexFixture( options )
    {
        var rootPath = options.rootPath || '/workspace';
        var fileContents = {};
        var ripgrepMatches = [];
        var fileIndex;

        for( fileIndex = 0; fileIndex < options.fileCount; ++fileIndex )
        {
            var relativePath = path.join( 'src', 'pkg-' + Math.floor( fileIndex / 40 ), 'feature-' + ( fileIndex % 10 ), 'file-' + fileIndex + '.js' );
            var absolutePath = path.join( rootPath, relativePath );
            var lines = [];
            var todoIndex;
            var lineNumber = 1;

            for( todoIndex = 0; todoIndex < options.todosPerFile; ++todoIndex )
            {
                var text = 'TODO: custom item ' + fileIndex + ':' + todoIndex;

                lines.push( text );
                ripgrepMatches.push( {
                    fsPath: options.relativePaths === true ? relativePath : absolutePath,
                    line: lineNumber,
                    column: 1,
                    match: text
                } );
                lineNumber += 1;
                lines.push( 'const custom' + todoIndex + ' = "value";' );
                lineNumber += 1;
            }

            fileContents[ absolutePath ] = lines.join( '\n' );
        }

        return {
            rootPath: rootPath,
            fileContents: fileContents,
            ripgrepMatches: ripgrepMatches,
            normalizeResult: function( match )
            {
                var displayText = match.match.replace( /^TODO:\s*/, '' );
                return {
                    uri: deps.createUri( match.fsPath ),
                    line: match.line,
                    column: match.column,
                    endLine: match.line,
                    endColumn: match.column + match.match.length,
                    actualTag: 'TODO',
                    displayText: displayText,
                    before: '',
                    after: displayText,
                    continuationText: [],
                    match: match.match
                };
            }
        };
    }

    function createOpenFileRefreshFixture( options )
    {
        var fsPath = options.fsPath || '/workspace/src/open-refresh.js';
        var lines = [];
        var changedLines = [];
        var matchIndex;

        for( matchIndex = 0; matchIndex < options.matchCount; ++matchIndex )
        {
            if( options.customRegex === true )
            {
                lines.push( 'TODO(' + matchIndex + '): visible item ' + matchIndex );
                changedLines.push( 'TODO(' + matchIndex + '): changed item ' + matchIndex );
            }
            else
            {
                lines.push( '// TODO visible item ' + matchIndex );
                changedLines.push( '// TODO changed item ' + matchIndex );
            }

            lines.push( 'const filler' + matchIndex + ' = ' + matchIndex + ';' );
            changedLines.push( 'const filler' + matchIndex + ' = ' + matchIndex + ';' );
        }

        return {
            initialDocument: createTextDocument( fsPath, lines.join( '\n' ), 1 ),
            changedDocument: createTextDocument( fsPath, changedLines.join( '\n' ), 2 )
        };
    }

    function createHighlightFixture( options )
    {
        var fsPath = options.fsPath || '/workspace/src/highlight-flow.js';
        var tags = ( options.tags && options.tags.length > 0 ) ? options.tags.slice() : [ 'TODO' ];
        var lines = [];
        var results = [];
        var matchIndex;
        var lineNumber = 1;
        var offset = 0;

        for( matchIndex = 0; matchIndex < options.matchCount; ++matchIndex )
        {
            var tag = tags[ matchIndex % tags.length ];
            var after = 'visible item ' + matchIndex;
            var lineText = '// ' + tag + ' ' + after;
            var fillerText = 'const filler' + matchIndex + ' = ' + matchIndex + ';';
            var tagStartOffset = offset + 3;
            var tagEndOffset = tagStartOffset + tag.length;

            lines.push( lineText );
            results.push( {
                uri: deps.createUri( fsPath ),
                line: lineNumber,
                column: 4,
                endLine: lineNumber,
                endColumn: lineText.length + 1,
                actualTag: tag,
                displayText: after,
                before: '',
                after: after,
                continuationText: [],
                match: tag + ' ' + after,
                commentStartOffset: offset,
                commentEndOffset: offset + lineText.length,
                matchStartOffset: tagStartOffset,
                matchEndOffset: offset + lineText.length,
                tagStartOffset: tagStartOffset,
                tagEndOffset: tagEndOffset
            } );

            lines.push( fillerText );
            offset += lineText.length + 1;
            offset += fillerText.length + 1;
            lineNumber += 2;
        }

        var document = createTextDocument( fsPath, lines.join( '\n' ), 1 );
        var editor = createTextEditor( document );

        return {
            document: document,
            editor: editor,
            tags: tags,
            scanDocumentImpl: function( candidateDocument )
            {
                return candidateDocument && candidateDocument.uri && candidateDocument.uri.toString() === document.uri.toString() ?
                    results.slice() :
                    [];
            }
        };
    }

    function resetHarnessMetrics( harness )
    {
        if( harness.provider )
        {
            harness.provider.replaceCalls.length = 0;
            harness.provider.latestResultsByUri.clear();
            harness.provider.refreshCalls = 0;
            harness.provider.clearCalls = 0;
            harness.provider.rebuildCalls = 0;
            harness.provider.finalizeCalls.length = 0;
        }

        harness.vscode.executedCommands.length = 0;
        harness.vscode.progressSessions.length = 0;
        harness.vscode.decorationTypeCreations.length = 0;
        harness.vscode.treeViews.forEach( function( view )
        {
            view.revealCalls.length = 0;
        } );

        ( harness.editors || [] ).forEach( function( editor )
        {
            if( Array.isArray( editor.decorationCalls ) )
            {
                editor.decorationCalls.length = 0;
            }
        } );

        if( Array.isArray( harness.updateCalls ) )
        {
            harness.updateCalls.length = 0;
        }
    }

    function renderVisibleTree( provider )
    {
        if( !provider || typeof ( provider.getChildren ) !== 'function' )
        {
            return 0;
        }

        function visit( node )
        {
            var treeItem;

            if( typeof ( provider.getTreeItem ) === 'function' )
            {
                treeItem = provider.getTreeItem( node );
            }

            var collapsibleState = treeItem && treeItem.collapsibleState;

            if( collapsibleState !== 2 )
            {
                return 1;
            }

            return ( provider.getChildren( node ) || [] ).reduce( function( total, child )
            {
                return total + visit( child );
            }, 1 );
        }

        return ( provider.getChildren() || [] ).reduce( function( total, child )
        {
            return total + visit( child );
        }, 0 );
    }

    async function activateHarness( harness )
    {
        harness.extension.activate( harness.context );
        await waitForHarnessIdle( harness );
        return harness;
    }

    async function executeCommandBySuffix( harness, suffix )
    {
        var commandName = ( harness.identity.COMMANDS && harness.identity.COMMANDS[ suffix ] ) ||
            ( harness.identity.LEGACY_COMMANDS && harness.identity.LEGACY_COMMANDS[ suffix ] ) ||
            ( 'better-todo-tree.' + suffix );
        var handler = harness.vscode.commandHandlers[ commandName ] ||
            harness.vscode.commandHandlers[ 'better-todo-tree.' + suffix ] ||
            harness.vscode.commandHandlers[ 'todo-tree.' + suffix ];

        if( typeof ( handler ) !== 'function' )
        {
            throw new Error( 'Missing command handler for ' + suffix );
        }

        await Promise.resolve( handler() );
        await waitForHarnessIdle( harness );
    }

    async function disposeHarness( harness )
    {
        if( harness.extension && typeof ( harness.extension.deactivate ) === 'function' )
        {
            await Promise.resolve( harness.extension.deactivate() );
        }

        if( harness.timerStubs && typeof ( harness.timerStubs.dispose ) === 'function' )
        {
            harness.timerStubs.dispose();
        }

        await flushAsyncWork();
    }

    function createUserFlowScenario( definition )
    {
        return {
            name: definition.name,
            userFlow: definition.userFlow,
            measurementScope: definition.measurementScope,
            inputModel: definition.inputModel,
            iterations: definition.iterations,
            createFixture: definition.createFixture,
            setupHarness: definition.setupHarness,
            runFlow: definition.runFlow,
            resetHarnessMetrics: resetHarnessMetrics,
            runVariant: async function( moduleLoader )
            {
                var fixture = definition.createFixture ? definition.createFixture() : undefined;
                var harness = await definition.setupHarness( moduleLoader, fixture );

                try
                {
                    resetHarnessMetrics( harness );
                    return await definition.runFlow( harness, fixture );
                }
                finally
                {
                    await disposeHarness( harness );
                }
            }
        };
    }

    function createActualTreeHarnessOptions( fixture, overrides )
    {
        return Object.assign( {
            useActualTreeProvider: true,
            scanMode: 'workspace',
            resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
            workspaceFolders: [ createWorkspaceFolder( fixture.rootPath ) ],
            ripgrepMatches: fixture.ripgrepMatches,
            scanTextImpl: fixture.scanTextImpl,
            normalizeResult: fixture.normalizeResult,
            fileContents: fixture.fileContents,
            timerStubs: createImmediateTimerStubs()
        }, overrides || {} );
    }

    function createOpenFileRefreshHarnessOptions( fixture, overrides )
    {
        return Object.assign( {
            useActualTreeProvider: true,
            useActualUtilsModule: true,
            useActualSearchResultsModule: true,
            useActualDetectionModule: false,
            scanMode: 'open files',
            scanAtStartup: false,
            resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
            visibleTextEditors: [ { document: fixture.initialDocument } ],
            activeTextEditor: { document: fixture.initialDocument },
            fileContents: {},
            timerStubs: createImmediateTimerStubs()
        }, overrides || {} );
    }

    function createHighlightHarnessOptions( fixture, overrides )
    {
        return Object.assign( {
            useActualTreeProvider: false,
            useActualUtilsModule: true,
            useActualSearchResultsModule: true,
            useActualDetectionModule: false,
            useActualAttributesModule: true,
            useActualHighlightsModule: true,
            scanMode: 'open files',
            scanAtStartup: true,
            autoRefresh: false,
            tags: fixture.tags,
            scanDocumentImpl: fixture.scanDocumentImpl,
            resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
            visibleTextEditors: [ fixture.editor ],
            activeTextEditor: fixture.editor,
            fileContents: {},
            timerStubs: createImmediateTimerStubs()
        }, overrides || {} );
    }

    function createWorkspaceRefreshScenario( definition )
    {
        return createUserFlowScenario( {
            name: definition.name,
            userFlow: definition.userFlow,
            measurementScope: definition.measurementScope,
            inputModel: definition.inputModel,
            iterations: definition.iterations || USER_FLOW_ITERATIONS.workspaceRefresh,
            createFixture: definition.createFixture,
            setupHarness: function( moduleLoader, fixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createActualTreeHarnessOptions( fixture, definition.createHarnessOverrides ? definition.createHarnessOverrides() : {} ) ) );
            },
            runFlow: async function( harness )
            {
                await executeCommandBySuffix( harness, 'refresh' );
                return renderVisibleTree( harness.provider );
            }
        } );
    }

    return [
        createUserFlowScenario( {
            name: 'open-file-default-save-rescan-visible-tree',
            userFlow: 'Save an already-open file that uses default tag scanning and redraw the visible tree.',
            measurementScope: 'Document save listener, document rescan, search-result replacement, and visible-tree render.',
            inputModel: 'Real document text in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.openFileRefresh,
            createFixture: function()
            {
                return createOpenFileRefreshFixture( {
                    fsPath: '/workspace/src/open-default-refresh.js',
                    matchCount: 2500,
                    customRegex: false
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createOpenFileRefreshHarnessOptions( fixture, {
                    useActualDetectionModule: moduleLoader === deps.loadCurrentModule
                } ) ) ).then( async function( harness )
                {
                    harness.vscode.workspaceListeners.save( fixture.initialDocument );
                    await waitForHarnessIdle( harness );
                    return harness;
                } );
            },
            runFlow: async function( harness, fixture )
            {
                harness.vscode.window.visibleTextEditors = [ { document: fixture.initialDocument } ];
                harness.vscode.window.activeTextEditor = { document: fixture.initialDocument };

                harness.vscode.workspaceListeners.save( fixture.initialDocument );
                await waitForHarnessIdle( harness );

                return renderVisibleTree( harness.provider );
            }
        } ),
        createUserFlowScenario( {
            name: 'open-file-custom-save-rescan-visible-tree',
            userFlow: 'Save an already-open file that uses custom regex scanning and redraw the visible tree.',
            measurementScope: 'Document save listener, custom-regex document rescan, search-result replacement, and visible-tree render.',
            inputModel: 'Real document text in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.openFileRefresh,
            createFixture: function()
            {
                return createOpenFileRefreshFixture( {
                    fsPath: '/workspace/src/open-custom-refresh.js',
                    matchCount: 2500,
                    customRegex: true
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createOpenFileRefreshHarnessOptions( fixture, {
                    useActualDetectionModule: moduleLoader === deps.loadCurrentModule,
                    resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
                    regexSource: 'TODO\\([^)]*\\):\\s*[^\\n]+'
                } ) ) ).then( async function( harness )
                {
                    harness.vscode.workspaceListeners.save( fixture.initialDocument );
                    await waitForHarnessIdle( harness );
                    return harness;
                } );
            },
            runFlow: async function( harness, fixture )
            {
                harness.vscode.window.visibleTextEditors = [ { document: fixture.initialDocument } ];
                harness.vscode.window.activeTextEditor = { document: fixture.initialDocument };

                harness.vscode.workspaceListeners.save( fixture.initialDocument );
                await waitForHarnessIdle( harness );

                return renderVisibleTree( harness.provider );
            }
        } ),
        createUserFlowScenario( {
            name: 'tree-view-cycle-visible-tree',
            userFlow: 'Cycle the tree between flat, tags-only, and tree views and redraw the visible tree each time.',
            measurementScope: 'View-mode commands, workspace-state mutation, and visible-tree rebuild/render.',
            inputModel: 'Fixture workspace tree in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.treeMutation,
            createFixture: function()
            {
                return createDefaultWorkspaceFixture( {
                    fileCount: 120,
                    todosPerFile: 12,
                    tags: [ 'TODO', 'FIXME' ],
                    relativePaths: true
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createActualTreeHarnessOptions( fixture ) ) );
            },
            runFlow: async function( harness )
            {
                if( traceScenarios === true )
                {
                    process.stderr.write( '[perf] command showFlatView tree-view-cycle-visible-tree\n' );
                }
                await executeCommandBySuffix( harness, 'showFlatView' );
                renderVisibleTree( harness.provider );
                if( traceScenarios === true )
                {
                    process.stderr.write( '[perf] command showTagsOnlyView tree-view-cycle-visible-tree\n' );
                }
                await executeCommandBySuffix( harness, 'showTagsOnlyView' );
                renderVisibleTree( harness.provider );
                if( traceScenarios === true )
                {
                    process.stderr.write( '[perf] command showTreeView tree-view-cycle-visible-tree\n' );
                }
                await executeCommandBySuffix( harness, 'showTreeView' );
                if( traceScenarios === true )
                {
                    process.stderr.write( '[perf] command done tree-view-cycle-visible-tree\n' );
                }
                return renderVisibleTree( harness.provider );
            }
        } ),
        createUserFlowScenario( {
            name: 'tree-group-toggle-tags-view',
            userFlow: 'Toggle tag grouping on and off while in tags view and redraw the visible tree.',
            measurementScope: 'Grouping commands, workspace-state mutation, and visible-tree rebuild/render.',
            inputModel: 'Fixture workspace tree in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.treeMutation,
            createFixture: function()
            {
                return createDefaultWorkspaceFixture( {
                    fileCount: 120,
                    todosPerFile: 12,
                    tags: [ 'TODO', 'FIXME' ],
                    relativePaths: true
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                var workspaceState = deps.createWorkspaceState( {
                    tagsOnly: true,
                    groupedByTag: false
                } );
                return activateHarness( createExtensionHarness( moduleLoader, createActualTreeHarnessOptions( fixture, {
                    workspaceState: workspaceState
                } ) ) );
            },
            runFlow: async function( harness )
            {
                await executeCommandBySuffix( harness, 'groupByTag' );
                renderVisibleTree( harness.provider );
                await executeCommandBySuffix( harness, 'ungroupByTag' );
                return renderVisibleTree( harness.provider );
            }
        } ),
        createUserFlowScenario( {
            name: 'tree-filter-visible-tree',
            userFlow: 'Apply a tree filter and clear it again while the tree is visible.',
            measurementScope: 'Filter command handling, tree filtering, and visible-tree render.',
            inputModel: 'Fixture workspace tree in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.treeMutation,
            createFixture: function()
            {
                return createDefaultWorkspaceFixture( {
                    fileCount: 180,
                    todosPerFile: 16,
                    tags: [ 'TODO', 'FIXME' ],
                    relativePaths: true
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createActualTreeHarnessOptions( fixture, {
                    inputBoxValue: 'item 72:7'
                } ) ) );
            },
            runFlow: async function( harness )
            {
                await executeCommandBySuffix( harness, 'filter' );
                renderVisibleTree( harness.provider );
                await executeCommandBySuffix( harness, 'filterClear' );
                return renderVisibleTree( harness.provider );
            }
        } ),
        createUserFlowScenario( {
            name: 'tree-view-repeat-click-burst',
            userFlow: 'Repeatedly click the same view button while the tree state is still mutating.',
            measurementScope: 'Overlapping command handling and workspace-state writes.',
            inputModel: 'Command burst against the extension command handlers in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.clickBurst,
            setupHarness: function( moduleLoader )
            {
                var updateCalls = [];
                var workspaceStateValues = {};
                var workspaceState = {
                    get: function( key, defaultValue )
                    {
                        return Object.prototype.hasOwnProperty.call( workspaceStateValues, key ) ? workspaceStateValues[ key ] : defaultValue;
                    },
                    update: function( key, value )
                    {
                        updateCalls.push( { key: key, value: value } );
                        return new Promise( function( resolve )
                        {
                            setImmediate( function()
                            {
                                workspaceStateValues[ key ] = value;
                                resolve();
                            } );
                        } );
                    }
                };
                var harness = createExtensionHarness( moduleLoader, {
                    scanMode: 'open files',
                    workspaceState: workspaceState,
                    resourceConfig: { isDefaultRegex: true, enableMultiLine: false, regexCaseSensitive: true },
                    fileContents: {},
                    timerStubs: createImmediateTimerStubs()
                } );

                harness.updateCalls = updateCalls;
                return activateHarness( harness );
            },
            runFlow: async function( harness )
            {
                var commandName = ( harness.identity.COMMANDS && harness.identity.COMMANDS.showFlatView ) || 'better-todo-tree.showFlatView';
                var handler = harness.vscode.commandHandlers[ commandName ] ||
                    harness.vscode.commandHandlers[ 'better-todo-tree.showFlatView' ] ||
                    harness.vscode.commandHandlers[ 'todo-tree.showFlatView' ];
                var index;

                for( index = 0; index < 10; ++index )
                {
                    handler();
                }

                await flushAsyncWork();
                await flushAsyncWork();
                return harness.updateCalls.length + ( harness.provider ? harness.provider.clearCalls : 0 );
            }
        } ),
        createUserFlowScenario( {
            name: 'tree-expansion-toggle-visible-tree',
            userFlow: 'Expand and then collapse the visible tree.',
            measurementScope: 'Expansion commands, workspace-state mutation, and visible-tree rebuild/render.',
            inputModel: 'Fixture workspace tree in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.treeMutation,
            createFixture: function()
            {
                return createDefaultWorkspaceFixture( {
                    fileCount: 120,
                    todosPerFile: 12,
                    tags: [ 'TODO' ],
                    relativePaths: true
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                var workspaceState = deps.createWorkspaceState( {
                    expanded: false
                } );
                return activateHarness( createExtensionHarness( moduleLoader, createActualTreeHarnessOptions( fixture, {
                    workspaceState: workspaceState
                } ) ) );
            },
            runFlow: async function( harness )
            {
                await executeCommandBySuffix( harness, 'expand' );
                renderVisibleTree( harness.provider );
                await executeCommandBySuffix( harness, 'collapse' );
                return renderVisibleTree( harness.provider );
            }
        } ),
        createWorkspaceRefreshScenario( {
            name: 'workspace-default-relative-rebuild-visible-tree',
            userFlow: 'Trigger a workspace refresh with default tag scanning and rebuild the visible tree from workspace matches.',
            measurementScope: 'Workspace refresh orchestration, ripgrep event handling, file reads, result application, and tree rebuild/render.',
            inputModel: 'Fixture ripgrep matches, fixture file contents, and fixture scan results in a VS Code event harness.',
            createFixture: function()
            {
                return createDefaultWorkspaceFixture( {
                    fileCount: 160,
                    todosPerFile: 10,
                    tags: [ 'TODO', 'FIXME' ],
                    relativePaths: true
                } );
            }
        } ),
        createWorkspaceRefreshScenario( {
            name: 'workspace-custom-relative-rebuild-visible-tree',
            userFlow: 'Trigger a workspace refresh with custom regex scanning and rebuild the visible tree from workspace matches.',
            measurementScope: 'Workspace refresh orchestration, ripgrep event handling, regex-match normalization, result application, and tree rebuild/render.',
            inputModel: 'Fixture ripgrep matches, fixture file contents, and fixture normalized regex results in a VS Code event harness.',
            createFixture: function()
            {
                return createCustomRegexFixture( {
                    fileCount: 160,
                    todosPerFile: 10,
                    relativePaths: true
                } );
            },
            createHarnessOverrides: function()
            {
                return {
                    resourceConfig: { isDefaultRegex: false, enableMultiLine: false, regexCaseSensitive: true },
                    regexSource: '(TODO):\\s*[^\\n]+'
                };
            }
        } ),
        createUserFlowScenario( {
            name: 'visible-editor-highlight-open-file',
            userFlow: 'Focus or open a visible editor and apply highlights to that editor.',
            measurementScope: 'Active-editor event handling, decoration creation/update, and highlight application.',
            inputModel: 'Fixture scan results fed into the real highlight pipeline in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.highlight,
            createFixture: function()
            {
                return createHighlightFixture( {
                    fsPath: '/workspace/src/highlight-visible.js',
                    tags: [ 'TODO', 'FIXME' ],
                    matchCount: 1800
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createHighlightHarnessOptions( fixture, {
                    highlightOverrides: {
                        enabled: true,
                        highlight: 'tag',
                        highlightDelay: 0,
                        defaultHighlight: {
                            foreground: '#ffffff',
                            background: '#334455'
                        }
                    }
                } ) ) );
            },
            runFlow: async function( harness, fixture )
            {
                harness.vscode.workspaceListeners.activeEditor( fixture.editor );
                await waitForHarnessIdle( harness );
                return fixture.editor.decorationCalls.length;
            }
        } ),
        createUserFlowScenario( {
            name: 'visible-editor-highlight-change-open-file',
            userFlow: 'Edit a visible file and refresh its highlights.',
            measurementScope: 'Text-change event handling, decoration update, and highlight application.',
            inputModel: 'Fixture scan results fed into the real highlight pipeline in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.highlight,
            createFixture: function()
            {
                return createHighlightFixture( {
                    fsPath: '/workspace/src/highlight-change-visible.js',
                    tags: [ 'TODO', 'FIXME' ],
                    matchCount: 1800
                } );
            },
            setupHarness: function( moduleLoader, fixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createHighlightHarnessOptions( fixture, {
                    highlightOverrides: {
                        enabled: true,
                        highlight: 'tag',
                        highlightDelay: 0,
                        defaultHighlight: {
                            foreground: '#ffffff',
                            background: '#334455'
                        }
                    }
                } ) ) );
            },
            runFlow: async function( harness, fixture )
            {
                harness.vscode.workspaceListeners.changeText( {
                    document: fixture.document
                } );
                await waitForHarnessIdle( harness );
                return fixture.editor.decorationCalls.length;
            }
        } ),
        createUserFlowScenario( {
            name: 'visible-editor-custom-highlight-config-open-file',
            userFlow: 'Open a visible editor while a large custom highlight configuration is active and apply highlights.',
            measurementScope: 'Custom-highlight attribute lookup, decoration creation/update, and highlight application.',
            inputModel: 'Fixture scan results plus a large custom-highlight config in a VS Code event harness.',
            iterations: USER_FLOW_ITERATIONS.highlight,
            createFixture: function()
            {
                var tags = Array.from( { length: 200 }, function( _, index )
                {
                    return 'TAG' + index;
                } );
                var customHighlight = tags.reduce( function( highlights, tag, index )
                {
                    highlights[ tag ] = {
                        foreground: index % 2 === 0 ? '#ffffff' : '#111111',
                        background: '#' + ( ( index * 65793 ) % 0xffffff ).toString( 16 ).padStart( 6, '0' ),
                        icon: 'check',
                        type: 'tag'
                    };
                    return highlights;
                }, {} );
                var fixture = createHighlightFixture( {
                    fsPath: '/workspace/src/highlight-custom-visible.js',
                    tags: tags,
                    matchCount: 2400
                } );

                return {
                    fixture: fixture,
                    customHighlight: customHighlight
                };
            },
            setupHarness: function( moduleLoader, customFixture )
            {
                return activateHarness( createExtensionHarness( moduleLoader, createHighlightHarnessOptions( customFixture.fixture, {
                    highlightOverrides: {
                        enabled: true,
                        highlight: 'tag',
                        highlightDelay: 0,
                        defaultHighlight: {
                            background: '#224466'
                        },
                        customHighlight: customFixture.customHighlight
                    }
                } ) ) );
            },
            runFlow: async function( harness, customFixture )
            {
                harness.vscode.workspaceListeners.activeEditor( customFixture.fixture.editor );
                await waitForHarnessIdle( harness );
                return customFixture.fixture.editor.decorationCalls.length;
            }
        } )
    ];
};
