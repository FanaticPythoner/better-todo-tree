var fs = require( 'fs' );
var path = require( 'path' );
var languageMatrix = require( './languageMatrix.js' );

function readPackageJson()
{
    return JSON.parse( fs.readFileSync( path.join( __dirname, '..', 'package.json' ), 'utf8' ) );
}

function readPackageNls( fileName )
{
    return JSON.parse( fs.readFileSync( path.join( __dirname, '..', fileName ), 'utf8' ) );
}

function getConfigurationProperty( propertyName )
{
    return languageMatrix.findConfigurationProperty( propertyName );
}

QUnit.module( 'package manifest' );

QUnit.test( 'stable hidden view ids are preserved while the public namespace is rebranded', function( assert )
{
    var packageJson = readPackageJson();
    var activityView = packageJson.contributes.viewsContainers.activitybar[ 0 ];
    var treeView = packageJson.contributes.views[ 'todo-tree-container' ][ 0 ];

    assert.equal( activityView.id, 'todo-tree-container' );
    assert.equal( treeView.id, 'todo-tree-view' );
    assert.equal( treeView.when, '!better-todo-tree-is-empty' );
} );

QUnit.test( 'public commands use the better-todo-tree namespace', function( assert )
{
    var packageJson = readPackageJson();
    var commands = packageJson.contributes.commands.map( function( entry )
    {
        return entry.command;
    } );

    assert.ok( commands.indexOf( 'better-todo-tree.showTreeView' ) !== -1 );
    assert.ok( commands.indexOf( 'better-todo-tree.importLegacySettings' ) !== -1 );
    assert.ok( commands.indexOf( 'todo-tree.showTreeView' ) === -1 );
} );

QUnit.test( 'legacy settings remain present and deprecated', function( assert )
{
    var currentSetting = getConfigurationProperty( 'better-todo-tree.general.tags' );
    var legacySetting = getConfigurationProperty( 'todo-tree.general.tags' );

    assert.ok( currentSetting );
    assert.ok( legacySetting );
    assert.equal( legacySetting.deprecationMessage, '%todo-tree.configuration.legacyNamespace.deprecationMessage%' );
    assert.equal( legacySetting.markdownDeprecationMessage, '%todo-tree.configuration.legacyNamespace.markdownDeprecationMessage%' );
} );

QUnit.test( 'issue #905 filtering defaults keep Go files included without any file-type allowlist', function( assert )
{
    var currentIncludeGlobs = getConfigurationProperty( 'better-todo-tree.filtering.includeGlobs' );
    var legacyIncludeGlobs = getConfigurationProperty( 'todo-tree.filtering.includeGlobs' );
    var currentExcludeGlobs = getConfigurationProperty( 'better-todo-tree.filtering.excludeGlobs' );
    var legacyExcludeGlobs = getConfigurationProperty( 'todo-tree.filtering.excludeGlobs' );

    assert.deepEqual( currentIncludeGlobs.default, [] );
    assert.deepEqual( legacyIncludeGlobs.default, [] );
    assert.deepEqual( currentExcludeGlobs.default, [ '**/node_modules/*/**' ] );
    assert.deepEqual( legacyExcludeGlobs.default, [ '**/node_modules/*/**' ] );
} );

QUnit.test( 'issue #883 notebook scanning keeps vscode-notebook-cell enabled in the default schemes list', function( assert )
{
    var currentSchemes = getConfigurationProperty( 'better-todo-tree.general.schemes' );
    var legacySchemes = getConfigurationProperty( 'todo-tree.general.schemes' );

    assert.ok( currentSchemes.default.indexOf( 'vscode-notebook-cell' ) !== -1 );
    assert.ok( legacySchemes.default.indexOf( 'vscode-notebook-cell' ) !== -1 );
} );

QUnit.test( 'context menus target stable todo-tree views with rebranded context keys', function( assert )
{
    var packageJson = readPackageJson();
    var menuEntry = packageJson.contributes.menus[ 'view/item/context' ].find( function( entry )
    {
        return entry.command === 'better-todo-tree.showTreeView';
    } );

    assert.equal( menuEntry.when, "view =~ /todo-tree/ && (better-todo-tree-flat == true || better-todo-tree-tags-only == true)" );
} );

