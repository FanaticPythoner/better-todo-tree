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

QUnit.module( 'settings compatibility' );

QUnit.test( 'current namespace values override legacy namespace values', function( assert )
{
    var identity = createIdentity(
        { general: { tags: [ 'BETTER' ] } },
        { general: { tags: [ 'LEGACY' ] } },
        { general: { tags: [ 'DEFAULT' ] } }
    );

    assert.deepEqual( identity.getSetting( 'general.tags', [] ), [ 'BETTER' ] );
} );

QUnit.test( 'legacy namespace values remain active when current namespace is unset', function( assert )
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

QUnit.test( 'legacy highlight settings remain active when current namespace is unset', function( assert )
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

    assert.deepEqual( identity.getSetting( 'highlights.defaultHighlight', {} ), {
        gutterIcon: true,
        type: 'text'
    } );
    assert.deepEqual( identity.getSetting( 'highlights.customHighlight', {} ), {
        FIXME: {
            foreground: '#8F1BDC'
        }
    } );
    assert.strictEqual( identity.getSetting( 'highlights.enabled', false ), true );
} );

QUnit.test( 'manifest exposes current and legacy settings namespaces together', function( assert )
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

    assert.equal( currentSettings.length, 70 );
    assert.equal( legacySettings.length, 70 );
    assert.ok( currentSettings.indexOf( 'general.tags' ) !== -1 );
    assert.ok( legacySettings.indexOf( 'todo-tree.general.tags' ) !== -1 );
} );
