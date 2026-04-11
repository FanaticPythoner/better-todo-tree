var path = require( 'path' );

var utils = require( './utils.js' );

function getUriFsPath( uri )
{
    if( uri === undefined || uri === null )
    {
        return "";
    }

    if( typeof ( uri ) === 'string' )
    {
        return uri;
    }

    return uri.fsPath || uri.path || uri.toString();
}

function createLineOffsets( text )
{
    var offsets = [ 0 ];
    var index = 0;

    while( index < text.length )
    {
        if( text[ index ] === '\n' )
        {
            offsets.push( index + 1 );
        }
        index++;
    }

    return offsets;
}

function offsetToPosition( lineOffsets, offset )
{
    var low = 0;
    var high = lineOffsets.length - 1;

    while( low <= high )
    {
        var mid = Math.floor( ( low + high ) / 2 );
        if( lineOffsets[ mid ] <= offset )
        {
            if( mid === lineOffsets.length - 1 || lineOffsets[ mid + 1 ] > offset )
            {
                return {
                    line: mid,
                    character: offset - lineOffsets[ mid ]
                };
            }
            low = mid + 1;
        }
        else
        {
            high = mid - 1;
        }
    }

    return {
        line: 0,
        character: offset
    };
}

function offsetFromLineAndColumn( text, lineOffsets, line, column )
{
    if( line < 1 )
    {
        return 0;
    }

    var start = lineOffsets[ line - 1 ] || 0;
    var offset = start + Math.max( column - 1, 0 );
    return Math.min( offset, text.length );
}

function splitPhysicalLines( text, startOffset )
{
    var lines = [];
    var index = 0;

    while( index <= text.length )
    {
        var lineStart = index;
        var lineEndingLength = 0;

        while( index < text.length && text[ index ] !== '\n' && text[ index ] !== '\r' )
        {
            index++;
        }

        if( index < text.length )
        {
            if( text[ index ] === '\r' && index + 1 < text.length && text[ index + 1 ] === '\n' )
            {
                lineEndingLength = 2;
            }
            else
            {
                lineEndingLength = 1;
            }
        }

        var rawText = text.slice( lineStart, index );
        lines.push( {
            rawText: rawText,
            rawStartOffset: startOffset + lineStart,
            rawEndOffset: startOffset + index
        } );

        if( index >= text.length )
        {
            break;
        }

        index += lineEndingLength;
    }

    return lines;
}

function trimCommentLine( lineText, options )
{
    var rawText = lineText;
    var contentStart = 0;
    var contentEnd = rawText.length;

    if( options.type === 'singleline' )
    {
        var leading = rawText.match( /^[ \t]*/ );
        contentStart = leading ? leading[ 0 ].length : 0;

        var singleLineToken = options.singleLineTokens.filter( function( token )
        {
            return rawText.slice( contentStart ).indexOf( token.start ) === 0;
        } ).sort( function( a, b )
        {
            return b.start.length - a.start.length;
        } )[ 0 ];

        if( singleLineToken )
        {
            contentStart += singleLineToken.start.length;
            if( rawText[ contentStart ] === ' ' )
            {
                contentStart++;
            }
        }
    }
    else if( options.type === 'multiline' )
    {
        var trimmedStart = rawText.match( /^[ \t]*/ );
        var baseStart = trimmedStart ? trimmedStart[ 0 ].length : 0;
        var workingText = rawText.slice( baseStart );
        var startToken = options.startToken;
        var middleToken = options.middleToken;
        var endToken = options.endToken;
        var startMatch = startToken ? findTokenStart( workingText, startToken, 0 ) : undefined;

        if( startMatch && startMatch.index === 0 )
        {
            contentStart = baseStart + startMatch.length;
            if( rawText[ contentStart ] === ' ' )
            {
                contentStart++;
            }
        }
        else
        {
            contentStart = baseStart;
            if( middleToken && workingText.indexOf( middleToken ) === 0 )
            {
                contentStart = baseStart + middleToken.length;
                if( rawText[ contentStart ] === ' ' )
                {
                    contentStart++;
                }
            }
        }

        if( endToken )
        {
            var trimmedRight = rawText.replace( /[ \t]+$/, '' );
            if( trimmedRight.endsWith( endToken ) )
            {
                contentEnd = rawText.lastIndexOf( endToken );
                while( contentEnd > contentStart && rawText[ contentEnd - 1 ] === ' ' )
                {
                    contentEnd--;
                }
            }
        }
    }

    if( contentEnd < contentStart )
    {
        contentEnd = contentStart;
    }

    return {
        contentText: rawText.slice( contentStart, contentEnd ),
        contentStartDelta: contentStart,
        contentEndDelta: contentEnd
    };
}

