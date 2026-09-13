'use strict';

var CURRENT_NAMESPACE = 'better-todo-tree';
var SOURCE_NAMESPACE = 'todo-tree';
var flatSettings = Object.freeze( {
    autoRefresh: 'tree.autoRefresh', customHighlight: 'highlights.customHighlight',
    debug: 'general.debug', defaultHighlight: 'highlights.defaultHighlight',
    excludedWorkspaces: 'filtering.excludedWorkspaces', excludeGlobs: 'filtering.excludeGlobs',
    expanded: 'tree.expanded', filterCaseSensitive: 'tree.filterCaseSensitive',
    flat: 'tree.flat', grouped: 'tree.groupedByTag',
    hideIconsWhenGroupedByTag: 'tree.hideIconsWhenGroupedByTag', hideTreeWhenEmpty: 'tree.hideTreeWhenEmpty',
    highlightDelay: 'highlights.highlightDelay', includedWorkspaces: 'filtering.includedWorkspaces',
    includeGlobs: 'filtering.includeGlobs', labelFormat: 'tree.labelFormat',
    passGlobsToRipgrep: 'filtering.passGlobsToRipgrep', regex: 'regex.regex',
    regexCaseSensitive: 'regex.regexCaseSensitive', revealBehaviour: 'general.revealBehaviour',
    ripgrep: 'ripgrep.ripgrep', ripgrepArgs: 'ripgrep.ripgrepArgs', rootFolder: 'general.rootFolder',
    showBadges: 'tree.showBadges', showCountsInTree: 'tree.showCountsInTree',
    sortTagsOnlyViewAlphabetically: 'tree.sortTagsOnlyViewAlphabetically', statusBar: 'general.statusBar',
    statusBarClickBehaviour: 'general.statusBarClickBehaviour', tags: 'general.tags',
    tagsOnly: 'tree.tagsOnly', trackFile: 'tree.trackFile', 'highlights.schemes': 'general.schemes',
    'tree.showScanOpenFilesOrWorkspaceButton': 'tree.buttons.scanMode',
    'tree.showTagsFromOpenFilesOnly': 'tree.scanMode'
} );
var sources = new Map();
Object.entries( flatSettings ).forEach( function( entry )
{
    var names = sources.get( entry[ 1 ] ) || [ entry[ 1 ] ];
    names.push( entry[ 0 ] );
    sources.set( entry[ 1 ], names );
} );

function getSources( setting )
{
    return sources.get( setting ) || [ setting ];
}

function getSchemas( packageJson )
{
    var prefix = CURRENT_NAMESPACE + '.';
    return new Map( packageJson.contributes.configuration.flatMap( function( group )
    {
        return Object.entries( group.properties ).filter( function( entry )
        {
            return entry[ 0 ].startsWith( prefix );
        } ).map( function( entry ) { return [ entry[ 0 ].substring( prefix.length ), entry[ 1 ] ]; } );
    } ) );
}

function convert( source, value )
{
    if( source === 'tree.showTagsFromOpenFilesOnly' )
    {
        return typeof value === 'boolean' ? ( value ? 'open files' : 'workspace' ) : undefined;
    }
    return value;
}

function accepts( source, destination, value, schema )
{
    if( value === undefined ) { return false; }
    if( source === destination ) { return true; }
    if( source === 'tree.showTagsFromOpenFilesOnly' ) { return typeof value === 'boolean'; }
    var type = Array.isArray( value ) ? 'array' : typeof value;
    return value !== null && schema && ( schema.type === type ||
        ( schema.type === 'integer' && Number.isInteger( value ) ) );
}

module.exports = { CURRENT_NAMESPACE, SOURCE_NAMESPACE, flatSettings, getSources, getSchemas, convert, accepts };
