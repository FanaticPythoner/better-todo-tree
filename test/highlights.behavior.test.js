var helpers = require( './moduleHelpers.js' );
var actualDetection = require( '../src/detection.js' );
var actualUtils = require( '../src/utils.js' );
var actualAttributes = require( '../src/attributes.js' );
var issue888Helpers = require( './issue888Helpers.js' );

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

function createAttributeConfig( overrides )
{
    return Object.assign( {
        tagList: [ 'TODO', 'FIXME' ],
        tags: function()
        {
            return this.tagList;
        },
        isRegexCaseSensitive: function()
        {
            return true;
        },
        shouldUseColourScheme: function()
        {
            return false;
        },
        foregroundColourScheme: function()
        {
            return [];
        },
        backgroundColourScheme: function()
        {
            return [];
        },
        defaultHighlight: function()
        {
            return {};
        },
        customHighlight: function()
        {
            return {};
        }
    }, overrides || {} );
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
                hasCustomHighlight: function() { return false; },
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
            },
            './extensionIdentity.js': {
                getSetting: function( setting, defaultValue )
                {
                    return defaultValue;
                }
            }
        } );

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );
        var decoration = highlights.getDecoration( 'TODO' );

        assert.equal( decoration.gutterIconPath, '/tmp/gutter-dark.svg' );
    } );

    QUnit.test( "customHighlight colours and defaultHighlight fallback flow into editor decorations", function( assert )
    {
        var decorationLog = [];
        var config = createAttributeConfig( {
            defaultHighlight: function()
            {
                return {
                    background: '#ff1493',
                    gutterIcon: true,
                    type: 'text'
                };
            },
            customHighlight: function()
            {
                return {
                    TODO: {
                        foreground: '#ffffff',
                        background: '#ff7e14',
                        gutterIcon: true,
                        type: 'tag'
                    },
                    FIXME: {
                        foreground: '#111111'
                    }
                };
            }
        } );

        actualUtils.init( config );
        actualAttributes.init( config );

        var highlights = helpers.loadWithStubs( '../src/highlights.js', {
            vscode: createVscodeStub( { enabled: true }, decorationLog ),
            './config.js': {
                customHighlight: config.customHighlight.bind( config ),
                subTagRegex: function() { return '(^:\\s*)'; },
                tagGroup: function() { return undefined; }
            },
            './utils.js': actualUtils,
            './attributes.js': actualAttributes,
            './icons.js': {
                getGutterIcon: function()
                {
                    return { dark: '/tmp/editor-gutter.svg', light: '/tmp/editor-gutter.svg' };
                }
            },
            './detection.js': {
                scanDocument: function()
                {
                    return [];
                }
            },
            './extensionIdentity.js': {
                getSetting: function( setting, defaultValue )
                {
                    return defaultValue;
                }
            }
        } );

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );

        var todoDecoration = highlights.getDecoration( 'TODO' );
        var fixmeDecoration = highlights.getDecoration( 'FIXME' );

        assert.equal( todoDecoration.light.color, '#ffffff' );
        assert.equal( todoDecoration.light.backgroundColor, 'rgba(255,126,20,1)' );
        assert.equal( todoDecoration.gutterIconPath, '/tmp/editor-gutter.svg' );
        assert.equal( fixmeDecoration.light.color, '#111111' );
        assert.equal( fixmeDecoration.light.backgroundColor, 'rgba(255,20,147,1)' );
        assert.equal( fixmeDecoration.gutterIconPath, '/tmp/editor-gutter.svg' );
    } );

    QUnit.test( "useColourScheme overrides defaultHighlight but not customHighlight in editor decorations", function( assert )
    {
        var decorationLog = [];
        var config = createAttributeConfig( {
            tagList: [ 'TODO', 'FIXME' ],
            shouldUseColourScheme: function()
            {
                return true;
            },
            foregroundColourScheme: function()
            {
                return [ 'white', 'black' ];
            },
            backgroundColourScheme: function()
            {
                return [ '#ff8855', '#00bff9' ];
            },
            defaultHighlight: function()
            {
                return {
                    foreground: '#101010',
                    background: '#202020'
                };
            },
            customHighlight: function()
            {
                return {
                    TODO: {
                        foreground: '#ffffff',
                        background: '#ff8855',
                        type: 'whole-line'
                    }
                };
            }
        } );

        actualUtils.init( config );
        actualAttributes.init( config );

        var highlights = helpers.loadWithStubs( '../src/highlights.js', {
            vscode: createVscodeStub( { enabled: true }, decorationLog ),
            './config.js': {
                customHighlight: config.customHighlight.bind( config ),
                subTagRegex: function() { return '(^:\\s*)'; },
                tagGroup: function() { return undefined; }
            },
            './utils.js': actualUtils,
            './attributes.js': actualAttributes,
            './icons.js': {
                getGutterIcon: function()
                {
                    return { dark: '/tmp/editor-gutter.svg', light: '/tmp/editor-gutter.svg' };
                }
            },
            './detection.js': {
                scanDocument: function()
                {
                    return [];
                }
            },
            './extensionIdentity.js': {
                getSetting: function( setting, defaultValue )
                {
                    return defaultValue;
                }
            }
        } );

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );

        var todoDecoration = highlights.getDecoration( 'TODO' );
        var fixmeDecoration = highlights.getDecoration( 'FIXME' );

        assert.equal( todoDecoration.light.color, '#ffffff' );
        assert.equal( todoDecoration.light.backgroundColor, 'rgba(255,136,85,1)' );
        assert.equal( todoDecoration.isWholeLine, true );
        assert.equal( fixmeDecoration.light.color, 'black' );
        assert.equal( fixmeDecoration.light.backgroundColor, 'rgba(0,191,249,1)' );
    } );

    QUnit.test( "issue #812 text-and-comment highlights are clipped to the detected inline comment range", function( assert )
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
                hasCustomHighlight: function() { return false; },
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
            },
            './extensionIdentity.js': {
                getSetting: function( setting, defaultValue )
                {
                    return defaultValue;
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
                hasCustomHighlight: function() { return false; },
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
            },
            './extensionIdentity.js': {
                getSetting: function( setting, defaultValue )
                {
                    return defaultValue;
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

    QUnit.test( "issue #888 tag highlights anchor to the content-line asterisk", function( assert )
    {
        var recorded = [];
        var issueConfig = issue888Helpers.createIssue888Config();
        var text = issue888Helpers.createIssue888Text();

        actualUtils.init( issueConfig );

        var highlights = helpers.loadWithStubs( '../src/highlights.js', {
            vscode: createVscodeStub( { highlight: 'tag', enabled: true }, [] ),
            './config.js': {
                customHighlight: function() { return {}; },
                subTagRegex: function() { return '(^:\\s*)'; },
                tagGroup: function() { return undefined; }
            },
            './utils.js': actualUtils,
            './attributes.js': {
                getForeground: function() { return undefined; },
                getBackground: function() { return undefined; },
                hasCustomHighlight: function() { return false; },
                getAttribute: function( tag, attribute, defaultValue )
                {
                    if( attribute === 'type' )
                    {
                        return 'tag';
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
            './detection.js': actualDetection,
            './extensionIdentity.js': {
                getSetting: function( setting, defaultValue )
                {
                    return defaultValue;
                }
            }
        } );

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );

        highlights.highlight( {
            viewColumn: 1,
            document: createDocument( text ),
            setDecorations: function( decoration, ranges )
            {
                recorded.push( ranges );
            }
        } );

        assert.equal( recorded[ 0 ][ 0 ].range.start.line, 1 );
        assert.equal( recorded[ 0 ][ 0 ].range.start.character, 1 );
        assert.equal( recorded[ 0 ][ 0 ].range.end.line, 1 );
        assert.equal( recorded[ 0 ][ 0 ].range.end.character, 2 );
    } );

    QUnit.test( "repeated highlights reuse cached decoration types for unchanged content", function( assert )
    {
        var creationCount = 0;
        var recorded = [];
        var highlights = helpers.loadWithStubs( '../src/highlights.js', {
            vscode: {
                ThemeColor: function( name ) { this.name = name; },
                Position: function( line, character )
                {
                    this.line = line;
                    this.character = character;
                },
                Range: function( start, end )
                {
                    this.start = start;
                    this.end = end;
                },
                window: {
                    createTextEditorDecorationType: function( options )
                    {
                        creationCount++;
                        return options;
                    }
                }
            },
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
                hasCustomHighlight: function() { return false; },
                getAttribute: function( tag, attribute, defaultValue )
                {
                    if( attribute === 'type' )
                    {
                        return 'tag';
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
                    return [];
                }
            },
            './extensionIdentity.js': {
                getSetting: function( setting, defaultValue )
                {
                    return defaultValue;
                }
            }
        } );
        var editor = {
            viewColumn: 1,
            document: createDocument( '// TODO body' ),
            setDecorations: function( decoration, ranges )
            {
                recorded.push( { decoration: decoration, ranges: ranges } );
            }
        };

        highlights.init( { subscriptions: { push: function() {} } }, function() {} );
        highlights.setScanResultsProvider( function()
        {
            return [ {
                actualTag: 'TODO',
                tagStartOffset: 3,
                tagEndOffset: 7,
                commentStartOffset: 0,
                commentEndOffset: 12
            } ];
        } );

        highlights.highlight( editor );
        highlights.highlight( editor );

        assert.equal( creationCount, 1 );
        assert.equal( recorded.length, 2 );
        assert.strictEqual( recorded[ 0 ].decoration, recorded[ 1 ].decoration );
    } );
} );
