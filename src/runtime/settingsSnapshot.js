var os = require( 'os' );
var utils = require( '../utils.js' );

function stableStringify( value )
{
    if( Array.isArray( value ) )
    {
        return '[' + value.map( stableStringify ).join( ',' ) + ']';
    }

    if( value && typeof ( value ) === 'object' )
    {
        return '{' + Object.keys( value ).sort().map( function( key )
        {
            return JSON.stringify( key ) + ':' + stableStringify( value[ key ] );
        } ).join( ',' ) + '}';
    }

    return JSON.stringify( value );
}

function normalizeUriKey( uri )
{
    return uri && uri.toString ? uri.toString() : String( uri );
}

function getParallelism()
{
    if( typeof ( os.availableParallelism ) === 'function' )
    {
        return os.availableParallelism();
    }

    return os.cpus().length;
}

function buildSettingsSnapshot( context, identity, config, vscode )
{
    var resourceConfigCache = new Map();
    var resourceSignatureCache = new Map();
    var baseSignatureData = {
        includeGlobs: identity.getSetting( 'filtering.includeGlobs', [] ),
        excludeGlobs: identity.getSetting( 'filtering.excludeGlobs', [] ),
        includeHiddenFiles: identity.getSetting( 'filtering.includeHiddenFiles', false ),
        passGlobsToRipgrep: identity.getSetting( 'filtering.passGlobsToRipgrep', true ),
        includedWorkspaces: identity.getSetting( 'filtering.includedWorkspaces', [] ),
        excludedWorkspaces: identity.getSetting( 'filtering.excludedWorkspaces', [] ),
        useBuiltInExcludes: identity.getSetting( 'filtering.useBuiltInExcludes', 'none' ),
        ignoreGitSubmodules: identity.getSetting( 'filtering.ignoreGitSubmodules', false ),
        subTagRegex: identity.getSetting( 'regex.subTagRegex', '', undefined ),
        tags: config.tags(),
        regex: identity.getSetting( 'regex.regex', undefined ),
        regexCaseSensitive: identity.getSetting( 'regex.regexCaseSensitive', true ),
        enableMultiLine: identity.getSetting( 'regex.enableMultiLine', false ),
        schemes: identity.getSetting( 'general.schemes', [] ),
        tagGroups: identity.getSetting( 'general.tagGroups', {} ),
        showCountsInTree: identity.getSetting( 'tree.showCountsInTree', false ),
        showBadges: identity.getSetting( 'tree.showBadges', false ),
        highlightEnabled: identity.getSetting( 'highlights.enabled', true ),
        highlightDelay: identity.getSetting( 'highlights.highlightDelay', 500 ),
        customHighlight: identity.getSetting( 'highlights.customHighlight', {} ),
        defaultHighlight: identity.getSetting( 'highlights.defaultHighlight', {} ),
        useColourScheme: identity.getSetting( 'highlights.useColourScheme', false ),
        foregroundColourScheme: identity.getSetting( 'highlights.foregroundColourScheme', [] ),
        backgroundColourScheme: identity.getSetting( 'highlights.backgroundColourScheme', [] ),
        scanMode: config.scanMode(),
        trackFile: identity.getSetting( 'tree.trackFile', true ),
        autoRefresh: identity.getSetting( 'tree.autoRefresh', true )
    };
    var baseSignature = stableStringify( baseSignatureData );
    var readFileConcurrency = Math.max( 1, Math.min( 4, Math.floor( getParallelism() / 2 ) ) );

    function getWorkspaceStateValue( key, defaultValue )
    {
        return context && context.workspaceState ? context.workspaceState.get( key, defaultValue ) : defaultValue;
    }

    function getResourceConfig( uri )
    {
        var key = normalizeUriKey( uri || '__workspace__' );

        if( resourceConfigCache.has( key ) )
        {
            return resourceConfigCache.get( key );
        }

        var regexSettings = config.regex( uri );
        var resolved = {
            tags: regexSettings.tags,
            regex: regexSettings.regex,
            regexCaseSensitive: regexSettings.caseSensitive !== false,
            enableMultiLine: regexSettings.multiLine === true,
            subTagRegex: config.subTagRegex( uri ),
            isDefaultRegex: regexSettings.regex === utils.DEFAULT_REGEX_SOURCE
        };

        resourceConfigCache.set( key, resolved );
        return resolved;
    }

    function getResourceSignature( uri )
    {
        var key = normalizeUriKey( uri || '__workspace__' );

        if( resourceSignatureCache.has( key ) )
        {
            return resourceSignatureCache.get( key );
        }

        var signature = baseSignature + '|' + stableStringify( getResourceConfig( uri ) );
        resourceSignatureCache.set( key, signature );
        return signature;
    }

    return {
        baseSignature: baseSignature,
        readFileConcurrency: readFileConcurrency,
        includeGlobs: baseSignatureData.includeGlobs,
        excludeGlobs: baseSignatureData.excludeGlobs,
        includeHiddenFiles: baseSignatureData.includeHiddenFiles,
        passGlobsToRipgrep: baseSignatureData.passGlobsToRipgrep,
        customHighlight: baseSignatureData.customHighlight,
        defaultHighlight: baseSignatureData.defaultHighlight,
        useColourScheme: baseSignatureData.useColourScheme,
        foregroundColourScheme: baseSignatureData.foregroundColourScheme,
        backgroundColourScheme: baseSignatureData.backgroundColourScheme,
        showCountsInTree: baseSignatureData.showCountsInTree,
        showBadges: baseSignatureData.showBadges,
        highlightEnabled: baseSignatureData.highlightEnabled,
        highlightDelay: baseSignatureData.highlightDelay,
        tagGroups: baseSignatureData.tagGroups,
        schemes: baseSignatureData.schemes,
        scanMode: baseSignatureData.scanMode,
        trackFile: baseSignatureData.trackFile,
        autoRefresh: baseSignatureData.autoRefresh,
        getResourceConfig: getResourceConfig,
        getResourceSignature: getResourceSignature,
        getTemporaryIncludeGlobs: function() { return getWorkspaceStateValue( 'includeGlobs', [] ); },
        getTemporaryExcludeGlobs: function() { return getWorkspaceStateValue( 'excludeGlobs', [] ); },
        getCurrentFilter: function() { return getWorkspaceStateValue( 'currentFilter', undefined ); },
        getIsTagsOnly: function() { return getWorkspaceStateValue( 'tagsOnly', identity.getSetting( 'tree.tagsOnly', false ) ); },
        getIsGroupedByTag: function() { return getWorkspaceStateValue( 'groupedByTag', identity.getSetting( 'tree.groupedByTag', false ) ); },
        getIsGroupedBySubTag: function() { return getWorkspaceStateValue( 'groupedBySubTag', identity.getSetting( 'tree.groupedBySubTag', false ) ); },
        getIsExpanded: function() { return getWorkspaceStateValue( 'expanded', identity.getSetting( 'tree.expanded', false ) ); },
        getIsFlat: function() { return getWorkspaceStateValue( 'flat', identity.getSetting( 'tree.flat', false ) ); },
        getExplorerCompactFolders: function()
        {
            return vscode.workspace.getConfiguration( 'explorer' ).compactFolders;
        }
    };
}

function settingsSignatureForUri( snapshot, uri )
{
    return snapshot.getResourceSignature( uri );
}

module.exports.buildSettingsSnapshot = buildSettingsSnapshot;
module.exports.settingsSignatureForUri = settingsSignatureForUri;
