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

function rgExecutableName()
{
    return /^win/.test( process.platform ) ? 'rg.exe' : 'rg';
}

function rgPlatformArch()
{
    return process.platform + '-' + ( process.env.npm_config_arch || process.arch );
}

function withNpmConfigArch( arch, callback )
{
    var previousArch = process.env.npm_config_arch;

    process.env.npm_config_arch = arch;

    try
    {
        callback();
    }
    finally
    {
        if( previousArch === undefined )
        {
            delete process.env.npm_config_arch;
        }
        else
        {
            process.env.npm_config_arch = previousArch;
        }
    }
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

QUnit.test( 'ripgrepPath resolves the packaged ripgrep-universal executable under the current platform directory', function( assert )
{
    var configuredPath = '/Applications/Visual Studio Code (M1).app/Contents/Resources/custom ripgrep (missing)/rg';
    var appRoot = '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app';
    var universalPath = path.join(
        appRoot,
        'node_modules.asar.unpacked/@vscode/ripgrep-universal/bin',
        rgPlatformArch(),
        rgExecutableName()
    );
    var olderScopedPath = path.join( appRoot, 'node_modules.asar.unpacked/@vscode/ripgrep/bin', rgExecutableName() );
    var config = loadConfigModule( {
        appRoot: appRoot,
        configuredRipgrepPath: configuredPath,
        existingPaths: [ universalPath, olderScopedPath ]
    } );

    assert.equal( config.ripgrepPath(), universalPath );
} );

QUnit.test( 'ripgrepPath follows ripgrep-universal npm_config_arch platform directories', function( assert )
{
    var overrideArch = process.arch === 'arm64' ? 'x64' : 'arm64';

    withNpmConfigArch( overrideArch, function()
    {
        var configuredPath = '/Applications/Visual Studio Code (M1).app/Contents/Resources/custom ripgrep (missing)/rg';
        var appRoot = '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app';
        var universalPath = path.join(
            appRoot,
            'node_modules.asar.unpacked/@vscode/ripgrep-universal/bin',
            rgPlatformArch(),
            rgExecutableName()
        );
        var hostArchUniversalPath = path.join(
            appRoot,
            'node_modules.asar.unpacked/@vscode/ripgrep-universal/bin',
            process.platform + '-' + process.arch,
            rgExecutableName()
        );
        var config = loadConfigModule( {
            appRoot: appRoot,
            configuredRipgrepPath: configuredPath,
            existingPaths: [ universalPath, hostArchUniversalPath ]
        } );

        assert.equal( config.ripgrepPath(), universalPath );
    } );
} );

QUnit.test( 'ripgrepPath keeps older VS Code packaged ripgrep locations compatible', function( assert )
{
    var configuredPath = '/Applications/Visual Studio Code (M1).app/Contents/Resources/custom ripgrep (missing)/rg';
    var appRoot = '/Applications/Visual Studio Code (M1).app/Contents/Resources/app';
    var olderLegacyPath = path.join( appRoot, 'node_modules/vscode-ripgrep/bin', rgExecutableName() );
    var olderScopedPath = path.join( appRoot, 'node_modules.asar.unpacked/@vscode/ripgrep/bin', rgExecutableName() );
    var config = loadConfigModule( {
        appRoot: appRoot,
        configuredRipgrepPath: configuredPath,
        existingPaths: [ olderLegacyPath, olderScopedPath ]
    } );

    assert.equal( config.ripgrepPath(), olderLegacyPath );
} );
