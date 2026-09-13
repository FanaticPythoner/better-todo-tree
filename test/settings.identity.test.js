var helpers = require( './moduleHelpers.js' );
var packageJson = require( '../package.json' );

function createConfigurationSection( values, defaults )
{
    function getNestedValue( source, key )
    {
        return key.split( '.' ).reduce( function( current, part )
        {
            return current && current[ part ] !== undefined ? current[ part ] : undefined;
        }, source );
    }

    return {
        get: function( key, defaultValue )
        {
            var explicitValue = getNestedValue( values, key );
            if( explicitValue !== undefined )
            {
                return explicitValue;
            }

            var defaultSetting = getNestedValue( defaults, key );
            return defaultSetting === undefined ? defaultValue : defaultSetting;
        },
        inspect: function( key )
        {
            var explicitValue = getNestedValue( values, key );
            var defaultSetting = getNestedValue( defaults, key );

            return {
                defaultValue: defaultSetting,
                globalValue: explicitValue,
                workspaceValue: undefined,
                workspaceFolderValue: undefined
            };
        },
        update: function()
        {
            return Promise.resolve();
        }
    };
}

function createIdentity( currentValues, legacyValues, defaults )
{
    return helpers.loadWithStubs( '../src/extensionIdentity.js', {
        vscode: {
            ConfigurationTarget: {
                Global: 1,
                Workspace: 2,
                WorkspaceFolder: 3
            },
            workspace: {
                getConfiguration: function( section )
                {
                    if( section === 'better-todo-tree' )
                    {
                        return createConfigurationSection( currentValues, defaults );
                    }

                    if( section === 'todo-tree' )
                    {
                        return createConfigurationSection( legacyValues, defaults );
                    }

                    return createConfigurationSection( {}, {} );
                }
            }
        }
    } );
}

QUnit.module( 'settings identity' );

var compatibility = require( '../src/settingsCompatibility.js' );
compatibility.getSchemas( packageJson ).forEach( function( schema, setting )
{
    compatibility.getSources( setting ).forEach( function( source )
    {
        QUnit.test( 'read explicit Todo Tree setting: ' + source, function( assert )
        {
            var value = source === 'tree.showTagsFromOpenFilesOnly' ? true : schema.default;
            var input = {};
            input[ 'better-todo-tree.' + setting ] = { defaultValue: 'unconfigured-sentinel' };
            input[ 'todo-tree.' + source ] = { globalValue: value };
            var expected = source === 'tree.showTagsFromOpenFilesOnly' ? 'open files' : value;
            assert.deepEqual( createScopedIdentity( input ).identity.getSetting( setting ), expected );
        } );
    } );
} );

QUnit.test( 'every pinned upstream setting remains recognized by the manifest', function( assert )
{
    var inventory = require( '../scripts/qa/todo-tree-settings-inventory.json' );
    var declared = new Set( packageJson.contributes.configuration.flatMap( function( group )
    {
        return Object.keys( group.properties );
    } ) );
    inventory.settings.forEach( function( key ) { assert.true( declared.has( key ), key ); } );
} );

QUnit.test( 'language defaults apply after non-language settings and before explicit language values', function( assert )
{
    var input = {
        'better-todo-tree.regex.regex': { defaultValue: '(DEFAULT)', defaultLanguageValue: '(LANGUAGE_DEFAULT)' },
        'todo-tree.regex.regex': { workspaceFolderValue: '(FOLDER)' }
    };
    var identity = createScopedIdentity( input ).identity;
    assert.equal( identity.getSetting( 'regex.regex' ), '(LANGUAGE_DEFAULT)' );
    input[ 'todo-tree.regex.regex' ].globalLanguageValue = '(LANGUAGE_USER)';
    assert.equal( identity.getSetting( 'regex.regex' ), '(LANGUAGE_USER)' );
} );

QUnit.test( 'current namespace values override legacy namespace values', function( assert )
{
    var identity = createIdentity(
        { general: { tags: [ 'BETTER' ] } },
        { general: { tags: [ 'LEGACY' ] } },
        { general: { tags: [ 'DEFAULT' ] } }
    );

    assert.deepEqual( identity.getSetting( 'general.tags', [] ), [ 'BETTER' ] );
} );

function createScopedIdentity( values )
{
    var scopes = [];
    var updates = [];
    var identity = helpers.loadWithStubs( '../src/extensionIdentity.js', {
        vscode: {
            ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
            workspace: {
                getConfiguration: function( namespace, scope )
                {
                    scopes.push( scope );
                    return {
                        inspect: function( setting ) { return values[ namespace + '.' + setting ] || {}; },
                        get: function( setting, defaultValue )
                        {
                            var inspection = values[ namespace + '.' + setting ] || {};
                            return inspection.defaultValue === undefined ? defaultValue : inspection.defaultValue;
                        },
                        update: function( setting, value, target )
                        {
                            updates.push( { namespace, setting, value, target, scope } );
                            return Promise.resolve();
                        }
                    };
                }
            }
        }
    } );
    return { identity, scopes, updates };
}

