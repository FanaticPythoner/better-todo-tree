var vscode = require( 'vscode' );

var CURRENT_NAMESPACE = 'better-todo-tree';
var LEGACY_NAMESPACE = 'todo-tree';

var DISPLAY_NAME = 'Better Todo Tree';
var LEGACY_DISPLAY_NAME = 'Todo Tree';

var VIEW_CONTAINER_ID = 'todo-tree-container';
var VIEW_ID = 'todo-tree-view';
var EXPORT_SCHEME = 'better-todo-tree-export';
var LEGACY_EXPORT_SCHEME = 'todotree-export';

var commandSuffixes = [
    'showFlatView',
    'showTagsOnlyView',
    'showTreeView',
    'refresh',
    'expand',
    'collapse',
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
    'onStatusBarClicked',
    'importLegacySettings'
];

var legacyCommandSuffixes = commandSuffixes.filter( function( suffix )
{
    return suffix !== 'importLegacySettings';
} );

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
    'is-empty'
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
var LEGACY_COMMANDS = buildCommandMap( LEGACY_NAMESPACE, legacyCommandSuffixes );
var CONTEXT_KEYS = buildContextMap( CURRENT_NAMESPACE, contextSuffixes );
var LEGACY_CONTEXT_KEYS = buildContextMap( LEGACY_NAMESPACE, contextSuffixes );

var COMMAND_ALIAS_MAP = Object.freeze( legacyCommandSuffixes.reduce( function( aliases, suffix )
{
    aliases[ LEGACY_COMMANDS[ suffix ] ] = COMMANDS[ suffix ];
    return aliases;
}, {} ) );

function getConfiguration( namespace, uri )
{
    return uri ? vscode.workspace.getConfiguration( namespace, uri ) : vscode.workspace.getConfiguration( namespace );
}

function inspectSetting( namespace, setting, uri )
{
    return getConfiguration( namespace, uri ).inspect( setting ) || {};
}

function hasExplicitValue( inspection )
{
    return inspection &&
        ( inspection.workspaceFolderValue !== undefined ||
        inspection.workspaceValue !== undefined ||
        inspection.globalValue !== undefined );
}

function getSetting( setting, defaultValue, uri )
{
    var currentInspection = inspectSetting( CURRENT_NAMESPACE, setting, uri );
    if( hasExplicitValue( currentInspection ) )
    {
        return getConfiguration( CURRENT_NAMESPACE, uri ).get( setting, defaultValue );
    }

    var legacyInspection = inspectSetting( LEGACY_NAMESPACE, setting, uri );
    if( hasExplicitValue( legacyInspection ) )
    {
        return getConfiguration( LEGACY_NAMESPACE, uri ).get( setting, defaultValue );
    }

    return getConfiguration( CURRENT_NAMESPACE, uri ).get( setting, defaultValue );
}

function getCurrentSetting( setting, defaultValue, uri )
{
    return getConfiguration( CURRENT_NAMESPACE, uri ).get( setting, defaultValue );
}

function getLegacySetting( setting, defaultValue, uri )
{
    return getConfiguration( LEGACY_NAMESPACE, uri ).get( setting, defaultValue );
}

function getSettingTarget( setting, uri )
{
    var currentInspection = inspectSetting( CURRENT_NAMESPACE, setting, uri );
    if( currentInspection.workspaceFolderValue !== undefined )
    {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if( currentInspection.workspaceValue !== undefined )
    {
        return vscode.ConfigurationTarget.Workspace;
    }
    if( currentInspection.globalValue !== undefined )
    {
        return vscode.ConfigurationTarget.Global;
    }

    var legacyInspection = inspectSetting( LEGACY_NAMESPACE, setting, uri );
    if( legacyInspection.workspaceFolderValue !== undefined )
    {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if( legacyInspection.workspaceValue !== undefined )
    {
        return vscode.ConfigurationTarget.Workspace;
    }
    if( legacyInspection.globalValue !== undefined )
    {
        return vscode.ConfigurationTarget.Global;
    }

    return vscode.ConfigurationTarget.Global;
}

function updateSetting( setting, value, target, uri )
{
    return getConfiguration( CURRENT_NAMESPACE, uri ).update( setting, value, target );
}

function affectsNamespace( event, namespace )
{
    return event.affectsConfiguration( namespace );
}

function affectsSetting( event, setting )
{
    return event.affectsConfiguration( CURRENT_NAMESPACE + '.' + setting ) ||
        event.affectsConfiguration( LEGACY_NAMESPACE + '.' + setting );
}

function getManifestSettingSuffixes( packageJson )
{
    var configurationGroups = packageJson &&
        packageJson.contributes &&
        Array.isArray( packageJson.contributes.configuration ) ?
        packageJson.contributes.configuration :
        [];

    var prefix = CURRENT_NAMESPACE + '.';

    return configurationGroups.reduce( function( settings, group )
    {
        Object.keys( group.properties || {} ).forEach( function( key )
        {
            if( key.indexOf( prefix ) === 0 )
            {
                settings.push( key.substring( prefix.length ) );
            }
        } );

        return settings;
    }, [] );
}

module.exports.CURRENT_NAMESPACE = CURRENT_NAMESPACE;
module.exports.LEGACY_NAMESPACE = LEGACY_NAMESPACE;
module.exports.DISPLAY_NAME = DISPLAY_NAME;
module.exports.LEGACY_DISPLAY_NAME = LEGACY_DISPLAY_NAME;
module.exports.VIEW_CONTAINER_ID = VIEW_CONTAINER_ID;
module.exports.VIEW_ID = VIEW_ID;
module.exports.EXPORT_SCHEME = EXPORT_SCHEME;
module.exports.LEGACY_EXPORT_SCHEME = LEGACY_EXPORT_SCHEME;
module.exports.COMMANDS = COMMANDS;
module.exports.LEGACY_COMMANDS = LEGACY_COMMANDS;
module.exports.CONTEXT_KEYS = CONTEXT_KEYS;
module.exports.LEGACY_CONTEXT_KEYS = LEGACY_CONTEXT_KEYS;
module.exports.COMMAND_ALIAS_MAP = COMMAND_ALIAS_MAP;
module.exports.getConfiguration = getConfiguration;
module.exports.inspectSetting = inspectSetting;
module.exports.hasExplicitValue = hasExplicitValue;
module.exports.getSetting = getSetting;
module.exports.getCurrentSetting = getCurrentSetting;
module.exports.getLegacySetting = getLegacySetting;
module.exports.getSettingTarget = getSettingTarget;
module.exports.updateSetting = updateSetting;
module.exports.affectsNamespace = affectsNamespace;
module.exports.affectsSetting = affectsSetting;
module.exports.getManifestSettingSuffixes = getManifestSettingSuffixes;