function createNormalizedCommentLines( wholeCommentText, commentOffset, pattern, variant )
{
    var lines = splitPhysicalLines( wholeCommentText, commentOffset );
    var options = {
        type: variant.type,
        singleLineTokens: pattern.singleLineComment || [],
        startToken: undefined,
        middleToken: undefined,
        endToken: undefined
    };

    if( variant.type === 'multiline' && pattern.multiLineComment && pattern.multiLineComment.length > 0 )
    {
        var firstLineText = lines.length > 0 ? lines[ 0 ].rawText.trimLeft() : "";
        var lastLineText = lines.length > 0 ? lines[ lines.length - 1 ].rawText.trimRight() : "";
        var chosenPattern = pattern.multiLineComment.find( function( entry )
        {
            var startMatch = findTokenStart( firstLineText, entry.start, 0 );
            return typeof ( entry.end ) === 'string' && startMatch && startMatch.index === 0 && lastLineText.endsWith( entry.end );
        } );

        if( chosenPattern === undefined )
        {
            chosenPattern = pattern.multiLineComment.find( function( entry )
            {
                return entry.start !== undefined && typeof ( entry.end ) === 'string';
            } );
        }

        if( chosenPattern )
        {
            options.startToken = chosenPattern.start;
            options.middleToken = chosenPattern.middle || "";
            options.endToken = chosenPattern.end;
        }
    }

    return lines.map( function( line )
    {
        var trimmed = trimCommentLine( line.rawText, options );
        return {
            text: trimmed.contentText,
            rawCommentStartOffset: line.rawStartOffset,
            rawCommentEndOffset: line.rawEndOffset,
            contentStartOffset: line.rawStartOffset + trimmed.contentStartDelta,
            contentEndOffset: line.rawStartOffset + trimmed.contentEndDelta
        };
    } );
}

function toGlobalRegex( regex )
{
    var flags = regex.flags.indexOf( 'g' ) === -1 ? regex.flags + 'g' : regex.flags;
    return new RegExp( regex.source, flags );
}

function findTokenStart( text, startPattern, cursor )
{
    if( typeof ( startPattern ) === 'string' )
    {
        var startIndex = text.indexOf( startPattern, cursor );
        return startIndex === -1 ? undefined : { index: startIndex, length: startPattern.length };
    }

    var regex = toGlobalRegex( startPattern );
    regex.lastIndex = cursor;
    var match = regex.exec( text );
    if( match )
    {
        return {
            index: match.index,
            length: match[ 0 ].length
        };
    }

    return undefined;
}

function splitTextLines( text )
{
    return splitPhysicalLines( text, 0 );
}

function createPassThroughLines( text )
{
    return splitPhysicalLines( text, 0 ).map( function( line )
    {
        return {
            text: line.rawText,
            rawCommentStartOffset: line.rawStartOffset,
            rawCommentEndOffset: line.rawEndOffset,
            contentStartOffset: line.rawStartOffset,
            contentEndOffset: line.rawEndOffset
        };
    } );
}

