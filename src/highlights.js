var vscode = require( 'vscode' );

var config = require( './config.js' );
var utils = require( './utils.js' );
var attributes = require( './attributes.js' );
var icons = require( './icons.js' );
var detection = require( './detection.js' );
var identity = require( './extensionIdentity.js' );

var captureGroupArgument = "capture-groups";

var lanes =
{
    "none": undefined,
    "left": 1,
    "center": 2,
    "right": 4,
    "full": 7
};

var decorations = {};
var decorationCache = new Map();
var highlightTimer = {};
var highlightVersions = {};
var context;
var debug;
var scanResultsProvider = function( document ) { return detection.scanDocument( document ); };

function init( context_, debug_ )
{
    context = context_;
    debug = debug_;
    context.subscriptions.push( {
        dispose: resetCaches
    } );
}

function applyOpacity( colour, opacity )
{
    if( utils.isHexColour( colour ) )
    {
        colour = utils.hexToRgba( colour, opacity < 1 ? opacity * 100 : opacity );
    }
    else if( utils.isRgbColour( colour ) )
    {
        if( opacity !== 100 )
        {
            colour = utils.setRgbAlpha( colour, opacity > 1 ? opacity / 100 : opacity );
        }
    }

    return colour;
}

function decorationSignature( tag )
{
    var lane = getRulerLane( tag );
    var normalizedLane = isNaN( parseInt( lane ) ) ? String( lane ).toLowerCase() : String( lane );
    var iconPath = showInGutter( tag ) ? icons.getGutterIcon( context, tag, debug ).dark : '';

    return JSON.stringify( {
        tag: tag,
        foreground: attributes.getForeground( tag ),
        background: attributes.getBackground( tag ),
        opacity: getOpacity( tag ),
        rulerLane: normalizedLane,
        rulerColour: getRulerColour( tag, 'editor.foreground' ),
        rulerOpacity: getRulerOpacity( tag ),
        borderRadius: getBorderRadius( tag ),
        fontStyle: getFontStyle( tag ),
        fontWeight: getFontWeight( tag ),
        textDecoration: getTextDecoration( tag ),
        type: getType( tag ),
        gutterIconPath: iconPath
    } );
}

function createDecoration( tag )
{
    var foregroundColour = attributes.getForeground( tag );
    var backgroundColour = attributes.getBackground( tag );

    var opacity = getOpacity( tag );

    var lightForegroundColour = foregroundColour;
    var darkForegroundColour = foregroundColour;
    var lightBackgroundColour = backgroundColour;
    var darkBackgroundColour = backgroundColour;

    if( foregroundColour )
    {
        if( foregroundColour.match( /(foreground|background)/i ) )
        {
            lightForegroundColour = new vscode.ThemeColor( foregroundColour );
            darkForegroundColour = new vscode.ThemeColor( foregroundColour );
        }
        else if( !utils.isValidColour( foregroundColour ) )
        {
            lightForegroundColour = new vscode.ThemeColor( 'editor.foreground' );
            darkForegroundColour = new vscode.ThemeColor( 'editor.foreground' );
        }
    }

    if( backgroundColour )
    {
        if( backgroundColour.match( /(foreground|background)/i ) )
        {
            lightBackgroundColour = new vscode.ThemeColor( backgroundColour );
            darkBackgroundColour = new vscode.ThemeColor( backgroundColour );
        }
        else if( !utils.isValidColour( backgroundColour ) )
        {
            lightBackgroundColour = new vscode.ThemeColor( 'editor.background' );
            darkBackgroundColour = new vscode.ThemeColor( 'editor.background' );
        }

        lightBackgroundColour = applyOpacity( lightBackgroundColour, opacity );
        darkBackgroundColour = applyOpacity( darkBackgroundColour, opacity );
    }

    if( lightForegroundColour === undefined && utils.isHexColour( lightBackgroundColour ) )
    {
        lightForegroundColour = utils.complementaryColour( lightBackgroundColour );
    }
    if( darkForegroundColour === undefined && utils.isHexColour( darkBackgroundColour ) )
    {
        darkForegroundColour = utils.complementaryColour( darkBackgroundColour );
    }

    if( lightBackgroundColour === undefined && lightForegroundColour === undefined )
    {
        lightBackgroundColour = new vscode.ThemeColor( 'editor.foreground' );
        lightForegroundColour = new vscode.ThemeColor( 'editor.background' );
    }

    if( darkBackgroundColour === undefined && darkForegroundColour === undefined )
    {
        darkBackgroundColour = new vscode.ThemeColor( 'editor.foreground' );
        darkForegroundColour = new vscode.ThemeColor( 'editor.background' );
    }

    var lane = getRulerLane( tag );
    if( isNaN( parseInt( lane ) ) )
    {
        lane = lanes[ lane.toLowerCase() ];
    }
    var decorationOptions = {
        borderRadius: getBorderRadius( tag ),
        isWholeLine: getType( tag ) === 'whole-line',
        fontWeight: getFontWeight( tag ),
        fontStyle: getFontStyle( tag ),
        textDecoration: getTextDecoration( tag ),
        gutterIconPath: showInGutter( tag ) ? icons.getGutterIcon( context, tag, debug ).dark : undefined
    };

    if( lane !== undefined )
    {
        var rulerColour = getRulerColour( tag, darkBackgroundColour ? darkBackgroundColour : 'editor.foreground' );
        var rulerOpacity = getRulerOpacity( tag );

        if( utils.isThemeColour( rulerColour ) )
        {
            rulerColour = new vscode.ThemeColor( rulerColour );
        }
        else
        {
            rulerColour = applyOpacity( rulerColour, rulerOpacity );
        }

        decorationOptions.overviewRulerColor = rulerColour;
        decorationOptions.overviewRulerLane = lane;
    }

    decorationOptions.light = { backgroundColor: lightBackgroundColour, color: lightForegroundColour };
    decorationOptions.dark = { backgroundColor: darkBackgroundColour, color: darkForegroundColour };

    return vscode.window.createTextEditorDecorationType( decorationOptions );
}