QUnit.test( 'view title busy placeholders are scoped to the active control instead of duplicating across the whole title bar', function( assert )
{
    var packageJson = readPackageJson();
    var titleMenu = packageJson.contributes.menus[ 'view/title' ];
    var scanBusyEntries = titleMenu.filter( function( entry )
    {
        return entry.command === 'better-todo-tree.scanBusy';
    } );
    var cycleViewStyleEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.cycleViewStyle';
    } );
    var viewBusyEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy' && entry.group === 'navigation@4';
    } );
    var expandBusyEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy' && entry.group === 'navigation@9';
    } );
    var groupingBusyEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy' && entry.group === 'navigation@5' && entry.when.indexOf( 'better-todo-tree-grouping-busy == true' ) >= 0;
    } );
    var groupByTagEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.groupByTag';
    } );
    var groupBySubTagEntry = titleMenu.find( function( entry )
    {
        return entry.command === 'better-todo-tree.groupBySubTag';
    } );

    assert.equal( scanBusyEntries.length, 1 );
    assert.equal( scanBusyEntries[ 0 ].group, 'navigation@8' );
    assert.ok( cycleViewStyleEntry.when.indexOf( 'better-todo-tree-view-style-busy == false' ) >= 0 );
    assert.ok( viewBusyEntry.when.indexOf( 'better-todo-tree-view-style-busy == true' ) >= 0 );
    assert.ok( expandBusyEntry.when.indexOf( 'better-todo-tree-expansion-busy == true' ) >= 0 );
    assert.ok( groupingBusyEntry.when.indexOf( 'better-todo-tree-grouping-busy == true' ) >= 0 );
    assert.ok( groupByTagEntry.when.indexOf( 'better-todo-tree-grouping-busy == false' ) >= 0 );
    assert.ok( groupBySubTagEntry.when.indexOf( 'better-todo-tree-grouping-busy == false' ) >= 0 );
} );

QUnit.test( 'busy and composite tree commands have localization entries in both english and zh-cn bundles', function( assert )
{
    var english = readPackageNls( 'package.nls.json' );
    var chinese = readPackageNls( 'package.nls.zh-cn.json' );
    var requiredKeys = [
        'better-todo-tree.command.cycleViewStyle.title',
        'better-todo-tree.command.toggleTreeExpansion.title',
        'better-todo-tree.command.scanBusy.title',
        'better-todo-tree.command.treeStateBusy.title'
    ];

    requiredKeys.forEach( function( key )
    {
        assert.equal( typeof english[ key ], 'string', 'english bundle contains ' + key );
        assert.equal( typeof chinese[ key ], 'string', 'zh-cn bundle contains ' + key );
    } );

    assert.notOk( english[ 'better-todo-tree.command.scanBusy.title' ].indexOf( '$(' ) >= 0 );
    assert.notOk( english[ 'better-todo-tree.command.treeStateBusy.title' ].indexOf( '$(' ) >= 0 );
    assert.notOk( chinese[ 'better-todo-tree.command.scanBusy.title' ].indexOf( '$(' ) >= 0 );
    assert.notOk( chinese[ 'better-todo-tree.command.treeStateBusy.title' ].indexOf( '$(' ) >= 0 );
} );

QUnit.test( 'busy placeholder commands use spinner icons with plain localized titles', function( assert )
{
    var packageJson = readPackageJson();
    var treeStateBusy = packageJson.contributes.commands.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy';
    } );
    var scanBusy = packageJson.contributes.commands.find( function( entry )
    {
        return entry.command === 'better-todo-tree.scanBusy';
    } );

    assert.equal( treeStateBusy.icon, '$(loading~spin)' );
    assert.equal( scanBusy.icon, '$(loading~spin)' );
    assert.equal( treeStateBusy.title, '%better-todo-tree.command.treeStateBusy.title%' );
    assert.equal( scanBusy.title, '%better-todo-tree.command.scanBusy.title%' );
} );
