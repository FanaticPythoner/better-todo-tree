/* jshint esversion:6 */

var vscode = require( 'vscode' );
var ripgrep = require( './ripgrep' );
var path = require( 'path' );
var treeify = require( 'treeify' );
var fs = require( 'fs' );
var crypto = require( 'crypto' );
var child_process = require( 'child_process' );

var tree = require( "./tree.js" );
var colours = require( './colours.js' );
var icons = require( './icons.js' );
var highlights = require( './highlights.js' );
var config = require( './config.js' );
var utils = require( './utils.js' );
var notebooks = require( './notebooks.js' );
var commentPatternLanguageResolver = require( './commentPatternLanguageResolver.js' );
var attributes = require( './attributes.js' );
var searchResults = require( './searchResults.js' );
var detection = require( './detection.js' );
var identity = require( './extensionIdentity.js' );
var settingsSnapshotModule = require( './runtime/settingsSnapshot.js' );
var documentScanCacheModule = require( './runtime/documentScanCache.js' );
var streamScanner = require( './runtime/streamScanner.js' );
var packageJson = require( '../package.json' );

var searchList = [];
var currentFilter;
var interrupted = false;
var selectedDocument;
var treeRefreshTimeout;
var rescanTimeout;
var hideTimeout;
var autoGitRefreshTimer;
var periodicRefreshTimer;
var lastGitHead = {};
var openDocuments = {};
var provider;
var ignoreMarkdownUpdate = false;
var markdownUpdatePopupOpen = false;
var scanGeneration = 0;
var activeScanGeneration = 0;
var scanInFlight = false;
var pendingRescan = false;
var cancelledScanGenerations = new Set();
var documentRefreshTimers = new Map();
var documentVersions = new Map();
var pendingDocumentRefreshes = new Map();
var gitHeadCheckInFlight = new Set();

var SCAN_MODE_WORKSPACE_AND_OPEN_FILES = 'workspace';
var SCAN_MODE_OPEN_FILES = 'open files';
var SCAN_MODE_CURRENT_FILE = 'current file';
var SCAN_MODE_WORKSPACE_ONLY = 'workspace only';

var STATUS_BAR_TOTAL = 'total';
var STATUS_BAR_TAGS = 'tags';
var STATUS_BAR_TOP_THREE = 'top three';
var STATUS_BAR_CURRENT_FILE = 'current file';

var MORE_INFO_BUTTON = "More Info";
var YES_BUTTON = "Yes";
var NEVER_SHOW_AGAIN_BUTTON = "Never Show This Again";
var OPEN_SETTINGS_BUTTON = "Open Settings";
var OK_BUTTON = "OK";

