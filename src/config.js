var vscode = require( 'vscode' );
var fs = require( 'fs' );
var path = require( 'path' );
var attributes = require( './attributes.js' );
var identity = require( './extensionIdentity.js' );

var context;
var treeStateOverrides = {};

var tagGroupLookup = {};
var ripgrepPathCache = {
    signature: undefined,
    value: undefined
};

function init( c )
{
    context = c;

    refreshTagGroupLookup();
}

function getTreeStateValue( key, setting, defaultValue )
{
    if( Object.prototype.hasOwnProperty.call( treeStateOverrides, key ) )
    {
        return treeStateOverrides[ key ];
    }

    return context.workspaceState.get( key, identity.getSetting( setting, defaultValue ) );
}

function setTreeStateOverride( key, value )
{
    if( value === undefined )
    {
        delete treeStateOverrides[ key ];
        return;
    }

    treeStateOverrides[ key ] = value;
}

function setTreeStateOverrides( values )
{
    Object.keys( values || {} ).forEach( function( key )
    {
        setTreeStateOverride( key, values[ key ] );
    } );
}

function shouldGroupByTag()
{
    return getTreeStateValue( 'groupedByTag', 'tree.groupedByTag', false );
}

function shouldGroupBySubTag()
{
    return getTreeStateValue( 'groupedBySubTag', 'tree.groupedBySubTag', false );
}

function shouldExpand()
{
    return getTreeStateValue( 'expanded', 'tree.expanded', false );
}

function shouldFlatten()
{
    return getTreeStateValue( 'flat', 'tree.flat', false );
}

function shouldShowTagsOnly()
{
    return getTreeStateValue( 'tagsOnly', 'tree.tagsOnly', false );
}

function shouldShowCounts()
{
    return identity.getSetting( 'tree.showCountsInTree', false );
}

function shouldHideIconsWhenGroupedByTag()
{
    return identity.getSetting( 'tree.hideIconsWhenGroupedByTag', false );
}

function showFilterCaseSensitive()
{
    return identity.getSetting( 'tree.filterCaseSensitive', false );
}

function isRegexCaseSensitive()
{
    return identity.getSetting( 'regex.regexCaseSensitive', true );
}

function showBadges()
{
    return identity.getSetting( 'tree.showBadges', false );
}

function regex( uri )
{
    return {
        tags: tags(),
        regex: identity.getSetting( 'regex.regex', undefined, uri ),
        caseSensitive: identity.getSetting( 'regex.regexCaseSensitive', true, uri ),
        multiLine: identity.getSetting( 'regex.enableMultiLine', false, uri )
    };
}

function subTagRegex( uri )
{
    return identity.getSetting( 'regex.subTagRegex', '', uri );
}

function ripgrepPath()
{
    function exeName()
    {
        var isWin = /^win/.test( process.platform );
        return isWin ? "rg.exe" : "rg";
    }

    function exePathIsDefined( rgExePath )
    {
        return fs.existsSync( rgExePath ) ? rgExePath : undefined;
    }

    var configuredPath = identity.getSetting( 'ripgrep.ripgrep', "" );
    var signature = configuredPath + "|" + vscode.env.appRoot;

    if( ripgrepPathCache.signature === signature )
    {
        return ripgrepPathCache.value;
    }

    var rgPath = "";

    rgPath = exePathIsDefined( configuredPath );
    if( rgPath )
    {
        ripgrepPathCache.signature = signature;
        ripgrepPathCache.value = rgPath;
        return rgPath;
    }

    rgPath = exePathIsDefined( path.join( vscode.env.appRoot, "node_modules/vscode-ripgrep/bin/", exeName() ) );
    if( rgPath )
    {
        ripgrepPathCache.signature = signature;
        ripgrepPathCache.value = rgPath;
        return rgPath;
    }

    rgPath = exePathIsDefined( path.join( vscode.env.appRoot, "node_modules.asar.unpacked/vscode-ripgrep/bin/", exeName() ) );
    if( rgPath )
    {
        ripgrepPathCache.signature = signature;
        ripgrepPathCache.value = rgPath;
        return rgPath;
    }

    rgPath = exePathIsDefined( path.join( vscode.env.appRoot, "node_modules/@vscode/ripgrep/bin/", exeName() ) );
    if( rgPath )
    {
        ripgrepPathCache.signature = signature;
        ripgrepPathCache.value = rgPath;
        return rgPath;
    }

    rgPath = exePathIsDefined( path.join( vscode.env.appRoot, "node_modules.asar.unpacked/@vscode/ripgrep/bin/", exeName() ) );
    ripgrepPathCache.signature = signature;
    ripgrepPathCache.value = rgPath;
    if( rgPath ) return rgPath;

    return rgPath;
}

