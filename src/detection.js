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

var tagCaptureGroupIndexCache = new Map();

function countCapturingGroups( source, endIndex )
{
    var count = 0;
    var escaped = false;
    var inCharacterClass = false;
    var index;

    for( index = 0; index < endIndex; ++index )
    {
        var character = source[ index ];

        if( escaped )
        {
            escaped = false;
            continue;
        }

        if( character === '\\' )
        {
            escaped = true;
            continue;
        }

        if( inCharacterClass )
        {
            if( character === ']' )
            {
                inCharacterClass = false;
            }
            continue;
        }

        if( character === '[' )
        {
            inCharacterClass = true;
            continue;
        }

        if( character !== '(' )
        {
            continue;
        }

        if( source[ index + 1 ] === '?' )
        {
            if( source[ index + 2 ] === '<' && source[ index + 3 ] !== '=' && source[ index + 3 ] !== '!' )
            {
                count++;
            }
            continue;
        }

        count++;
    }

    return count;
}

function getTagCaptureGroupIndex( regexSource )
{
    if( tagCaptureGroupIndexCache.has( regexSource ) )
    {
        return tagCaptureGroupIndexCache.get( regexSource );
    }

    var placeholderIndex = regexSource.indexOf( '($TAGS)' );
    var captureGroupIndex = placeholderIndex === -1 ? undefined : countCapturingGroups( regexSource, placeholderIndex ) + 1;

    tagCaptureGroupIndexCache.set( regexSource, captureGroupIndex );
    return captureGroupIndex;
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

function getLineBoundsForOffset( text, lineOffsets, offset )
{
    var boundedOffset = offset;

    if( text.length === 0 )
    {
        return {
            line: 0,
            startOffset: 0,
            endOffset: 0
        };
    }

    if( boundedOffset < 0 )
    {
        boundedOffset = 0;
    }
    else if( boundedOffset >= text.length )
    {
        boundedOffset = text.length - 1;
    }

    var position = offsetToPosition( lineOffsets, boundedOffset );
    var startOffset = lineOffsets[ position.line ] || 0;
    var endOffset = position.line + 1 < lineOffsets.length ? lineOffsets[ position.line + 1 ] - 1 : text.length;

    if( endOffset > startOffset && text[ endOffset - 1 ] === '\r' )
    {
        endOffset--;
    }

    return {
        line: position.line,
        startOffset: startOffset,
        endOffset: endOffset
    };
}

function findExactRegexExecMatch( context, startOffset )
{
    if( !context.exactRegex )
    {
        return undefined;
    }

    var regex = context.exactRegex;
    regex.lastIndex = startOffset;

    var exactMatch = regex.exec( context.text );

    if( exactMatch && exactMatch.index === startOffset )
    {
        return exactMatch;
    }

    return undefined;
}

function resolveTagCaptureRange( context, match, rawStartOffset )
{
    var tagCaptureGroupIndex = getTagCaptureGroupIndex( context.resourceConfig.regex );

    if( tagCaptureGroupIndex === undefined )
    {
        return undefined;
    }

    var indexedMatch = match;

    if( !indexedMatch.indices || indexedMatch.indices[ tagCaptureGroupIndex ] === undefined )
    {
        indexedMatch = findExactRegexExecMatch( context, rawStartOffset ) || indexedMatch;
    }

    if( indexedMatch.indices && indexedMatch.indices[ tagCaptureGroupIndex ] )
    {
        return indexedMatch.indices[ tagCaptureGroupIndex ];
    }

    if( typeof ( match[ tagCaptureGroupIndex ] ) === 'string' && match[ tagCaptureGroupIndex ].length > 0 )
    {
        var capturedTagOffset = match[ 0 ].indexOf( match[ tagCaptureGroupIndex ] );
        if( capturedTagOffset >= 0 )
        {
            return [
                rawStartOffset + capturedTagOffset,
                rawStartOffset + capturedTagOffset + match[ tagCaptureGroupIndex ].length
            ];
        }
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

function createAnchoredTagMatcher( tags, caseSensitive )
{
    var root = {};

    tags.forEach( function( tag )
    {
        var normalizedTag = caseSensitive === true ? tag : tag.toLowerCase();
        var node = root;

        Array.from( normalizedTag ).forEach( function( character )
        {
            if( node[ character ] === undefined )
            {
                node[ character ] = {};
            }

            node = node[ character ];
        } );

        node.tag = tag;
    } );

    return {
        match: function( text, allowMarkdownPrefix )
        {
            var prefixLength = 0;
            var node = root;
            var bestMatch;
            var normalizedText;
            var index;

            if( allowMarkdownPrefix === true )
            {
                markdownTaskListLineRegex.lastIndex = 0;
                var markdownPrefixMatch = markdownTaskListLineRegex.exec( text );
                if( !markdownPrefixMatch )
                {
                    return undefined;
                }
                prefixLength = markdownPrefixMatch[ 1 ] ? markdownPrefixMatch[ 1 ].length : 0;
            }
            else
            {
                var whitespaceMatch = text.match( /^\s*/ );
                prefixLength = whitespaceMatch ? whitespaceMatch[ 0 ].length : 0;
            }

            normalizedText = caseSensitive === true ? text : text.toLowerCase();

            for( index = prefixLength; index < normalizedText.length; ++index )
            {
                node = node[ normalizedText[ index ] ];
                if( node === undefined )
                {
                    break;
                }

                if( node.tag !== undefined )
                {
                    bestMatch = {
                        tag: node.tag,
                        prefixLength: prefixLength,
                        length: index - prefixLength + 1
                    };
                }
            }

            if( !bestMatch )
            {
                return undefined;
            }

            var boundaryCharacter = text[ prefixLength + bestMatch.length ];
            if( boundaryCharacter && /[A-Za-z0-9_]/.test( boundaryCharacter ) )
            {
                return undefined;
            }

            return bestMatch;
        }
    };
}

function createScanContext( uri, text, snapshot, options )
{
    options = options || {};

    var resourceConfig = snapshot && typeof ( snapshot.getResourceConfig ) === 'function' ?
        snapshot.getResourceConfig( uri ) :
        resolveResourceConfig( uri );
    var flags = resourceConfig.regexCaseSensitive === true ? '' : 'i';
    var regexSource = options.regexSource || utils.getRegexSource( uri );
    var tagRegex = resourceConfig.regex.indexOf( "$TAGS" ) > -1 ?
        new RegExp( '(' + utils.getTagRegexSource( uri, resourceConfig.tags ) + ')', flags ) :
        undefined;

    return {
        uri: uri,
        text: text,
        options: options,
        snapshot: snapshot,
        resourceConfig: resourceConfig,
        lineOffsets: createLineOffsets( text ),
        regexSource: regexSource,
        exactRegex: resourceConfig.isDefaultRegex === true ? undefined : utils.getRegexForEditorSearch( true, uri, {
            includeIndices: true,
            resourceConfig: resourceConfig,
            regexSource: regexSource
        } ),
        tagRegex: tagRegex,
        subTagRegex: new RegExp( resourceConfig.subTagRegex, flags ),
        tagMatcher: createAnchoredTagMatcher( resourceConfig.tags, resourceConfig.regexCaseSensitive === true ),
        patternFileName: options.patternFileName
    };
}

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
    var low = 0;
    var high = multiLineBlocks.length - 1;

    while( low <= high )
    {
        var mid = Math.floor( ( low + high ) / 2 );
        var block = multiLineBlocks[ mid ];
        var blockEnd = block.startOffset + block.wholeCommentText.length;

        if( offset < block.startOffset )
        {
            high = mid - 1;
        }
        else if( offset >= blockEnd )
        {
            low = mid + 1;
        }
        else
        {
            return true;
        }
    }

    return false;
}

function collectCommentPatternMatches( uri, text, pattern, lineOffsets, resourceConfig, options )
{
    var results = [];
    var multiLineBlocks = scanMultiLineCommentBlocks( text, pattern );

    multiLineBlocks.forEach( function( block )
    {
        var normalizedLines = createNormalizedCommentLines( block.wholeCommentText, block.startOffset, pattern, block.variant );
        results = results.concat( collectLogicalCommentMatches( uri, normalizedLines, lineOffsets, resourceConfig, options ) );
    } );

    scanSingleLineCommentBlocks( text, pattern, multiLineBlocks ).forEach( function( normalizedLines )
    {
        results = results.concat( collectLogicalCommentMatches( uri, normalizedLines, lineOffsets, resourceConfig, options ) );
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
    var context = createScanContext( uri, text, undefined, { regexSource: resourceConfig.regex } );
    context.resourceConfig = resourceConfig;
    context.lineOffsets = lineOffsets;
    var results = collectCommentPatternMatches( uri, text, markdownCommentPattern, lineOffsets, resourceConfig, { context: context } );
    var markdownTaskLines = createPassThroughLines( text ).filter( function( line )
    {
        markdownTaskListLineRegex.lastIndex = 0;
        return markdownTaskListLineRegex.test( line.text );
    } );

    if( markdownTaskLines.length > 0 )
    {
        results = results.concat( collectLogicalCommentMatches( uri, markdownTaskLines, lineOffsets, resourceConfig, {
            allowMarkdownPrefix: true,
            context: context
        } ) );
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

function collectLogicalCommentMatches( uri, normalizedLines, lineOffsets, resourceConfig, options )
{
    var results = [];
    var context = options && options.context ? options.context : createScanContext( uri, "", undefined, {
        regexSource: resourceConfig.regex,
        patternFileName: options && options.patternFileName
    } );
    context.resourceConfig = resourceConfig;
    context.lineOffsets = lineOffsets;
    var current = undefined;

    function finalizeCurrent()
    {
        if( current === undefined )
        {
            return;
        }

        var firstLine = current.lines[ 0 ];
        var logicalTextLines = current.lines.map( function( line ) { return line.text; } );
        var extracted = utils.extractTag( firstLine.text, undefined, uri, undefined, {
            resourceConfig: resourceConfig,
            tagRegex: context.tagRegex,
            subTagRegex: context.subTagRegex
        } );
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
        var tagMatch = context.tagMatcher.match( line.text, options && options.allowMarkdownPrefix === true );

        if( tagMatch )
        {
            finalizeCurrent();

            var actualTag = findActualTag( resourceConfig.tags, tagMatch.tag, resourceConfig.regexCaseSensitive === true );
            var tagStartOffset = line.contentStartOffset + tagMatch.prefixLength;

            current = {
                tag: actualTag,
                tagStartOffset: tagStartOffset,
                tagEndOffset: tagStartOffset + tagMatch.length,
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

function scanCommentPatternText( uri, text, resourceConfig, patternFileName )
{
    var fsPath = getUriFsPath( uri );
    var patternLookupName = patternFileName || fsPath;
    var pattern = utils.getCommentPattern( patternLookupName );
    var lineOffsets = createLineOffsets( text );
    var context = createScanContext( uri, text, undefined, {
        patternFileName: patternFileName,
        regexSource: resourceConfig.regex
    } );
    context.resourceConfig = resourceConfig;
    context.lineOffsets = lineOffsets;

    if( pattern === undefined )
    {
        return runRegexScan( context );
    }

    if( pattern.commentsOnly === true )
    {
        if( path.extname( patternLookupName ).toLowerCase() === '.md' || pattern.name === 'Markdown' )
        {
            return scanMarkdownText( uri, text, pattern, lineOffsets, resourceConfig );
        }

        return [];
    }

    return collectCommentPatternMatches( uri, text, pattern, lineOffsets, resourceConfig, {
        context: context,
        patternFileName: patternFileName
    } );
}

function normalizeRegexExecMatchWithContext( context, match )
{
    if( !match || match[ 0 ] === undefined || match[ 0 ].length === 0 )
    {
        return undefined;
    }

    var matchText = match[ 0 ];
    var rawStartOffset = match.index;
    var rawEndOffset = rawStartOffset + matchText.length;
    var logicalStartOffset = rawStartOffset;
    var logicalEndOffset = rawEndOffset;
    var preferredTagOffset;
    var tagCaptureRange = resolveTagCaptureRange( context, match, rawStartOffset );
    var tagStartOffset = tagCaptureRange ? tagCaptureRange[ 0 ] : undefined;
    var tagEndOffset = tagCaptureRange ? tagCaptureRange[ 1 ] : undefined;

    if( tagCaptureRange )
    {
        var startLineBounds = getLineBoundsForOffset( context.text, context.lineOffsets, rawStartOffset );
        var tagLineBounds = getLineBoundsForOffset( context.text, context.lineOffsets, tagStartOffset );

        if( tagLineBounds.line > startLineBounds.line )
        {
            logicalStartOffset = tagLineBounds.startOffset;

            var lastRenderedOffset = Math.max( rawEndOffset - 1, tagEndOffset - 1 );
            logicalEndOffset = getLineBoundsForOffset( context.text, context.lineOffsets, lastRenderedOffset ).endOffset;
            matchText = context.text.slice( logicalStartOffset, logicalEndOffset );
            preferredTagOffset = tagStartOffset - logicalStartOffset;
        }
        else if( context.resourceConfig.isDefaultRegex === true && tagLineBounds.endOffset > rawEndOffset )
        {
            logicalEndOffset = tagLineBounds.endOffset;
            matchText = context.text.slice( logicalStartOffset, logicalEndOffset );
            preferredTagOffset = tagStartOffset - logicalStartOffset;
        }
    }

    var extracted = utils.extractTag( matchText, undefined, context.uri, preferredTagOffset, {
        resourceConfig: context.resourceConfig,
        tagRegex: context.tagRegex,
        subTagRegex: context.subTagRegex
    } );
    var actualTag = extracted.tag && extracted.tag.length > 0 ? extracted.tag : matchText;

    if( tagStartOffset === undefined )
    {
        tagStartOffset = extracted.tag && extracted.tagOffset !== undefined ? logicalStartOffset + extracted.tagOffset : rawStartOffset;
    }
    if( tagEndOffset === undefined )
    {
        tagEndOffset = extracted.tag && extracted.tag.length > 0 ? tagStartOffset + extracted.tag.length : rawEndOffset;
    }

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
    var startPosition = offsetToPosition( context.lineOffsets, tagStartOffset );
    var endPosition = offsetToPosition( context.lineOffsets, logicalEndOffset );
    var subTagStartOffset = extracted.subTagOffset !== undefined ? logicalStartOffset + extracted.subTagOffset : undefined;

    var result = {
        uri: context.uri,
        fsPath: getUriFsPath( context.uri ),
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
        commentEndOffset: logicalEndOffset,
        matchStartOffset: tagStartOffset,
        matchEndOffset: logicalEndOffset,
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

    var context = createScanContext( uri, text );
    var rawStartOffset;

    if( match.absoluteOffset !== undefined && match.submatches && match.submatches.length > 0 )
    {
        rawStartOffset = match.absoluteOffset + match.submatches[ 0 ].start;
    }
    else
    {
        rawStartOffset = offsetFromLineAndColumn( text, context.lineOffsets, match.line, match.column );
    }

    var exactMatch = findExactRegexExecMatch( context, rawStartOffset );

    if( exactMatch )
    {
        return normalizeRegexExecMatchWithContext( context, exactMatch );
    }

    var logicalText = match.match;
    if( match.extraLines && match.extraLines.length > 0 )
    {
        logicalText += '\n' + match.extraLines.map( function( extraLine ) { return extraLine.match; } ).join( '\n' );
    }

    return normalizeRegexExecMatchWithContext( context, {
        0: logicalText,
        index: rawStartOffset
    } );
}

function shiftNormalizedResult( result, charOffset, lineOffset )
{
    [ 'commentStartOffset', 'commentEndOffset', 'matchStartOffset', 'matchEndOffset', 'tagStartOffset', 'tagEndOffset', 'subTagStartOffset', 'subTagEndOffset' ].forEach( function( field )
    {
        if( typeof result[ field ] === 'number' )
        {
            result[ field ] += charOffset;
        }
    } );

    if( Array.isArray( result.captureGroupOffsets ) )
    {
        result.captureGroupOffsets = result.captureGroupOffsets.map( function( range )
        {
            if( !range )
            {
                return undefined;
            }

            return [ range[ 0 ] + charOffset, range[ 1 ] + charOffset ];
        } );
    }

    if( typeof result.line === 'number' )
    {
        result.line += lineOffset;
    }
    if( typeof result.endLine === 'number' )
    {
        result.endLine += lineOffset;
    }

    return result;
}

function normalizeWorkspaceRegexMatch( uri, match, snapshot )
{
    if( !match )
    {
        return undefined;
    }

    var contextText = typeof match.lines === 'string' && match.lines.length > 0 ? match.lines : ( match.match || "" );
    var localMatchText = typeof match.match === 'string' && match.match.length > 0 ? match.match : contextText;
    var localMatchStart = match.submatches && match.submatches.length > 0 && typeof match.submatches[ 0 ].start === 'number' ?
        match.submatches[ 0 ].start :
        Math.max( ( match.column || 1 ) - 1, 0 );
    var context = createScanContext( uri, contextText, snapshot );
    var exactMatch = findExactRegexExecMatch( context, localMatchStart );
    var normalized = normalizeRegexExecMatchWithContext(
        context,
        exactMatch || {
            0: localMatchText,
            index: localMatchStart
        }
    );

    if( !normalized )
    {
        return undefined;
    }

    return shiftNormalizedResult(
        normalized,
        typeof match.absoluteOffset === 'number' ? match.absoluteOffset : 0,
        Math.max( ( match.line || 1 ) - 1, 0 )
    );
}

function resolveResourceConfig( uri )
{
    return utils.getResourceConfig( uri );
}

function resolveDocumentPatternFileName( document )
{
    if( !document )
    {
        return undefined;
    }

    return document.commentPatternFileName || document.fileName || getUriFsPath( document.uri );
}

function scanText( uri, text, options )
{
    return scanTextWithContext( createScanContext( uri, text, undefined, options ) );
}

function scanDocument( document )
{
    return scanDocumentWithContext( createScanContext( document.uri, document.getText(), undefined, {
        patternFileName: resolveDocumentPatternFileName( document )
    } ) );
}

function normalizeRegexMatch( uri, text, match )
{
    var context = createScanContext( uri, text );

    if( match && Object.prototype.hasOwnProperty.call( match, 'fsPath' ) )
    {
        return normalizeRipgrepMatch( uri, text, match );
    }

    return normalizeRegexExecMatchWithContext( context, match );
}

function ensureExactRegex( context )
{
    if( context.exactRegex )
    {
        return context.exactRegex;
    }

    context.exactRegex = utils.getRegexForEditorSearch( true, context.uri, {
        includeIndices: true,
        resourceConfig: context.resourceConfig
    } );

    return context.exactRegex;
}

function runRegexScan( context )
{
    var regex = ensureExactRegex( context );
    var results = [];
    var match;

    regex.lastIndex = 0;

    while( ( match = regex.exec( context.text ) ) !== null )
    {
        if( match[ 0 ].length === 0 )
        {
            regex.lastIndex++;
            continue;
        }

        var normalized = normalizeRegexExecMatchWithContext( context, match );
        if( normalized )
        {
            results.push( normalized );
        }
    }

    return results;
}

function getTrailingTextContentEnd( text )
{
    var end = text.length;

    while( end > 0 && ( text[ end - 1 ] === '\n' || text[ end - 1 ] === '\r' ) )
    {
        end--;
    }

    return end;
}

function getStreamingResultStartOffset( result )
{
    var startOffset;

    [ 'commentStartOffset', 'matchStartOffset', 'tagStartOffset', 'subTagStartOffset' ].forEach( function( field )
    {
        if( typeof result[ field ] === 'number' && ( startOffset === undefined || result[ field ] < startOffset ) )
        {
            startOffset = result[ field ];
        }
    } );

    return startOffset;
}

function getStreamingResultEndOffset( result )
{
    var endOffset;

    [ 'commentEndOffset', 'matchEndOffset', 'tagEndOffset', 'subTagEndOffset' ].forEach( function( field )
    {
        if( typeof result[ field ] === 'number' && ( endOffset === undefined || result[ field ] > endOffset ) )
        {
            endOffset = result[ field ];
        }
    } );

    if( Array.isArray( result.captureGroupOffsets ) )
    {
        result.captureGroupOffsets.forEach( function( range )
        {
            if( range && typeof range[ 1 ] === 'number' && ( endOffset === undefined || range[ 1 ] > endOffset ) )
            {
                endOffset = range[ 1 ];
            }
        } );
    }

    return endOffset;
}

function findTrailingUnclosedMultiLineCommentStart( text, pattern )
{
    if( !pattern || !Array.isArray( pattern.multiLineComment ) )
    {
        return undefined;
    }

    var openStartOffset;

    pattern.multiLineComment.forEach( function( entry )
    {
        if( !entry || entry.start === undefined || typeof entry.end !== 'string' || entry.end.length === 0 )
        {
            return;
        }

        var cursor = 0;

        while( cursor < text.length )
        {
            var start = findTokenStart( text, entry.start, cursor );

            if( start === undefined )
            {
                return;
            }

            var endIndex = text.indexOf( entry.end, start.index + start.length );

            if( endIndex === -1 )
            {
                if( openStartOffset === undefined || start.index < openStartOffset )
                {
                    openStartOffset = start.index;
                }
                return;
            }

            cursor = endIndex + entry.end.length;
        }
    } );

    return openStartOffset;
}

function resolveStreamingRetainOffset( context, results )
{
    if( !context || !context.resourceConfig || context.resourceConfig.isDefaultRegex !== true )
    {
        return undefined;
    }

    var retainOffset;
    var patternLookupName = context.patternFileName || getUriFsPath( context.uri );
    var pattern = utils.getCommentPattern( patternLookupName );
    var trailingTextEnd = getTrailingTextContentEnd( context.text || "" );

    if( pattern !== undefined )
    {
        var openCommentOffset = findTrailingUnclosedMultiLineCommentStart( context.text || "", pattern );

        if( typeof openCommentOffset === 'number' )
        {
            retainOffset = openCommentOffset;
        }
    }

    ( results || [] ).forEach( function( result )
    {
        var resultStart = getStreamingResultStartOffset( result );
        var resultEnd = getStreamingResultEndOffset( result );

        if( typeof resultStart !== 'number' || typeof resultEnd !== 'number' )
        {
            return;
        }

        if( resultEnd >= trailingTextEnd )
        {
            if( retainOffset === undefined || resultStart < retainOffset )
            {
                retainOffset = resultStart;
            }
        }
    } );

    return retainOffset;
}

function scanTextWithContext( context )
{
    if( context.resourceConfig.isDefaultRegex === true )
    {
        return scanCommentPatternText( context.uri, context.text, context.resourceConfig, context.patternFileName );
    }

    return runRegexScan( context );
}

function scanTextWithStreamingContext( context )
{
    var results = scanTextWithContext( context );

    return {
        results: results,
        retainOffset: resolveStreamingRetainOffset( context, results )
    };
}

function scanDocumentWithContext( context )
{
    return scanTextWithContext( context );
}

function normalizeRegexMatchWithContext( context, match )
{
    if( match && Object.prototype.hasOwnProperty.call( match, 'fsPath' ) )
    {
        return normalizeRipgrepMatch( context.uri, context.text, match );
    }

    return normalizeRegexExecMatchWithContext( context, match );
}

module.exports.resolveResourceConfig = resolveResourceConfig;
module.exports.createScanContext = createScanContext;
module.exports.scanDocument = scanDocument;
module.exports.scanDocumentWithContext = scanDocumentWithContext;
module.exports.scanText = scanText;
module.exports.scanTextWithContext = scanTextWithContext;
module.exports.scanTextWithStreamingContext = scanTextWithStreamingContext;
module.exports.normalizeRegexMatch = normalizeRegexMatch;
module.exports.normalizeRegexMatchWithContext = normalizeRegexMatchWithContext;
module.exports.normalizeWorkspaceRegexMatch = normalizeWorkspaceRegexMatch;