function activate( context )
{
    var outputChannel;
    var legacySettingImportMarker = 'importedLegacyNamespaceVersion';
    var currentManifestSettingSuffixes = identity.getManifestSettingSuffixes( packageJson );
    var notebookRegistry = notebooks.createRegistry();
    var currentSettingsSnapshot;
    var activeSearchResults = searchResults.createStore();
    var nextSearchResults = undefined;
    var documentScanCache = documentScanCacheModule.createDocumentScanCache();
    var workspaceScanIssues = [];
    var lastWorkspaceScanIssueSignature;
    var streamingTreeApplyTimer;
    var streamingTreeApplyGeneration = 0;
    var streamingTreePreparedGeneration = 0;
    var treeStateMutationQueue = Promise.resolve();
    var extensionContextUpdateQueue = Promise.resolve();
    var extensionContextValues = {};
    var treeBusyStateCounts = {
        'view-style-busy': 0,
        'expansion-busy': 0,
        'grouping-busy': 0
    };
    var scanProgressSession;
    var scanProgressState;

    var SCAN_PROGRESS_ROOT_UNITS = 5;
    var SCAN_PROGRESS_MIN_FILES_PER_ROOT = 25;

    function settingLocation( setting, uri )
    {
        return identity.getSettingTarget( setting, uri );
    }

    function getCurrentConfiguration( section, uri )
    {
        var namespace = identity.CURRENT_NAMESPACE + ( section ? '.' + section : '' );
        return identity.getConfiguration( namespace, uri );
    }

    function getLegacyConfiguration( section, uri )
    {
        var namespace = identity.LEGACY_NAMESPACE + ( section ? '.' + section : '' );
        return identity.getConfiguration( namespace, uri );
    }

    function getSetting( setting, defaultValue, uri )
    {
        return identity.getSetting( setting, defaultValue, uri );
    }

    function rebuildSettingsSnapshot()
    {
        currentSettingsSnapshot = settingsSnapshotModule.buildSettingsSnapshot( context, identity, config, vscode );
        attributes.init( {
            isRegexCaseSensitive: function()
            {
                return currentSettingsSnapshot.getResourceConfig().regexCaseSensitive;
            },
            customHighlight: function()
            {
                return currentSettingsSnapshot.customHighlight;
            },
            defaultHighlight: function()
            {
                return currentSettingsSnapshot.defaultHighlight;
            },
            shouldUseColourScheme: function()
            {
                return currentSettingsSnapshot.useColourScheme;
            },
            backgroundColourScheme: function()
            {
                return currentSettingsSnapshot.backgroundColourScheme;
            },
            foregroundColourScheme: function()
            {
                return currentSettingsSnapshot.foregroundColourScheme;
            },
            tags: function()
            {
                return currentSettingsSnapshot.getResourceConfig().tags;
            }
        } );
    }

    function updateSetting( setting, value, target, uri )
    {
        return identity.updateSetting( setting, value, target === undefined ? settingLocation( setting, uri ) : target, uri );
    }

    function queueExtensionContextUpdates( entries )
    {
        var latestEntries = new Map();

        ( entries || [] ).forEach( function( entry )
        {
            latestEntries.set( entry.suffix, entry.value );
        } );

        if( latestEntries.size === 0 )
        {
            return extensionContextUpdateQueue;
        }

        var scheduled = extensionContextUpdateQueue.catch( function()
        {
            return undefined;
        } ).then( function()
        {
            var changedEntries = Array.from( latestEntries.entries() ).reduce( function( filtered, entry )
            {
                if( extensionContextValues[ entry[ 0 ] ] !== entry[ 1 ] )
                {
                    filtered.push( {
                        suffix: entry[ 0 ],
                        value: entry[ 1 ]
                    } );
                }
                return filtered;
            }, [] );

            if( changedEntries.length === 0 )
            {
                return undefined;
            }

            changedEntries.forEach( function( entry )
            {
                extensionContextValues[ entry.suffix ] = entry.value;
            } );

            return Promise.all( changedEntries.map( function( entry )
            {
                var updates = [
                    vscode.commands.executeCommand( 'setContext', identity.CONTEXT_KEYS[ entry.suffix ], entry.value )
                ];

                if( identity.LEGACY_CONTEXT_KEYS[ entry.suffix ] !== undefined )
                {
                    updates.push( vscode.commands.executeCommand( 'setContext', identity.LEGACY_CONTEXT_KEYS[ entry.suffix ], entry.value ) );
                }

                return Promise.all( updates );
            } ) );
        } );

        extensionContextUpdateQueue = scheduled.catch( function( error )
        {
            vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": failed to update command contexts (" + error.message + ")" );
        } );

        return scheduled;
    }

    function setExtensionContext( suffix, value )
    {
        return queueExtensionContextUpdates( [ {
            suffix: suffix,
            value: value
        } ] );
    }

    function registerExportContentProvider( scheme )
    {
        context.subscriptions.push( vscode.workspace.registerTextDocumentContentProvider( scheme, {
            provideTextDocumentContent( uri )
            {
                if( path.extname( uri.path ) === '.json' )
                {
                    return JSON.stringify( provider.exportTree(), null, 2 );
                }
                return treeify.asTree( provider.exportTree(), true );
            }
        } ) );
    }

    function registerCommandPair( suffix, handler )
    {
        context.subscriptions.push( vscode.commands.registerCommand( identity.COMMANDS[ suffix ], handler ) );

        if( identity.LEGACY_COMMANDS[ suffix ] !== undefined )
        {
            context.subscriptions.push( vscode.commands.registerCommand( identity.LEGACY_COMMANDS[ suffix ], handler ) );
        }
    }

    function debug( text )
    {
        if( outputChannel )
        {
            var now = new Date();
            outputChannel.appendLine( now.toLocaleTimeString( 'en', { hour12: false } ) + "." + String( now.getMilliseconds() ).padStart( 3, '0' ) + " " + text );
        }
    }

    currentFilter = context.workspaceState.get( 'currentFilter' );

    config.init( context );
    highlights.init( context, debug );
    utils.init( config );
    rebuildSettingsSnapshot();

    highlights.setScanResultsProvider( function( document )
    {
        return getDocumentScanResults( document );
    } );

    var resolveCommentPatternFileNameForLanguage = commentPatternLanguageResolver.createCommentPatternLanguageResolver( vscode, utils );

    provider = new tree.TreeNodeProvider( context, debug, setButtonsAndContext );
    var statusBarIndicator = vscode.window.createStatusBarItem( vscode.StatusBarAlignment.Left, 0 );

    var todoTreeView = vscode.window.createTreeView( identity.VIEW_ID, { treeDataProvider: provider } );

    var fileSystemWatcher;

    context.subscriptions.push( provider );
    context.subscriptions.push( statusBarIndicator );
    context.subscriptions.push( todoTreeView );

    registerExportContentProvider( identity.EXPORT_SCHEME );
    registerExportContentProvider( identity.LEGACY_EXPORT_SCHEME );

    ignoreMarkdownUpdate = context.globalState.get( 'ignoreMarkdownUpdate', false );

    function resetOutputChannel()
    {
        if( outputChannel )
        {
            outputChannel.dispose();
            outputChannel = undefined;
        }
        if( getSetting( 'general.debug', false ) === true )
        {
            outputChannel = vscode.window.createOutputChannel( identity.DISPLAY_NAME );
        }
    }

    function refreshTree( immediate )
    {
        clearTimeout( treeRefreshTimeout );
        if( immediate === true )
        {
            treeRefreshTimeout = undefined;
            provider.refresh();
            return setButtonsAndContext();
        }

        treeRefreshTimeout = setTimeout( function()
        {
            provider.refresh();
            setButtonsAndContext();
        }, 200 );

        return Promise.resolve();
    }

    function updateWorkspaceState( values )
    {
        return Promise.all( values.map( function( entry )
        {
            return context.workspaceState.update( entry.key, entry.value );
        } ) );
    }

    function applyTreeStateOverrides( values )
    {
        if( Array.isArray( values ) )
        {
            values.forEach( function( entry )
            {
                config.setTreeStateOverride( entry.key, entry.value );
            } );
            return;
        }

        config.setTreeStateOverride( values.key, values.value );
    }

    function normalizeWorkspaceStateEntries( values )
    {
        return Array.isArray( values ) ? values.slice() : [ values ];
    }

    function readEffectiveTreeStateValue( key )
    {
        switch( key )
        {
        case 'flat':
            return config.shouldFlatten();
        case 'tagsOnly':
            return config.shouldShowTagsOnly();
        case 'expanded':
            return config.shouldExpand();
        case 'groupedByTag':
            return config.shouldGroupByTag();
        case 'groupedBySubTag':
            return config.shouldGroupBySubTag();
        default:
            return context.workspaceState.get( key );
        }
    }

    function captureWorkspaceStateEntries( values )
    {
        return normalizeWorkspaceStateEntries( values ).map( function( entry )
        {
            return {
                key: entry.key,
                value: readEffectiveTreeStateValue( entry.key )
            };
        } );
    }

    function workspaceStateEntriesChanged( values )
    {
        return normalizeWorkspaceStateEntries( values ).some( function( entry )
        {
            return readEffectiveTreeStateValue( entry.key ) !== entry.value;
        } );
    }

    function updateTreeBusyContexts()
    {
        var totalBusyCount = Object.keys( treeBusyStateCounts ).reduce( function( total, key )
        {
            return total + treeBusyStateCounts[ key ];
        }, 0 );

        return queueExtensionContextUpdates( [
            { suffix: 'tree-state-busy', value: totalBusyCount > 0 },
            { suffix: 'view-style-busy', value: treeBusyStateCounts[ 'view-style-busy' ] > 0 },
            { suffix: 'expansion-busy', value: treeBusyStateCounts[ 'expansion-busy' ] > 0 },
            { suffix: 'grouping-busy', value: treeBusyStateCounts[ 'grouping-busy' ] > 0 }
        ] );
    }

    function formatScanDuration( seconds )
    {
        if( seconds <= 0 )
        {
            return '<1s';
        }

        if( seconds < 60 )
        {
            return Math.round( seconds ) + 's';
        }

        var minutes = Math.floor( seconds / 60 );
        var remainingSeconds = Math.round( seconds % 60 );
        return remainingSeconds > 0 ? minutes + 'm ' + remainingSeconds + 's' : minutes + 'm';
    }

    function getScanTargetLabel( rootPath, targetPath )
    {
        if( !targetPath )
        {
            return undefined;
        }

        if( rootPath )
        {
            var relativePath = path.relative( rootPath, targetPath );
            if( relativePath && !relativePath.startsWith( '..' + path.sep ) && relativePath !== '..' )
            {
                return relativePath;
            }
        }

        return path.basename( targetPath ) || targetPath;
    }

    function calculateScanProgressSnapshot( state )
    {
        var activeRootCount = state.currentRoot ? 1 : 0;
        var remainingRootCount = Math.max( state.rootCount - state.rootsCompleted - activeRootCount, 0 );
        var estimatedFilesPerRoot = SCAN_PROGRESS_MIN_FILES_PER_ROOT;

        if( state.rootsCompleted > 0 )
        {
            estimatedFilesPerRoot = Math.max( SCAN_PROGRESS_MIN_FILES_PER_ROOT, Math.ceil( state.completedRootQueuedTotal / state.rootsCompleted ) );
        }
        else if( state.currentRootQueued > 0 )
        {
            estimatedFilesPerRoot = Math.max( SCAN_PROGRESS_MIN_FILES_PER_ROOT, state.currentRootQueued );
        }

        var estimatedWorkspaceFilesTotal = Math.max(
            state.filesQueued + ( remainingRootCount * estimatedFilesPerRoot ),
            state.filesCompleted + ( activeRootCount > 0 ? Math.max( state.currentRootQueued, estimatedFilesPerRoot ) : 0 ),
            state.finalizationTotal > 0 ? state.finalizationTotal : 1
        );
        var totalUnits = ( Math.max( state.rootCount, 1 ) * SCAN_PROGRESS_ROOT_UNITS ) + estimatedWorkspaceFilesTotal + Math.max( state.finalizationTotal, 1 );
        var currentRootFraction = state.currentRoot ?
            ( state.currentRootQueued > 0 ?
                Math.min( state.currentRootCompleted / Math.max( state.currentRootQueued, 1 ), 1 ) :
                0.15 ) :
            0;
        var completedUnits = ( state.rootsCompleted * SCAN_PROGRESS_ROOT_UNITS ) + state.filesCompleted + state.finalizationCompleted + ( currentRootFraction * SCAN_PROGRESS_ROOT_UNITS );
        var rawFraction = totalUnits > 0 ? Math.min( completedUnits / totalUnits, state.phase === 'completed' ? 1 : 0.99 ) : 0;
        var fraction = state.phase === 'completed' ? 1 : Math.max( rawFraction, 0.01 );
        var completedWorkUnits = Math.max( completedUnits, state.filesCompleted + state.finalizationCompleted + state.rootsCompleted );
        var totalWorkUnits = Math.max( totalUnits, completedWorkUnits );

        return {
            fraction: fraction,
            percent: state.phase === 'completed' ?
                100 :
                Math.max( 1, Math.min( 99, Math.floor( fraction * 100 ) ) ),
            totalUnits: totalWorkUnits,
            completedUnits: completedWorkUnits
        };
    }

    function calculateScanEtaSeconds( state, snapshot, now )
    {
        var recentSample = state.progressSamples.length > 0 ? state.progressSamples[ 0 ] : undefined;
        var remainingUnits = Math.max( snapshot.totalUnits - snapshot.completedUnits, 0 );
        var rate;

        if( recentSample && recentSample.completedUnits < snapshot.completedUnits && now > recentSample.timestamp )
        {
            rate = ( snapshot.completedUnits - recentSample.completedUnits ) / ( ( now - recentSample.timestamp ) / 1000 );
        }
        else if( snapshot.completedUnits > 0 && now > state.startedAt )
        {
            rate = snapshot.completedUnits / ( ( now - state.startedAt ) / 1000 );
        }

        if( !rate || !isFinite( rate ) || rate <= 0 || remainingUnits <= 0 )
        {
            return undefined;
        }

        return remainingUnits / rate;
    }

    function recordScanProgressSample( state, snapshot, now )
    {
        state.progressSamples.push( {
            timestamp: now,
            completedUnits: snapshot.completedUnits
        } );

        while( state.progressSamples.length > 0 && ( state.progressSamples.length > 40 || ( now - state.progressSamples[ 0 ].timestamp ) > 5000 ) )
        {
            state.progressSamples.shift();
        }
    }

    function buildScanProgressMessage( state, snapshot )
    {
        var messageParts = [];
        var currentRootNumber = state.currentRoot ? Math.min( state.rootsCompleted + 1, Math.max( state.rootCount, 1 ) ) : Math.min( state.rootsCompleted, Math.max( state.rootCount, 1 ) );
        var targetLabel = getScanTargetLabel( state.currentRoot, state.currentFile ) || ( state.currentRoot ? path.basename( state.currentRoot ) : undefined );

        if( state.rootCount > 0 )
        {
            messageParts.push( 'Root ' + currentRootNumber + '/' + state.rootCount );
        }

        if( state.filesCompleted > 0 || state.filesQueued > 0 )
        {
            messageParts.push( state.filesCompleted + '/' + Math.max( state.filesQueued, state.filesCompleted ) + ' files' );
        }

        if( state.phase === 'finalizing' )
        {
            messageParts.push( 'Finalizing' );
        }

        if( snapshot.etaSeconds !== undefined && isFinite( snapshot.etaSeconds ) )
        {
            messageParts.push( 'ETA ' + formatScanDuration( snapshot.etaSeconds ) );
        }

        if( targetLabel )
        {
            messageParts.push( targetLabel );
        }

        if( messageParts.length === 0 )
        {
            return state.phase === 'finalizing' ? 'Finalizing scan' : 'Preparing scan';
        }

        return messageParts.join( ' · ' );
    }

    function applyScanProgressUi( state, snapshot )
    {
        var message = buildScanProgressMessage( state, snapshot );

        statusBarIndicator.text = "$(loading~spin) " + identity.DISPLAY_NAME + " " + snapshot.percent + "%";
        statusBarIndicator.show();
        statusBarIndicator.command = identity.COMMANDS.stopScan;
        statusBarIndicator.tooltip = message || 'Click to interrupt scan';
        todoTreeView.message = message;

        if( scanProgressSession && scanProgressSession.progress )
        {
            var increment = Math.max( snapshot.percent - scanProgressSession.lastReportedPercent, 0 );
            if( increment > 0 || message !== scanProgressSession.lastReportedMessage )
            {
                scanProgressSession.progress.report( {
                    increment: increment,
                    message: message
                } );
                scanProgressSession.lastReportedPercent = Math.max( scanProgressSession.lastReportedPercent, snapshot.percent );
                scanProgressSession.lastReportedMessage = message;
            }
        }
    }

    function updateScanProgress( generation, patch, force )
    {
        if( !scanProgressState || scanProgressState.generation !== generation )
        {
            return;
        }

        Object.keys( patch || {} ).forEach( function( key )
        {
            scanProgressState[ key ] = patch[ key ];
        } );

        var snapshot = calculateScanProgressSnapshot( scanProgressState );
        var now = Date.now();

        snapshot.etaSeconds = calculateScanEtaSeconds( scanProgressState, snapshot, now );
        recordScanProgressSample( scanProgressState, snapshot, now );

        if( force !== true && scanProgressState.lastUiUpdateAt && ( now - scanProgressState.lastUiUpdateAt ) < 100 && snapshot.percent <= scanProgressState.lastUiPercent )
        {
            return;
        }

        scanProgressState.lastUiUpdateAt = now;
        scanProgressState.lastUiPercent = snapshot.percent;
        applyScanProgressUi( scanProgressState, snapshot );
    }

    function startScanProgress( generation, roots )
    {
        var completionPromiseResolve;

        scanProgressState = {
            generation: generation,
            startedAt: Date.now(),
            rootCount: roots.length,
            rootsCompleted: 0,
            currentRoot: roots.length > 0 ? roots[ 0 ] : undefined,
            currentFile: undefined,
            filesQueued: 0,
            filesCompleted: 0,
            currentRootQueued: 0,
            currentRootCompleted: 0,
            completedRootQueuedTotal: 0,
            finalizationTotal: 0,
            finalizationCompleted: 0,
            phase: 'searching',
            progressSamples: [],
            lastUiUpdateAt: 0,
            lastUiPercent: 0
        };

        scanProgressSession = {
            generation: generation,
            lastReportedPercent: 0,
            lastReportedMessage: '',
            resolve: undefined,
            progress: undefined
        };

        var completionPromise = new Promise( function( resolve )
        {
            completionPromiseResolve = resolve;
        } );

        scanProgressSession.resolve = completionPromiseResolve;

        vscode.window.withProgress( {
            location: vscode.ProgressLocation.Notification,
            title: identity.DISPLAY_NAME + ': Scanning',
            cancellable: true
        }, function( progress, token )
        {
            scanProgressSession.progress = progress;
            token.onCancellationRequested( interruptActiveScan );
            updateScanProgress( generation, {}, true );
            return completionPromise;
        } );
    }

    function finishScanProgress( generation, wasCancelled )
    {
        if( !scanProgressState || scanProgressState.generation !== generation )
        {
            return;
        }

        scanProgressState.phase = 'completed';
        scanProgressState.currentFile = undefined;
        scanProgressState.finalizationCompleted = Math.max( scanProgressState.finalizationCompleted, scanProgressState.finalizationTotal );
        updateScanProgress( generation, {}, true );

        if( scanProgressSession && scanProgressSession.generation === generation && scanProgressSession.resolve )
        {
            scanProgressSession.resolve();
        }

        if( wasCancelled === true )
        {
            todoTreeView.message = 'Scan cancelled.';
        }
        else
        {
            todoTreeView.message = '';
        }

        scanProgressSession = undefined;
        scanProgressState = undefined;
    }

    function beginScanRoot( generation, rootPath )
    {
        updateScanProgress( generation, {
            phase: 'searching',
            currentRoot: rootPath,
            currentFile: undefined,
            currentRootQueued: 0,
            currentRootCompleted: 0
        }, true );
    }

    function queueScanFileProgress( generation, filePath )
    {
        if( !scanProgressState || scanProgressState.generation !== generation )
        {
            return;
        }

        updateScanProgress( generation, {
            currentFile: filePath,
            filesQueued: scanProgressState.filesQueued + 1,
            currentRootQueued: scanProgressState.currentRootQueued + 1
        }, false );
    }

    function completeScanFileProgress( generation, filePath )
    {
        if( !scanProgressState || scanProgressState.generation !== generation )
        {
            return;
        }

        updateScanProgress( generation, {
            currentFile: filePath,
            filesCompleted: scanProgressState.filesCompleted + 1,
            currentRootCompleted: scanProgressState.currentRootCompleted + 1
        }, false );
    }

    function completeScanRoot( generation, nextRootPath )
    {
        if( !scanProgressState || scanProgressState.generation !== generation )
        {
            return;
        }

        updateScanProgress( generation, {
            rootsCompleted: scanProgressState.rootsCompleted + 1,
            completedRootQueuedTotal: scanProgressState.completedRootQueuedTotal + scanProgressState.currentRootQueued,
            currentRoot: nextRootPath,
            currentFile: undefined,
            currentRootQueued: 0,
            currentRootCompleted: 0
        }, true );
    }

    function beginScanFinalization( generation, totalTargets )
    {
        updateScanProgress( generation, {
            phase: 'finalizing',
            currentFile: undefined,
            finalizationTotal: Math.max( totalTargets, 1 ),
            finalizationCompleted: 0
        }, true );
    }

    function completeScanFinalizationTarget( generation, target )
    {
        if( !scanProgressState || scanProgressState.generation !== generation )
        {
            return;
        }

        updateScanProgress( generation, {
            currentFile: target && target.uri && target.uri.fsPath ? target.uri.fsPath : undefined,
            finalizationCompleted: Math.min( scanProgressState.finalizationCompleted + 1, Math.max( scanProgressState.finalizationTotal, 1 ) )
        }, false );
    }

    function queueTreeStateMutation( operationName, busyContextKey, mutation )
    {
        treeBusyStateCounts[ busyContextKey ] = ( treeBusyStateCounts[ busyContextKey ] || 0 ) + 1;
        updateTreeBusyContexts();

        var scheduled = treeStateMutationQueue.then( mutation );

        treeStateMutationQueue = scheduled.catch( function( error )
        {
            vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": failed to update " + operationName + " (" + error.message + ")" );
        } ).finally( function()
        {
            treeBusyStateCounts[ busyContextKey ] = Math.max( ( treeBusyStateCounts[ busyContextKey ] || 0 ) - 1, 0 );
            updateTreeBusyContexts();
        } );

        return scheduled;
    }

    function queueWorkspaceStateRefresh( operationName, busyContextKey, values, refresher, options )
    {
        options = options || {};
        var stateEntries = normalizeWorkspaceStateEntries( values );
        var refreshOperation = refresher || function()
        {
            return refresh( { immediateRefresh: true, forceFullRefresh: true } );
        };

        if( workspaceStateEntriesChanged( stateEntries ) !== true )
        {
            if( options.forceRefreshWhenUnchanged === true )
            {
                applyTreeStateOverrides( stateEntries );
                setButtonsAndContext();

                if( ( treeBusyStateCounts[ busyContextKey ] || 0 ) > 0 )
                {
                    return treeStateMutationQueue;
                }

                return queueTreeStateMutation( operationName, busyContextKey, refreshOperation );
            }

            return Promise.resolve();
        }

        if( ( treeBusyStateCounts[ busyContextKey ] || 0 ) > 0 )
        {
            return treeStateMutationQueue;
        }

        var previousEntries = captureWorkspaceStateEntries( stateEntries );
        applyTreeStateOverrides( stateEntries );

        var scheduled = queueTreeStateMutation( operationName, busyContextKey, function()
        {
            return updateWorkspaceState( stateEntries ).then( refreshOperation ).catch( function( error )
            {
                applyTreeStateOverrides( previousEntries );
                setButtonsAndContext();
                throw error;
            } );
        } );

        setButtonsAndContext();

        return scheduled;
    }

    function prepareStreamingTreeApply( generation, store )
    {
        if( streamingTreePreparedGeneration === generation )
        {
            return;
        }

        if( store )
        {
            store.markAsNotAdded();
        }
        provider.clear( vscode.workspace.workspaceFolders );
        provider.rebuild();
        streamingTreePreparedGeneration = generation;
    }

    function flushStreamingTreeApply( generation, store, options )
    {
        if( streamingTreeApplyTimer )
        {
            clearTimeout( streamingTreeApplyTimer );
            streamingTreeApplyTimer = undefined;
        }

        if( isGenerationActive( generation ) !== true || nextSearchResults !== store )
        {
            return;
        }

        prepareStreamingTreeApply( generation, store );
        applyDirtyResultsToTree( options, store );
    }

    function scheduleStreamingTreeApply( generation, store )
    {
        if( nextSearchResults !== store )
        {
            return;
        }

        streamingTreeApplyGeneration = generation;

        if( streamingTreeApplyTimer )
        {
            return;
        }

        streamingTreeApplyTimer = setTimeout( function()
        {
            streamingTreeApplyTimer = undefined;

            if( isGenerationActive( streamingTreeApplyGeneration ) !== true || nextSearchResults !== store )
            {
                return;
            }

            prepareStreamingTreeApply( generation, store );
            applyDirtyResultsToTree( undefined, store );
        }, 200 );
    }

    function updateInformation()
    {
        var statusBar = getSetting( 'general.statusBar', 'none' );

        var counts = provider.getTagCountsForActivityBar();
        var total = Object.values( counts ).reduce( function( a, b ) { return a + b; }, 0 );

        var badgeTotal = config.shouldShowActivityBarBadge() ? total : 0;
        todoTreeView.badge = { value: badgeTotal };

        if( statusBar === STATUS_BAR_CURRENT_FILE )
        {
            counts = provider.getTagCountsForStatusBar( getCurrentFileFilter() );
            total = Object.values( counts ).reduce( function( a, b ) { return a + b; }, 0 );
        }

        var countRegex = new RegExp( "([^(]*)(\\(\\d+\\))*" );
        var match = countRegex.exec( todoTreeView.title );
        if( match !== null )
        {
            var title;
            if( config.shouldFlatten() )
            {
                title = "Flat";
            }
            else if( config.shouldShowTagsOnly() )
            {
                title = "Tags";
            }
            else
            {
                title = "Tree";
            }

            if( total > 0 && getSetting( 'tree.showCountsInTree', false ) === true )
            {
                title += " (" + total + ")";
            }
            todoTreeView.title = title;
        }

        if( scanInFlight === true && scanProgressState )
        {
            applyScanProgressUi( scanProgressState, calculateScanProgressSnapshot( scanProgressState ) );
            return;
        }

        if( statusBar === STATUS_BAR_TOTAL )
        {
            statusBarIndicator.text = "$(check) " + total;
            statusBarIndicator.tooltip = identity.DISPLAY_NAME + " total";
            statusBarIndicator.show();
        }
        else if( statusBar === STATUS_BAR_TAGS || statusBar === STATUS_BAR_CURRENT_FILE || statusBar === STATUS_BAR_TOP_THREE )
        {
            var sortedTags = Object.keys( counts );
            if( statusBar === STATUS_BAR_TOP_THREE )
            {
                sortedTags.sort( function( a, b ) { return counts[ a ] < counts[ b ] ? 1 : counts[ b ] < counts[ a ] ? -1 : a > b ? 1 : -1; } );
                sortedTags = sortedTags.splice( 0, 3 );
            }
            else
            {
                sortedTags = config.tags();
            }
            var text = "";
            var showIcons = config.shouldShowIconsInsteadOfTagsInStatusBar();
            sortedTags.map( function( tag )
            {
                if( counts[ tag ] > 0 )
                {
                    if( text.length > 0 )
                    {
                        text += " ";
                    }
                    var icon = attributes.getIcon( tag );
                    if( icon != config.defaultHighlight().icon && showIcons )
                    {
                        if( !utils.isCodicon( icon ) )
                        {
                            icon = "$(" + icon + ")";
                        }
                        text += icon + " " + counts[ tag ] + "  ";
                    }
                    else
                    {
                        text += tag + ": " + counts[ tag ] + " ";
                    }
                }
            } );
            statusBarIndicator.text = showIcons ? text.trim() : "$(check) " + text.trim();
            if( statusBar === STATUS_BAR_CURRENT_FILE )
            {
                statusBarIndicator.tooltip = identity.DISPLAY_NAME + " tag counts in current file";
            }
            else if( statusBar === STATUS_BAR_TOP_THREE )
            {
                statusBarIndicator.tooltip = identity.DISPLAY_NAME + " top three tag counts";
            }
            else
            {
                statusBarIndicator.tooltip = identity.DISPLAY_NAME + " tag counts";
            }
            if( Object.keys( counts ).length === 0 )
            {
                statusBarIndicator.text = "$(check) 0";
            }
            statusBarIndicator.show();
        }
        else
        {
            statusBarIndicator.hide();
        }

        var scanMode = config.scanMode();
        if( scanMode === SCAN_MODE_OPEN_FILES )
        {
            statusBarIndicator.text += " (in open files)";
        }
        else if( scanMode === SCAN_MODE_CURRENT_FILE )
        {
            statusBarIndicator.text += " (in current file)";
        }

        statusBarIndicator.command = identity.COMMANDS.onStatusBarClicked;
    }

    function onStatusBarClicked()
    {
        if( config.clickingStatusBarShouldRevealTree() )
        {
            if( todoTreeView.visible === false )
            {
                vscode.commands.executeCommand( identity.VIEW_ID + '.focus' );
            }
        }
        else if( config.clickingStatusBarShouldToggleHighlights() )
        {
            var enabled = getSetting( 'highlights.enabled', true );
            var target = settingLocation( 'highlights.enabled' );
            updateSetting( 'highlights.enabled', !enabled, target );
        }
        else
        {
            var setting = getSetting( 'general.statusBar', 'none' );
            if( setting === STATUS_BAR_TOTAL )
            {
                setting = STATUS_BAR_TAGS;
                vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": Now showing tag counts" );
            }
            else if( setting === STATUS_BAR_TAGS )
            {
                setting = STATUS_BAR_TOP_THREE;
                vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": Now showing top three tag counts" );
            }
            else if( setting === STATUS_BAR_TOP_THREE )
            {
                setting = STATUS_BAR_CURRENT_FILE;
                vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": Now showing total tags in current file" );
            }
            else
            {
                setting = STATUS_BAR_TOTAL;
                vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": Now showing total tags" );
            }
            updateSetting( 'general.statusBar', setting, vscode.ConfigurationTarget.Global );
        }
    }

    function createCancelledError( message )
    {
        var error = new Error( message || "Search cancelled" );
        error.cancelled = true;
        return error;
    }

    function isCancelledError( error )
    {
        return error && error.cancelled === true;
    }

    function isGenerationActive( generation )
    {
        return activeScanGeneration === generation && cancelledScanGenerations.has( generation ) !== true;
    }

    function assertGenerationActive( generation )
    {
        if( isGenerationActive( generation ) !== true )
        {
            throw createCancelledError();
        }
    }

    function interruptActiveScan()
    {
        pendingRescan = false;
        cancelScan();
        statusBarIndicator.text = identity.DISPLAY_NAME + ": Scanning interrupted.";
        statusBarIndicator.tooltip = "Click to restart";
        statusBarIndicator.command = identity.COMMANDS.refresh;
        interrupted = true;
    }

    function beginScan( roots )
    {
        scanGeneration += 1;
        activeScanGeneration = scanGeneration;
        scanInFlight = true;
        pendingRescan = false;
        interrupted = false;
        cancelledScanGenerations.delete( activeScanGeneration );

        statusBarIndicator.text = identity.DISPLAY_NAME + ": Scanning...";
        statusBarIndicator.show();
        statusBarIndicator.command = identity.COMMANDS.stopScan;
        statusBarIndicator.tooltip = "Click to interrupt scan";
        setExtensionContext( 'scan-busy', true );
        startScanProgress( activeScanGeneration, roots || [] );

        return activeScanGeneration;
    }

    function finishScan( generation )
    {
        cancelledScanGenerations.delete( generation );

        if( activeScanGeneration === generation )
        {
            activeScanGeneration = 0;
            scanInFlight = false;
        }

        setExtensionContext( 'scan-busy', scanInFlight === true );
        finishScanProgress( generation, false );

        if( scanInFlight !== true && interrupted !== true )
        {
            updateInformation();
            setButtonsAndContext();
        }

        if( scanInFlight !== true && pendingRescan === true )
        {
            pendingRescan = false;
            triggerRescan( 0 );
        }
    }

    function cancelScan()
    {
        var cancelledGeneration = activeScanGeneration;

        if( activeScanGeneration !== 0 )
        {
            cancelledScanGenerations.add( activeScanGeneration );
        }

        activeScanGeneration = 0;
        scanInFlight = false;
        setExtensionContext( 'scan-busy', false );
        if( cancelledGeneration !== 0 )
        {
            finishScanProgress( cancelledGeneration, true );
        }

        ripgrep.kill();
    }

    function createTaskScheduler( limit )
    {
        var activeCount = 0;
        var queue = [];
        var pendingPromises = [];

        function pump()
        {
            if( activeCount >= limit || queue.length === 0 )
            {
                return;
            }

            var entry = queue.shift();
            activeCount++;

            Promise.resolve().then( entry.task ).then( function( value )
            {
                activeCount--;
                entry.resolve( value );
                pump();
            } ).catch( function( error )
            {
                activeCount--;
                entry.reject( error );
                pump();
            } );
        }

        return {
            schedule: function( task )
            {
                var promise = new Promise( function( resolve, reject )
                {
                    queue.push( {
                        task: task,
                        resolve: resolve,
                        reject: reject
                    } );
                    pump();
                } );

                pendingPromises.push( promise );
                return promise;
            },
            wait: function()
            {
                return Promise.all( pendingPromises );
            }
        };
    }

    function scanWorkspaceFileWithText( filePath, scanFn )
    {
        return streamScanner.scanWorkspaceFileWithText( filePath, scanFn, { fs: fs } );
    }

    function inspectWorkspaceFile( filePath )
    {
        return streamScanner.inspectWorkspaceFile( filePath, { fs: fs } );
    }

    function ensureStorageDirectory()
    {
        if( !context.storageUri || !context.storageUri.fsPath )
        {
            return Promise.resolve( false );
        }

        return fs.promises.mkdir( context.storageUri.fsPath, { recursive: true } ).then( function()
        {
            return true;
        } ).catch( function( error )
        {
            if( error && error.code === 'EEXIST' )
            {
                return true;
            }

            throw error;
        } );
    }

    function decodeRipgrepValue( value )
    {
        return ripgrep.decodeJsonValue( value );
    }

    function resolveWorkspaceFilePath( rootPath, value )
    {
        var filePath = decodeRipgrepValue( value );

        if( !filePath )
        {
            return filePath;
        }

        if( path.isAbsolute( filePath ) )
        {
            return filePath;
        }

        return rootPath ? path.resolve( rootPath, filePath ) : filePath;
    }

    function toWorkspaceMatch( rootPath, data )
    {
        var submatches = Array.isArray( data.submatches ) ? data.submatches.map( function( submatch )
        {
            return {
                match: decodeRipgrepValue( submatch.match ),
                start: submatch.start,
                end: submatch.end
            };
        } ) : [];
        var firstSubmatch = submatches[ 0 ] || { start: 0, match: decodeRipgrepValue( data.lines ) || "" };

        return {
            fsPath: resolveWorkspaceFilePath( rootPath, data.path ),
            line: data.line_number,
            column: firstSubmatch.start + 1,
            match: firstSubmatch.match,
            absoluteOffset: data.absolute_offset,
            submatches: submatches,
            lines: decodeRipgrepValue( data.lines )
        };
    }

    function search( cwd, options, onEvent )
    {
        var target = options.filename ? options.filename : ".";
        debug( "Searching " + target + "..." );

        return ripgrep.search( cwd, options, onEvent ).then( function( summary )
        {
            var matchCount = summary && summary.stats && summary.stats.matches !== undefined ? summary.stats.matches : 0;
            debug( "Search returned " + matchCount + " matches for " + target );
            return summary;
        } ).catch( function( error )
        {
            if( isCancelledError( error ) )
            {
                throw error;
            }

            var message = error.message;
            if( error.stderr )
            {
                message += " (" + error.stderr + ")";
            }
            error.reportedToUser = true;
            vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": " + message );
            throw error;
        } );
    }

    function resetWorkspaceScanIssues()
    {
        workspaceScanIssues = [];
    }

    function recordWorkspaceScanIssue( stage, filePath, error )
    {
        var message = error && error.message ? error.message : String( error );
        workspaceScanIssues.push( {
            stage: stage,
            filePath: filePath,
            message: message
        } );
        debug( "Skipping workspace file during " + stage + ": " + filePath + " (" + message + ")" );
    }

    function handleWorkspaceScanIssue( stage, filePath, error )
    {
        if( isCancelledError( error ) )
        {
            throw error;
        }

        recordWorkspaceScanIssue( stage, filePath, error );
    }

    function flushWorkspaceScanIssues()
    {
        if( workspaceScanIssues.length === 0 )
        {
            return;
        }

        var firstIssue = workspaceScanIssues[ 0 ];
        var signature = workspaceScanIssues.map( function( issue )
        {
            return [ issue.stage, issue.filePath, issue.message ].join( '\u0000' );
        } ).join( '\u0001' );

        if( signature !== lastWorkspaceScanIssueSignature )
        {
            vscode.window.showWarningMessage(
                identity.DISPLAY_NAME + ": skipped " + workspaceScanIssues.length +
                " workspace file(s) while scanning. Results may be incomplete. First failure: " +
                firstIssue.filePath + " (" + firstIssue.message + ")" );
            lastWorkspaceScanIssueSignature = signature;
        }

        workspaceScanIssues = [];
    }

    function addGlobs( source, target, exclude )
    {
        Object.keys( source ).map( function( glob )
        {
            if( source.hasOwnProperty( glob ) && source[ glob ] === true )
            {
                target = target.concat( ( exclude === true ? '!' : '' ) + glob );
            }
        } );

        return target;
    }

    function buildGlobsForRipgrep( includeGlobs, excludeGlobs, tempIncludeGlobs, tempExcludeGlobs, submoduleExcludeGlobs )
    {
        var globs = []
            .concat( includeGlobs )
            .concat( tempIncludeGlobs )
            .concat( excludeGlobs.map( g => `!${g}` ) )
            .concat( tempExcludeGlobs.map( g => `!${g}` ) );

        if( config.shouldUseBuiltInFileExcludes() )
        {
            globs = addGlobs( vscode.workspace.getConfiguration( 'files.exclude' ), globs, true );
        }

        if( config.shouldUseBuiltInSearchExcludes() )
        {
            globs = addGlobs( vscode.workspace.getConfiguration( 'search.exclude' ), globs, true );
        }

        if( config.shouldIgnoreGitSubmodules() )
        {
            globs = globs.concat( submoduleExcludeGlobs.map( g => `!${g}` ) );
        }

        return globs;
    }

    function getOptions( filename, uri, overrideRegexSource, overrideSubmoduleExcludeGlobs )
    {
        var snapshot = currentSettingsSnapshot;
        var resourceConfig = snapshot.getResourceConfig( uri );
        var regexSource = overrideRegexSource || utils.getRegexSource( uri );

        var tempIncludeGlobs = snapshot.getTemporaryIncludeGlobs();
        var tempExcludeGlobs = snapshot.getTemporaryExcludeGlobs();
        var submoduleExcludeGlobs = overrideSubmoduleExcludeGlobs || [];

        var options = {
            regex: regexSource,
            unquotedRegex: regexSource,
            rgPath: config.ripgrepPath()
        };

        var globs = snapshot.passGlobsToRipgrep === true ? buildGlobsForRipgrep(
            snapshot.includeGlobs,
            snapshot.excludeGlobs,
            tempIncludeGlobs,
            tempExcludeGlobs,
            submoduleExcludeGlobs ) : undefined;

        if( globs && globs.length > 0 )
        {
            options.globs = globs;
        }
        if( filename )
        {
            options.filename = filename;
        }

        options.outputChannel = outputChannel;
        options.additional = getSetting( 'ripgrep.ripgrepArgs', '' );
        options.maxBuffer = getSetting( 'ripgrep.ripgrepMaxBuffer', 200 );
        options.multiline = regexSource.indexOf( "\\n" ) > -1 || resourceConfig.enableMultiLine === true;

        if( context.storageUri && context.storageUri.fsPath && getSetting( 'ripgrep.usePatternFile', true ) === true )
        {
            var patternFileName = crypto.randomBytes( 6 ).readUIntLE( 0, 6 ).toString( 36 ) + '.txt';
            options.patternFilePath = path.join( context.storageUri.fsPath, patternFileName );
        }

        if( snapshot.includeHiddenFiles )
        {
            options.additional += ' --hidden ';
        }
        if( resourceConfig.regexCaseSensitive === false )
        {
            options.additional += ' -i ';
        }

        return options;
    }

    function searchWorkspaces( searchList )
    {
        var scanMode = config.scanMode();
        if( scanMode === SCAN_MODE_WORKSPACE_AND_OPEN_FILES || scanMode === SCAN_MODE_WORKSPACE_ONLY )
        {
            var includes = getSetting( 'filtering.includedWorkspaces', [] );
            var excludes = getSetting( 'filtering.excludedWorkspaces', [] );
            if( vscode.workspace.workspaceFolders )
            {
                vscode.workspace.workspaceFolders.map( function( folder )
                {
                    if( folder.uri && folder.uri.scheme === 'file' && utils.isIncluded( folder.uri.fsPath, includes, excludes ) )
                    {
                        searchList.push( folder.uri.fsPath );
                    }
                } );
            }
        }
    }

    function isFileInSearchRoots( filename, roots )
    {
        return roots.some( function( root )
        {
            var prefix = root.endsWith( path.sep ) ? root : root + path.sep;
            return filename === root || filename.indexOf( prefix ) === 0;
        } );
    }

    function getWorkspaceSearchRoots()
    {
        var roots = getRootFolders();

        if( roots === undefined )
        {
            return [];
        }

        if( roots.length === 0 )
        {
            searchWorkspaces( roots );
        }

        return roots;
    }

    function isDocumentCoveredByWorkspaceSearch( document )
    {
        if( !document || !document.fileName )
        {
            return false;
        }

        if( config.scanMode() !== SCAN_MODE_WORKSPACE_AND_OPEN_FILES && config.scanMode() !== SCAN_MODE_WORKSPACE_ONLY )
        {
            return false;
        }

        return isFileInSearchRoots( document.fileName, getWorkspaceSearchRoots() );
    }

    function rememberNotebookDocument( notebook )
    {
        if( notebooks.isNotebookDocument( notebook ) === true )
        {
            notebookRegistry.remember( notebook );
        }
    }

    function getVisibleNotebookDocuments()
    {
        var visibleNotebookDocuments = [];
        var visibleNotebookKeys = new Set();
        var visibleNotebookEditors = Array.isArray( vscode.window.visibleNotebookEditors ) ? vscode.window.visibleNotebookEditors : [];

        function addVisibleNotebook( notebook )
        {
            if( notebooks.isNotebookDocument( notebook ) !== true )
            {
                return;
            }

            var notebookKey = notebooks.getNotebookKey( notebook );

            if( visibleNotebookKeys.has( notebookKey ) )
            {
                return;
            }

            visibleNotebookKeys.add( notebookKey );
            visibleNotebookDocuments.push( notebook );
        }

        visibleNotebookEditors.forEach( function( editor )
        {
            addVisibleNotebook( editor && editor.notebook );
        } );

        if( vscode.window.activeNotebookEditor )
        {
            addVisibleNotebook( vscode.window.activeNotebookEditor.notebook );
        }

        return visibleNotebookDocuments;
    }

    function applyForgottenNotebookState( forgottenNotebooks )
    {
        var shouldRefreshTree = false;

        forgottenNotebooks.forEach( function( forgotten )
        {
            if( !forgotten )
            {
                return;
            }

            forgotten.cellKeys.forEach( clearQueuedRefreshForKey );
            clearQueuedRefreshForKey( forgotten.notebookKey );

            if( forgotten.notebook && forgotten.notebook.uri && getSetting( 'tree.autoRefresh', true ) === true )
            {
                removeSearchResults( forgotten.notebook.uri, activeSearchResults );
                documentScanCache.deleteByUri( forgotten.notebook.uri );
                pendingDocumentRefreshes.delete( forgotten.notebookKey );
                shouldRefreshTree = true;
            }
        } );

        if( shouldRefreshTree && scanInFlight !== true )
        {
            applyDirtyResultsToTree( undefined, activeSearchResults );
        }
    }

    function syncVisibleNotebookEditors()
    {
        var synced = notebookRegistry.sync( getVisibleNotebookDocuments() ) || { added: [], forgotten: [] };

        if( synced.forgotten.length > 0 )
        {
            applyForgottenNotebookState( synced.forgotten );
        }

        return synced;
    }

    function handleVisibleNotebookEditorsChanged( reason )
    {
        var synced = syncVisibleNotebookEditors();

        if( shouldRefreshFile() !== true )
        {
            return;
        }

        synced.added.forEach( function( notebook )
        {
            queueNotebookRefresh( notebook, reason || 'open' );
        } );
    }

    function clearQueuedRefreshForKey( key )
    {
        pendingDocumentRefreshes.delete( key );
        documentVersions.delete( key );

        if( documentRefreshTimers.has( key ) )
        {
            clearTimeout( documentRefreshTimers.get( key ) );
            documentRefreshTimers.delete( key );
        }
    }

    function getNotebookForDocument( document )
    {
        if( !document || !document.uri )
        {
            return undefined;
        }

        if( notebooks.isNotebookCellDocument( document ) !== true && !( document.notebook && document.notebook.uri ) )
        {
            return undefined;
        }

        return notebookRegistry.getForDocument( document );
    }

    function getActiveScanTarget()
    {
        if( vscode.window.activeNotebookEditor && notebooks.isNotebookDocument( vscode.window.activeNotebookEditor.notebook ) )
        {
            rememberNotebookDocument( vscode.window.activeNotebookEditor.notebook );
            return vscode.window.activeNotebookEditor.notebook;
        }

        if( vscode.window.activeTextEditor && vscode.window.activeTextEditor.document )
        {
            if( notebooks.isNotebookCellDocument( vscode.window.activeTextEditor.document ) === true )
            {
                return getNotebookForDocument( vscode.window.activeTextEditor.document );
            }

            return vscode.window.activeTextEditor.document;
        }

        return undefined;
    }

    function getOwnerUriForDocument( document )
    {
        if( !document || !document.uri )
        {
            return undefined;
        }

        if( notebooks.isNotebookCellDocument( document ) !== true && !( document.notebook && document.notebook.uri ) )
        {
            return document.uri;
        }

        var notebook = getNotebookForDocument( document );
        return notebook ? notebook.uri : undefined;
    }

    function getCurrentFileFilter()
    {
        var activeTarget = getActiveScanTarget();

        if( !activeTarget || !activeTarget.uri )
        {
            return undefined;
        }

        if( activeTarget.uri.fsPath !== undefined )
        {
            return activeTarget.uri.fsPath;
        }

        if( vscode.window.activeTextEditor && vscode.window.activeTextEditor.document )
        {
            return vscode.window.activeTextEditor.document.fileName;
        }

        return undefined;
    }

    function getNotebookDocumentsForScan( workspaceRoots )
    {
        var scanMode = config.scanMode();
        var openNotebookTargets = notebookRegistry.all().filter( function( notebook )
        {
            return notebook && config.isValidScheme( notebook.uri ) && isIncluded( notebook.uri );
        } );

        if( scanMode === SCAN_MODE_CURRENT_FILE )
        {
            var activeTarget = getActiveScanTarget();
            return notebooks.isNotebookDocument( activeTarget ) ? [ activeTarget ] : [];
        }

        if( scanMode === SCAN_MODE_WORKSPACE_ONLY )
        {
            return openNotebookTargets.filter( function( notebook )
            {
                return notebook.uri.fsPath === undefined || isFileInSearchRoots( notebook.uri.fsPath, workspaceRoots );
            } );
        }

        return openNotebookTargets;
    }

    function getOpenDocumentsForScan( workspaceRoots )
    {
        var scanMode = config.scanMode();
        var documents = Object.keys( openDocuments ).map( function( key )
        {
            return openDocuments[ key ];
        } ).filter( function( document )
        {
            return document &&
                notebooks.isNotebookCellDocument( document ) !== true &&
                config.isValidScheme( document.uri ) &&
                isIncluded( document.uri );
        } );

        if( scanMode === SCAN_MODE_CURRENT_FILE )
        {
            var activeTarget = getActiveScanTarget();
            if( activeTarget && notebooks.isNotebookDocument( activeTarget ) !== true && config.isValidScheme( activeTarget.uri ) && isIncluded( activeTarget.uri ) )
            {
                return [ activeTarget ];
            }
            return [];
        }

        if( scanMode === SCAN_MODE_OPEN_FILES )
        {
            return documents;
        }

        if( scanMode === SCAN_MODE_WORKSPACE_AND_OPEN_FILES )
        {
            return documents.filter( function( document )
            {
                return document.fileName === undefined || isFileInSearchRoots( document.fileName, workspaceRoots ) !== true;
            } );
        }

        return [];
    }

    function scanNotebookDocument( notebook )
    {
        var notebookDetection = {
            scanDocument: function( document )
            {
                return getDocumentScanResults( document );
            }
        };

        return notebooks.scanDocument( notebook, notebookDetection, function( uri )
        {
            return config.isValidScheme( uri ) === true;
        }, function( document )
        {
            return resolveCommentPatternFileNameForLanguage( document.languageId );
        } );
    }

    function getSearchResultsStore( store )
    {
        return store || activeSearchResults;
    }

    function getDisplayedSearchResultsStore()
    {
        return nextSearchResults || activeSearchResults;
    }

    function getSearchResultsCount( store )
    {
        return getSearchResultsStore( store ).count();
    }

    function removeSearchResults( uri, store )
    {
        return getSearchResultsStore( store ).remove( uri );
    }

    function replaceSearchResults( uri, results, store )
    {
        return getSearchResultsStore( store ).replaceUriResults( uri, results );
    }

    function getDocumentPatternFileName( document )
    {
        if( !document )
        {
            return undefined;
        }

        if( document.commentPatternFileName )
        {
            return document.commentPatternFileName;
        }

        if( document.languageId )
        {
            return resolveCommentPatternFileNameForLanguage( document.languageId );
        }

        if( document.fileName )
        {
            return document.fileName;
        }

        return document.uri && document.uri.fsPath ? document.uri.fsPath : undefined;
    }

    function getDocumentScanResults( document )
    {
        var patternFileName = getDocumentPatternFileName( document );
        var signature = settingsSnapshotModule.settingsSignatureForUri( currentSettingsSnapshot, document.uri );
        var cachedResults = documentScanCache.get( document.uri, document.version, signature, patternFileName );

        if( cachedResults !== undefined )
        {
            return cachedResults;
        }

        var scanContext = detection.createScanContext( document.uri, document.getText(), currentSettingsSnapshot, {
            patternFileName: patternFileName
        } );
        var results = detection.scanDocumentWithContext( scanContext );

        documentScanCache.set( document.uri, document.version, signature, patternFileName, results );
        return results;
    }

    function refreshTextDocumentResults( document, store )
    {
        if( !document || !config.isValidScheme( document.uri ) || isIncluded( document.uri ) !== true )
        {
            replaceSearchResults( document.uri, [], store );
            return;
        }

        if( config.scanMode() === SCAN_MODE_CURRENT_FILE )
        {
            var activeTarget = getActiveScanTarget();
            if( activeTarget !== document )
            {
                replaceSearchResults( document.uri, [], store );
                return;
            }
        }

        replaceSearchResults( document.uri, getDocumentScanResults( document ), store );
    }

    function refreshNotebookResults( notebook, store )
    {
        if( !notebook )
        {
            return;
        }

        if( !config.isValidScheme( notebook.uri ) || isIncluded( notebook.uri ) !== true )
        {
            replaceSearchResults( notebook.uri, [], store );
            return;
        }

        if( config.scanMode() === SCAN_MODE_CURRENT_FILE )
        {
            var activeTarget = getActiveScanTarget();
            if( !activeTarget || !activeTarget.uri || activeTarget.uri.toString() !== notebook.uri.toString() )
            {
                replaceSearchResults( notebook.uri, [], store );
                return;
            }
        }

        replaceSearchResults( notebook.uri, scanNotebookDocument( notebook ), store );
    }

    function refreshScanTarget( target, store )
    {
        if( notebooks.isNotebookDocument( target ) )
        {
            refreshNotebookResults( target, store );
        }
        else
        {
            refreshTextDocumentResults( target, store );
        }
    }

    function applyDirtyResultsToTree( options, store )
    {
        options = options || {};
        var resultsStore = getSearchResultsStore( store );

        if( resultsStore.containsMarkdown() )
        {
            checkForMarkdownUpgrade();
        }

        resultsStore.drainDirtyResults().forEach( function( entry )
        {
            provider.replaceDocument( entry.uri, entry.results );
        } );

        provider.finalizePendingChanges( currentFilter, {
            refilterAll: options.refilterAll === true,
            fullSort: options.fullSort === true,
            forceFullRefresh: options.forceFullRefresh === true || scanInFlight === true
        } );

        updateInformation();
        refreshTree( options.immediateRefresh === true );
        setButtonsAndContext();
    }

    function flushPendingDocumentRefreshes()
    {
        if( pendingRescan === true || pendingDocumentRefreshes.size === 0 )
        {
            pendingDocumentRefreshes.clear();
            return;
        }

        pendingDocumentRefreshes.forEach( function( document )
        {
            refreshScanTarget( document, activeSearchResults );
        } );

        pendingDocumentRefreshes.clear();
        applyDirtyResultsToTree( undefined, activeSearchResults );
    }

    function getRefreshTargets( workspaceRoots )
    {
        return getOpenDocumentsForScan( workspaceRoots ).concat( getNotebookDocumentsForScan( workspaceRoots ) );
    }

    function refreshOpenFiles( workspaceRoots, store, onTargetRefreshed )
    {
        getRefreshTargets( workspaceRoots ).forEach( function( target )
        {
            refreshScanTarget( target, store );
            if( typeof ( onTargetRefreshed ) === 'function' )
            {
                onTargetRefreshed( target );
            }
        } );
    }

    function getCandidateSearchRegex()
    {
        return '(' + utils.getTagRegexSource() + ')';
    }

    function scanWorkspaceCandidates( rootPath, generation, store )
    {
        var matchedFiles = new Set();
        var scheduledFiles = new Set();
        var scheduler = createTaskScheduler( currentSettingsSnapshot.readFileConcurrency );
        var submoduleExcludeGlobs = config.shouldIgnoreGitSubmodules() ? utils.getSubmoduleExcludeGlobs( rootPath ) : [];

        function scheduleFileScan( filePath )
        {
            if( !filePath || scheduledFiles.has( filePath ) )
            {
                return;
            }

            scheduledFiles.add( filePath );

            scheduler.schedule( function()
            {
                assertGenerationActive( generation );

                var uri = vscode.Uri.file( filePath );
                if( isIncluded( uri ) !== true )
                {
                    return;
                }

                queueScanFileProgress( generation, filePath );
                return scanWorkspaceFileWithText( filePath, function( text )
                {
                    assertGenerationActive( generation );
                    return detection.scanTextWithStreamingContext( detection.createScanContext( uri, text, currentSettingsSnapshot ) );
                } ).then( function( results )
                {
                    assertGenerationActive( generation );
                    replaceSearchResults( uri, results, store );
                    completeScanFileProgress( generation, filePath );
                    scheduleStreamingTreeApply( generation, store );
                } ).catch( function( error )
                {
                    completeScanFileProgress( generation, filePath );
                    handleWorkspaceScanIssue( 'candidate scan', filePath, error );
                } );
            } );
        }

        return ensureStorageDirectory().then( function()
        {
            return search( rootPath, getOptions( undefined, undefined, getCandidateSearchRegex(), submoduleExcludeGlobs ), function( message )
            {
                if( message.type === 'match' )
                {
                    matchedFiles.add( resolveWorkspaceFilePath( rootPath, message.data.path ) );
                }
                else if( message.type === 'end' )
                {
                    var filePath = resolveWorkspaceFilePath( rootPath, message.data.path );
                    if( matchedFiles.has( filePath ) === true )
                    {
                        matchedFiles.delete( filePath );
                        scheduleFileScan( filePath );
                    }
                }
            } );
        } ).then( function()
        {
            Array.from( matchedFiles ).forEach( function( filePath )
            {
                scheduleFileScan( filePath );
            } );

            return scheduler.wait();
        } );
    }

    function scanWorkspaceRegexMatches( rootPath, generation, store )
    {
        var scheduler = createTaskScheduler( currentSettingsSnapshot.readFileConcurrency );
        var matchesByFile = new Map();
        var submoduleExcludeGlobs = config.shouldIgnoreGitSubmodules() ? utils.getSubmoduleExcludeGlobs( rootPath ) : [];

        function getFileMatches( filePath )
        {
            if( matchesByFile.has( filePath ) !== true )
            {
                matchesByFile.set( filePath, [] );
            }

            return matchesByFile.get( filePath );
        }

        function normalizeWorkspaceRegexMatches( uri, fileMatches )
        {
            return fileMatches.map( function( match )
            {
                return detection.normalizeWorkspaceRegexMatch( uri, match, currentSettingsSnapshot );
            } ).filter( function( result )
            {
                return result !== undefined;
            } );
        }

        function scheduleFileNormalization( filePath, fileMatches )
        {
            if( !filePath || !fileMatches || fileMatches.length === 0 )
            {
                return;
            }

            scheduler.schedule( function()
            {
                assertGenerationActive( generation );

                var uri = vscode.Uri.file( filePath );
                if( isIncluded( uri ) !== true )
                {
                    return;
                }

                queueScanFileProgress( generation, filePath );
                return inspectWorkspaceFile( filePath ).then( function( scanInfo )
                {
                    assertGenerationActive( generation );

                    if( scanInfo.useStreaming === true )
                    {
                        return normalizeWorkspaceRegexMatches( uri, fileMatches );
                    }

                    return scanWorkspaceFileWithText( filePath, function( text, info )
                    {
                        assertGenerationActive( generation );

                        var scanContext = detection.createScanContext( uri, text, currentSettingsSnapshot );

                        if( info && info.isFirst === true && info.isLast === true )
                        {
                            return fileMatches.map( function( match )
                            {
                                return detection.normalizeRegexMatchWithContext( scanContext, match );
                            } ).filter( function( result )
                            {
                                return result !== undefined;
                            } );
                        }

                        return detection.scanTextWithContext( scanContext );
                    } );
                } ).then( function( results )
                {
                    assertGenerationActive( generation );
                    replaceSearchResults( uri, results, store );
                    completeScanFileProgress( generation, filePath );
                    scheduleStreamingTreeApply( generation, store );
                } ).catch( function( error )
                {
                    completeScanFileProgress( generation, filePath );
                    handleWorkspaceScanIssue( 'regex normalization', filePath, error );
                } );
            } );
        }

        return ensureStorageDirectory().then( function()
        {
            return search( rootPath, getOptions( undefined, undefined, undefined, submoduleExcludeGlobs ), function( message )
            {
                assertGenerationActive( generation );

                if( message.type === 'match' )
                {
                    var workspaceMatch = toWorkspaceMatch( rootPath, message.data );
                    getFileMatches( workspaceMatch.fsPath ).push( workspaceMatch );
                }
                else if( message.type === 'end' )
                {
                    var filePath = resolveWorkspaceFilePath( rootPath, message.data.path );
                    var fileMatches = matchesByFile.get( filePath );
                    matchesByFile.delete( filePath );
                    scheduleFileNormalization( filePath, fileMatches );
                }
            } );
        } ).then( function()
        {
            matchesByFile.forEach( function( fileMatches, filePath )
            {
                scheduleFileNormalization( filePath, fileMatches );
            } );

            return scheduler.wait();
        } );
    }

    function applyGlobs( store )
    {
        var includeGlobs = currentSettingsSnapshot.includeGlobs;
        var excludeGlobs = currentSettingsSnapshot.excludeGlobs;

        var tempIncludeGlobs = currentSettingsSnapshot.getTemporaryIncludeGlobs();
        var tempExcludeGlobs = currentSettingsSnapshot.getTemporaryExcludeGlobs();
        var resultsStore = getSearchResultsStore( store );

        if( includeGlobs.length + excludeGlobs.length + tempIncludeGlobs.length + tempExcludeGlobs.length > 0 )
        {
            debug( "Applying globs to " + resultsStore.count() + " items..." );

            resultsStore.filter( function( match )
            {
                return utils.isIncluded( match.uri.fsPath, includeGlobs.concat( tempIncludeGlobs ), excludeGlobs.concat( tempExcludeGlobs ) );
            } );

            debug( "Remaining items: " + resultsStore.count() );
        }
    }

    function iterateSearchList( generation, store )
    {
        var workspaceConfig = currentSettingsSnapshot.getResourceConfig();

        return searchList.reduce( function( promise, entry, index )
        {
            return promise.then( function()
            {
                assertGenerationActive( generation );
                beginScanRoot( generation, entry );

                var scanPromise = workspaceConfig.isDefaultRegex === true ?
                    scanWorkspaceCandidates( entry, generation, store ) :
                    scanWorkspaceRegexMatches( entry, generation, store );

                return scanPromise.then( function()
                {
                    assertGenerationActive( generation );
                    completeScanRoot( generation, searchList[ index + 1 ] );
                } );
            } );
        }, Promise.resolve() ).then( function()
        {
            debug( "Found " + getSearchResultsCount( store ) + " items" );

            if( getSetting( 'filtering.passGlobsToRipgrep', true ) !== true )
            {
                applyGlobs( store );
            }
        } );
    }

    function getRootFolders()
    {
        var rootFolders = [];
        var valid = true;
        var rootFolder = getSetting( 'general.rootFolder', '' );
        if( rootFolder.indexOf( "${workspaceFolder}" ) > -1 )
        {
            if( vscode.workspace.workspaceFolders )
            {
                vscode.workspace.workspaceFolders.map( function( folder )
                {
                    var path = rootFolder;
                    path = path.replace( /\$\{workspaceFolder\}/g, folder.uri.fsPath );
                    rootFolders.push( path );
                } );
            }
            else
            {
                valid = false;
            }
        }
        else if( rootFolder !== "" )
        {
            //Using the VS Code URI api to get the fspath, which will follow case sensitivity of platform
            rootFolders.push( vscode.Uri.file( rootFolder ).fsPath );
        }

        rootFolders = rootFolders.map( function( folder )
        {
            return utils.replaceEnvironmentVariables( folder );
        } );

        var includes = getSetting( 'filtering.includedWorkspaces', [] );
        var excludes = getSetting( 'filtering.excludedWorkspaces', [] );

        if( valid === true )
        {
            rootFolders = rootFolders.filter( function( folder )
            {
                return utils.isIncluded( folder, includes, excludes );
            } );
        }

        return valid === true ? rootFolders : undefined;
    }

    function executeRebuild()
    {
        searchList = getWorkspaceSearchRoots();
        var generation = beginScan( searchList );
        var needsFullFilter = currentFilter !== undefined && currentFilter !== "";

        resetWorkspaceScanIssues();
        streamingTreePreparedGeneration = 0;
        streamingTreeApplyGeneration = generation;
        if( streamingTreeApplyTimer )
        {
            clearTimeout( streamingTreeApplyTimer );
            streamingTreeApplyTimer = undefined;
        }

        nextSearchResults = searchResults.createStore();

        return iterateSearchList( generation, nextSearchResults ).then( function()
        {
            assertGenerationActive( generation );
            var refreshTargets = getRefreshTargets( searchList );
            beginScanFinalization( generation, refreshTargets.length );
            refreshOpenFiles( searchList, nextSearchResults, function( target )
            {
                completeScanFinalizationTarget( generation, target );
            } );
            assertGenerationActive( generation );
            flushStreamingTreeApply( generation, nextSearchResults, undefined );
            prepareStreamingTreeApply( generation, nextSearchResults );
            activeSearchResults = nextSearchResults;
            nextSearchResults = undefined;
            applyDirtyResultsToTree( { fullSort: true, refilterAll: needsFullFilter }, activeSearchResults );
        } ).catch( function( error )
        {
            nextSearchResults = undefined;

            if( isCancelledError( error ) !== true )
            {
                if( streamingTreePreparedGeneration === generation )
                {
                    provider.clear( vscode.workspace.workspaceFolders );
                    provider.rebuild();
                    activeSearchResults.markAsNotAdded();
                }

                if( error.reportedToUser !== true )
                {
                    vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": scan failed (" + error.message + ")" );
                }
                applyDirtyResultsToTree( { fullSort: false, refilterAll: false }, activeSearchResults );
            }
        } ).finally( function()
        {
            if( streamingTreeApplyTimer )
            {
                clearTimeout( streamingTreeApplyTimer );
                streamingTreeApplyTimer = undefined;
            }
            if( streamingTreePreparedGeneration === generation )
            {
                streamingTreePreparedGeneration = 0;
            }
            flushWorkspaceScanIssues();
            finishScan( generation );
            flushPendingDocumentRefreshes();
        } );
    }

    function rebuild()
    {
        clearTimeout( rescanTimeout );

        if( scanInFlight === true )
        {
            pendingRescan = true;
            return;
        }

        executeRebuild();
    }

    function triggerRescan( delay )
    {
        clearTimeout( rescanTimeout );
        rescanTimeout = setTimeout( function()
        {
            if( scanInFlight === true )
            {
                pendingRescan = true;
                return;
            }

            executeRebuild();
        }, delay === undefined ? 1000 : delay );
    }

    function resetGitWatcher()
    {
        function checkGitHead()
        {
            if( vscode.workspace.workspaceFolders )
            {
                vscode.workspace.workspaceFolders.map( function( folder )
                {
                    if( gitHeadCheckInFlight.has( folder.uri.fsPath ) )
                    {
                        return;
                    }

                    gitHeadCheckInFlight.add( folder.uri.fsPath );

                    child_process.execFile( "git", [ "rev-parse", "HEAD" ], { cwd: folder.uri.fsPath }, function( err, stdout, stderr )
                    {
                        gitHeadCheckInFlight.delete( folder.uri.fsPath );

                        if( err )
                        {
                            debug( "git rev-parse HEAD failed for " + folder.uri.fsPath + ": " + stderr.toString().trim() );
                            return;
                        }

                        var gitHead = stdout.toString().trim();
                        if( lastGitHead[ folder.uri.fsPath ] !== undefined && gitHead != lastGitHead[ folder.uri.fsPath ] )
                        {
                            debug( 'Rescan triggered by change to git repository' );
                            triggerRescan();
                        }
                        lastGitHead[ folder.uri.fsPath ] = gitHead;
                    } );
                } );
            }
        }

        var timerInterval = getSetting( 'general.automaticGitRefreshInterval', 0 );

        if( autoGitRefreshTimer )
        {
            clearInterval( autoGitRefreshTimer );
        }

        if( timerInterval > 0 )
        {
            debug( 'Setting automatic Git refresh interval to ' + timerInterval + ' seconds' );
            autoGitRefreshTimer = setInterval( checkGitHead, timerInterval * 1000 );
        }
        else
        {
            debug( 'Automatic Git refresh disabled' );
        }
    }

    function resetPeriodicRefresh()
    {
        var timerInterval = getSetting( 'general.periodicRefreshInterval', 0 );

        if( periodicRefreshTimer )
        {
            clearInterval( periodicRefreshTimer );
        }

        if( timerInterval > 0 )
        {
            debug( 'Setting periodic refresh interval to ' + timerInterval + ' minutes' );
            periodicRefreshTimer = setInterval( triggerRescan, timerInterval * 1000 * 60 );
        }
        else
        {
            debug( 'Periodic refresh disabled' );
        }
    }

    function setButtonsAndContext()
    {
        var isFlat = config.shouldFlatten();
        var isTagsOnly = config.shouldShowTagsOnly();
        var isGroupedByTag = config.shouldGroupByTag();
        var isGroupedBySubTag = config.shouldGroupBySubTag();
        var isCollapsible = !isTagsOnly || isGroupedByTag || isGroupedBySubTag;
        var includeGlobs = context.workspaceState.get( 'includeGlobs' ) || [];
        var excludeGlobs = context.workspaceState.get( 'excludeGlobs' ) || [];
        var hasSubTags = provider.hasSubTags();

        var treeButtons = getSetting( 'tree.buttons', {} );
        var showRevealButton = treeButtons.reveal === true;
        var showScanModeButton = treeButtons.scanMode === true;
        var showViewStyleButton = treeButtons.viewStyle === true;
        var showGroupByTagButton = treeButtons.groupByTag === true;
        var showGroupBySubTagButton = treeButtons.groupBySubTag === true;
        var showFilterButton = treeButtons.filter === true;
        var showRefreshButton = treeButtons.refresh === true;
        var showExpandButton = treeButtons.expand === true;
        var showExportButton = treeButtons.export === true;
        var totalBusyCount = Object.keys( treeBusyStateCounts ).reduce( function( total, key )
        {
            return total + treeBusyStateCounts[ key ];
        }, 0 );

        clearTimeout( hideTimeout );
        hideTimeout = setTimeout( hideTreeIfEmpty, 1000 );

        return queueExtensionContextUpdates( [
            { suffix: 'show-reveal-button', value: showRevealButton && !getSetting( 'tree.trackFile', false ) },
            { suffix: 'show-scan-mode-button', value: showScanModeButton },
            { suffix: 'show-view-style-button', value: showViewStyleButton },
            { suffix: 'show-group-by-tag-button', value: showGroupByTagButton },
            { suffix: 'show-group-by-sub-tag-button', value: showGroupBySubTagButton },
            { suffix: 'show-filter-button', value: showFilterButton },
            { suffix: 'show-refresh-button', value: showRefreshButton },
            { suffix: 'show-expand-button', value: showExpandButton },
            { suffix: 'show-export-button', value: showExportButton },
            { suffix: 'expanded', value: config.shouldExpand() },
            { suffix: 'flat', value: isFlat },
            { suffix: 'tags-only', value: isTagsOnly },
            { suffix: 'grouped-by-tag', value: isGroupedByTag },
            { suffix: 'grouped-by-sub-tag', value: isGroupedBySubTag },
            { suffix: 'filtered', value: context.workspaceState.get( 'filtered', false ) },
            { suffix: 'collapsible', value: isCollapsible },
            { suffix: 'folder-filter-active', value: includeGlobs.length + excludeGlobs.length > 0 },
            { suffix: 'global-filter-active', value: currentFilter },
            { suffix: 'can-toggle-compact-folders', value: vscode.workspace.getConfiguration( 'explorer' ).compactFolders === true },
            { suffix: 'has-sub-tags', value: hasSubTags },
            { suffix: 'scan-mode', value: config.scanMode() },
            { suffix: 'tree-state-busy', value: totalBusyCount > 0 },
            { suffix: 'view-style-busy', value: treeBusyStateCounts[ 'view-style-busy' ] > 0 },
            { suffix: 'expansion-busy', value: treeBusyStateCounts[ 'expansion-busy' ] > 0 },
            { suffix: 'grouping-busy', value: treeBusyStateCounts[ 'grouping-busy' ] > 0 },
            { suffix: 'scan-busy', value: scanInFlight === true }
        ] );
    }

    function hideTreeIfEmpty()
    {
        var children = provider.getChildren();
        children = children.filter( function( child )
        {
            return child.isStatusNode !== true;
        } );

        if( getSetting( 'tree.hideTreeWhenEmpty', false ) === true )
        {
            setExtensionContext( 'is-empty', children.length == 0 );
        }
        else
        {
            setExtensionContext( 'is-empty', false );
        }
    }

    function isIncluded( uri )
    {
        if( uri.fsPath )
        {
            var includeGlobs = getSetting( 'filtering.includeGlobs', [] );
            var excludeGlobs = getSetting( 'filtering.excludeGlobs', [] );
            var includeHiddenFiles = getSetting( 'filtering.includeHiddenFiles', false );

            var tempIncludeGlobs = context.workspaceState.get( 'includeGlobs' ) || [];
            var tempExcludeGlobs = context.workspaceState.get( 'excludeGlobs' ) || [];

            if( config.shouldUseBuiltInFileExcludes() )
            {
                excludeGlobs = addGlobs( vscode.workspace.getConfiguration( 'files.exclude' ), excludeGlobs );
            }

            if( config.shouldUseBuiltInSearchExcludes() )
            {
                excludeGlobs = addGlobs( vscode.workspace.getConfiguration( 'search.exclude' ), excludeGlobs );
            }

            var isHidden = utils.isHidden( uri.fsPath );
            var included = utils.isIncluded( uri.fsPath, includeGlobs.concat( tempIncludeGlobs ), excludeGlobs.concat( tempExcludeGlobs ) );

            return included && ( !isHidden || includeHiddenFiles );
        }

        return false;
    }

    function refreshFile( document )
    {
        if( !document )
        {
            return;
        }

        refreshScanTarget( document, activeSearchResults );
        applyDirtyResultsToTree( undefined, activeSearchResults );
    }

    function shouldRefreshFile()
    {
        return getSetting( 'tree.autoRefresh', true ) === true && config.scanMode() !== SCAN_MODE_WORKSPACE_ONLY;
    }

    function scheduleRefreshForTarget( key, target, delay, lookupTarget )
    {
        documentVersions.set( key, target.version );

        if( documentRefreshTimers.has( key ) )
        {
            clearTimeout( documentRefreshTimers.get( key ) );
        }

        documentRefreshTimers.set( key, setTimeout( function()
        {
            documentRefreshTimers.delete( key );

            var currentTarget = lookupTarget( key );
            if( !currentTarget )
            {
                return;
            }

            if( currentTarget.version !== documentVersions.get( key ) )
            {
                return;
            }

            if( scanInFlight === true )
            {
                pendingDocumentRefreshes.set( key, currentTarget );
                return;
            }

            refreshFile( currentTarget );
        }, delay ) );
    }

    function queueNotebookRefresh( notebook, reason )
    {
        var notebookKey = notebooks.getNotebookKey( notebook );

        if( !notebook || !config.isValidScheme( notebook.uri ) || shouldRefreshFile() !== true || notebookRegistry.getByKey( notebookKey ) === undefined )
        {
            return;
        }

        scheduleRefreshForTarget(
            notebookKey,
            notebook,
            reason === 'change' ? 500 : 200,
            function( key )
            {
                return notebookRegistry.getByKey( key );
            }
        );
    }

    function queueDocumentRefresh( document, reason )
    {
        if( !document || !config.isValidScheme( document.uri ) || notebooks.isNotebookCellDocument( document ) === true || path.basename( document.fileName ) === "settings.json" || shouldRefreshFile() !== true )
        {
            return;
        }

        if( reason !== 'change' && isDocumentCoveredByWorkspaceSearch( document ) === true )
        {
            return;
        }

        var key = document.uri.toString();

        openDocuments[ key ] = document;
        scheduleRefreshForTarget(
            key,
            document,
            reason === 'change' ? 500 : 200,
            function( lookupKey )
            {
                return openDocuments[ lookupKey ];
            }
        );
    }

    function refresh( options )
    {
        options = options || {};
        var resultsStore = getDisplayedSearchResultsStore();

        resultsStore.markAsNotAdded();

        provider.clear( vscode.workspace.workspaceFolders );
        provider.rebuild();
        if( scanInFlight === true && nextSearchResults === resultsStore )
        {
            streamingTreePreparedGeneration = activeScanGeneration;
        }
        applyDirtyResultsToTree( {
            fullSort: true,
            refilterAll: currentFilter !== undefined && currentFilter !== "",
            immediateRefresh: options.immediateRefresh === true,
            forceFullRefresh: options.forceFullRefresh === true
        }, resultsStore );
    }

    function waitForTreeUiTurn()
    {
        return new Promise( function( resolve )
        {
            setImmediate( resolve );
        } );
    }

    function getVisibleTreeChildren( node )
    {
        var children = provider.getChildren( node );
        return Array.isArray( children ) ? children : [];
    }

    function getVisibleExpansionDepth( node )
    {
        var children = getVisibleTreeChildren( node );
        if( children.length === 0 )
        {
            return 0;
        }

        return 1 + children.reduce( function( maxDepth, child )
        {
            return Math.max( maxDepth, getVisibleExpansionDepth( child ) );
        }, 0 );
    }

    function syncRenderedTreeExpansion( expanded )
    {
        if( expanded === true )
        {
            return getVisibleTreeChildren().reduce( function( promise, root )
            {
                var depth = getVisibleExpansionDepth( root );
                if( depth === 0 )
                {
                    return promise;
                }

                return promise.then( function()
                {
                    return todoTreeView.reveal( root, {
                        focus: false,
                        select: false,
                        expand: depth
                    } );
                } );
            }, Promise.resolve() );
        }

        return vscode.commands.executeCommand( 'workbench.actions.treeView.' + identity.VIEW_ID + '.collapseAll' );
    }

    function clearExpansionStateAndRefresh( expanded )
    {
        provider.clearExpansionState();
        return Promise.resolve( refresh( { immediateRefresh: true, forceFullRefresh: true } ) )
            .then( waitForTreeUiTurn )
            .then( function()
            {
                return syncRenderedTreeExpansion( expanded );
            } );
    }

    function showFlatView()
    {
        return queueWorkspaceStateRefresh( 'tree view style', 'view-style-busy', [
            { key: 'tagsOnly', value: false },
            { key: 'flat', value: true }
        ], undefined, { forceRefreshWhenUnchanged: true } );
    }

    function showTagsOnlyView()
    {
        return queueWorkspaceStateRefresh( 'tree view style', 'view-style-busy', [
            { key: 'flat', value: false },
            { key: 'tagsOnly', value: true }
        ], undefined, { forceRefreshWhenUnchanged: true } );
    }

    function showTreeView()
    {
        return queueWorkspaceStateRefresh( 'tree view style', 'view-style-busy', [
            { key: 'tagsOnly', value: false },
            { key: 'flat', value: false }
        ], undefined, { forceRefreshWhenUnchanged: true } );
    }

    function cycleViewStyle()
    {
        var isFlat = config.shouldFlatten();
        var isTagsOnly = config.shouldShowTagsOnly();

        if( isFlat === false && isTagsOnly === false )
        {
            return showFlatView();
        }

        if( isFlat === true && isTagsOnly === false )
        {
            return showTagsOnlyView();
        }

        return showTreeView();
    }

    function toggleTreeExpansion()
    {
        var isExpanded = config.shouldExpand();
        return isExpanded === true ? collapse() : expand();
    }

    function collapse() { return queueWorkspaceStateRefresh( 'tree expansion', 'expansion-busy', { key: 'expanded', value: false }, function() { return clearExpansionStateAndRefresh( false ); }, { forceRefreshWhenUnchanged: true } ); }
    function expand() { return queueWorkspaceStateRefresh( 'tree expansion', 'expansion-busy', { key: 'expanded', value: true }, function() { return clearExpansionStateAndRefresh( true ); }, { forceRefreshWhenUnchanged: true } ); }
    function groupByTag() { return queueWorkspaceStateRefresh( 'tree grouping', 'grouping-busy', { key: 'groupedByTag', value: true }, undefined, { forceRefreshWhenUnchanged: true } ); }
    function ungroupByTag() { return queueWorkspaceStateRefresh( 'tree grouping', 'grouping-busy', { key: 'groupedByTag', value: false }, undefined, { forceRefreshWhenUnchanged: true } ); }
    function groupBySubTag() { return queueWorkspaceStateRefresh( 'tree grouping', 'grouping-busy', { key: 'groupedBySubTag', value: true }, undefined, { forceRefreshWhenUnchanged: true } ); }
    function ungroupBySubTag() { return queueWorkspaceStateRefresh( 'tree grouping', 'grouping-busy', { key: 'groupedBySubTag', value: false }, undefined, { forceRefreshWhenUnchanged: true } ); }

    function clearTreeFilter()
    {
        currentFilter = undefined;
        context.workspaceState.update( 'filtered', false );
        context.workspaceState.update( 'currentFilter', undefined );
        provider.finalizePendingChanges( undefined, { refilterAll: true } );
        updateInformation();
        refreshTree();
    }

    function addTag( tag )
    {
        var tags = getSetting( 'general.tags', [] );
        if( tags.indexOf( tag ) === -1 )
        {
            tags.push( tag );
            updateSetting( 'general.tags', tags, vscode.ConfigurationTarget.Global );
        }
    }

    function addTagDialog()
    {
        vscode.window.showInputBox( { prompt: "New tag", placeHolder: "e.g. FIXME" } ).then( function( tag )
        {
            if( tag )
            {
                addTag( tag );
            }
        } );
    }

    function removeTagDialog()
    {
        var tags = getSetting( 'general.tags', [] );
        vscode.window.showQuickPick( tags, { matchOnDetail: true, matchOnDescription: true, canPickMany: true, placeHolder: "Select tags to remove" } ).then( function( tagsToRemove )
        {
            if( tagsToRemove )
            {
                tagsToRemove.map( tag =>
                {
                    tags = tags.filter( t => tag != t );
                } );
                updateSetting( 'general.tags', tags, vscode.ConfigurationTarget.Global );
            }
        } );
    }

    function scanWorkspaceAndOpenFiles()
    {
        return updateSetting( 'tree.scanMode', SCAN_MODE_WORKSPACE_AND_OPEN_FILES, vscode.ConfigurationTarget.Workspace );
    }

    function scanOpenFilesOnly()
    {
        return updateSetting( 'tree.scanMode', SCAN_MODE_OPEN_FILES, vscode.ConfigurationTarget.Workspace );
    }

    function scanCurrentFileOnly()
    {
        return updateSetting( 'tree.scanMode', SCAN_MODE_CURRENT_FILE, vscode.ConfigurationTarget.Workspace );
    }

    function scanWorkspaceOnly()
    {
        return updateSetting( 'tree.scanMode', SCAN_MODE_WORKSPACE_ONLY, vscode.ConfigurationTarget.Workspace );
    }

    function dumpFolderFilter()
    {
        debug( "Folder filter include:" + JSON.stringify( context.workspaceState.get( 'includeGlobs' ) ) );
        debug( "Folder filter exclude:" + JSON.stringify( context.workspaceState.get( 'excludeGlobs' ) ) );
    }

    function checkForMarkdownUpgrade()
    {
        if( markdownUpdatePopupOpen === false && ignoreMarkdownUpdate === false )
        {
            if( getSetting( 'regex.regex', '' ).indexOf( "|^\\s*- \\[ \\])" ) > -1 )
            {
                markdownUpdatePopupOpen = true;
                setTimeout( function()
                {
                    // Information messages seem to self close after 15 seconds.
                    markdownUpdatePopupOpen = false;
                }, 15000 );
                var message = identity.DISPLAY_NAME + ": There is now an improved method of locating markdown TODOs.";
                var buttons = [ MORE_INFO_BUTTON, NEVER_SHOW_AGAIN_BUTTON ];
                if( getSetting( 'regex.regex', '' ) === getCurrentConfiguration().inspect( 'regex.regex' ).defaultValue )
                {
                    message += " Would you like to update your settings automatically?";
                    buttons.unshift( YES_BUTTON );
                }
                vscode.window.showInformationMessage( message, ...buttons ).then( function( button )
                {
                    markdownUpdatePopupOpen = false;
                    if( button === undefined )
                    {
                        ignoreMarkdownUpdate = true;
                    }
                    else if( button === YES_BUTTON )
                    {
                        ignoreMarkdownUpdate = true;
                        addTag( '[ ]' );
                        addTag( '[x]' );
                        updateSetting( 'regex.regex', '(^|//|#|<!--|;|/\\*|^[ \\t]*(-|\\d+.))\\s*(?=\\[x\\]|\\[ \\]|[A-Za-z0-9_])($TAGS)(?![A-Za-z0-9_])', vscode.ConfigurationTarget.Global );
                    }
                    else if( button === MORE_INFO_BUTTON )
                    {
                        vscode.env.openExternal( vscode.Uri.parse( "https://github.com/FanaticPythoner/better-todo-tree#markdown-support" ) );
                    }
                    else if( button === NEVER_SHOW_AGAIN_BUTTON )
                    {
                        context.globalState.update( 'ignoreMarkdownUpdate', true );
                        ignoreMarkdownUpdate = true;
                    }
                } );
            }
        }
    }

    function register()
    {
        function migrateSettings()
        {
            function typeMatches( value, type )
            {
                if( type === 'array' )
                {
                    return Array.isArray( value ) && value.length > 0;
                }

                if( type === 'object' )
                {
                    return value !== undefined && value !== null && typeof ( value ) === 'object' && Array.isArray( value ) !== true;
                }

                return typeof ( value ) === type;
            }

            function getInspectionValueForTarget( inspection, target )
            {
                if( target === vscode.ConfigurationTarget.Global )
                {
                    return inspection.globalValue;
                }
                if( target === vscode.ConfigurationTarget.Workspace )
                {
                    return inspection.workspaceValue;
                }

                return inspection.workspaceFolderValue;
            }

            function migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, setting, type, destination, destinationSetting )
            {
                var details = legacyRootConfiguration.inspect( setting ) || {};
                var targetSetting = destination + "." + ( destinationSetting || setting );
                [
                    vscode.ConfigurationTarget.Global,
                    vscode.ConfigurationTarget.Workspace,
                    vscode.ConfigurationTarget.WorkspaceFolder
                ].forEach( function( target )
                {
                    var value = getInspectionValueForTarget( details, target );
                    if( typeMatches( value, type ) )
                    {
                        debug( "Migrating legacy flat setting '" + setting + "' to '" + targetSetting + "'" );
                        updates.push( legacyRootConfiguration.update( targetSetting, value, target ) );
                    }
                } );
            }

            function importLegacyNamespaceSettingsIfRequired( updates )
            {
                var importRequired = context.globalState.get( legacySettingImportMarker, 0 ) < 225;
                if( importRequired !== true )
                {
                    return;
                }

                var currentRootConfiguration = getCurrentConfiguration();
                var legacyRootConfiguration = getLegacyConfiguration();

                currentManifestSettingSuffixes.forEach( function( setting )
                {
                    var currentInspection = currentRootConfiguration.inspect( setting ) || {};
                    var legacyInspection = legacyRootConfiguration.inspect( setting ) || {};

                    [
                        vscode.ConfigurationTarget.Global,
                        vscode.ConfigurationTarget.Workspace,
                        vscode.ConfigurationTarget.WorkspaceFolder
                    ].forEach( function( target )
                    {
                        var legacyValue = getInspectionValueForTarget( legacyInspection, target );
                        var currentValue = getInspectionValueForTarget( currentInspection, target );

                        if( legacyValue !== undefined && currentValue === undefined )
                        {
                            debug( "Importing legacy setting '" + identity.LEGACY_NAMESPACE + "." + setting + "' into '" + identity.CURRENT_NAMESPACE + "." + setting + "'" );
                            updates.push( currentRootConfiguration.update( setting, legacyValue, target ) );
                        }
                    } );
                } );

                updates.push( context.globalState.update( legacySettingImportMarker, 225 ) );
            }

            var legacyRootConfiguration = getLegacyConfiguration();
            var updates = [];

            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'autoRefresh', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'customHighlight', 'object', 'highlights' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'debug', 'boolean', 'general' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'defaultHighlight', 'object', 'highlights' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'excludedWorkspaces', 'array', 'filtering' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'excludeGlobs', 'array', 'filtering' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'expanded', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'filterCaseSensitive', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'flat', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'grouped', 'boolean', 'tree', 'groupedByTag' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'hideIconsWhenGroupedByTag', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'hideTreeWhenEmpty', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'highlightDelay', 'number', 'highlights' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'includedWorkspaces', 'array', 'filtering' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'includeGlobs', 'array', 'filtering' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'labelFormat', 'string', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'passGlobsToRipgrep', 'boolean', 'filtering' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'regex', 'string', 'regex' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'regexCaseSensitive', 'boolean', 'regex' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'revealBehaviour', 'string', 'general' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'ripgrep', 'string', 'ripgrep' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'ripgrepArgs', 'string', 'ripgrep' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'ripgrepMaxBuffer', 'number', 'ripgrep' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'rootFolder', 'string', 'general' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'showBadges', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'showCountsInTree', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'sortTagsOnlyViewAlphabetically', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'statusBar', 'string', 'general' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'statusBarClickBehaviour', 'string', 'general' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'tags', 'array', 'general' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'tagsOnly', 'boolean', 'tree' );
            migrateLegacyFlatSettingIfRequired( legacyRootConfiguration, updates, 'trackFile', 'boolean', 'tree' );

            importLegacyNamespaceSettingsIfRequired( updates );

            if( context.globalState.get( 'migratedVersion', 0 ) < 189 )
            {
                if( getSetting( 'tree.showInExplorer', false ) === true )
                {
                    vscode.commands.executeCommand( 'vscode.moveViews', {
                        viewIds: [ identity.VIEW_ID ],
                        destinationId: 'workbench.view.explorer'
                    } );

                    vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": 'showInExplorer' has been deprecated. If needed, the view can now be dragged to where you want it.", OPEN_SETTINGS_BUTTON, NEVER_SHOW_AGAIN_BUTTON ).then( function( button )
                    {
                        if( button === OPEN_SETTINGS_BUTTON )
                        {
                            vscode.commands.executeCommand( 'workbench.action.openSettingsJson', identity.CURRENT_NAMESPACE + '.tree.showInExplorer' );
                        }
                        else if( button === NEVER_SHOW_AGAIN_BUTTON )
                        {
                            context.globalState.update( 'migratedVersion', 189 );
                        }
                    } );
                }
            }

            if( context.globalState.get( 'migratedVersion', 0 ) < 210 )
            {
                var validValues = [ 'start of line', 'start of todo', 'end of todo' ];
                if( validValues.indexOf( getSetting( 'general.revealBehaviour', 'start of todo' ) ) === -1 )
                {
                    vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": some 'revealBehaviour' settings have been removed to make the extension more consistent with VSCode.", OPEN_SETTINGS_BUTTON, NEVER_SHOW_AGAIN_BUTTON ).then( function( button )
                    {
                        if( button === OPEN_SETTINGS_BUTTON )
                        {
                            vscode.commands.executeCommand( 'workbench.action.openSettings', identity.CURRENT_NAMESPACE + '.general.revealBehaviour' );
                        }
                        else if( button === NEVER_SHOW_AGAIN_BUTTON )
                        {
                            context.globalState.update( 'migratedVersion', 210 );
                        }
                    } );
                }
            }

            if( context.globalState.get( 'migratedVersion', 0 ) < 223 )
            {
                if( getSetting( 'general.enableFileWatcher', false ) === true )
                {
                    vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": File watcher functionality will be removed in the next version of the extension.", MORE_INFO_BUTTON, OPEN_SETTINGS_BUTTON, NEVER_SHOW_AGAIN_BUTTON ).then( function( button )
                    {
                        if( button == MORE_INFO_BUTTON )
                        {
                            vscode.env.openExternal( vscode.Uri.parse( "https://github.com/FanaticPythoner/better-todo-tree/issues/723" ) );
                        }
                        else if( button === OPEN_SETTINGS_BUTTON )
                        {
                            vscode.commands.executeCommand( 'workbench.action.openSettingsJson', identity.CURRENT_NAMESPACE + '.general.enableFileWatcher' );
                        }
                        else if( button === NEVER_SHOW_AGAIN_BUTTON )
                        {
                            context.globalState.update( 'migratedVersion', 223 );
                        }
                    } );
                }
            }

            var currentSchemes = getLegacyConfiguration( 'highlights' ).get( 'schemes' );
            if( getLegacyConfiguration( 'highlights' ).schemes !== undefined )
            {
                var schemesSettings = getLegacyConfiguration( 'general' ).inspect( 'schemes' );

                if( currentSchemes !== schemesSettings.defaultValue )
                {
                    var target = settingLocation( 'highlights.schemes' );
                    updateSetting( 'general.schemes', currentSchemes, target );
                }
            }

            return Promise.all( updates ).then( function()
            {
                return updates.length;
            } );
        }

        function showInTree( uri, options )
        {
            options = options || {};
            provider.getElement( uri.fsPath, function( element )
            {
                if( todoTreeView.visible === true )
                {
                    todoTreeView.reveal( element, { focus: false, select: options.select !== false } );
                }
            } );
        }

        function triggerHighlightsForDocument( document )
        {
            if( document )
            {
                vscode.window.visibleTextEditors.map( editor =>
                {
                    if( document === editor.document && config.isValidScheme( document.uri ) )
                    {
                        if( isIncluded( document.uri ) )
                        {
                            highlights.triggerHighlight( editor );
                        }
                    }
                } );
            }
            else
            {
                vscode.window.visibleTextEditors.map( editor =>
                {
                    if( config.isValidScheme( editor.document.uri ) )
                    {
                        if( isIncluded( editor.document.uri ) )
                        {
                            highlights.triggerHighlight( editor );
                        }
                    }
                } );
            }
        }

        function documentChanged( document )
        {
            if( document )
            {
                triggerHighlightsForDocument( document );
                if( config.isValidScheme( document.uri ) && path.basename( document.fileName ) !== "settings.json" )
                {
                    if( notebooks.isNotebookCellDocument( document ) === true )
                    {
                        return;
                    }

                    if( shouldRefreshFile() )
                    {
                        queueDocumentRefresh( document, 'change' );
                    }
                }
            }
            else
            {
                triggerHighlightsForDocument();
            }
        }

        function activeEditorChanged( editor )
        {
            if( !editor || !editor.document )
            {
                return;
            }

            var document = editor.document;
            var activeDocumentIsNotebookCell = notebooks.isNotebookCellDocument( document ) === true;
            var activeNotebook = activeDocumentIsNotebookCell === true ? getNotebookForDocument( document ) : undefined;
            var ownerUri = activeNotebook ? activeNotebook.uri : getOwnerUriForDocument( document );
            var ownerFileFilter = ownerUri && ownerUri.fsPath !== undefined ? ownerUri.fsPath : document.fileName;

            triggerHighlightsForDocument( document );

            if( activeDocumentIsNotebookCell !== true )
            {
                openDocuments[ document.uri.toString() ] = document;
            }

            if( config.scanMode() === SCAN_MODE_CURRENT_FILE )
            {
                rebuild();
            }

            if( getSetting( 'tree.autoRefresh', true ) === true && getSetting( 'tree.trackFile', true ) === true )
            {
                if( ownerUri && config.isValidScheme( ownerUri ) )
                {
                    if( selectedDocument !== ownerFileFilter )
                    {
                        setTimeout( function()
                        {
                            showInTree( ownerUri, { select: false } );
                        }, 500 );
                    }
                    selectedDocument = undefined;
                }
            }

            if( ownerUri && ( document.fileName === undefined || isIncluded( ownerUri ) ) )
            {
                updateInformation();
            }

            if( config.scanMode() !== SCAN_MODE_CURRENT_FILE && activeNotebook && shouldRefreshFile() )
            {
                queueNotebookRefresh( activeNotebook, 'open' );
            }
        }

        function validateColours()
        {
            var invalidColourMessage = colours.validateColours( vscode.workspace );
            if( invalidColourMessage )
            {
                vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": " + invalidColourMessage );
            }
            var invalidIconColourMessage = colours.validateIconColours( vscode.workspace );
            if( invalidIconColourMessage )
            {
                vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": " + invalidIconColourMessage );
            }
        }

        function validateIcons()
        {
            var invalidIconMessage = icons.validateIcons( vscode.workspace );
            if( invalidIconMessage )
            {
                vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": " + invalidIconMessage );
            }
        }

        function validatePlaceholders()
        {
            var unexpectedPlaceholders = [];
            utils.formatLabel( config.labelFormat(), {}, unexpectedPlaceholders );
            if( unexpectedPlaceholders.length > 0 )
            {
                vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": Unexpected placeholders (" + unexpectedPlaceholders.join( "," ) + ")" );
            }
        }

        // We can't do anything if we can't find ripgrep
        if( !config.ripgrepPath() )
        {
            vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": Failed to find vscode-ripgrep - please install ripgrep manually and set '" + identity.CURRENT_NAMESPACE + ".ripgrep.ripgrep' to point to the executable" );
            return;
        }

        registerCommandPair( 'openUrl', ( url ) =>
        {
            debug( "Opening " + url );
            vscode.env.openExternal( vscode.Uri.parse( url ) );
        } );

        registerCommandPair( 'filter', function()
        {
            vscode.window.showInputBox( { prompt: "Filter tree" } ).then(
                function( term )
                {
                    currentFilter = term;
                    if( currentFilter )
                    {
                        context.workspaceState.update( 'filtered', true );
                        context.workspaceState.update( 'currentFilter', currentFilter );
                        provider.finalizePendingChanges( currentFilter, { refilterAll: true } );
                        updateInformation();
                        refreshTree();
                    }
                } );
        } );

        registerCommandPair( 'stopScan', function()
        {
            interruptActiveScan();
        } );

        registerCommandPair( 'exportTree', function()
        {
            var exportPath = getSetting( 'general.exportPath', '~/better-todo-tree-%Y%m%d-%H%M.txt' );
            exportPath = utils.replaceEnvironmentVariables( exportPath );
            exportPath = utils.formatExportPath( exportPath );

            var uri = vscode.Uri.parse( identity.EXPORT_SCHEME + ':' + exportPath );
            vscode.workspace.openTextDocument( uri ).then( function( document )
            {
                vscode.window.showTextDocument( document, { preview: true } );
            } );
        } );

        registerCommandPair( 'showOnlyThisFolder', function( node )
        {
            var rootNode = tree.locateWorkspaceNode( node.fsPath );
            var includeGlobs = [ utils.createFolderGlob( node.fsPath, rootNode.fsPath, "/*" ) ];
            context.workspaceState.update( 'includeGlobs', includeGlobs );
            rebuild();
            dumpFolderFilter();
        } );

        registerCommandPair( 'showOnlyThisFolderAndSubfolders', function( node )
        {
            var rootNode = tree.locateWorkspaceNode( node.fsPath );
            var includeGlobs = [ utils.createFolderGlob( node.fsPath, rootNode.fsPath, "/**/*" ) ];
            context.workspaceState.update( 'includeGlobs', includeGlobs );
            rebuild();
            dumpFolderFilter();
        } );

        registerCommandPair( 'switchScope', function()
        {
            var scopes = getSetting( 'filtering.scopes', [] );

            if( !scopes || scopes.length === 0 )
            {
                vscode.window.showWarningMessage( identity.DISPLAY_NAME + ": No scopes configured (see " + identity.CURRENT_NAMESPACE + ".filtering.scopes setting)", OPEN_SETTINGS_BUTTON, OK_BUTTON ).then( function( button )
                {
                    if( button === OPEN_SETTINGS_BUTTON )
                    {
                        updateSetting( 'filtering.scopes', [], vscode.ConfigurationTarget.Global ).then( function()
                        {
                            vscode.commands.executeCommand( 'workbench.action.openSettingsJson', identity.CURRENT_NAMESPACE + '.filtering.scopes' );
                        } );
                    }
                } );
            }
            else
            {
                var items = [];
                var currentIncludeGlobs = JSON.stringify( context.workspaceState.get( 'includeGlobs' ) || [] );
                var currentExcludeGlobs = JSON.stringify( context.workspaceState.get( 'excludeGlobs' ) || [] );
                scopes.forEach( function( c )
                {
                    var scope = { label: c.name };
                    var includeGlobs = JSON.stringify( utils.toGlobArray( c.includeGlobs ) );
                    var excludeGlobs = JSON.stringify( utils.toGlobArray( c.excludeGlobs ) );
                    if( currentIncludeGlobs === includeGlobs && currentExcludeGlobs === excludeGlobs )
                    {
                        scope.description = "$(check)";
                    }

                    items.push( scope );
                } );
                var options = { placeHolder: "Select scope..." };
                vscode.window.showQuickPick( items, options ).then( function( scope )
                {
                    if( scope )
                    {
                        var currentConfig = scopes.find( c => c.name === scope.label );

                        context.workspaceState.update( 'includeGlobs', utils.toGlobArray( currentConfig.includeGlobs ) );
                        context.workspaceState.update( 'excludeGlobs', utils.toGlobArray( currentConfig.excludeGlobs ) );

                        rebuild();
                        dumpFolderFilter();
                    }
                } );
            }

        } );

        registerCommandPair( 'excludeThisFolder', function( node )
        {
            var rootNode = tree.locateWorkspaceNode( node.fsPath );
            var glob = utils.createFolderGlob( node.fsPath, rootNode.fsPath, "/**/*" );
            var excludeGlobs = context.workspaceState.get( 'excludeGlobs' ) || [];
            if( excludeGlobs.indexOf( glob ) === -1 )
            {
                excludeGlobs.push( glob );
                context.workspaceState.update( 'excludeGlobs', excludeGlobs );
                rebuild();
                dumpFolderFilter();
            }
        } );

        registerCommandPair( 'excludeThisFile', function( node )
        {
            var excludeGlobs = context.workspaceState.get( 'excludeGlobs' ) || [];
            if( excludeGlobs.indexOf( node.fsPath ) === -1 )
            {
                excludeGlobs.push( node.fsPath );
                context.workspaceState.update( 'excludeGlobs', excludeGlobs );
                rebuild();
                dumpFolderFilter();
            }
        } );

        registerCommandPair( 'removeFilter', function()
        {
            var CLEAR_TREE_FILTER = "Clear Tree Filter";
            var excludeGlobs = context.workspaceState.get( 'excludeGlobs' ) || [];
            var includeGlobs = context.workspaceState.get( 'includeGlobs' ) || [];
            var choices = [];

            if( currentFilter )
            {
                choices[ CLEAR_TREE_FILTER ] = {};
            }

            excludeGlobs.forEach( function( excludeGlob )
            {
                if( excludeGlob.endsWith( "/**/*" ) )
                {
                    choices[ "Exclude Folder: " + excludeGlob.slice( 0, -5 ) ] = { exclude: excludeGlob };
                }
                else if( excludeGlob.indexOf( '*' ) === -1 )
                {
                    choices[ "Exclude File: " + excludeGlob ] = { exclude: excludeGlob };
                }
                else
                {
                    choices[ "Exclude: " + excludeGlob ] = { exclude: excludeGlob };
                }
            } );
            includeGlobs.forEach( function( includeGlob )
            {
                if( includeGlob.endsWith( "/**/*" ) )
                {
                    choices[ "Include Folder and Subfolders: " + includeGlob.slice( 0, -5 ) ] = { include: includeGlob };
                }
                else if( includeGlob.endsWith( "/*" ) )
                {
                    choices[ "Include Folder: " + includeGlob.slice( 0, -2 ) ] = { include: includeGlob };
                }
                else
                {
                    choices[ "Include: " + includeGlob ] = { include: includeGlob };
                }
            } );

            vscode.window.showQuickPick( Object.keys( choices ), { matchOnDetail: true, matchOnDescription: true, canPickMany: true, placeHolder: "Select filters to remove" } ).then( function( selection )
            {
                if( selection )
                {
                    if( selection.indexOf( CLEAR_TREE_FILTER ) === 0 )
                    {
                        clearTreeFilter();
                        selection.shift();
                    }

                    selection.map( function( choice )
                    {
                        if( choices[ choice ].include )
                        {
                            includeGlobs = includeGlobs.filter( f => choices[ choice ].include != f );
                        }
                        else if( choices[ choice ].exclude )
                        {
                            excludeGlobs = excludeGlobs.filter( f => choices[ choice ].exclude != f );
                        }
                    } );

                    context.workspaceState.update( 'includeGlobs', includeGlobs );
                    context.workspaceState.update( 'excludeGlobs', excludeGlobs );

                    rebuild();
                    dumpFolderFilter();
                }
            } );
        } );

        registerCommandPair( 'resetCache', function()
        {
            function purgeFolder( folder )
            {
                if( !folder )
                {
                    return Promise.resolve();
                }

                return fs.promises.readdir( folder ).then( function( files )
                {
                    return Promise.all( files.map( function( file )
                    {
                        return fs.promises.unlink( path.join( folder, file ) );
                    } ) );
                } ).catch( function( error )
                {
                    if( error && error.code === 'ENOENT' )
                    {
                        return;
                    }

                    throw error;
                } );
            }

            context.workspaceState.update( 'includeGlobs', [] );
            context.workspaceState.update( 'excludeGlobs', [] );
            context.workspaceState.update( 'expandedNodes', {} );
            utils.clearSubmoduleExcludeGlobCache();
            context.workspaceState.update( 'currentFilter', undefined );
            context.workspaceState.update( 'filtered', undefined );
            context.workspaceState.update( 'tagsOnly', undefined );
            context.workspaceState.update( 'flat', undefined );
            context.workspaceState.update( 'expanded', undefined );
            context.workspaceState.update( 'grouped', undefined );
            context.workspaceState.update( 'groupedByTag', undefined );
            context.workspaceState.update( 'groupedBySubTag', undefined );
            context.globalState.update( 'migratedVersion', undefined );
            context.globalState.update( 'ignoreMarkdownUpdate', undefined );
            context.globalState.update( legacySettingImportMarker, undefined );

            Promise.all( [
                purgeFolder( context.storageUri && context.storageUri.fsPath ),
                purgeFolder( context.globalStorageUri && context.globalStorageUri.fsPath )
            ] ).catch( function( error )
            {
                vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": Failed to reset cache contents (" + error.message + ")" );
            } );
        } );

        registerCommandPair( 'resetAllFilters', function()
        {
            context.workspaceState.update( 'includeGlobs', [] );
            context.workspaceState.update( 'excludeGlobs', [] );
            rebuild();
            dumpFolderFilter();
            clearTreeFilter();
        } );

        registerCommandPair( 'reveal', function()
        {
            if( vscode.window.activeTextEditor )
            {
                var ownerUri = getOwnerUriForDocument( vscode.window.activeTextEditor.document );

                if( ownerUri )
                {
                    showInTree( ownerUri, { select: true } );
                }
            }
        } );

        registerCommandPair( 'toggleItemCounts', function()
        {
            var current = getSetting( 'tree.showCountsInTree', false );
            return updateSetting( 'tree.showCountsInTree', !current, vscode.ConfigurationTarget.Workspace );
        } );

        registerCommandPair( 'toggleBadges', function()
        {
            var current = getSetting( 'tree.showBadges', false );
            return updateSetting( 'tree.showBadges', !current, vscode.ConfigurationTarget.Workspace );
        } );

        registerCommandPair( 'toggleCompactFolders', function()
        {
            var current = getSetting( 'tree.disableCompactFolders', false );
            return updateSetting( 'tree.disableCompactFolders', !current, vscode.ConfigurationTarget.Workspace );
        } );

        registerCommandPair( 'goToNext', function()
        {
            var editor = vscode.window.activeTextEditor;

            var text = editor.document.getText();
            var regex = utils.getRegexForEditorSearch( false );

            var newSelections = [];
            var ok = true;

            editor.selections.map( function( selection )
            {
                var cursorOffset = editor.document.offsetAt( selection.start );
                var textToSearch = text.substring( cursorOffset );
                var matches = textToSearch.match( regex );

                if( matches && matches.length && matches.index === 0 )
                {
                    cursorOffset += matches[ 0 ].length;
                    textToSearch = text.substring( cursorOffset );
                    matches = textToSearch.match( regex );
                }

                if( matches && matches.length )
                {
                    var offset = cursorOffset + matches.index;
                    if( matches[ 0 ][ 0 ] === '\n' )
                    {
                        ++offset;
                    }
                    var newPosition = editor.document.positionAt( offset );
                    newSelections.push( new vscode.Selection( newPosition, newPosition ) );
                }
                else
                {
                    ok = false;
                }
            } );

            if( ok && newSelections.length > 0 )
            {
                editor.selections = newSelections;

                editor.revealRange( new vscode.Range( newSelections[ 0 ].start, newSelections[ 0 ].start ) );
            }
        } );

        registerCommandPair( 'goToPrevious', function()
        {
            var editor = vscode.window.activeTextEditor;

            var text = editor.document.getText();

            var newSelections = [];
            var ok = true;

            editor.selections.map( function( selection )
            {
                var cursorOffset = editor.document.offsetAt( selection.start );
                var textToSearch = text.substring( 0, cursorOffset );

                var regex = utils.getRegexForEditorSearch( true );

                var lastMatch;
                var lastMatchOffset = -1;

                while( result = regex.exec( textToSearch ) )
                {
                    lastMatch = result;
                    lastMatchOffset = result.index;
                }

                if( lastMatchOffset !== -1 )
                {
                    if( lastMatch[ 0 ][ 0 ] === '\n' )
                    {
                        ++lastMatchOffset;
                    }
                    var newPosition = editor.document.positionAt( lastMatchOffset );
                    newSelections.push( new vscode.Selection( newPosition, newPosition ) );
                }
                else
                {
                    ok = false;
                }
            } );

            if( ok && newSelections.length > 0 )
            {
                editor.selections = newSelections;

                editor.revealRange( new vscode.Range( newSelections[ 0 ].start, newSelections[ 0 ].start ) );
            }
        } );

        registerCommandPair( 'revealInFile', function( uri, selection )
        {
            function flashLine()
            {
                var editor = vscode.window.activeTextEditor;

                var currentLineRange = editor.document.lineAt( editor.selection.active.line ).range;

                var decorationOptions = {
                    isWholeLine: true,
                };

                var flashBackgroundColour = new vscode.ThemeColor( 'editor.rangeHighlightBackground' );

                decorationOptions.light = { backgroundColor: flashBackgroundColour };
                decorationOptions.dark = { backgroundColor: flashBackgroundColour };

                var lineFlashStyle = vscode.window.createTextEditorDecorationType( decorationOptions );

                var lineRangeHighlight = { range: currentLineRange };

                editor.setDecorations( lineFlashStyle, [ lineRangeHighlight ] );

                setTimeout( function()
                {
                    editor.setDecorations( lineFlashStyle, [] );
                }, 150 );
            }
            vscode.commands.executeCommand( 'vscode.open', uri, selection ).then(
                flashLine
            );
        } );

        context.subscriptions.push( todoTreeView.onDidExpandElement( function( e ) { provider.setExpanded( e.element.fsPath, true ); } ) );
        context.subscriptions.push( todoTreeView.onDidCollapseElement( function( e ) { provider.setExpanded( e.element.fsPath, false ); } ) );

        registerCommandPair( 'filterClear', clearTreeFilter );
        registerCommandPair( 'refresh', rebuild );
        registerCommandPair( 'cycleViewStyle', cycleViewStyle );
        registerCommandPair( 'showFlatView', showFlatView );
        registerCommandPair( 'showTagsOnlyView', showTagsOnlyView );
        registerCommandPair( 'showTreeView', showTreeView );
        registerCommandPair( 'toggleTreeExpansion', toggleTreeExpansion );
        registerCommandPair( 'expand', expand );
        registerCommandPair( 'collapse', collapse );
        registerCommandPair( 'treeStateBusy', function() {} );
        registerCommandPair( 'scanBusy', function() {} );
        registerCommandPair( 'groupByTag', groupByTag );
        registerCommandPair( 'ungroupByTag', ungroupByTag );
        registerCommandPair( 'groupBySubTag', groupBySubTag );
        registerCommandPair( 'ungroupBySubTag', ungroupBySubTag );
        registerCommandPair( 'addTag', addTagDialog );
        registerCommandPair( 'removeTag', removeTagDialog );
        registerCommandPair( 'onStatusBarClicked', onStatusBarClicked );
        registerCommandPair( 'scanWorkspaceAndOpenFiles', scanWorkspaceAndOpenFiles );
        registerCommandPair( 'scanOpenFilesOnly', scanOpenFilesOnly );
        registerCommandPair( 'scanCurrentFileOnly', scanCurrentFileOnly );
        registerCommandPair( 'scanWorkspaceOnly', scanWorkspaceOnly );
        context.subscriptions.push( vscode.commands.registerCommand( identity.COMMANDS.importLegacySettings, function()
        {
            context.globalState.update( legacySettingImportMarker, undefined ).then( function()
            {
                return migrateSettings();
            } ).then( function( updateCount )
            {
                vscode.window.showInformationMessage( identity.DISPLAY_NAME + ": imported legacy settings across " + updateCount + " configuration updates." );
            } ).catch( function( error )
            {
                vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": failed to import legacy settings (" + error.message + ")" );
            } );
        } ) );

        context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor( activeEditorChanged ) );

        context.subscriptions.push( vscode.workspace.onDidSaveTextDocument( document =>
        {
            if( config.isValidScheme( document.uri ) && notebooks.isNotebookCellDocument( document ) !== true && path.basename( document.fileName ) !== "settings.json" )
            {
                if( shouldRefreshFile() )
                {
                    queueDocumentRefresh( document, 'save' );
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidOpenTextDocument( document =>
        {
            if( shouldRefreshFile() )
            {
                if( config.isValidScheme( document.uri ) && notebooks.isNotebookCellDocument( document ) !== true )
                {
                    openDocuments[ document.uri.toString() ] = document;
                    queueDocumentRefresh( document, 'open' );
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidCloseTextDocument( document =>
        {
            delete openDocuments[ document.uri.toString() ];
            clearQueuedRefreshForKey( document.uri.toString() );

            if( document.uri && document.uri.scheme === 'vscode-notebook-cell' )
            {
                return;
            }

            if( getSetting( 'tree.autoRefresh', true ) === true && config.scanMode() !== SCAN_MODE_WORKSPACE_ONLY )
            {
                if( config.isValidScheme( document.uri ) )
                {
                    var keep = false;

                    if( config.scanMode() === SCAN_MODE_WORKSPACE_AND_OPEN_FILES || config.scanMode() === SCAN_MODE_WORKSPACE_ONLY )
                    {
                        var workspaceRoots = getWorkspaceSearchRoots();
                        if( document.fileName )
                        {
                            keep = isFileInSearchRoots( document.fileName, workspaceRoots );
                        }
                    }

                    if( !keep )
                    {
                        removeSearchResults( document.uri, activeSearchResults );
                        documentScanCache.deleteByUri( document.uri );

                        if( scanInFlight === true )
                        {
                            pendingDocumentRefreshes.delete( document.uri.toString() );
                        }
                        else
                        {
                            applyDirtyResultsToTree( undefined, activeSearchResults );
                        }
                    }
                }
            }
        } ) );

        if( typeof ( vscode.workspace.onDidOpenNotebookDocument ) === 'function' )
        {
            context.subscriptions.push( vscode.workspace.onDidOpenNotebookDocument( function( notebook )
            {
                handleVisibleNotebookEditorsChanged( 'open' );
            } ) );
        }

        if( typeof ( vscode.workspace.onDidChangeNotebookDocument ) === 'function' )
        {
            context.subscriptions.push( vscode.workspace.onDidChangeNotebookDocument( function( event )
            {
                if( event && event.notebook )
                {
                    var notebookKey = notebooks.getNotebookKey( event.notebook );

                    if( notebookRegistry.getByKey( notebookKey ) !== undefined )
                    {
                        rememberNotebookDocument( event.notebook );

                        if( shouldRefreshFile() )
                        {
                            queueNotebookRefresh( event.notebook, 'change' );
                        }
                    }
                }
            } ) );
        }

        if( typeof ( vscode.workspace.onDidCloseNotebookDocument ) === 'function' )
        {
            context.subscriptions.push( vscode.workspace.onDidCloseNotebookDocument( function( notebook )
            {
                handleVisibleNotebookEditorsChanged( 'open' );
            } ) );
        }

        if( typeof ( vscode.window.onDidChangeVisibleNotebookEditors ) === 'function' )
        {
            context.subscriptions.push( vscode.window.onDidChangeVisibleNotebookEditors( function()
            {
                handleVisibleNotebookEditorsChanged( 'open' );
            } ) );
        }

        context.subscriptions.push( vscode.workspace.onDidChangeConfiguration( function( e )
        {
            if( identity.affectsNamespace( e, identity.CURRENT_NAMESPACE ) ||
                identity.affectsNamespace( e, identity.LEGACY_NAMESPACE ) ||
                e.affectsConfiguration( 'files.exclude' ) ||
                e.affectsConfiguration( 'explorer.compactFolders' ) )
            {
                rebuildSettingsSnapshot();
                documentScanCache.clear();
                utils.clearSubmoduleExcludeGlobCache();
                highlights.resetCaches();

                if( identity.affectsSetting( e, 'regex.regex' ) )
                {
                    return;
                }

                if( identity.affectsSetting( e, 'highlights.enabled' ) ||
                    identity.affectsSetting( e, 'highlights.useColourScheme' ) ||
                    identity.affectsSetting( e, 'highlights.foregroundColourScheme' ) ||
                    identity.affectsSetting( e, 'highlights.backgroundColourScheme' ) ||
                    identity.affectsSetting( e, 'highlights.defaultHighlight' ) ||
                    identity.affectsSetting( e, 'highlights.customHighlight' ) )
                {
                    validateColours();
                    validateIcons();
                    documentChanged();
                }
                else if( identity.affectsSetting( e, 'tree.labelFormat' ) )
                {
                    validatePlaceholders();
                }
                else if( identity.affectsSetting( e, 'general.debug' ) )
                {
                    resetOutputChannel();
                }
                else if( identity.affectsSetting( e, 'general.automaticGitRefreshInterval' ) )
                {
                    resetGitWatcher();
                }
                else if( identity.affectsSetting( e, 'general.periodicRefreshInterval' ) )
                {
                    resetPeriodicRefresh();
                }

                if( identity.affectsSetting( e, 'general.tagGroups' ) )
                {
                    config.refreshTagGroupLookup();
                    rebuild();
                    documentChanged();
                }
                else if( identity.affectsSetting( e, 'tree.showCountsInTree' ) ||
                    identity.affectsSetting( e, 'tree.showBadges' ) )
                {
                    refresh();
                }
                else if( identity.affectsNamespace( e, identity.CURRENT_NAMESPACE + '.filtering' ) ||
                    identity.affectsNamespace( e, identity.LEGACY_NAMESPACE + '.filtering' ) ||
                    identity.affectsNamespace( e, identity.CURRENT_NAMESPACE + '.regex' ) ||
                    identity.affectsNamespace( e, identity.LEGACY_NAMESPACE + '.regex' ) ||
                    identity.affectsNamespace( e, identity.CURRENT_NAMESPACE + '.ripgrep' ) ||
                    identity.affectsNamespace( e, identity.LEGACY_NAMESPACE + '.ripgrep' ) ||
                    identity.affectsNamespace( e, identity.CURRENT_NAMESPACE + '.tree' ) ||
                    identity.affectsNamespace( e, identity.LEGACY_NAMESPACE + '.tree' ) ||
                    identity.affectsSetting( e, 'general.rootFolder' ) ||
                    identity.affectsSetting( e, 'general.tags' ) ||
                    e.affectsConfiguration( "files.exclude" ) )
                {
                    rebuild();
                    documentChanged();
                }
                else if( identity.affectsSetting( e, 'general.showActivityBarBadge' ) )
                {
                    updateInformation();
                }
                else
                {
                    refresh();
                }

                setButtonsAndContext();
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidChangeWorkspaceFolders( function()
        {
            rebuild();
        } ) );

        context.subscriptions.push( vscode.workspace.onDidChangeTextDocument( function( e )
        {
            documentChanged( e.document );
        } ) );

        context.subscriptions.push( outputChannel );

        resetOutputChannel();


        migrateSettings().catch( function( error )
        {
            vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": Failed to migrate legacy settings (" + error.message + ")" );
        } );
        validateColours();
        validateIcons();
        validatePlaceholders();
        setButtonsAndContext();
        resetGitWatcher();
        resetPeriodicRefresh();
        syncVisibleNotebookEditors();

        if( getSetting( 'tree.scanAtStartup', true ) === true )
        {
            var editors = vscode.window.visibleTextEditors;
            editors.map( function( editor )
            {
                if( editor.document && config.isValidScheme( editor.document.uri ) && notebooks.isNotebookCellDocument( editor.document ) !== true )
                {
                    openDocuments[ editor.document.uri.toString() ] = editor.document;
                }
            } );

            rebuild();

            if( vscode.window.activeTextEditor )
            {
                documentChanged();
            }
        }
        else
        {
            todoTreeView.message = "Click the refresh button to scan...";
        }
    }

    register();
}

function deactivate()
{
    ripgrep.kill();
    if( provider )
    {
        provider.clear( [] );
    }
}

exports.activate = activate;
exports.deactivate = deactivate;