function tags()
{
    var tags = identity.getSetting( 'general.tags', [] );
    return tags.length > 0 ? tags : [ "TODO" ];
}

function shouldSortTagsOnlyViewAlphabetically()
{
    return identity.getSetting( 'tree.sortTagsOnlyViewAlphabetically', false );
}

function labelFormat()
{
    return identity.getSetting( 'tree.labelFormat', "${tag} ${after}" );
}

function tooltipFormat()
{
    return identity.getSetting( 'tree.tooltipFormat', "${filepath}, line ${line}" );
}

function clickingStatusBarShouldRevealTree()
{
    return identity.getSetting( 'general.statusBarClickBehaviour', "reveal" ) === "reveal";
}

function clickingStatusBarShouldToggleHighlights()
{
    return identity.getSetting( 'general.statusBarClickBehaviour', "reveal" ) === "toggle highlights";
}

function isValidScheme( uri )
{
    var schemes = identity.getSetting( 'general.schemes', [] );
    return uri && uri.scheme && schemes && schemes.length && schemes.indexOf( uri.scheme ) !== -1;
}

function shouldUseBuiltInFileExcludes()
{
    var useBuiltInExcludes = identity.getSetting( 'filtering.useBuiltInExcludes', "none" );
    return useBuiltInExcludes === "file exclude" || useBuiltInExcludes === "file and search excludes";
}

function shouldUseBuiltInSearchExcludes()
{
    var useBuiltInExcludes = identity.getSetting( 'filtering.useBuiltInExcludes', "none" );
    return useBuiltInExcludes === "search excludes" || useBuiltInExcludes === "file and search excludes";
}

function shouldIgnoreGitSubmodules()
{
    return identity.getSetting( 'filtering.ignoreGitSubmodules', false );
}

function refreshTagGroupLookup()
{
    var tagGroups = identity.getSetting( 'general.tagGroups', {} );
    tagGroupLookup = Object.keys( tagGroups ).reduce( ( acc, propName ) =>
        tagGroups[ propName ].reduce( ( a, num ) =>
        {
            a[ num ] = propName;
            return a;
        }, acc ), {} );
}

function tagGroup( tag )
{
    return tagGroupLookup[ tag ];
}

function shouldCompactFolders()
{
    return vscode.workspace.getConfiguration( 'explorer' ).compactFolders &&
        identity.getSetting( 'tree.disableCompactFolders', false ) !== true;
}

function shouldHideFromTree( tag )
{
    return attributes.getAttribute( tag, 'hideFromTree', false );
}

function shouldHideFromStatusBar( tag )
{
    return attributes.getAttribute( tag, 'hideFromStatusBar', false );
}

function shouldHideFromActivityBar( tag )
{
    return attributes.getAttribute( tag, 'hideFromActivityBar', false );
}

function shouldSortTree()
{
    return identity.getSetting( 'tree.sort', true );
}

function scanMode()
{
    return identity.getSetting( 'tree.scanMode', 'workspace' );
}

function shouldShowScanModeInTree()
{
    return identity.getSetting( 'tree.showCurrentScanMode', true );
}

