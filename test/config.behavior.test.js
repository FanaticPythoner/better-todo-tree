var path = require( 'path' );

var helpers = require( './moduleHelpers.js' );
var regexRegistry = require( '../src/regexRegistry.js' );

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

    var getSettingCalls = [];
    var config = helpers.loadWithStubs( '../src/config.js', {
        vscode: createVscodeStub( options.appRoot || '/Applications/Visual Studio Code (M1).app/Contents/Resources/app' ),
        fs: {
            existsSync: function( fsPath )
            {
                return ( options.existingPaths || [] ).indexOf( fsPath ) !== -1;
            },
            readdirSync: function( fsPath )
            {
                return ( options.directoryEntries || {} )[ fsPath ] || [];
            }
        },
        './attributes.js': {
            getAttribute: function( tag, attribute, defaultValue )
            {
                return defaultValue;
            }
        },
        './extensionIdentity.js': {
            getSetting: function( setting, defaultValue, uri )
            {
                getSettingCalls.push( {
                    setting: setting,
                    uri: uri
                } );

                if( setting === 'ripgrep.ripgrep' )
                {
                    return options.configuredRipgrepPath !== undefined ? options.configuredRipgrepPath : defaultValue;
                }

                if( options.settingValues && Object.prototype.hasOwnProperty.call( options.settingValues, setting ) )
                {
                    return options.settingValues[ setting ];
                }

                return defaultValue;
            }
        }
    } );

    config.__getSettingCalls = function()
    {
        return getSettingCalls.slice();
    };

    if( options.extensionPath )
    {
        config.init( {
            extensionPath: options.extensionPath,
            workspaceState: {
                get: function( key, defaultValue )
                {
                    return defaultValue;
                }
            }
        } );
    }

    return config;
}

function rgExecutableName()
{
    return regexRegistry.createRegExp( 'windowsPlatform' ).test( process.platform ) ? 'rg.exe' : 'rg';
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

function createDirectoryEntry( name )
{
    return {
        name: name,
        isDirectory: function()
        {
            return true;
        }
    };
}

QUnit.module( 'behavioral config' );

QUnit.test( 'regex reads only language-overridable regex source with a resource URI', function( assert )
{
    var uri = { toString: function() { return '/workspace/source.vue'; } };
    var config = loadConfigModule( {
        settingValues: {
            'regex.regex': 'TODO',
            'regex.regexCaseSensitive': false,
            'regex.enableMultiLine': true,
            'regex.subTagRegex': '^-\\s+'
        }
    } );

    var regexConfig = config.regex( uri );
    var subTagRegex = config.subTagRegex( uri );
    var calls = config.__getSettingCalls().filter( function( call )
    {
        return call.setting.indexOf( 'regex.' ) === 0;
    } );

    assert.deepEqual( regexConfig, {
        tags: [ "TODO" ],
        regex: 'TODO',
        caseSensitive: false,
        multiLine: true
    } );
    assert.equal( subTagRegex, '^-\\s+' );
    assert.equal( calls.filter( function( call )
    {
        return call.uri === uri;
    } ).map( function( call )
    {
        return call.setting;
    } ).join( ',' ), 'regex.regex' );
} );

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
        configuredRipgrepPath: '',
        existingPaths: [ universalPath, olderScopedPath ]
    } );

    assert.equal( config.ripgrepPath(), universalPath );
} );

QUnit.test( 'ripgrepPath rejects a missing configured executable without switching binaries', function( assert )
{
    var configuredPath = '/Applications/Visual Studio Code.app/Contents/Resources/custom ripgrep (missing)/rg';
    var extensionPath = '/home/user/.vscode/extensions/fanaticpythoner.better-todo-tree-1.1.12';
    var shippedPath = path.join( extensionPath, 'dist/ripgrep', rgPlatformArch(), rgExecutableName() );
    var config = loadConfigModule( {
        extensionPath: extensionPath,
        configuredRipgrepPath: configuredPath,
        existingPaths: [ shippedPath ]
    } );

    assert.equal( config.ripgrepPath(), undefined );
} );

QUnit.test( 'ripgrepPath prefers the extension packaged ripgrep binary over VS Code internals', function( assert )
{
    var extensionPath = '/home/user/.vscode/extensions/fanaticpythoner.better-todo-tree-1.1.12';
    var appRoot = '/Applications/Visual Studio Code.app/Contents/Resources/app';
    var shippedPath = path.join( extensionPath, 'dist/ripgrep', rgPlatformArch(), rgExecutableName() );
    var vscodePath = path.join(
        appRoot,
        'node_modules.asar.unpacked/@vscode/ripgrep-universal/bin',
        rgPlatformArch(),
        rgExecutableName()
    );
    var config = loadConfigModule( {
        appRoot: appRoot,
        extensionPath: extensionPath,
        configuredRipgrepPath: '',
        existingPaths: [ shippedPath, vscodePath ]
    } );

    assert.equal( config.ripgrepPath(), shippedPath );
} );

QUnit.test( 'ripgrepPath resolves VS Code commit-nested app roots for compatibility', function( assert )
{
    var appRoot = '/Applications/Visual Studio Code.app/Contents/Resources/app';
    var commitDirectory = '8761a5560cfd65fdd19ce7e2bd18dab5c0a4d84e';
    var nestedRoot = path.join( appRoot, commitDirectory, 'resources', 'app' );
    var nestedPath = path.join(
        nestedRoot,
        'node_modules/@vscode/ripgrep-universal/bin',
        rgPlatformArch(),
        rgExecutableName()
    );
    var directoryEntries = {};

    directoryEntries[ appRoot ] = [ createDirectoryEntry( commitDirectory ) ];

    var config = loadConfigModule( {
        appRoot: appRoot,
        configuredRipgrepPath: '',
        existingPaths: [ appRoot, nestedRoot, nestedPath ],
        directoryEntries: directoryEntries
    } );

    assert.equal( config.ripgrepPath(), nestedPath );
} );

QUnit.test( 'ripgrepPath follows ripgrep-universal npm_config_arch platform directories', function( assert )
{
    var overrideArch = process.arch === 'arm64' ? 'x64' : 'arm64';

    withNpmConfigArch( overrideArch, function()
    {
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
            configuredRipgrepPath: '',
            existingPaths: [ universalPath, hostArchUniversalPath ]
        } );

        assert.equal( config.ripgrepPath(), universalPath );
    } );
} );

QUnit.test( 'ripgrepPath keeps older VS Code packaged ripgrep locations compatible', function( assert )
{
    var appRoot = '/Applications/Visual Studio Code (M1).app/Contents/Resources/app';
    var olderLegacyPath = path.join( appRoot, 'node_modules/vscode-ripgrep/bin', rgExecutableName() );
    var olderScopedPath = path.join( appRoot, 'node_modules.asar.unpacked/@vscode/ripgrep/bin', rgExecutableName() );
    var config = loadConfigModule( {
        appRoot: appRoot,
        configuredRipgrepPath: '',
        existingPaths: [ olderLegacyPath, olderScopedPath ]
    } );

    assert.equal( config.ripgrepPath(), olderLegacyPath );
} );