var markdownTaskListPrefixSource = '[ \\t]*(?:[-*+]|\\d+\\.)\\s*';
var markdownTaskListLineRegex = new RegExp( '^(' + markdownTaskListPrefixSource + ')\\[[ xX]\\]' );

function sortResultsByLocation( results )
{
    results.sort( function( a, b )
    {
        return a.matchStartOffset - b.matchStartOffset ||
            a.commentStartOffset - b.commentStartOffset ||
            a.tagStartOffset - b.tagStartOffset;
    } );

    return results;
}

function scanMultiLineCommentBlocks( text, pattern )
{
    if( !pattern.multiLineComment )
    {
        return [];
    }

    var seen = new Set();
    var blocks = [];

    pattern.multiLineComment.forEach( function( entry )
    {
        var cursor = 0;
        while( cursor < text.length )
        {
            var start = findTokenStart( text, entry.start, cursor );
            if( start === undefined )
            {
                break;
            }

            var endIndex = text.indexOf( entry.end, start.index + start.length );
            if( endIndex === -1 )
            {
                break;
            }

            var blockStart = start.index;
            var blockEnd = endIndex + entry.end.length;
            var key = blockStart + ":" + blockEnd;
            if( seen.has( key ) !== true )
            {
                seen.add( key );
                blocks.push( {
                    startOffset: blockStart,
                    wholeCommentText: text.slice( blockStart, blockEnd ),
                    variant: {
                        type: 'multiline'
                    }
                } );
            }

            cursor = blockEnd;
        }
    } );

    blocks.sort( function( a, b ) { return a.startOffset - b.startOffset; } );
    return blocks;
}

function isInsideMultiLineBlock( offset, multiLineBlocks )
{
    return multiLineBlocks.some( function( block )
    {
        return offset >= block.startOffset && offset < block.startOffset + block.wholeCommentText.length;
    } );
}

function collectCommentPatternMatches( uri, text, pattern, lineOffsets, resourceConfig )
{
    var results = [];
    var multiLineBlocks = scanMultiLineCommentBlocks( text, pattern );

    multiLineBlocks.forEach( function( block )
    {
        var normalizedLines = createNormalizedCommentLines( block.wholeCommentText, block.startOffset, pattern, block.variant );
        results = results.concat( collectLogicalCommentMatches( uri, normalizedLines, lineOffsets, resourceConfig ) );
    } );

    scanSingleLineCommentBlocks( text, pattern, multiLineBlocks ).forEach( function( normalizedLines )
    {
        results = results.concat( collectLogicalCommentMatches( uri, normalizedLines, lineOffsets, resourceConfig ) );
    } );

    return results;
}

function resolveMarkdownCommentPattern()
{
    var markdownCommentPattern = utils.getCommentPattern( '.html' );

    if( markdownCommentPattern === undefined )
    {
        throw new Error( 'HTML comment pattern is required for Markdown scanning.' );
    }

    return markdownCommentPattern;
}

function scanMarkdownText( uri, text, pattern, lineOffsets, resourceConfig )
{
    var markdownCommentPattern = resolveMarkdownCommentPattern();
    var results = collectCommentPatternMatches( uri, text, markdownCommentPattern, lineOffsets, resourceConfig );
    var markdownTaskLines = createPassThroughLines( text ).filter( function( line )
    {
        markdownTaskListLineRegex.lastIndex = 0;
        return markdownTaskListLineRegex.test( line.text );
    } );

    if( markdownTaskLines.length > 0 )
    {
        results = results.concat( collectLogicalCommentMatches( uri, markdownTaskLines, lineOffsets, resourceConfig, { allowMarkdownPrefix: true } ) );
    }

    return sortResultsByLocation( results );
}

