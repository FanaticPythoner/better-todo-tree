var helpers = require( './moduleHelpers.js' );

function createVscodeStub( highlightConfiguration, decorationLog )
{
    function Position( line, character )
    {
        this.line = line;
        this.character = character;
    }

    function Range( start, end )
    {
        this.start = start;
        this.end = end;
    }

    function ThemeColor( name )
    {
        this.name = name;
    }

    return {
        ThemeColor: ThemeColor,
        Position: Position,
        Range: Range,
        window: {
            createTextEditorDecorationType: function( options )
            {
                decorationLog.push( options );
                return options;
            }
        },
        workspace: {
            getConfiguration: function()
            {
                return {
                    get: function( key, defaultValue )
                    {
                        if( Object.prototype.hasOwnProperty.call( highlightConfiguration, key ) )
                        {
                            return highlightConfiguration[ key ];
                        }

                        return defaultValue;
                    }
                };
            }
        }
    };
}

function createDocument( text )
{
    var lineOffsets = [ 0 ];
    for( var index = 0; index < text.length; ++index )
    {
        if( text[ index ] === '\n' )
        {
            lineOffsets.push( index + 1 );
        }
    }

    function positionAt( offset )
    {
        var line = 0;
        while( line + 1 < lineOffsets.length && lineOffsets[ line + 1 ] <= offset )
        {
            line++;
        }

        return {
            line: line,
            character: offset - lineOffsets[ line ]
        };
    }

    function lineAt( input )
    {
        var line = typeof ( input ) === 'number' ? input : input.line;
        var start = lineOffsets[ line ];
        var end = line + 1 < lineOffsets.length ? lineOffsets[ line + 1 ] - 1 : text.length;
        return {
            range: {
                end: {
                    line: line,
                    character: end - start
                }
            }
        };
    }

    return {
        version: 1,
        uri: {
            fsPath: '/tmp/test.js',
            toString: function()
            {
                return '/tmp/test.js';
            }
        },
        getText: function()
        {
            return text;
        },
        positionAt: positionAt,
        lineAt: lineAt
    };
}

