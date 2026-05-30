var helpers = require( './moduleHelpers.js' );

function createIdentityStub( settings )
{
    return {
        getSetting: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( settings, key ) ? settings[ key ] : defaultValue;
        }
    };
}

QUnit.module( 'behavioral colours', function()
{
    QUnit.test( 'issue #40 codicon named colours report theme colour contract', function( assert )
    {
        var colours = helpers.loadWithStubs( '../src/colours.js', {
            vscode: {},
            './extensionIdentity.js': createIdentityStub( {
                'highlights.customHighlight': {
                    BUG: {},
                    FIXME: {},
                    TODO: {}
                },
                'highlights.customHighlight.BUG.icon': '$(bug)',
                'highlights.customHighlight.BUG.iconColour': 'red',
                'highlights.customHighlight.FIXME.icon': '$(tools)',
                'highlights.customHighlight.FIXME.iconColour': 'orange',
                'highlights.customHighlight.TODO.icon': '$(checklist)',
                'highlights.customHighlight.TODO.iconColour': 'yellow'
            } )
        } );

        assert.equal(
            colours.validateIconColours(),
            'Invalid icon colour settings: customHighlight.BUG.iconColour (red), ' +
                'customHighlight.FIXME.iconColour (orange), ' +
                'customHighlight.TODO.iconColour (yellow). Codicons can only use theme colours.'
        );
    } );

    QUnit.test( 'issue #40 codicon theme colours pass icon colour checks', function( assert )
    {
        var colours = helpers.loadWithStubs( '../src/colours.js', {
            vscode: {},
            './extensionIdentity.js': createIdentityStub( {
                'highlights.customHighlight': {
                    BUG: {},
                    FIXME: {},
                    TODO: {}
                },
                'highlights.customHighlight.BUG.icon': '$(bug)',
                'highlights.customHighlight.BUG.iconColour': 'editorError.foreground',
                'highlights.customHighlight.FIXME.icon': '$(tools)',
                'highlights.customHighlight.FIXME.iconColour': 'editorWarning.foreground',
                'highlights.customHighlight.TODO.icon': '$(checklist)',
                'highlights.customHighlight.TODO.iconColour': 'editorInfo.foreground'
            } )
        } );

        assert.equal( colours.validateIconColours(), '' );
    } );
} );