function scanSingleLineCommentBlocks( text, pattern, multiLineBlocks )
{
    if( !pattern.singleLineComment )
    {
        return [];
    }

    var blocks = [];
    var currentBlock = [];

    function pushCurrentBlock()
    {
        if( currentBlock.length > 0 )
        {
            blocks.push( currentBlock );
            currentBlock = [];
        }
    }

    splitTextLines( text ).forEach( function( line )
    {
        var bestMatch = undefined;

        pattern.singleLineComment.forEach( function( entry )
        {
            var index = line.rawText.indexOf( entry.start );
            if( index !== -1 )
            {
                var absoluteIndex = line.rawStartOffset + index;
                if( isInsideMultiLineBlock( absoluteIndex, multiLineBlocks ) !== true )
                {
                    if(
                        bestMatch === undefined ||
                        index < bestMatch.index ||
                        ( index === bestMatch.index && entry.start.length > bestMatch.startToken.length )
                    )
                    {
                        bestMatch = {
                            index: index,
                            startToken: entry.start
                        };
                    }
                }
            }
        } );

        if( bestMatch )
        {
            var contentStartOffset = line.rawStartOffset + bestMatch.index + bestMatch.startToken.length;
            if( text[ contentStartOffset ] === ' ' )
            {
                contentStartOffset++;
            }

            currentBlock.push( {
                text: text.slice( contentStartOffset, line.rawEndOffset ),
                rawCommentStartOffset: line.rawStartOffset + bestMatch.index,
                rawCommentEndOffset: line.rawEndOffset,
                contentStartOffset: contentStartOffset,
                contentEndOffset: line.rawEndOffset
            } );
        }
        else
        {
            pushCurrentBlock();
        }
    } );

    pushCurrentBlock();
    return blocks;
}

function findActualTag( tags, tag, caseSensitive )
{
    return tags.find( function( configuredTag )
    {
        if( caseSensitive )
        {
            return configuredTag === tag;
        }

        return configuredTag.toLowerCase() === tag.toLowerCase();
    } ) || tag;
}

function buildBuiltInTagRegex( resourceConfig, allowMarkdownPrefix )
{
    var flags = resourceConfig.regexCaseSensitive === true ? '' : 'i';
    var prefix = allowMarkdownPrefix === true ? '(' + markdownTaskListPrefixSource + ')' : '(\\s*)';
    return new RegExp( '^' + prefix + '(' + utils.getTagRegexSource( undefined, resourceConfig.tags ) + ')(?![A-Za-z0-9_])', flags );
}