function getDecoration( tag )
{
    var signature = decorationSignature( tag );

    if( decorationCache.has( signature ) )
    {
        return decorationCache.get( signature );
    }

    var decoration = createDecoration( tag );
    decorationCache.set( signature, decoration );
    return decoration;
}

function getRulerColour( tag, defaultColour )
{
    return attributes.getAttribute( tag, 'rulerColour', defaultColour );
}

function getRulerLane( tag )
{
    return attributes.getAttribute( tag, 'rulerLane', 4 );
}

function getOpacity( tag )
{
    return attributes.getAttribute( tag, 'opacity', 100 );
}

function getRulerOpacity( tag )
{
    return attributes.getAttribute( tag, 'rulerOpacity', 100 );
}

function getBorderRadius( tag )
{
    return attributes.getAttribute( tag, 'borderRadius', '0.2em' );
}

function getFontStyle( tag )
{
    return attributes.getAttribute( tag, 'fontStyle', 'normal' );
}

function getFontWeight( tag )
{
    return attributes.getAttribute( tag, 'fontWeight', 'normal' );
}

function getTextDecoration( tag )
{
    return attributes.getAttribute( tag, 'textDecoration', '' );
}

function showInGutter( tag )
{
    return attributes.getAttribute( tag, 'gutterIcon', false );
}

function getType( tag )
{
    return attributes.getAttribute( tag, 'type', identity.getSetting( 'highlights.highlight', undefined ) );
}

function editorId( editor )
{
    var id = "";
    if( editor.document )
    {
        id = JSON.stringify( editor.document.uri );
    }
    if( editor.viewColumn )
    {
        id += editor.viewColumn;
    }
    return id;
}