function shouldUseColourScheme()
{
    return identity.getSetting( 'highlights.useColourScheme', false );
}

function foregroundColourScheme()
{
    return identity.getSetting( 'highlights.foregroundColourScheme', [] );
}

function backgroundColourScheme()
{
    return identity.getSetting( 'highlights.backgroundColourScheme', [] );
}

function defaultHighlight()
{
    return identity.getSetting( 'highlights.defaultHighlight', {} );
}

function customHighlight()
{
    return identity.getSetting( 'highlights.customHighlight', {} );
}

function subTagClickUrl()
{
    return identity.getSetting( 'tree.subTagClickUrl', "" );
}

function shouldShowIconsInsteadOfTagsInStatusBar()
{
    return identity.getSetting( 'general.showIconsInsteadOfTagsInStatusBar', false );
}

function shouldShowActivityBarBadge()
{
    return identity.getSetting( 'general.showActivityBarBadge', false );
}

module.exports.init = init;
module.exports.shouldGroupByTag = shouldGroupByTag;
module.exports.shouldGroupBySubTag = shouldGroupBySubTag;
module.exports.shouldExpand = shouldExpand;
module.exports.shouldFlatten = shouldFlatten;
module.exports.shouldShowTagsOnly = shouldShowTagsOnly;
module.exports.shouldShowCounts = shouldShowCounts;
module.exports.shouldHideIconsWhenGroupedByTag = shouldHideIconsWhenGroupedByTag;
module.exports.showFilterCaseSensitive = showFilterCaseSensitive;
module.exports.isRegexCaseSensitive = isRegexCaseSensitive;
module.exports.showBadges = showBadges;
module.exports.regex = regex;
module.exports.subTagRegex = subTagRegex;
module.exports.ripgrepPath = ripgrepPath;
module.exports.tags = tags;
module.exports.shouldSortTagsOnlyViewAlphabetically = shouldSortTagsOnlyViewAlphabetically;
module.exports.labelFormat = labelFormat;
module.exports.tooltipFormat = tooltipFormat;
module.exports.clickingStatusBarShouldRevealTree = clickingStatusBarShouldRevealTree;
module.exports.clickingStatusBarShouldToggleHighlights = clickingStatusBarShouldToggleHighlights;
module.exports.isValidScheme = isValidScheme;
module.exports.shouldIgnoreGitSubmodules = shouldIgnoreGitSubmodules;
module.exports.refreshTagGroupLookup = refreshTagGroupLookup;
module.exports.tagGroup = tagGroup;
module.exports.shouldCompactFolders = shouldCompactFolders;
module.exports.shouldUseBuiltInFileExcludes = shouldUseBuiltInFileExcludes;
module.exports.shouldUseBuiltInSearchExcludes = shouldUseBuiltInSearchExcludes;
module.exports.shouldHideFromTree = shouldHideFromTree;
module.exports.shouldHideFromStatusBar = shouldHideFromStatusBar;
module.exports.shouldHideFromActivityBar = shouldHideFromActivityBar;
module.exports.shouldSortTree = shouldSortTree;
module.exports.scanMode = scanMode;
module.exports.shouldShowScanModeInTree = shouldShowScanModeInTree;
module.exports.shouldUseColourScheme = shouldUseColourScheme;
module.exports.foregroundColourScheme = foregroundColourScheme;
module.exports.backgroundColourScheme = backgroundColourScheme;
module.exports.defaultHighlight = defaultHighlight;
module.exports.customHighlight = customHighlight;
module.exports.subTagClickUrl = subTagClickUrl;
module.exports.shouldShowIconsInsteadOfTagsInStatusBar = shouldShowIconsInsteadOfTagsInStatusBar;
module.exports.shouldShowActivityBarBadge = shouldShowActivityBarBadge;
module.exports.getTreeStateValue = getTreeStateValue;
module.exports.setTreeStateOverride = setTreeStateOverride;
module.exports.setTreeStateOverrides = setTreeStateOverrides;