QUnit.test( 'scope precedence applies across both namespaces with current values winning ties', function( assert )
{
    var fields = [ 'globalValue', 'workspaceValue', 'workspaceFolderValue',
        'globalLanguageValue', 'workspaceLanguageValue', 'workspaceFolderLanguageValue' ];
    fields.forEach( function( currentField, currentIndex )
    {
        fields.forEach( function( sourceField, sourceIndex )
        {
            var current = { defaultValue: '(DEFAULT)' };
            var source = {};
            current[ currentField ] = '(CURRENT)';
            source[ sourceField ] = '(SOURCE)';
            var harness = createScopedIdentity( {
                'better-todo-tree.regex.regex': current, 'todo-tree.regex.regex': source
            } );
            var scope = { uri: 'file:/customer/source.py', languageId: 'python' };
            assert.equal( harness.identity.getSetting( 'regex.regex', undefined, scope ),
                sourceIndex > currentIndex ? '(SOURCE)' : '(CURRENT)', currentField + '/' + sourceField );
            assert.equal( harness.identity.getSettingTarget( 'regex.regex', scope ),
                Math.max( currentIndex, sourceIndex ) % 3 + 1 );
            assert.true( harness.scopes.every( function( value ) { return value === scope; } ) );
        } );
    } );
} );

QUnit.test( 'explicit false, zero and empty collections survive setting aliases', function( assert )
{
    [ [ 'highlights.useColourScheme', false ], [ 'highlights.highlightDelay', 0 ],
        [ 'general.tags', [] ], [ 'highlights.defaultHighlight', {} ] ].forEach( function( entry )
    {
        var values = {};
        values[ 'todo-tree.' + entry[ 0 ] ] = { workspaceValue: entry[ 1 ] };
        assert.deepEqual( createScopedIdentity( values ).identity.getSetting( entry[ 0 ], 'sentinel' ), entry[ 1 ] );
    } );
} );

QUnit.test( 'historical flat keys support live reads and grouped keys win within one scope', function( assert )
{
    var values = {
        'todo-tree.tags': { globalValue: [ 'GLOBAL' ], workspaceValue: [] },
        'todo-tree.general.tags': { globalValue: [ 'GROUPED' ] },
        'todo-tree.highlightDelay': { workspaceValue: 0 },
        'todo-tree.regex': { globalValue: { regex: '(NESTED)' } },
        'todo-tree.tree.showTagsFromOpenFilesOnly': { workspaceValue: true },
        'todo-tree.tree.showScanOpenFilesOrWorkspaceButton': { workspaceValue: true }
    };
    var identity = createScopedIdentity( values ).identity;
    assert.deepEqual( identity.getSetting( 'general.tags' ), [] );
    delete values[ 'todo-tree.tags' ].workspaceValue;
    assert.deepEqual( identity.getSetting( 'general.tags' ), [ 'GROUPED' ] );
    assert.strictEqual( identity.getSetting( 'highlights.highlightDelay' ), 0 );
    assert.strictEqual( identity.getSetting( 'regex.regex', '(DEFAULT)' ), '(DEFAULT)' );
    assert.equal( identity.getSetting( 'tree.scanMode' ), 'open files' );
    assert.true( identity.getSetting( 'tree.buttons.scanMode' ) );
    values[ 'todo-tree.tree.showTagsFromOpenFilesOnly' ].workspaceValue = false;
    assert.equal( identity.getSetting( 'tree.scanMode' ), 'workspace' );
} );

QUnit.test( 'object inheritance retains unrelated keys without mutating source settings', function( assert )
{
    var values = {
        'better-todo-tree.highlights.customHighlight': {
            defaultValue: { FIXME: { icon: 'flame' } },
            globalValue: { TODO: { foreground: '#ffffff', fontWeight: 'bold' } }
        },
        'todo-tree.highlights.customHighlight': {
            workspaceValue: JSON.parse( '{"TODO":{"background":"#000000"},"__proto__":{"icon":"bug"},"constructor":{"icon":"beaker"}}' )
        }
    };
    var before = JSON.stringify( values );
    var result = createScopedIdentity( values ).identity.getSetting( 'highlights.customHighlight' );
    assert.deepEqual( result.TODO, { foreground: '#ffffff', fontWeight: 'bold', background: '#000000' } );
    assert.equal( result.FIXME.icon, 'flame' );
    assert.equal( result.__proto__.icon, 'bug' );
    assert.equal( result.constructor.icon, 'beaker' );
    assert.equal( JSON.stringify( values ), before );
    assert.strictEqual( {}.icon, undefined );
} );