function collectLogicalCommentMatches( uri, normalizedLines, lineOffsets, resourceConfig, options )
{
    var results = [];
    var tagRegex = buildBuiltInTagRegex( resourceConfig, options && options.allowMarkdownPrefix === true );
    var current = undefined;

    function finalizeCurrent()
    {
        if( current === undefined )
        {
            return;
        }

        var firstLine = current.lines[ 0 ];
        var logicalTextLines = current.lines.map( function( line ) { return line.text; } );
        var extracted = utils.extractTag( firstLine.text, undefined, uri );
        var actualTag = extracted.tag && extracted.tag.length > 0 ? extracted.tag : current.tag;
        var displayText = ( extracted.after || "" ).trim();

        if( displayText.length === 0 )
        {
            displayText = ( extracted.before || "" ).trim();
        }
        if( displayText.length === 0 )
        {
            displayText = firstLine.text.trim();
        }
        if( displayText.length === 0 )
        {
            displayText = actualTag;
        }

        var continuationText = logicalTextLines.slice( 1 ).map( function( line ) { return line.trim(); } ).filter( function( line ) { return line.length > 0; } );
        var tagStart = offsetToPosition( lineOffsets, current.tagStartOffset );
        var textEndOffset = current.lines.reduce( function( latest, line )
        {
            return line.contentEndOffset > latest ? line.contentEndOffset : latest;
        }, current.tagEndOffset );
        var endPosition = offsetToPosition( lineOffsets, textEndOffset );
        var subTagStartOffset = extracted.subTagOffset !== undefined ? firstLine.contentStartOffset + extracted.subTagOffset : undefined;

        results.push( {
            uri: uri,
            fsPath: getUriFsPath( uri ),
            line: tagStart.line + 1,
            column: tagStart.character + 1,
            endLine: endPosition.line + 1,
            endColumn: endPosition.character + 1,
            tag: actualTag,
            actualTag: actualTag,
            subTag: extracted.subTag,
            before: ( extracted.before || "" ).trim(),
            after: displayText,
            match: logicalTextLines.join( '\n' ),
            displayText: displayText,
            continuationText: continuationText,
            commentStartOffset: current.lines[ 0 ].rawCommentStartOffset,
            commentEndOffset: current.lines[ current.lines.length - 1 ].rawCommentEndOffset,
            matchStartOffset: current.tagStartOffset,
            matchEndOffset: textEndOffset,
            tagStartOffset: current.tagStartOffset,
            tagEndOffset: current.tagEndOffset,
            subTagStartOffset: subTagStartOffset,
            subTagEndOffset: subTagStartOffset !== undefined && extracted.subTag ? subTagStartOffset + extracted.subTag.length : undefined
        } );

        current = undefined;
    }

    normalizedLines.forEach( function( line )
    {
        tagRegex.lastIndex = 0;
        var tagMatch = tagRegex.exec( line.text );

        if( tagMatch )
        {
            finalizeCurrent();

            var tagPrefixLength = tagMatch[ 1 ] ? tagMatch[ 1 ].length : 0;
            var actualTag = findActualTag( resourceConfig.tags, tagMatch[ 2 ], resourceConfig.regexCaseSensitive === true );
            var tagStartOffset = line.contentStartOffset + tagPrefixLength;

            current = {
                tag: actualTag,
                tagStartOffset: tagStartOffset,
                tagEndOffset: tagStartOffset + tagMatch[ 2 ].length,
                lines: [ line ]
            };
        }
        else if( current )
        {
            current.lines.push( line );
        }
    } );

    finalizeCurrent();

    return results;
}

function scanCommentPatternText( uri, text, resourceConfig )
{
    var fsPath = getUriFsPath( uri );
    var pattern = utils.getCommentPattern( fsPath );
    var lineOffsets = createLineOffsets( text );

    if( pattern === undefined )
    {
        var genericLines = createPassThroughLines( text );
        return collectLogicalCommentMatches( uri, genericLines, lineOffsets, resourceConfig );
    }

    if( pattern.commentsOnly === true )
    {
        if( path.extname( fsPath ).toLowerCase() === '.md' || pattern.name === 'Markdown' )
        {
            return scanMarkdownText( uri, text, pattern, lineOffsets, resourceConfig );
        }

        return [];
    }

    return collectCommentPatternMatches( uri, text, pattern, lineOffsets, resourceConfig );
}

