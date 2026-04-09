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
var attributes = require( './attributes.js' );
var searchResults = require( './searchResults.js' );
var detection = require( './detection.js' );
var identity = require( './extensionIdentity.js' );
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

    function updateSetting( setting, value, target, uri )
    {
        return identity.updateSetting( setting, value, target === undefined ? settingLocation( setting, uri ) : target, uri );
    }

    function setExtensionContext( suffix, value )
    {
        vscode.commands.executeCommand( 'setContext', identity.CONTEXT_KEYS[ suffix ], value );

        if( identity.LEGACY_CONTEXT_KEYS[ suffix ] !== undefined )
        {
            vscode.commands.executeCommand( 'setContext', identity.LEGACY_CONTEXT_KEYS[ suffix ], value );
        }
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
    attributes.init( config );

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

    function refreshTree()
    {
        clearTimeout( treeRefreshTimeout );
        treeRefreshTimeout = setTimeout( function()
        {
            provider.refresh();
            setButtonsAndContext();
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
            var fileFilter;

            if( vscode.window.activeTextEditor && vscode.window.activeTextEditor.document )
            {
                fileFilter = vscode.window.activeTextEditor.document.fileName;
            }

            counts = provider.getTagCountsForStatusBar( fileFilter );
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

    function beginScan()
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

        if( scanInFlight !== true && pendingRescan === true )
        {
            pendingRescan = false;
            triggerRescan( 0 );
        }
    }

    function cancelScan()
    {
        if( activeScanGeneration !== 0 )
        {
            cancelledScanGenerations.add( activeScanGeneration );
        }

        activeScanGeneration = 0;
        scanInFlight = false;

        ripgrep.kill();
    }

    function search( options )
    {
        var target = options.filename ? options.filename : ".";
        debug( "Searching " + target + "..." );

        return ripgrep.search( "/", options ).then( function( matches )
        {
            debug( "Search returned " + matches.length + " matches for " + target );
            return matches;
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
            vscode.window.showErrorMessage( identity.DISPLAY_NAME + ": " + message );
            throw error;
        } );
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

    function getOptions( filename, uri, overrideRegexSource )
    {
        var resourceConfig = detection.resolveResourceConfig( uri );
        var regexSource = overrideRegexSource || utils.getRegexSource( uri );

        var tempIncludeGlobs = context.workspaceState.get( 'includeGlobs' ) || [];
        var tempExcludeGlobs = context.workspaceState.get( 'excludeGlobs' ) || [];
        var submoduleExcludeGlobs = context.workspaceState.get( 'submoduleExcludeGlobs' ) || [];

        var options = {
            regex: regexSource,
            unquotedRegex: regexSource,
            rgPath: config.ripgrepPath()
        };

        var globs = getSetting( 'filtering.passGlobsToRipgrep', true ) === true ? buildGlobsForRipgrep(
            getSetting( 'filtering.includeGlobs', [] ),
            getSetting( 'filtering.excludeGlobs', [] ),
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

        if( context.storageUri.fsPath && !fs.existsSync( context.storageUri.fsPath ) )
        {
            debug( "Attempting to create local storage folder " + context.storageUri.fsPath );
            fs.mkdirSync( context.storageUri.fsPath, { recursive: true } );
        }

        options.outputChannel = outputChannel;
        options.additional = getSetting( 'ripgrep.ripgrepArgs', '' );
        options.maxBuffer = getSetting( 'ripgrep.ripgrepMaxBuffer', 200 );
        options.multiline = regexSource.indexOf( "\\n" ) > -1 || resourceConfig.enableMultiLine === true;

        if( fs.existsSync( context.storageUri.fsPath ) === true && getSetting( 'ripgrep.usePatternFile', true ) === true )
        {
            var patternFileName = crypto.randomBytes( 6 ).readUIntLE( 0, 6 ).toString( 36 ) + '.txt';
            options.patternFilePath = path.join( context.storageUri.fsPath, patternFileName );
        }

        if( getSetting( 'filtering.includeHiddenFiles', false ) )
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

    function getOpenDocumentsForScan( workspaceRoots )
    {
        var scanMode = config.scanMode();
        var documents = Object.keys( openDocuments ).map( function( key )
        {
            return openDocuments[ key ];
        } ).filter( function( document )
        {
            return document && config.isValidScheme( document.uri ) && isIncluded( document.uri );
        } );

        if( scanMode === SCAN_MODE_CURRENT_FILE )
        {
            if( vscode.window.activeTextEditor && vscode.window.activeTextEditor.document && config.isValidScheme( vscode.window.activeTextEditor.document.uri ) && isIncluded( vscode.window.activeTextEditor.document.uri ) )
            {
                return [ vscode.window.activeTextEditor.document ];
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

    function refreshDocumentResults( document )
    {
        if( !document || !config.isValidScheme( document.uri ) || isIncluded( document.uri ) !== true )
        {
            searchResults.replaceUriResults( document.uri, [] );
            return;
        }

        if( config.scanMode() === SCAN_MODE_CURRENT_FILE )
        {
            if( !vscode.window.activeTextEditor || vscode.window.activeTextEditor.document.fileName !== document.fileName )
            {
                searchResults.replaceUriResults( document.uri, [] );
                return;
            }
        }

        searchResults.replaceUriResults( document.uri, detection.scanDocument( document ) );
    }

    function applyDirtyResultsToTree( options )
    {
        options = options || {};

        if( searchResults.containsMarkdown() )
        {
            checkForMarkdownUpgrade();
        }

        searchResults.drainDirtyResults().forEach( function( entry )
        {
            provider.replaceDocument( entry.uri, entry.results );
        } );

        provider.finalizePendingChanges( currentFilter, {
            refilterAll: options.refilterAll === true,
            fullSort: options.fullSort === true
        } );

        updateInformation();
        refreshTree();
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
            refreshDocumentResults( document );
        } );

        pendingDocumentRefreshes.clear();
        applyDirtyResultsToTree();
    }

    function refreshOpenFiles( workspaceRoots )
    {
        getOpenDocumentsForScan( workspaceRoots ).forEach( function( document )
        {
            refreshDocumentResults( document );
        } );
    }

    function getCandidateSearchRegex()
    {
        return '(' + utils.getTagRegexSource() + ')';
    }

    function readWorkspaceFile( filePath )
    {
        return fs.readFileSync( filePath, 'utf8' );
    }

    function scanWorkspaceCandidates( rootPath )
    {
        var seenFiles = new Set();

        return search( getOptions( rootPath, undefined, getCandidateSearchRegex() ) ).then( function( matches )
        {
            matches.forEach( function( match )
            {
                seenFiles.add( match.fsPath );
            } );

            Array.from( seenFiles ).forEach( function( filePath )
            {
                var uri = vscode.Uri.file( filePath );
                if( isIncluded( uri ) !== true )
                {
                    return;
                }

                var text = readWorkspaceFile( filePath );
                searchResults.replaceUriResults( uri, detection.scanText( uri, text ) );
            } );
        } );
    }

    function scanWorkspaceRegexMatches( rootPath )
    {
        return search( getOptions( rootPath ) ).then( function( matches )
        {
            var matchesByFile = new Map();

            matches.forEach( function( match )
            {
                if( matchesByFile.has( match.fsPath ) !== true )
                {
                    matchesByFile.set( match.fsPath, [] );
                }
                matchesByFile.get( match.fsPath ).push( match );
            } );

            matchesByFile.forEach( function( fileMatches, filePath )
            {
                var uri = vscode.Uri.file( filePath );
                if( isIncluded( uri ) !== true )
                {
                    return;
                }

                var text = readWorkspaceFile( filePath );
                var normalized = fileMatches.map( function( match )
                {
                    return detection.normalizeRegexMatch( uri, text, match );
                } ).filter( function( result )
                {
                    return result !== undefined;
                } );

                searchResults.replaceUriResults( uri, normalized );
            } );
        } );
    }

    function applyGlobs()
    {
        var includeGlobs = getSetting( 'filtering.includeGlobs', [] );
        var excludeGlobs = getSetting( 'filtering.excludeGlobs', [] );

        var tempIncludeGlobs = context.workspaceState.get( 'includeGlobs' ) || [];
        var tempExcludeGlobs = context.workspaceState.get( 'excludeGlobs' ) || [];

        if( includeGlobs.length + excludeGlobs.length + tempIncludeGlobs.length + tempExcludeGlobs.length > 0 )
        {
            debug( "Applying globs to " + searchResults.count() + " items..." );

            searchResults.filter( function( match )
            {
                return utils.isIncluded( match.uri.fsPath, includeGlobs.concat( tempIncludeGlobs ), excludeGlobs.concat( tempExcludeGlobs ) );
            } );

            debug( "Remaining items: " + searchResults.count() );
        }
    }

    function iterateSearchList( generation )
    {
        var workspaceConfig = detection.resolveResourceConfig();

        return searchList.reduce( function( promise, entry )
        {
            return promise.then( function()
            {
                assertGenerationActive( generation );

                var scanPromise = workspaceConfig.isDefaultRegex === true ?
                    scanWorkspaceCandidates( entry ) :
                    scanWorkspaceRegexMatches( entry );

                return scanPromise.then( function()
                {
                    assertGenerationActive( generation );
                } );
            } );
        }, Promise.resolve() ).then( function()
        {
            debug( "Found " + searchResults.count() + " items" );

            if( getSetting( 'filtering.passGlobsToRipgrep', true ) !== true )
            {
                applyGlobs();
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
        var generation = beginScan();
        var needsFullFilter = currentFilter !== undefined && currentFilter !== "";

        todoTreeView.message = "";

        searchResults.clear();
        searchList = [];
        provider.clear( vscode.workspace.workspaceFolders );
        provider.rebuild();

        searchList = getWorkspaceSearchRoots();

        if( config.shouldIgnoreGitSubmodules() )
        {
            var submoduleExcludeGlobs = [];
            searchList.forEach( function( rootPath )
            {
                submoduleExcludeGlobs = submoduleExcludeGlobs.concat( utils.getSubmoduleExcludeGlobs( rootPath ) );
            } );
            context.workspaceState.update( 'submoduleExcludeGlobs', submoduleExcludeGlobs );
        }

        return iterateSearchList( generation ).then( function()
        {
            assertGenerationActive( generation );
            refreshOpenFiles( searchList );
            assertGenerationActive( generation );
            applyDirtyResultsToTree( { fullSort: true, refilterAll: needsFullFilter } );
        } ).catch( function( error )
        {
            if( isCancelledError( error ) !== true )
            {
                applyDirtyResultsToTree( { fullSort: true, refilterAll: needsFullFilter } );
            }
        } ).finally( function()
        {
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
        var isTagsOnly = context.workspaceState.get( 'tagsOnly', getSetting( 'tree.tagsOnly', false ) );
        var isGroupedByTag = context.workspaceState.get( 'groupedByTag', getSetting( 'tree.groupedByTag', false ) );
        var isGroupedBySubTag = context.workspaceState.get( 'groupedBySubTag', getSetting( 'tree.groupedBySubTag', false ) );
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

        setExtensionContext( 'show-reveal-button', showRevealButton && !getSetting( 'tree.trackFile', false ) );
        setExtensionContext( 'show-scan-mode-button', showScanModeButton );
        setExtensionContext( 'show-view-style-button', showViewStyleButton );
        setExtensionContext( 'show-group-by-tag-button', showGroupByTagButton );
        setExtensionContext( 'show-group-by-sub-tag-button', showGroupBySubTagButton );
        setExtensionContext( 'show-filter-button', showFilterButton );
        setExtensionContext( 'show-refresh-button', showRefreshButton );
        setExtensionContext( 'show-expand-button', showExpandButton );
        setExtensionContext( 'show-export-button', showExportButton );

        setExtensionContext( 'expanded', context.workspaceState.get( 'expanded', getSetting( 'tree.expanded', false ) ) );
        setExtensionContext( 'flat', context.workspaceState.get( 'flat', getSetting( 'tree.flat', false ) ) );
        setExtensionContext( 'tags-only', isTagsOnly );
        setExtensionContext( 'grouped-by-tag', isGroupedByTag );
        setExtensionContext( 'grouped-by-sub-tag', isGroupedBySubTag );
        setExtensionContext( 'filtered', context.workspaceState.get( 'filtered', false ) );
        setExtensionContext( 'collapsible', isCollapsible );
        setExtensionContext( 'folder-filter-active', includeGlobs.length + excludeGlobs.length > 0 );
        setExtensionContext( 'global-filter-active', currentFilter );
        setExtensionContext( 'can-toggle-compact-folders', vscode.workspace.getConfiguration( 'explorer' ).compactFolders === true );
        setExtensionContext( 'has-sub-tags', hasSubTags );

        setExtensionContext( 'scan-mode', config.scanMode() );

        clearTimeout( hideTimeout );
        hideTimeout = setTimeout( hideTreeIfEmpty, 1000 );
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

        refreshDocumentResults( document );
        applyDirtyResultsToTree();
    }

    function queueDocumentRefresh( document, reason )
    {
        if( !document || !config.isValidScheme( document.uri ) || path.basename( document.fileName ) === "settings.json" || shouldRefreshFile() !== true )
        {
            return;
        }

        var key = document.uri.toString();
        var delay = reason === 'change' ? 500 : 200;

        openDocuments[ key ] = document;
        documentVersions.set( key, document.version );

        if( documentRefreshTimers.has( key ) )
        {
            clearTimeout( documentRefreshTimers.get( key ) );
        }

        documentRefreshTimers.set( key, setTimeout( function()
        {
            documentRefreshTimers.delete( key );

            var currentDocument = openDocuments[ key ];
            if( !currentDocument )
            {
                return;
            }

            if( currentDocument.version !== documentVersions.get( key ) )
            {
                return;
            }

            if( scanInFlight === true )
            {
                pendingDocumentRefreshes.set( key, currentDocument );
                return;
            }

            refreshFile( currentDocument );
        }, delay ) );
    }

    function refresh()
    {
        searchResults.markAsNotAdded();

        provider.clear( vscode.workspace.workspaceFolders );
        provider.rebuild();
        applyDirtyResultsToTree( { fullSort: true, refilterAll: currentFilter !== undefined && currentFilter !== "" } );
    }

    function clearExpansionStateAndRefresh()
    {
        provider.clearExpansionState();
        refresh();
    }

    function showFlatView()
    {
        context.workspaceState.update( 'tagsOnly', false );
        context.workspaceState.update( 'flat', true ).then( refresh );
    }

    function showTagsOnlyView()
    {
        context.workspaceState.update( 'flat', false );
        context.workspaceState.update( 'tagsOnly', true ).then( refresh );
    }

    function showTreeView()
    {
        context.workspaceState.update( 'tagsOnly', false );
        context.workspaceState.update( 'flat', false ).then( refresh );
    }

    function collapse() { context.workspaceState.update( 'expanded', false ).then( clearExpansionStateAndRefresh ); }
    function expand() { context.workspaceState.update( 'expanded', true ).then( clearExpansionStateAndRefresh ); }
    function groupByTag() { context.workspaceState.update( 'groupedByTag', true ).then( refresh ); }
    function ungroupByTag() { context.workspaceState.update( 'groupedByTag', false ).then( refresh ); }
    function groupBySubTag() { context.workspaceState.update( 'groupedBySubTag', true ).then( refresh ); }
    function ungroupBySubTag() { context.workspaceState.update( 'groupedBySubTag', false ).then( refresh ); }

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
        updateSetting( 'tree.scanMode', SCAN_MODE_WORKSPACE_AND_OPEN_FILES, vscode.ConfigurationTarget.Workspace );
    }

    function scanOpenFilesOnly()
    {
        updateSetting( 'tree.scanMode', SCAN_MODE_OPEN_FILES, vscode.ConfigurationTarget.Workspace );
    }

    function scanCurrentFileOnly()
    {
        updateSetting( 'tree.scanMode', SCAN_MODE_CURRENT_FILE, vscode.ConfigurationTarget.Workspace );
    }

    function scanWorkspaceOnly()
    {
        updateSetting( 'tree.scanMode', SCAN_MODE_WORKSPACE_ONLY, vscode.ConfigurationTarget.Workspace );
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

        function documentChanged( document )
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

                if( config.isValidScheme( document.uri ) && path.basename( document.fileName ) !== "settings.json" )
                {
                    if( shouldRefreshFile() )
                    {
                        queueDocumentRefresh( document, 'change' );
                    }
                }
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

        function shouldRefreshFile()
        {
            return getSetting( 'tree.autoRefresh', true ) === true && config.scanMode() !== SCAN_MODE_WORKSPACE_ONLY;
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
            pendingRescan = false;
            cancelScan();
            statusBarIndicator.text = identity.DISPLAY_NAME + ": Scanning interrupted.";
            statusBarIndicator.tooltip = "Click to restart";
            statusBarIndicator.command = identity.COMMANDS.refresh;
            interrupted = true;
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
                fs.readdir( folder, function( err, files )
                {
                    files.map( function( file )
                    {
                        fs.unlinkSync( path.join( folder, file ) );
                    } );
                } );
            }

            context.workspaceState.update( 'includeGlobs', [] );
            context.workspaceState.update( 'excludeGlobs', [] );
            context.workspaceState.update( 'expandedNodes', {} );
            context.workspaceState.update( 'submoduleExcludeGlobs', [] );
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

            purgeFolder( context.storageUri.fsPath );
            purgeFolder( context.globalStorageUri.fsPath );
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
                showInTree( vscode.window.activeTextEditor.document.uri, { select: true } );
            }
        } );

        registerCommandPair( 'toggleItemCounts', function()
        {
            var current = getSetting( 'tree.showCountsInTree', false );
            updateSetting( 'tree.showCountsInTree', !current, vscode.ConfigurationTarget.Workspace );
        } );

        registerCommandPair( 'toggleBadges', function()
        {
            var current = getSetting( 'tree.showBadges', false );
            updateSetting( 'tree.showBadges', !current, vscode.ConfigurationTarget.Workspace );
        } );

        registerCommandPair( 'toggleCompactFolders', function()
        {
            var current = getSetting( 'tree.disableCompactFolders', false );
            updateSetting( 'tree.disableCompactFolders', !current, vscode.ConfigurationTarget.Workspace );
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
        registerCommandPair( 'showFlatView', showFlatView );
        registerCommandPair( 'showTagsOnlyView', showTagsOnlyView );
        registerCommandPair( 'showTreeView', showTreeView );
        registerCommandPair( 'expand', expand );
        registerCommandPair( 'collapse', collapse );
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

        context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor( function( e )
        {
            if( e && e.document )
            {
                openDocuments[ e.document.uri.toString() ] = e.document;

                if( config.scanMode() === SCAN_MODE_CURRENT_FILE )
                {
                    rebuild();
                }

                if( getSetting( 'tree.autoRefresh', true ) === true && getSetting( 'tree.trackFile', true ) === true )
                {
                    if( e.document.uri && config.isValidScheme( e.document.uri ) )
                    {
                        if( selectedDocument !== e.document.fileName )
                        {
                            setTimeout( function()
                            {
                                showInTree( e.document.uri, { select: false } );
                            }, 500 );
                        }
                        selectedDocument = undefined;
                    }
                }

                if( e.document.fileName === undefined || isIncluded( e.document.uri ) )
                {
                    updateInformation();
                }

                if( config.scanMode() !== SCAN_MODE_CURRENT_FILE )
                {
                    documentChanged( e.document );
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidSaveTextDocument( document =>
        {
            if( config.isValidScheme( document.uri ) && path.basename( document.fileName ) !== "settings.json" )
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
                if( config.isValidScheme( document.uri ) )
                {
                    openDocuments[ document.uri.toString() ] = document;
                    queueDocumentRefresh( document, 'open' );
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidCloseTextDocument( document =>
        {
            delete openDocuments[ document.uri.toString() ];
            documentVersions.delete( document.uri.toString() );
            pendingDocumentRefreshes.delete( document.uri.toString() );

            if( documentRefreshTimers.has( document.uri.toString() ) )
            {
                clearTimeout( documentRefreshTimers.get( document.uri.toString() ) );
                documentRefreshTimers.delete( document.uri.toString() );
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
                        searchResults.remove( document.uri );

                        if( scanInFlight === true )
                        {
                            pendingDocumentRefreshes.delete( document.uri.toString() );
                        }
                        else
                        {
                            applyDirtyResultsToTree();
                        }
                    }
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidChangeConfiguration( function( e )
        {
            if( identity.affectsNamespace( e, identity.CURRENT_NAMESPACE ) ||
                identity.affectsNamespace( e, identity.LEGACY_NAMESPACE ) ||
                e.affectsConfiguration( 'files.exclude' ) ||
                e.affectsConfiguration( 'explorer.compactFolders' ) )
            {
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

        if( getSetting( 'tree.scanAtStartup', true ) === true )
        {
            var editors = vscode.window.visibleTextEditors;
            editors.map( function( editor )
            {
                if( editor.document && config.isValidScheme( editor.document.uri ) )
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