QUnit.test( 'configuration changes cover grouped, flat and renamed settings without command aliases', function( assert )
{
    var identity = createIdentity( {}, {}, {} );
    var pairs = [ [ 'todo-tree.general.tags', 'general.tags', 'general' ],
        [ 'todo-tree.tags', 'general.tags', 'general' ],
        [ 'todo-tree.customHighlight', 'highlights.customHighlight', 'highlights' ],
        [ 'todo-tree.regex', 'regex.regex', 'regex' ],
        [ 'todo-tree.tree.showTagsFromOpenFilesOnly', 'tree.scanMode', 'tree' ],
        [ 'todo-tree.languages.customPatterns', 'languages.customPatterns', 'languages' ] ];
    pairs.forEach( function( entry )
    {
        var event = { affectsConfiguration: function( key ) { return entry[ 0 ] === key || entry[ 0 ].startsWith( key + '.' ); } };
        assert.true( identity.affectsSetting( event, entry[ 1 ] ), entry[ 0 ] );
        assert.true( identity.affectsNamespace( event, 'better-todo-tree.' + entry[ 2 ] ), entry[ 0 ] );
        assert.true( identity.affectsNamespace( event, 'better-todo-tree' ) );
    } );
    assert.true( Object.values( identity.COMMANDS ).every( function( command ) { return command.startsWith( 'better-todo-tree.' ); } ) );
} );

QUnit.test( 'Todo Tree values remain active without a current namespace value', function( assert )
{
    var identity = createIdentity(
        {},
        { general: { tags: [ 'LEGACY' ] } },
        { general: { tags: [ 'DEFAULT' ] } }
    );

    assert.deepEqual( identity.getSetting( 'general.tags', [] ), [ 'LEGACY' ] );
} );

QUnit.test( 'current namespace highlight settings override legacy highlight settings', function( assert )
{
    var identity = createIdentity(
        {
            highlights: {
                customHighlight: {
                    TODO: {
                        foreground: '#ffffff'
                    }
                },
                useColourScheme: true,
                backgroundColourScheme: [ '#d61' ]
            }
        },
        {
            highlights: {
                customHighlight: {
                    TODO: {
                        foreground: '#000000'
                    }
                },
                useColourScheme: false,
                backgroundColourScheme: [ '#000000' ]
            }
        },
        {
            highlights: {
                customHighlight: {},
                useColourScheme: false,
                backgroundColourScheme: []
            }
        }
    );

    assert.deepEqual( identity.getSetting( 'highlights.customHighlight', {} ), {
        TODO: {
            foreground: '#ffffff'
        }
    } );
    assert.strictEqual( identity.getSetting( 'highlights.useColourScheme', false ), true );
    assert.deepEqual( identity.getSetting( 'highlights.backgroundColourScheme', [] ), [ '#d61' ] );
} );

QUnit.test( 'Todo Tree highlights remain active without a current namespace value', function( assert )
{
    var identity = createIdentity(
        {},
        {
            highlights: {
                defaultHighlight: {
                    gutterIcon: true,
                    type: 'text'
                },
                customHighlight: {
                    FIXME: {
                        foreground: '#8F1BDC'
                    }
                },
                enabled: true
            }
        },
        {
            highlights: {
                defaultHighlight: {},
                customHighlight: {},
                enabled: false
            }
        }
    );

    assert.deepEqual( identity.getSetting( 'highlights.defaultHighlight', {} ), { gutterIcon: true, type: 'text' } );
    assert.deepEqual( identity.getSetting( 'highlights.customHighlight', {} ), { FIXME: { foreground: '#8F1BDC' } } );
    assert.strictEqual( identity.getSetting( 'highlights.enabled', false ), true );
} );

QUnit.test( 'manifest recognizes both setting namespaces', function( assert )
{
    var identity = createIdentity( {}, {}, {} );
    var currentSettings = identity.getManifestSettingSuffixes( packageJson );
    var allProperties = packageJson.contributes.configuration.reduce( function( properties, group )
    {
        return properties.concat( Object.keys( group.properties || {} ) );
    }, [] );
    var legacySettings = allProperties.filter( function( key )
    {
        return key.indexOf( 'todo-tree.' ) === 0;
    } );

    assert.equal( currentSettings.length, 71 );
    currentSettings.forEach( function( suffix ) { assert.true( legacySettings.includes( 'todo-tree.' + suffix ), suffix ); } );
    assert.true( legacySettings.includes( 'todo-tree.tags' ) );
    assert.ok( currentSettings.indexOf( 'general.tags' ) !== -1 );
    assert.ok( currentSettings.indexOf( 'general.showScanningProgress' ) !== -1 );
    assert.ok( currentSettings.indexOf( 'languages.customPatterns' ) !== -1 );
    assert.ok( currentSettings.indexOf( 'languages.embeddedDocuments' ) !== -1 );
} );
