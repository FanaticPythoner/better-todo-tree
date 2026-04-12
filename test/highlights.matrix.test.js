var helpers = require( './moduleHelpers.js' );
var languageMatrix = require( './languageMatrix.js' );
var matrixHelpers = require( './matrixHelpers.js' );

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
                    },
                    inspect: function( key )
                    {
                        return {
                            defaultValue: Object.prototype.hasOwnProperty.call( highlightConfiguration, key ) ? highlightConfiguration[ key ] : undefined,
                            globalValue: undefined,
                            workspaceValue: undefined,
                            workspaceFolderValue: undefined
                        };
                    }
                };
            }
        }
    };
}

function createMatch( overrides )
{
    return Object.assign( {
        actualTag: 'TODO',
        subTag: undefined,
        commentStartOffset: 0,
        commentEndOffset: 0,
        matchStartOffset: 0,
        matchEndOffset: 0,
        tagStartOffset: 0,
        tagEndOffset: 0,
        subTagStartOffset: undefined,
        subTagEndOffset: undefined,
        captureGroupOffsets: undefined
    }, overrides || {} );
}

function createHarness( options )
{
    var decorationLog = [];
    var recorded = [];
    var highlights = helpers.loadWithStubs( '../src/highlights.js', {
        vscode: createVscodeStub( { highlight: options.type, enabled: true, highlightDelay: 0 }, decorationLog ),
        './config.js': {
            customHighlight: function() { return options.customHighlights || {}; },
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
            hasCustomHighlight: function( tag ) { return Object.prototype.hasOwnProperty.call( options.customHighlights || {}, tag ); },
            getAttribute: function( tag, attribute, defaultValue )
            {
                if( attribute === 'type' )
                {
                    return options.type;
                }
                if( attribute === 'gutterIcon' )
                {
                    return false;
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
                return options.matches;
            }
        }
    } );

    highlights.init( { subscriptions: { push: function() {} } }, function() {} );

    highlights.highlight( {
        viewColumn: 1,
        document: matrixHelpers.createDocument( '/tmp/test.js', options.text ),
        setDecorations: function( decoration, ranges )
        {
            recorded.push( { decoration: decoration, ranges: ranges } );
        }
    } );

    return {
        decorationLog: decorationLog,
        recorded: recorded
    };
}

QUnit.module( "highlight matrix" );

QUnit.test( "tag highlights only the tag range", function( assert )
{
    var harness = createHarness( {
        type: 'tag',
        text: '// TODO body',
        matches: [ createMatch( {
            commentStartOffset: 0,
            commentEndOffset: 12,
            matchStartOffset: 3,
            matchEndOffset: 12,
            tagStartOffset: 3,
            tagEndOffset: 7
        } ) ]
    } );

    assert.equal( harness.recorded.length, 1 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.start.character, 3 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.end.character, 7 );
} );

QUnit.test( "tag highlights cover the full manifest default tag corpus", function( assert )
{
    languageMatrix.DEFAULT_TAGS.forEach( function( tag )
    {
        var text = '// ' + tag + ' body';
        var harness = createHarness( {
            type: 'tag',
            text: text,
            matches: [ createMatch( {
                actualTag: tag,
                commentStartOffset: 0,
                commentEndOffset: text.length,
                matchStartOffset: 3,
                matchEndOffset: text.length,
                tagStartOffset: 3,
                tagEndOffset: 3 + tag.length
            } ) ]
        } );

        assert.equal( harness.recorded.length, 1, tag + ' creates one decoration bucket' );
        assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.start.character, 3, tag + ' start' );
        assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.end.character, 3 + tag.length, tag + ' end' );
    } );
} );

QUnit.test( "tag-and-comment highlights from the comment start through the tag", function( assert )
{
    var harness = createHarness( {
        type: 'tag-and-comment',
        text: '// TODO body',
        matches: [ createMatch( {
            commentStartOffset: 0,
            commentEndOffset: 12,
            matchStartOffset: 3,
            matchEndOffset: 12,
            tagStartOffset: 3,
            tagEndOffset: 7
        } ) ]
    } );

    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.start.character, 0 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.end.character, 7 );
} );

QUnit.test( "tag-and-subTag highlights the tag and extracted subTag separately", function( assert )
{
    var harness = createHarness( {
        type: 'tag-and-subTag',
        text: 'TODO (alice)',
        customHighlights: { alice: { foreground: 'red' } },
        matches: [ createMatch( {
            subTag: 'alice',
            commentStartOffset: 0,
            commentEndOffset: 12,
            matchStartOffset: 0,
            matchEndOffset: 12,
            tagStartOffset: 0,
            tagEndOffset: 4,
            subTagStartOffset: 6,
            subTagEndOffset: 11
        } ) ]
    } );

    assert.equal( harness.recorded.length, 2 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.start.character, 0 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.end.character, 4 );
    assert.equal( harness.recorded[ 1 ].ranges[ 0 ].range.start.character, 6 );
    assert.equal( harness.recorded[ 1 ].ranges[ 0 ].range.end.character, 11 );
} );

QUnit.test( "capture-groups highlights only the requested groups", function( assert )
{
    var harness = createHarness( {
        type: 'capture-groups:1,2',
        text: 'TODO(api)',
        matches: [ createMatch( {
            commentStartOffset: 0,
            commentEndOffset: 9,
            matchStartOffset: 0,
            matchEndOffset: 9,
            tagStartOffset: 0,
            tagEndOffset: 4,
            captureGroupOffsets: [ [ 0, 9 ], [ 0, 4 ], [ 5, 8 ] ]
        } ) ]
    } );

    assert.equal( harness.recorded.length, 1 );
    assert.equal( harness.recorded[ 0 ].ranges.length, 2 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.start.character, 0 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.end.character, 4 );
    assert.equal( harness.recorded[ 0 ].ranges[ 1 ].range.start.character, 5 );
    assert.equal( harness.recorded[ 0 ].ranges[ 1 ].range.end.character, 8 );
} );

QUnit.test( "line highlights span the full line without whole-line decoration", function( assert )
{
    var harness = createHarness( {
        type: 'line',
        text: 'prefix TODO body',
        matches: [ createMatch( {
            commentStartOffset: 0,
            commentEndOffset: 16,
            matchStartOffset: 7,
            matchEndOffset: 16,
            tagStartOffset: 7,
            tagEndOffset: 11
        } ) ]
    } );

    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.start.character, 0 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.end.character, 16 );
    assert.equal( harness.decorationLog[ 0 ].isWholeLine, false );
} );

QUnit.test( "whole-line highlights set the whole-line decoration flag", function( assert )
{
    var harness = createHarness( {
        type: 'whole-line',
        text: 'prefix TODO body',
        matches: [ createMatch( {
            commentStartOffset: 0,
            commentEndOffset: 16,
            matchStartOffset: 7,
            matchEndOffset: 16,
            tagStartOffset: 7,
            tagEndOffset: 11
        } ) ]
    } );

    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.start.character, 0 );
    assert.equal( harness.recorded[ 0 ].ranges[ 0 ].range.end.character, 16 );
    assert.equal( harness.decorationLog[ 0 ].isWholeLine, true );
} );

QUnit.test( "none suppresses all editor decorations", function( assert )
{
    var harness = createHarness( {
        type: 'none',
        text: '// TODO body',
        matches: [ createMatch( {
            commentStartOffset: 0,
            commentEndOffset: 12,
            matchStartOffset: 3,
            matchEndOffset: 12,
            tagStartOffset: 3,
            tagEndOffset: 7
        } ) ]
    } );

    assert.equal( harness.recorded.length, 0 );
} );
