var settingsSnapshot = require( '../src/runtime/settingsSnapshot.js' );

function createIdentity()
{
    var calls = [];

    return {
        calls: calls,
        getSetting: function( setting, defaultValue )
        {
            calls.push( setting );
            return defaultValue;
        }
    };
}

function createConfig( useColourScheme )
{
    return {
        tags: function() { return [ 'TODO' ]; },
        scanMode: function() { return 'workspace'; },
        shouldUseColourScheme: function() { return useColourScheme; }
    };
}

function createVscode()
{
    return {
        workspace: {
            getConfiguration: function()
            {
                return { compactFolders: false };
            }
        }
    };
}

QUnit.module( 'settings snapshot behavior', function()
{
    QUnit.test( 'issue #110 snapshot reuses the authoritative colour-scheme policy', function( assert )
    {
        var identity = createIdentity();
        var disabled = settingsSnapshot.buildSettingsSnapshot(
            undefined,
            identity,
            createConfig( false ),
            createVscode()
        );
        var enabled = settingsSnapshot.buildSettingsSnapshot(
            undefined,
            identity,
            createConfig( true ),
            createVscode()
        );

        assert.strictEqual( disabled.useColourScheme, false );
        assert.strictEqual( enabled.useColourScheme, true );
        assert.strictEqual( identity.calls.indexOf( 'highlights.useColourScheme' ), -1 );
    } );
} );