QUnit.module( "behavioral highlights", function( hooks )
{
    var originalVscode;

    hooks.beforeEach( function()
    {
        originalVscode = require.cache[ require.resolve( './moduleHelpers.js' ) ];
    } );

    QUnit.test( "gutter icons use file-backed icon paths even for codicon-backed settings", function( assert )
    {
        var decorationLog = [];
        var highlights = helpers.loadWithStubs( '../src/highlights.js', {
            vscode: createVscodeStub( { highlight: 'tag', enabled: true }, decorationLog ),
            './config.js': {
                customHighlight: function() { return {}; },
                subTagRegex: function() { return '(^:\\s*)'; }
            },
            './utils.js': {
                isHexColour: function() { return false; },
                isRgbColour: function() { return false; },
                isValidColour: function() { return true; },
                isThemeColour: function() { return false; },
                hexToRgba: function( value ) { return value; },
                complementaryColour: function() { return '#ffffff'; },
                setRgbAlpha: function( value ) { return value; }
            },
            './attributes.js': {
                getForeground: function() { return undefined; },
                getBackground: function() { return undefined; },
                getAttribute: function( tag, attribute, defaultValue )
                {
                    if( attribute === 'gutterIcon' )
                    {
                        return true;
                    }
                    return defaultValue;
                }
            },
            './icons.js': {
                getGutterIcon: function()
                {
                    return { dark: '/tmp/gutter-dark.svg', light: '/tmp/gutter-light.svg' };
                }
            },
            './detection.js': {
                scanDocument: function()
                {
                    return [];
                }
            }
        } );

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );
        var decoration = highlights.getDecoration( 'TODO' );

        assert.equal( decoration.gutterIconPath, '/tmp/gutter-dark.svg' );
    } );

    QUnit.test( "text-and-comment highlights are clipped to the detected comment range", function( assert )
    {
        var recorded = [];
        var highlights = helpers.loadWithStubs( '../src/highlights.js', {
            vscode: createVscodeStub( { highlight: 'text-and-comment', enabled: true }, [] ),
            './config.js': {
                customHighlight: function() { return {}; },
                subTagRegex: function() { return '(^:\\s*)'; },
                tagGroup: function() { return undefined; }
            },
            './utils.js': {
                isHexColour: function() { return false; },
                isRgbColour: function() { return false; },
                isValidColour: function() { return true; },
                isThemeColour: function() { return false; },
                hexToRgba: function( value ) { return value; },
                complementaryColour: function() { return '#ffffff'; },
                setRgbAlpha: function( value ) { return value; }
            },
            './attributes.js': {
                getForeground: function() { return undefined; },
                getBackground: function() { return undefined; },
                getAttribute: function( tag, attribute, defaultValue )
                {
                    if( attribute === 'type' )
                    {
                        return 'text-and-comment';
                    }
                    return defaultValue;
                }
            },
            './icons.js': {
                getGutterIcon: function()
                {
                    return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
                }
            },
            './detection.js': {
                scanDocument: function()
                {
                    return [ {
                        actualTag: 'TODO',
                        commentStartOffset: 12,
                        commentEndOffset: 28,
                        matchStartOffset: 15,
                        matchEndOffset: 24,
                        tagStartOffset: 15,
                        tagEndOffset: 19
                    } ];
                }
            }
        } );

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );

        highlights.highlight( {
            viewColumn: 1,
            document: createDocument( 'const value = /* TODO */ after;' ),
            setDecorations: function( decoration, ranges )
            {
                recorded.push( ranges );
            }
        } );

        assert.equal( recorded[ 0 ][ 0 ].range.start.character, 12 );
        assert.equal( recorded[ 0 ][ 0 ].range.end.character, 28 );
    } );

    QUnit.test( "text highlights stop at the raw match boundary for multiline regex results", function( assert )
    {
        var recorded = [];
        var highlights = helpers.loadWithStubs( '../src/highlights.js', {
            vscode: createVscodeStub( { highlight: 'text', enabled: true }, [] ),
            './config.js': {
                customHighlight: function() { return {}; },
                subTagRegex: function() { return '(^:\\s*)'; },
                tagGroup: function() { return undefined; }
            },
            './utils.js': {
                isHexColour: function() { return false; },
                isRgbColour: function() { return false; },
                isValidColour: function() { return true; },
                isThemeColour: function() { return false; },
                hexToRgba: function( value ) { return value; },
                complementaryColour: function() { return '#ffffff'; },
                setRgbAlpha: function( value ) { return value; }
            },
            './attributes.js': {
                getForeground: function() { return undefined; },
                getBackground: function() { return undefined; },
                getAttribute: function( tag, attribute, defaultValue )
                {
                    if( attribute === 'type' )
                    {
                        return 'text';
                    }
                    return defaultValue;
                }
            },
            './icons.js': {
                getGutterIcon: function()
                {
                    return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
                }
            },
            './detection.js': {
                scanDocument: function()
                {
                    return [ {
                        actualTag: 'TODO',
                        commentStartOffset: 0,
                        commentEndOffset: 32,
                        matchStartOffset: 3,
                        matchEndOffset: 18,
                        tagStartOffset: 3,
                        tagEndOffset: 7
                    } ];
                }
            }
        } );

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );

        highlights.highlight( {
            viewColumn: 1,
            document: createDocument( '/* TODO first\\nsecond */\\nconst after = 1;' ),
            setDecorations: function( decoration, ranges )
            {
                recorded.push( ranges );
            }
        } );

        assert.equal( recorded[ 0 ][ 0 ].range.start.character, 3 );
        assert.equal( recorded[ 0 ][ 0 ].range.end.line, 0 );
        assert.equal( recorded[ 0 ][ 0 ].range.end.character, 18 );
    } );
} );
