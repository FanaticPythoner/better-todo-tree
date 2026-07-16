var fs = require( 'fs' );
var path = require( 'path' );
var languageMatrix = require( './languageMatrix.js' );
var regexRegistry = require( '../src/regexRegistry.js' );

function readPackageJson()
{
    return JSON.parse( fs.readFileSync( path.join( __dirname, '..', 'package.json' ), 'utf8' ) );
}

function readPackageNls( fileName )
{
    return JSON.parse( fs.readFileSync( path.join( __dirname, '..', fileName ), 'utf8' ) );
}

function readRepositoryFile( fileName )
{
    return fs.readFileSync( path.join( __dirname, '..', fileName ) );
}

function occurrenceCount( text, value )
{
    return text.split( value ).length - 1;
}

function circleRadii( svg, centerX, centersY )
{
    var radii = [];

    centersY.forEach( function( centerY )
    {
        var marker = '<circle cx="' + centerX + '" cy="' + centerY + '" r="';
        var markerStart = svg.indexOf( marker );

        while( markerStart !== -1 )
        {
            var radiusStart = markerStart + marker.length;
            var radiusEnd = svg.indexOf( '"', radiusStart );

            radii.push( Number( svg.slice( radiusStart, radiusEnd ) ) );
            markerStart = svg.indexOf( marker, radiusEnd );
        }
    } );

    return radii;
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

QUnit.test( 'Marketplace presentation states independent fork identity consistently', function( assert )
{
    var expectedDescription = 'An independent, actively maintained fork of Todo Tree for VS Code: the familiar workflow, major new features, active fixes, benchmarked speedups of up to 696×, and modern compatibility.';
    var expectedScreenshot = '![screenshot](https://raw.githubusercontent.com/FanaticPythoner/better-todo-tree/master/resources/screenshot.png)';
    var packageJson = readPackageJson();
    var packageLock = JSON.parse( readRepositoryFile( 'package-lock.json' ).toString( 'utf8' ) );
    var readme = readRepositoryFile( 'README.md' ).toString( 'utf8' );
    var provenance = readRepositoryFile( 'ARTWORK-PROVENANCE.md' ).toString( 'utf8' );

    assert.equal( packageJson.description, expectedDescription );
    assert.equal( packageJson.description.length, 185 );
    assert.equal( packageJson.name, 'better-todo-tree' );
    assert.equal( packageJson.displayName, 'Better Todo Tree' );
    assert.equal( packageJson.publisher, 'FanaticPythoner' );
    assert.equal( packageJson.repository, 'https://github.com/FanaticPythoner/better-todo-tree' );
    assert.equal( packageJson.bugs.url, 'https://github.com/FanaticPythoner/better-todo-tree/issues' );
    assert.equal( packageJson.homepage, 'https://bettertodotree.com' );
    assert.equal( packageLock.version, packageJson.version );
    assert.equal( packageLock.packages[ '' ].version, packageJson.version );
    assert.ok( readme.indexOf( '**' + expectedDescription + '**' ) !== -1 );
    assert.ok( readme.indexOf( 'not affiliated with, endorsed by, or published by Gruntfuggly' ) !== -1 );
    assert.ok( readme.indexOf( '**Migration Ready 🤝:** Familiar workflow.' ) !== -1 );
    assert.ok( readme.indexOf( '**Major Features & Bulletproof Fixes 🛠️:** Complete notebook scanning, embedded Vue/Svelte/Astro support' ) !== -1 );
    assert.ok( readme.indexOf( '**Alive & Active 💖:** Keeping this project alive' ) !== -1 );
    assert.equal( readme.indexOf( 'I took over to modernize the core' ), -1 );
    assert.equal( readme.indexOf( 'drop-in replacement fork of Todo Tree' ), -1 );
    assert.equal( occurrenceCount( readme, expectedScreenshot ), 1 );
    assert.ok( readme.indexOf( '| **Custom Highlight Configs** | 1,391.93 ms | 2.00 ms | **696.0X** 🚀 |' ) !== -1 );
    assert.ok( readme.indexOf( '| **Custom Regex Workspace Refreshes** | 36.72 ms | 3.76 ms | **9.8X** 🚀 |' ) !== -1 );
    assert.ok( readme.indexOf( '[ARTWORK-PROVENANCE.md](ARTWORK-PROVENANCE.md)' ) !== -1 );
    assert.equal( readme.indexOf( 'Main icons originally made by [Freepik]' ), -1 );
    assert.ok( readme.indexOf( 'Tree view icons made by [Vaadin]' ) !== -1 );
    assert.ok( provenance.indexOf( 'original project artwork' ) !== -1 );
    assert.ok( provenance.indexOf( '`resources/better-todo-tree-logo.svg` | Full-color vector master' ) !== -1 );
} );

QUnit.test( 'issue #106 sidebar tree view activates on direct view demand', function( assert )
{
    var activationEvents = readPackageJson().activationEvents;

    assert.ok( activationEvents.indexOf( 'onView:todo-tree-view' ) !== -1 );
    assert.ok( activationEvents.indexOf( 'onStartupFinished' ) !== -1 );
} );

QUnit.test( 'scan progress contributes the Better Todo Tree product icon font', function( assert )
{
    var packageJson = readPackageJson();
    var english = readPackageNls( 'package.nls.json' );
    var chinese = readPackageNls( 'package.nls.zh-cn.json' );
    var productIcon = packageJson.contributes.icons[ 'better-todo-tree' ];
    var iconDefault = productIcon.default;
    var fontPath = path.join( __dirname, '..', iconDefault.fontPath );

    assert.equal( productIcon.description, '%better-todo-tree.productIcon.description%' );
    assert.equal( iconDefault.fontPath, './resources/product-icons/better-todo-tree.woff' );
    assert.equal( iconDefault.fontCharacter, '\\EA01' );
    assert.equal( fs.existsSync( fontPath ), true );
    assert.equal( fs.statSync( fontPath ).size > 0, true );
    assert.equal( english[ 'better-todo-tree.productIcon.description' ], 'Better Todo Tree status icon' );
    assert.equal( typeof chinese[ 'better-todo-tree.productIcon.description' ], 'string' );
} );

QUnit.test( 'brand icons use two equal circular status badges', function( assert )
{
    var marketplaceIcon = readRepositoryFile( 'resources/better-todo-tree.png' );
    var marketplaceScreenshot = readRepositoryFile( 'resources/screenshot.png' );
    var logoSource = readRepositoryFile( 'resources/better-todo-tree-logo.svg' ).toString( 'utf8' );
    var containerIcon = readRepositoryFile( 'resources/better-todo-tree-container.svg' ).toString( 'utf8' );
    var productIcon = readRepositoryFile( 'resources/product-icons/better-todo-tree.svg' ).toString( 'utf8' );

    assert.equal( marketplaceIcon.readUInt32BE( 16 ), 128 );
    assert.equal( marketplaceIcon.readUInt32BE( 20 ), 128 );
    assert.equal( marketplaceScreenshot.readUInt32BE( 16 ), 2561 );
    assert.equal( marketplaceScreenshot.readUInt32BE( 20 ), 1594 );
    assert.deepEqual( circleRadii( logoSource, '98', [ '28', '67' ] ), [ 18, 14, 18, 14 ] );
    assert.deepEqual( circleRadii( containerIcon, '19', [ '5.1', '14.35' ] ), [ 4, 4 ] );
    assert.deepEqual( circleRadii( productIcon, '19', [ '5.1', '14.35' ] ), [ 4, 4 ] );
    assert.ok( containerIcon.indexOf( 'm16.8 5.1 1.45 1.45 2.95-3.35' ) !== -1 );
    assert.ok( containerIcon.indexOf( 'M16.2 14.35h2.2' ) !== -1 );
    assert.ok( productIcon.indexOf( 'm16.8 5.1 1.45 1.45 2.95-3.35' ) !== -1 );
    assert.ok( productIcon.indexOf( 'M16.2 14.35h2.2' ) !== -1 );
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

QUnit.test( 'prepublish builds are deterministic and codicon updates are explicit', function( assert )
{
    var scripts = readPackageJson().scripts;

    assert.equal( scripts[ 'vscode:prepublish' ], 'webpack --mode production' );
    assert.equal( scripts[ 'codicons:update' ], 'node ./buildCodiconNames.js' );
    assert.equal( scripts[ 'vscode:prepublish' ].indexOf( 'buildCodiconNames' ), -1 );
} );

QUnit.test( 'generated codicon table stores aliases instead of codepoints', function( assert )
{
    var codiconNames = require( '../src/codiconNames.js' );

    assert.ok( codiconNames.indexOf( 'bug' ) !== -1 );
    assert.ok( codiconNames.indexOf( 'flame' ) !== -1 );
    assert.ok( codiconNames.indexOf( 'pulse' ) !== -1 );
    assert.notOk( codiconNames.some( function( name )
    {
        return regexRegistry.createRegExp( 'digitsOnly' ).test( name );
    } ) );
} );

QUnit.test( 'release packaging has the ripgrep-universal build dependency', function( assert )
{
    var packageJson = readPackageJson();

    assert.equal( packageJson.devDependencies[ '@vscode/ripgrep-universal' ], '^1.18.0' );
} );

QUnit.test( 'regex defaults are generated by the shared registry', function( assert )
{
    var currentRegex = getConfigurationProperty( 'better-todo-tree.regex.regex' );
    var legacyRegex = getConfigurationProperty( 'todo-tree.regex.regex' );

    assert.equal( currentRegex.default, regexRegistry.DEFAULT_REGEX_SOURCE );
    assert.equal( legacyRegex.default, regexRegistry.DEFAULT_REGEX_SOURCE );
} );

QUnit.test( 'issue #58 highlight colour scheme is enabled by default', function( assert )
{
    var currentUseColourScheme = getConfigurationProperty( 'better-todo-tree.highlights.useColourScheme' );
    var legacyUseColourScheme = getConfigurationProperty( 'todo-tree.highlights.useColourScheme' );

    assert.strictEqual( currentUseColourScheme.default, true );
    assert.strictEqual( legacyUseColourScheme.default, true );
} );

QUnit.test( 'ripgrep executable setting documents packaged binary behavior', function( assert )
{
    var englishNls = readPackageNls( 'package.nls.json' );

    assert.equal(
        englishNls[ 'todo-tree.configuration.ripgrep.ripgrep.markdownDescription' ],
        'Custom ripgrep executable path. Empty value uses the packaged ripgrep binary.'
    );
    assert.equal(
        englishNls[ 'better-todo-tree.configuration.ripgrep.ripgrep.markdownDescription' ],
        'Custom ripgrep executable path. Empty value uses the packaged ripgrep binary.'
    );
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

QUnit.test( 'issue #57 and #77 scanning progress setting defaults to status bar only', function( assert )
{
    var currentProgress = getConfigurationProperty( 'better-todo-tree.general.showScanningProgress' );
    var legacyProgress = getConfigurationProperty( 'todo-tree.general.showScanningProgress' );
    var expectedModes = [ 'none', 'status bar', 'notification', 'tree', 'all' ];
    var english = readPackageNls( 'package.nls.json' );
    var chinese = readPackageNls( 'package.nls.zh-cn.json' );

    assert.equal( currentProgress.default, 'status bar' );
    assert.equal( legacyProgress.default, 'status bar' );
    assert.deepEqual( currentProgress.enum, expectedModes );
    assert.deepEqual( legacyProgress.enum, expectedModes );
    assert.equal( legacyProgress.deprecationMessage, '%todo-tree.configuration.legacyNamespace.deprecationMessage%' );
    assert.equal( typeof english[ 'better-todo-tree.configuration.general.showScanningProgress.markdownDescription' ], 'string' );
    assert.equal( typeof chinese[ 'better-todo-tree.configuration.general.showScanningProgress.markdownDescription' ], 'string' );
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

QUnit.test( 'issue #59 view title expansion control swaps icon commands by expanded context', function( assert )
{
    var packageJson = readPackageJson();
    var titleMenu = packageJson.contributes.menus[ 'view/title' ];
    var expansionEntries = titleMenu.filter( function( entry )
    {
        return entry.group === 'navigation@9' &&
            (
                entry.command === 'better-todo-tree.expand' ||
                entry.command === 'better-todo-tree.collapse' ||
                entry.command === 'better-todo-tree.toggleTreeExpansion'
            );
    } );
    var commands = packageJson.contributes.commands.reduce( function( byName, entry )
    {
        byName[ entry.command ] = entry;
        return byName;
    }, {} );

    assert.deepEqual( expansionEntries.map( function( entry ) { return entry.command; } ), [
        'better-todo-tree.expand',
        'better-todo-tree.collapse'
    ] );
    assert.equal( expansionEntries[ 0 ].when, "view =~ /todo-tree/ && better-todo-tree-show-expand-button == true && better-todo-tree-collapsible == true && better-todo-tree-expanded == false && better-todo-tree-expansion-busy == false" );
    assert.equal( expansionEntries[ 1 ].when, "view =~ /todo-tree/ && better-todo-tree-show-expand-button == true && better-todo-tree-collapsible == true && better-todo-tree-expanded == true && better-todo-tree-expansion-busy == false" );
    assert.equal( commands[ 'better-todo-tree.expand' ].icon, '$(expand-all)' );
    assert.equal( commands[ 'better-todo-tree.collapse' ].icon, '$(collapse-all)' );
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

QUnit.test( 'busy placeholder commands use static product icons with plain localized titles', function( assert )
{
    var packageJson = readPackageJson();
    var busyIcon = {
        light: 'resources/button-icons/refresh-spin-light.svg',
        dark: 'resources/button-icons/refresh-spin-dark.svg'
    };
    var treeStateBusy = packageJson.contributes.commands.find( function( entry )
    {
        return entry.command === 'better-todo-tree.treeStateBusy';
    } );
    var scanBusy = packageJson.contributes.commands.find( function( entry )
    {
        return entry.command === 'better-todo-tree.scanBusy';
    } );

    assert.deepEqual( treeStateBusy.icon, busyIcon );
    assert.deepEqual( scanBusy.icon, busyIcon );
    assert.equal( treeStateBusy.icon.light.indexOf( '~spin' ), -1 );
    assert.equal( treeStateBusy.icon.dark.indexOf( '~spin' ), -1 );
    assert.equal( scanBusy.icon.light.indexOf( '~spin' ), -1 );
    assert.equal( scanBusy.icon.dark.indexOf( '~spin' ), -1 );
    assert.equal( treeStateBusy.title, '%better-todo-tree.command.treeStateBusy.title%' );
    assert.equal( scanBusy.title, '%better-todo-tree.command.scanBusy.title%' );
} );

QUnit.test( 'showBadges metadata documents file icon theme coupling', function( assert )
{
    var english = readPackageNls( 'package.nls.json' );
    var chinese = readPackageNls( 'package.nls.zh-cn.json' );

    assert.ok( english[ 'better-todo-tree.configuration.tree.showBadges.markdownDescription' ].indexOf( 'file icon theme resources' ) >= 0 );
    assert.ok( english[ 'todo-tree.configuration.tree.showBadges.markdownDescription' ].indexOf( 'file icon theme resources' ) >= 0 );
    assert.ok( chinese[ 'better-todo-tree.configuration.tree.showBadges.markdownDescription' ].indexOf( '文件图标主题资源' ) >= 0 );
    assert.ok( chinese[ 'todo-tree.configuration.tree.showBadges.markdownDescription' ].indexOf( '文件图标主题资源' ) >= 0 );
} );
