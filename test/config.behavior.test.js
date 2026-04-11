var path = require( 'path' );

var helpers = require( './moduleHelpers.js' );

function createVscodeStub( appRoot )
{
    return {
        env: {
            appRoot: appRoot
        },
        workspace: {
            getConfiguration: function()
            {
                return {
                    compactFolders: false,
                    get: function( key, defaultValue )
                    {
                        return defaultValue;
                    }
                };
            }
        }
    };
}

function loadConfigModule( options )
{
    options = options || {};

    return helpers.loadWithStubs( '../src/config.js', {
        vscode: createVscodeStub( options.appRoot || '/Applications/Visual Studio Code (M1).app/Contents/Resources/app' ),
        fs: {
            existsSync: function( fsPath )
            {
                return ( options.existingPaths || [] ).indexOf( fsPath ) !== -1;
            }
        },
        './attributes.js': {
            getAttribute: function( tag, attribute, defaultValue )
            {
                return defaultValue;
            }
        },
        './extensionIdentity.js': {
            getSetting: function( setting, defaultValue )
            {
                if( setting === 'ripgrep.ripgrep' )
                {
                    return options.configuredRipgrepPath !== undefined ? options.configuredRipgrepPath : defaultValue;
                }

                return defaultValue;
            }
        }
    } );
}

QUnit.module( 'behavioral config' );

QUnit.test( 'ripgrepPath prefers the configured executable even when the path contains spaces and parentheses', function( assert )
{
    var configuredPath = '/Applications/Visual Studio Code (M1).app/Contents/Resources/custom ripgrep (local)/rg';
    var bundledPath = path.join( '/Applications/Visual Studio Code (M1).app/Contents/Resources/app', 'node_modules/vscode-ripgrep/bin/', 'rg' );
    var config = loadConfigModule( {
        configuredRipgrepPath: configuredPath,
        existingPaths: [ configuredPath, bundledPath ]
    } );

    assert.equal( config.ripgrepPath(), configuredPath );
} );

QUnit.test( 'ripgrepPath falls back to the bundled executable when the configured path does not exist', function( assert )
{
    var configuredPath = '/Applications/Visual Studio Code (M1).app/Contents/Resources/custom ripgrep (missing)/rg';
    var bundledPath = path.join( '/Applications/Visual Studio Code (M1).app/Contents/Resources/app', 'node_modules.asar.unpacked/@vscode/ripgrep/bin/', 'rg' );
    var config = loadConfigModule( {
        configuredRipgrepPath: configuredPath,
        existingPaths: [ bundledPath ]
    } );

    assert.equal( config.ripgrepPath(), bundledPath );
} );
