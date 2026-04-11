var fs = require( 'fs' );
var path = require( 'path' );
var languageMatrix = require( './languageMatrix.js' );

function readPackageJson()
{
    return JSON.parse( fs.readFileSync( path.join( __dirname, '..', 'package.json' ), 'utf8' ) );
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