function normalizeRegexExecMatch( uri, text, match, resourceConfig )
{
    if( !match || match[ 0 ] === undefined || match[ 0 ].length === 0 )
    {
        return undefined;
    }

    var lineOffsets = createLineOffsets( text );
    var matchText = match[ 0 ];
    var rawStartOffset = match.index;
    var rawEndOffset = rawStartOffset + matchText.length;
    var extracted = utils.extractTag( matchText, undefined, uri );
    var actualTag = extracted.tag && extracted.tag.length > 0 ? extracted.tag : matchText;
    var tagStartOffset = extracted.tag && extracted.tagOffset !== undefined ? rawStartOffset + extracted.tagOffset : rawStartOffset;
    var tagEndOffset = extracted.tag && extracted.tag.length > 0 ? tagStartOffset + extracted.tag.length : rawEndOffset;
    var originalLines = matchText.split( /\r?\n/ );
    var displayText = ( extracted.after || "" ).split( /\r?\n/ )[ 0 ].trim();

    if( displayText.length === 0 )
    {
        displayText = ( extracted.before || "" ).split( /\r?\n/ )[ 0 ].trim();
    }
    if( displayText.length === 0 )
    {
        displayText = originalLines[ 0 ].trim();
    }
    if( displayText.length === 0 && extracted.tag )
    {
        displayText = extracted.tag;
    }

    var continuationText = originalLines.slice( 1 ).map( function( line ) { return line.trim(); } ).filter( function( line ) { return line.length > 0; } );
    var startPosition = offsetToPosition( lineOffsets, tagStartOffset );
    var endPosition = offsetToPosition( lineOffsets, rawEndOffset );
    var subTagStartOffset = extracted.subTagOffset !== undefined ? rawStartOffset + extracted.subTagOffset : undefined;

    var result = {
        uri: uri,
        fsPath: getUriFsPath( uri ),
        line: startPosition.line + 1,
        column: startPosition.character + 1,
        endLine: endPosition.line + 1,
        endColumn: endPosition.character + 1,
        tag: actualTag,
        actualTag: actualTag,
        subTag: extracted.subTag,
        before: ( extracted.before || "" ).trim(),
        after: displayText,
        match: matchText,
        displayText: displayText,
        continuationText: continuationText,
        commentStartOffset: rawStartOffset,
        commentEndOffset: rawEndOffset,
        matchStartOffset: rawStartOffset,
        matchEndOffset: rawEndOffset,
        tagStartOffset: tagStartOffset,
        tagEndOffset: tagEndOffset,
        subTagStartOffset: subTagStartOffset,
        subTagEndOffset: subTagStartOffset !== undefined && extracted.subTag ? subTagStartOffset + extracted.subTag.length : undefined
    };

    if( match.indices )
    {
        result.captureGroupOffsets = match.indices.map( function( range )
        {
            if( !range )
            {
                return undefined;
            }

            return [ rawStartOffset + ( range[ 0 ] - match.index ), rawStartOffset + ( range[ 1 ] - match.index ) ];
        } );
    }

    return result;
}

function normalizeRipgrepMatch( uri, text, match )
{
    if( !match || !match.match )
    {
        return undefined;
    }

    var resourceConfig = resolveResourceConfig( uri );
    var lineOffsets = createLineOffsets( text );
    var logicalText = match.match;
    if( match.extraLines && match.extraLines.length > 0 )
    {
        logicalText += '\n' + match.extraLines.map( function( extraLine ) { return extraLine.match; } ).join( '\n' );
    }

    var rawStartOffset = offsetFromLineAndColumn( text, lineOffsets, match.line, match.column );
    return normalizeRegexExecMatch( uri, text, {
        0: logicalText,
        index: rawStartOffset
    }, resourceConfig );
}

function resolveResourceConfig( uri )
{
    return utils.getResourceConfig( uri );
}

function scanText( uri, text )
{
    var resourceConfig = resolveResourceConfig( uri );

    if( resourceConfig.isDefaultRegex === true )
    {
        return scanCommentPatternText( uri, text, resourceConfig );
    }

    var regex = utils.getRegexForEditorSearch( true, uri, { includeIndices: true } );
    var results = [];
    var match;

    while( ( match = regex.exec( text ) ) !== null )
    {
        if( match[ 0 ].length === 0 )
        {
            regex.lastIndex++;
            continue;
        }

        var normalized = normalizeRegexExecMatch( uri, text, match, resourceConfig );
        if( normalized )
        {
            results.push( normalized );
        }
    }

    return results;
}

function scanDocument( document )
{
    return scanText( document.uri, document.getText() );
}

function normalizeRegexMatch( uri, text, match )
{
    if( match && Object.prototype.hasOwnProperty.call( match, 'fsPath' ) )
    {
        return normalizeRipgrepMatch( uri, text, match );
    }

    return normalizeRegexExecMatch( uri, text, match, resolveResourceConfig( uri ) );
}

module.exports.resolveResourceConfig = resolveResourceConfig;
module.exports.scanDocument = scanDocument;
module.exports.scanText = scanText;
module.exports.normalizeRegexMatch = normalizeRegexMatch;