function highlight( editor )
{
    function addDecoration( tag, startOffset, endOffset )
    {
        if( startOffset === undefined || endOffset === undefined )
        {
            return;
        }

        if( endOffset < startOffset )
        {
            var previousStart = startOffset;
            startOffset = endOffset;
            endOffset = previousStart;
        }

        var startPos = editor.document.positionAt( startOffset );
        var endPos = editor.document.positionAt( endOffset );
        var decoration = { range: new vscode.Range( startPos, endPos ) };
        if( documentHighlights[ tag ] === undefined )
        {
            documentHighlights[ tag ] = [];
        }
        documentHighlights[ tag ].push( decoration );
    }

    var documentHighlights = {};
    var subTagHighlights = {};
    if( editor )
    {
        var id = editorId( editor );
        var previousDecorations = decorations[ id ] || [];
        var nextDecorations = [];

        if( identity.getSetting( 'highlights.enabled', true ) )
        {
            scanResultsProvider( editor.document ).forEach( function( match )
            {
                var tag = config.tagGroup( match.actualTag ) || match.actualTag;
                var type = getType( tag );
                if( type !== 'none' )
                {
                    if( type === 'text-and-comment' )
                    {
                        addDecoration( tag, match.commentStartOffset, match.commentEndOffset );
                    }
                    else if( type === 'text' )
                    {
                        addDecoration( tag, match.matchStartOffset, match.matchEndOffset );
                    }
                    else if( type !== undefined && type.indexOf( captureGroupArgument + ":" ) === 0 )
                    {
                        type.substring( type.indexOf( ':' ) + 1 ).split( ',' ).map( function( groupText )
                        {
                            var group = parseInt( groupText );
                            if( match.captureGroupOffsets && match.captureGroupOffsets[ group ] )
                            {
                                addDecoration( tag, match.captureGroupOffsets[ group ][ 0 ], match.captureGroupOffsets[ group ][ 1 ] );
                            }
                        } );
                    }
                    else if( type === 'tag-and-subTag' || type === 'tag-and-subtag' )
                    {
                        addDecoration( tag, match.tagStartOffset, match.tagEndOffset );

                        if( match.subTag && attributes.hasCustomHighlight( match.subTag ) && match.subTagStartOffset !== undefined && match.subTagEndOffset !== undefined )
                        {
                            var subTagDecoration = {
                                range: new vscode.Range(
                                    editor.document.positionAt( match.subTagStartOffset ),
                                    editor.document.positionAt( match.subTagEndOffset ) )
                            };
                            if( subTagHighlights[ match.subTag ] === undefined )
                            {
                                subTagHighlights[ match.subTag ] = [];
                            }
                            subTagHighlights[ match.subTag ].push( subTagDecoration );
                        }
                    }
                    else if( type === 'tag-and-comment' )
                    {
                        addDecoration( tag, match.commentStartOffset, match.tagEndOffset );
                    }
                    else if( type === 'line' || type === 'whole-line' )
                    {
                        var lineStart = new vscode.Position( editor.document.positionAt( match.commentStartOffset ).line, 0 );
                        var lineEnd = editor.document.lineAt( editor.document.positionAt( match.commentEndOffset ).line ).range.end;
                        var lineDecoration = { range: new vscode.Range( lineStart, lineEnd ) };
                        if( documentHighlights[ tag ] === undefined )
                        {
                            documentHighlights[ tag ] = [];
                        }
                        documentHighlights[ tag ].push( lineDecoration );
                    }
                    else
                    {
                        addDecoration( tag, match.tagStartOffset, match.tagEndOffset );
                    }
                }
            } );

            Object.keys( documentHighlights ).forEach( function( tag )
            {
                var decoration = getDecoration( tag );
                nextDecorations.push( decoration );
                editor.setDecorations( decoration, documentHighlights[ tag ] );
            } );

            Object.keys( subTagHighlights ).forEach( function( subTag )
            {
                var decoration = getDecoration( subTag );
                nextDecorations.push( decoration );
                editor.setDecorations( decoration, subTagHighlights[ subTag ] );
            } );
        }

        previousDecorations.forEach( function( decoration )
        {
            if( nextDecorations.indexOf( decoration ) === -1 )
            {
                editor.setDecorations( decoration, [] );
            }
        } );

        decorations[ id ] = nextDecorations;
    }
}

function triggerHighlight( editor )
{
    if( editor )
    {
        var id = editorId( editor );
        var version = editor.document ? editor.document.version : undefined;

        if( highlightTimer[ id ] )
        {
            clearTimeout( highlightTimer[ id ] );
        }

        highlightVersions[ id ] = version;
        highlightTimer[ id ] = setTimeout( function( scheduledEditor, scheduledVersion )
        {
            if( scheduledEditor.document && scheduledVersion !== undefined && scheduledEditor.document.version !== scheduledVersion )
            {
                return;
            }

            highlight( scheduledEditor );
        }, identity.getSetting( 'highlights.highlightDelay', 500 ), editor, version );
    }
}

function setScanResultsProvider( provider )
{
    scanResultsProvider = typeof ( provider ) === 'function' ? provider : function( document )
    {
        return detection.scanDocument( document );
    };
}

function resetCaches()
{
    Object.keys( highlightTimer ).forEach( function( key )
    {
        clearTimeout( highlightTimer[ key ] );
        delete highlightTimer[ key ];
    } );

    Object.keys( decorations ).forEach( function( key )
    {
        delete decorations[ key ];
    } );

    decorationCache.forEach( function( decoration )
    {
        decoration.dispose();
    } );
    decorationCache.clear();
}

module.exports.init = init;
module.exports.getDecoration = getDecoration;
module.exports.highlight = highlight;
module.exports.triggerHighlight = triggerHighlight;
module.exports.setScanResultsProvider = setScanResultsProvider;
module.exports.resetCaches = resetCaches;
