var vscode = require( 'vscode' );
var compatibility = require( './settingsCompatibility.js' );
var settingSchemas = compatibility.getSchemas( require( '../package.json' ) );

var CURRENT_NAMESPACE = compatibility.CURRENT_NAMESPACE;
var SOURCE_NAMESPACE = compatibility.SOURCE_NAMESPACE;
var explicitFields = [ 'globalValue', 'workspaceValue', 'workspaceFolderValue',
    'globalLanguageValue', 'workspaceLanguageValue', 'workspaceFolderLanguageValue' ];

var DISPLAY_NAME = 'Better Todo Tree';
var STATUS_SCAN_ICON = 'better-todo-tree';
var STATUS_SCAN_ICON_LABEL = '$(' + STATUS_SCAN_ICON + ')';
var STATUS_SCAN_SPIN_ICON_LABEL = '$(' + STATUS_SCAN_ICON + '~spin)';

var VIEW_CONTAINER_ID = 'todo-tree-container';
var VIEW_ID = 'todo-tree-view';
var EXPORT_SCHEME = 'better-todo-tree-export';

var commandSuffixes = [
    'showFlatView',
    'showTagsOnlyView',
    'showTreeView',
    'cycleViewStyle',
    'refresh',
    'expand',
    'collapse',
    'toggleTreeExpansion',
    'filter',
    'filterClear',
    'groupByTag',
    'ungroupByTag',
    'groupBySubTag',
    'ungroupBySubTag',
    'scanOpenFilesOnly',
    'scanCurrentFileOnly',
    'scanWorkspaceAndOpenFiles',
    'scanWorkspaceOnly',
    'addTag',
    'removeTag',
    'exportTree',
    'showOnlyThisFolder',
    'showOnlyThisFolderAndSubfolders',
    'switchScope',
    'excludeThisFolder',
    'excludeThisFile',
    'removeFilter',
    'resetAllFilters',
    'reveal',
    'resetCache',
    'toggleItemCounts',
    'toggleBadges',
    'toggleCompactFolders',
    'goToNext',
    'goToPrevious',
    'revealInFile',
    'openUrl',
    'stopScan',
    'openCurrentScanFile',
    'exportScanDiagnostics',
    'treeStateBusy',
    'scanBusy',
    'onStatusBarClicked',
    'importLegacySettings'
];

var contextSuffixes = [
    'show-reveal-button',
    'show-scan-mode-button',
    'show-view-style-button',
    'show-group-by-tag-button',
    'show-group-by-sub-tag-button',
    'show-filter-button',
    'show-refresh-button',
    'show-expand-button',
    'show-export-button',
    'expanded',
    'flat',
    'tags-only',
    'grouped-by-tag',
    'grouped-by-sub-tag',
    'filtered',
    'collapsible',
    'folder-filter-active',
    'global-filter-active',
    'can-toggle-compact-folders',
    'has-sub-tags',
    'scan-mode',
    'is-empty',
    'tree-state-busy',
    'view-style-busy',
    'expansion-busy',
    'grouping-busy',
    'scan-busy'
];

function buildCommandMap( namespace, suffixes )
{
    return Object.freeze( suffixes.reduce( function( commands, suffix )
    {
        commands[ suffix ] = namespace + '.' + suffix;
        return commands;
    }, {} ) );
}

function buildContextMap( namespace, suffixes )
{
    return Object.freeze( suffixes.reduce( function( contexts, suffix )
    {
        contexts[ suffix ] = namespace + '-' + suffix;
        return contexts;
    }, {} ) );
}

var COMMANDS = buildCommandMap( CURRENT_NAMESPACE, commandSuffixes );
var CONTEXT_KEYS = buildContextMap( CURRENT_NAMESPACE, contextSuffixes );

function getConfiguration( namespace, uri )
{
    return uri ? vscode.workspace.getConfiguration( namespace, uri ) : vscode.workspace.getConfiguration( namespace );
}

function inspectSetting( namespace, setting, uri )
{
    return getConfiguration( namespace, uri ).inspect( setting ) || {};
}

function inspectSettings( setting, uri )
{
    var sourceConfiguration = getConfiguration( SOURCE_NAMESPACE, uri );
    return {
        current: inspectSetting( CURRENT_NAMESPACE, setting, uri ),
        sources: compatibility.getSources( setting ).map( function( source )
        {
            return { name: source, inspection: sourceConfiguration.inspect( source ) || {} };
        } )
    };
}

