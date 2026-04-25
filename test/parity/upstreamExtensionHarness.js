var upstreamGitLoader = require( './upstreamGitLoader.js' );

function createUpstreamConfig( config )
{
    return {
        init: function() {},
        refreshTagGroupLookup: function() {},
        ripgrepPath: function() { return '/tmp/rg'; },
        regex: function()
        {
            return {
                tags: config.tagList.slice(),
                regex: config.regexSource,
                caseSensitive: config.caseSensitive !== false,
                multiLine: config.multiLine === true
            };
        },
        subTagRegex: function()
        {
            return config.subTagRegexString || '(^:\\s*)';
        },
        scanMode: function()
        {
            return 'open files';
        },
        shouldIgnoreGitSubmodules: function() { return false; },
        shouldUseBuiltInFileExcludes: function() { return false; },
        shouldUseBuiltInSearchExcludes: function() { return false; },
        shouldShowActivityBarBadge: function() { return false; },
        shouldFlatten: function() { return false; },
        shouldShowTagsOnly: function() { return false; },
        clickingStatusBarShouldRevealTree: function() { return false; },
        clickingStatusBarShouldToggleHighlights: function() { return false; },
        tags: function() { return config.tagList.slice(); },
        shouldShowIconsInsteadOfTagsInStatusBar: function() { return false; },
        shouldCompactFolders: function() { return false; },
        isValidScheme: function( uri ) { return !!uri && uri.scheme === 'file'; },
        labelFormat: function() { return '${tag} ${after}'; },
        shouldShowScanModeInTree: function() { return false; },
        shouldExpand: function() { return false; },
        shouldGroupByTag: function() { return false; },
        shouldGroupBySubTag: function() { return false; },
        shouldShowCounts: function() { return false; },
        shouldHideIconsWhenGroupedByTag: function() { return false; },
        tooltipFormat: function() { return '${filepath}, ${line}'; },
        showFilterCaseSensitive: function() { return false; },
        isRegexCaseSensitive: function() { return config.caseSensitive !== false; },
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
}

function createConfiguration( values )
{
    var state = Object.assign( {}, values );
    var configuration = {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( state, key ) ? state[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            state[ key ] = value;
            configuration[ key ] = value;
            return Promise.resolve();
        },
        inspect: function()
        {
            return {
                workspaceFolderValue: undefined,
                workspaceValue: undefined,
                globalValue: undefined,
                defaultValue: undefined
            };
        }
    };

    Object.keys( state ).forEach( function( key )
    {
        configuration[ key ] = state[ key ];
    } );

    return configuration;
}

function createWorkspaceState()
{
    var state = Object.create( null );

    return {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( state, key ) ? state[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            state[ key ] = value;
            return Promise.resolve();
        }
    };
}

function createLineOffsets( text )
{
    var offsets = [ 0 ];
    var index = 0;

    while( index < text.length )
    {
        if( text[ index ] === '\n' )
        {
            offsets.push( index + 1 );
        }
        index++;
    }

    return offsets;
}

function offsetToPosition( lineOffsets, offset )
{
    if( !Array.isArray( lineOffsets ) || lineOffsets.length === 0 )
    {
        throw new Error( 'offsetToPosition: lineOffsets must be a non-empty array' );
    }

    if( typeof ( offset ) !== 'number' || !isFinite( offset ) || offset < 0 )
    {
        throw new Error( 'offsetToPosition: offset must be a non-negative finite number, received ' + offset );
    }

    var low = 0;
    var high = lineOffsets.length - 1;

    while( low <= high )
    {
        var mid = Math.floor( ( low + high ) / 2 );
        if( lineOffsets[ mid ] <= offset )
        {
            if( mid === lineOffsets.length - 1 || lineOffsets[ mid + 1 ] > offset )
            {
                return { line: mid, character: offset - lineOffsets[ mid ] };
            }
            low = mid + 1;
        }
        else
        {
            high = mid - 1;
        }
    }

    throw new Error( 'offsetToPosition: offset ' + offset + ' did not resolve to any line in lineOffsets' );
}

function lineTextAt( text, lineOffsets, lineIndex )
{
    if( typeof ( lineIndex ) !== 'number' || lineIndex < 0 || lineIndex >= lineOffsets.length )
    {
        throw new Error( 'lineTextAt: lineIndex ' + lineIndex + ' out of range [0, ' + lineOffsets.length + ')' );
    }

    var start = lineOffsets[ lineIndex ];
    var end = lineIndex + 1 < lineOffsets.length ? lineOffsets[ lineIndex + 1 ] - 1 : text.length;

    if( end > start && text[ end - 1 ] === '\r' )
    {
        end--;
    }

    return text.slice( start, end );
}

function createDocument( uri, text )
{
    var documentUri = {
        fsPath: uri.fsPath,
        path: uri.path || uri.fsPath,
        scheme: uri.scheme || 'file',
        authority: uri.authority || '',
        toString: typeof ( uri.toString ) === 'function' ? function() { return uri.toString(); } : function() { return uri.fsPath; }
    };
    var lineOffsets = createLineOffsets( text );

    return {
        uri: documentUri,
        fileName: documentUri.fsPath,
        version: 1,
        _lineOffsets: lineOffsets,
        getText: function() { return text; },
        positionAt: function( offset ) { return offsetToPosition( lineOffsets, offset ); },
        lineAt: function( input )
        {
            var lineIndex = typeof ( input ) === 'number' ? input : input.line;
            return { text: lineTextAt( text, lineOffsets, lineIndex ) };
        }
    };
}

function indexOfCaseAware( haystack, needle, caseSensitive )
{
    if( !needle )
    {
        return -1;
    }

    if( caseSensitive === false )
    {
        return haystack.toLowerCase().indexOf( String( needle ).toLowerCase() );
    }

    return haystack.indexOf( needle );
}

function buildJoinedText( rawResult )
{
    var joined = rawResult.match.substr( rawResult.column - 1 );

    if( rawResult.extraLines )
    {
        rawResult.extraLines.forEach( function( extraLine )
        {
            joined += '\n' + extraLine.match;
        } );
    }

    return joined;
}

function normalizeRawResult( document, rawResult, config, upstreamUtils )
{
    var joined = buildJoinedText( rawResult );
    var text = upstreamUtils.removeBlockComments( joined, rawResult.uri.fsPath );
    var extracted = upstreamUtils.extractTag( text, rawResult.column );
    var actualTag = extracted.tag || '';
    var before = extracted.before ? extracted.before.trim() : '';
    var after = extracted.after ? extracted.after.trim() : '';
    var displayText = after.length > 0 ? after : ( before.length > 0 ? before : actualTag );
    var anchor = actualTag;
    var tagIndex;
    var joinedLineOffsets;
    var relativePosition;
    var line;
    var column;
    var tagStartOffset;
    var continuationText = [];

    if( after.length > 0 )
    {
        anchor += ' ' + after;
    }

    tagIndex = indexOfCaseAware( joined, anchor, config.caseSensitive !== false );
    if( tagIndex === -1 )
    {
        tagIndex = indexOfCaseAware( joined, actualTag, config.caseSensitive !== false );
    }
    if( tagIndex === -1 )
    {
        if( typeof ( extracted.tagOffset ) !== 'number' )
        {
            throw new Error( 'normalizeRawResult: cannot resolve tag offset for ' + JSON.stringify( actualTag ) );
        }
        tagIndex = extracted.tagOffset;
    }

    joinedLineOffsets = createLineOffsets( joined );
    relativePosition = offsetToPosition( joinedLineOffsets, tagIndex );
    line = rawResult.line + relativePosition.line;
    column = relativePosition.line === 0 ? rawResult.column + relativePosition.character : relativePosition.character + 1;
    var rawLineOffset = document._lineOffsets[ rawResult.line - 1 ];
    if( typeof ( rawLineOffset ) !== 'number' )
    {
        throw new Error( 'normalizeRawResult: rawResult.line ' + rawResult.line + ' is outside document line offsets' );
    }
    tagStartOffset = rawLineOffset + rawResult.column - 1 + tagIndex;

    if( rawResult.extraLines )
    {
        var commentsRemoved = text.split( '\n' );
        commentsRemoved.shift();
        rawResult.extraLines.forEach( function( extraLine, index )
        {
            if( index >= commentsRemoved.length )
            {
                return;
            }
            var extraLineMatch = commentsRemoved[ index ].trim();
            if( extraLineMatch.length > 0 && extraLineMatch !== actualTag )
            {
                continuationText.push( extraLineMatch );
            }
        } );
    }

    return {
        fsPath: rawResult.uri.fsPath,
        line: line,
        column: column,
        actualTag: actualTag,
        tag: actualTag,
        subTag: extracted.subTag,
        before: before,
        after: after,
        displayText: displayText,
        match: rawResult.match,
        continuationText: continuationText,
        tagStartOffset: tagStartOffset,
        tagEndOffset: tagStartOffset + actualTag.length
    };
}

function createProviderStub( capturedRawResults )
{
    return {
        clear: function() {},
        rebuild: function() {},
        refresh: function() {},
        filter: function() {},
        reset: function() {},
        remove: function( callback )
        {
            if( typeof ( callback ) === 'function' )
            {
                callback();
            }
        },
        add: function( result )
        {
            capturedRawResults.push( result );
        },
        getTagCountsForActivityBar: function() { return {}; },
        getTagCountsForStatusBar: function() { return {}; },
        clearExpansionState: function() {},
        setExpanded: function() {},
        getChildren: function() { return []; },
        exportTree: function() { return {}; },
        getElement: function() {},
        getFirstNode: function() { return undefined; },
        hasSubTags: function() { return false; }
    };
}

function createVscodeStub( document, config, provider )
{
    var handlers = {};
    var configurations = {
        'todo-tree': createConfiguration( {
            'filtering.passGlobsToRipgrep': false,
            'filtering.includeGlobs': [],
            'filtering.excludeGlobs': [],
            'filtering.scopes': [],
            'ripgrep.ripgrepArgs': '',
            'ripgrep.ripgrepMaxBuffer': 200000,
            'ripgrep.usePatternFile': false,
            'regex.regex': config.regexSource,
            'tree.buttons': {
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
            'tree.trackFile': false,
            'tree.expanded': false,
            'tree.flat': false,
            'tree.tagsOnly': false,
            'tree.groupedByTag': false,
            'tree.groupedBySubTag': false,
            'tree.showCountsInTree': false,
            'tree.showBadges': false
        } ),
        'todo-tree.tree': createConfiguration( {
            autoRefresh: true,
            trackFile: false,
            scanAtStartup: false,
            showCountsInTree: false,
            showBadges: false,
            disableCompactFolders: false
        } ),
        'todo-tree.general': createConfiguration( {
            debug: false,
            statusBar: 'none',
            enableFileWatcher: false,
            fileWatcherGlob: '**/*',
            exportPath: '/tmp/export.txt'
        } ),
        'todo-tree.filtering': createConfiguration( {
            includedWorkspaces: [],
            excludedWorkspaces: [],
            includeGlobs: [],
            excludeGlobs: [],
            scopes: [],
            includeHiddenFiles: false
        } ),
        'todo-tree.regex': createConfiguration( {
            regex: config.regexSource,
            regexCaseSensitive: config.caseSensitive !== false,
            enableMultiLine: config.multiLine === true
        } ),
        'todo-tree.highlights': createConfiguration( {
            enabled: false,
            useColourScheme: false,
            defaultHighlight: {},
            customHighlight: {},
            foregroundColourScheme: [],
            backgroundColourScheme: []
        } ),
        'files.exclude': createConfiguration( {} ),
        'search.exclude': createConfiguration( {} ),
        'explorer.compactFolders': createConfiguration( { compactFolders: true } )
    };

    return {
        handlers: handlers,
        workspace: {
            workspaceFolders: [],
            getConfiguration: function( section )
            {
                return configurations[ section ] || createConfiguration( {} );
            },
            registerTextDocumentContentProvider: function() { return { dispose: function() {} }; },
            createFileSystemWatcher: function()
            {
                return {
                    onDidChange: function() {},
                    onDidCreate: function() {},
                    onDidDelete: function() {},
                    dispose: function() {}
                };
            },
            onDidOpenTextDocument: function( handler ) { handlers.onDidOpenTextDocument = handler; return { dispose: function() {} }; },
            onDidCloseTextDocument: function( handler ) { handlers.onDidCloseTextDocument = handler; return { dispose: function() {} }; },
            onDidChangeConfiguration: function( handler ) { handlers.onDidChangeConfiguration = handler; return { dispose: function() {} }; },
            onDidChangeWorkspaceFolders: function( handler ) { handlers.onDidChangeWorkspaceFolders = handler; return { dispose: function() {} }; },
            onDidChangeTextDocument: function( handler ) { handlers.onDidChangeTextDocument = handler; return { dispose: function() {} }; },
            onDidSaveTextDocument: function( handler ) { handlers.onDidSaveTextDocument = handler; return { dispose: function() {} }; },
            openTextDocument: function() { return Promise.resolve( document ); }
        },
        window: {
            visibleTextEditors: [ { document: document } ],
            activeTextEditor: { document: document },
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
                return {
                    title: 'Tree',
                    badge: undefined,
                    message: '',
                    visible: false,
                    onDidExpandElement: function() { return { dispose: function() {} }; },
                    onDidCollapseElement: function() { return { dispose: function() {} }; }
                };
            },
            showInformationMessage: function() { return Promise.resolve(); },
            showWarningMessage: function() { return Promise.resolve(); },
            showErrorMessage: function() { return Promise.resolve(); },
            showInputBox: function() { return Promise.resolve(); },
            showQuickPick: function() { return Promise.resolve(); },
            showTextDocument: function() { return Promise.resolve(); },
            onDidChangeActiveTextEditor: function( handler ) { handlers.onDidChangeActiveTextEditor = handler; return { dispose: function() {} }; },
            createOutputChannel: function()
            {
                return {
                    appendLine: function() {},
                    dispose: function() {}
                };
            }
        },
        commands: {
            registerCommand: function() { return { dispose: function() {} }; },
            executeCommand: function() { return Promise.resolve(); }
        },
        env: {
            openExternal: function() { return Promise.resolve(); }
        },
        Uri: {
            file: function( fsPath )
            {
                return {
                    fsPath: fsPath,
                    path: fsPath,
                    scheme: 'file',
                    authority: '',
                    toString: function() { return fsPath; }
                };
            },
            parse: function( value )
            {
                return {
                    fsPath: value,
                    path: value,
                    scheme: 'file',
                    authority: '',
                    toString: function() { return value; }
                };
            }
        },
        StatusBarAlignment: { Left: 0 },
        ConfigurationTarget: {
            Global: 1,
            Workspace: 2,
            WorkspaceFolder: 3
        }
    };
}

function runUpstreamDetector( uri, text, config )
{
    if( !config || !Array.isArray( config.tagList ) )
    {
        throw new Error( 'runUpstreamDetector: config.tagList is required' );
    }

    var upstreamUtils = upstreamGitLoader.loadModule( 'src/utils.js' );
    var upstreamSearchResults = upstreamGitLoader.loadModule( 'src/searchResults.js' );
    var upstreamConfig = createUpstreamConfig( config );
    var capturedRawResults = [];
    var provider = createProviderStub( capturedRawResults );
    var document = createDocument( uri, text );
    var vscodeStub = createVscodeStub( document, config, provider );
    var extensionModule = upstreamGitLoader.loadModule( 'src/extension.js', {
        vscode: vscodeStub,
        './ripgrep': {
            search: function() { return Promise.resolve( [] ); },
            kill: function() {}
        },
        './tree.js': {
            TreeNodeProvider: function() { return provider; },
            locateWorkspaceNode: function() { return undefined; }
        },
        './colours.js': {
            validateColours: function() { return []; },
            validateIconColours: function() { return []; }
        },
        './icons.js': {
            validateIcons: function() { return []; },
            getIcon: function() { return undefined; }
        },
        './highlights.js': {
            init: function() {},
            triggerHighlight: function() {},
            clearHighlights: function() {}
        },
        './config.js': upstreamConfig,
        './utils.js': upstreamUtils,
        './attributes.js': {
            init: function() {},
            getIcon: function() { return 'check'; }
        },
        './searchResults.js': upstreamSearchResults
    } );
    var context = {
        subscriptions: { push: function() {} },
        workspaceState: createWorkspaceState(),
        globalState: createWorkspaceState(),
        storageUri: { fsPath: '/tmp/storage' },
        globalStorageUri: { fsPath: '/tmp/global-storage' }
    };

    upstreamSearchResults.clear();
    extensionModule.activate( context );
    vscodeStub.handlers.onDidOpenTextDocument( document );

    return capturedRawResults.map( function( rawResult )
    {
        return normalizeRawResult( document, rawResult, config, upstreamUtils );
    } );
}

module.exports.runUpstreamDetector = runUpstreamDetector;