function valueAtScope( setting, inspections, field )
{
    if( inspections.current[ field ] !== undefined ) { return inspections.current[ field ]; }
    var source = inspections.sources.find( function( entry )
    {
        return compatibility.accepts( entry.name, setting, entry.inspection[ field ], settingSchemas.get( setting ) );
    } );
    return source ? compatibility.convert( source.name, source.inspection[ field ] ) : undefined;
}

function getSetting( setting, defaultValue, uri )
{
    var inspections = inspectSettings( setting, uri );
    var result = inspections.current.defaultValue;
    var hasExplicit = false;
    explicitFields.forEach( function( field )
    {
        if( field === 'globalLanguageValue' && inspections.current.defaultLanguageValue !== undefined )
        {
            result = mergeSettingValue( result, inspections.current.defaultLanguageValue );
        }
        var value = valueAtScope( setting, inspections, field );
        if( value !== undefined )
        {
            result = mergeSettingValue( result, value );
            hasExplicit = true;
        }
    } );
    return hasExplicit ? result : getConfiguration( CURRENT_NAMESPACE, uri ).get( setting, defaultValue );
}

function mergeSettingValue( base, value )
{
    if( !base || !value || typeof base !== 'object' || typeof value !== 'object' ||
        Array.isArray( base ) || Array.isArray( value ) )
    {
        return value;
    }
    var result = Object.assign( Object.create( null ), base );
    Object.keys( value ).forEach( function( key )
    {
        result[ key ] = mergeSettingValue( result[ key ], value[ key ] );
    } );
    return result;
}

function getSettingTarget( setting, uri )
{
    var inspections = inspectSettings( setting, uri );
    for( var index = explicitFields.length - 1; index >= 0; index-- )
    {
        var field = explicitFields[ index ];
        if( valueAtScope( setting, inspections, field ) !== undefined )
        {
            return [ vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace,
                vscode.ConfigurationTarget.WorkspaceFolder ][ index % 3 ];
        }
    }
    return vscode.ConfigurationTarget.Global;
}

function updateSetting( setting, value, target, uri )
{
    return getConfiguration( CURRENT_NAMESPACE, uri ).update( setting, value, target );
}

function affectsNamespace( event, namespace )
{
    if( event.affectsConfiguration( namespace ) ) { return true; }
    if( namespace !== CURRENT_NAMESPACE && !namespace.startsWith( CURRENT_NAMESPACE + '.' ) ) { return false; }
    var suffix = namespace.substring( CURRENT_NAMESPACE.length );
    return event.affectsConfiguration( SOURCE_NAMESPACE + suffix ) ||
        Object.entries( compatibility.flatSettings ).some( function( entry )
        {
            return ( '.' + entry[ 1 ] ).startsWith( suffix + '.' ) &&
                event.affectsConfiguration( SOURCE_NAMESPACE + '.' + entry[ 0 ] );
        } );
}

function affectsSetting( event, setting )
{
    return event.affectsConfiguration( CURRENT_NAMESPACE + '.' + setting ) ||
        compatibility.getSources( setting ).some( function( source )
        {
            return event.affectsConfiguration( SOURCE_NAMESPACE + '.' + source );
        } );
}

function getManifestSettingSuffixes( packageJson )
{
    return Array.from( compatibility.getSchemas( packageJson ).keys() );
}

module.exports.CURRENT_NAMESPACE = CURRENT_NAMESPACE;
module.exports.SOURCE_NAMESPACE = SOURCE_NAMESPACE;
module.exports.DISPLAY_NAME = DISPLAY_NAME;
module.exports.STATUS_SCAN_ICON = STATUS_SCAN_ICON;
module.exports.STATUS_SCAN_ICON_LABEL = STATUS_SCAN_ICON_LABEL;
module.exports.STATUS_SCAN_SPIN_ICON_LABEL = STATUS_SCAN_SPIN_ICON_LABEL;
module.exports.VIEW_CONTAINER_ID = VIEW_CONTAINER_ID;
module.exports.VIEW_ID = VIEW_ID;
module.exports.EXPORT_SCHEME = EXPORT_SCHEME;
module.exports.COMMANDS = COMMANDS;
module.exports.CONTEXT_KEYS = CONTEXT_KEYS;
module.exports.getConfiguration = getConfiguration;
module.exports.inspectSetting = inspectSetting;
module.exports.getSetting = getSetting;
module.exports.getSettingTarget = getSettingTarget;
module.exports.updateSetting = updateSetting;
module.exports.affectsNamespace = affectsNamespace;
module.exports.affectsSetting = affectsSetting;
module.exports.getManifestSettingSuffixes = getManifestSettingSuffixes;
