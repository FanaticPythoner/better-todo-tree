var commentPatternCatalog = require( './commentPatternCatalog.js' );

function normalizeToken( value )
{
    return commentPatternCatalog.normalizeToken( value );
}

function isNameCharacter( character )
{
    if( character === '-' || character === '_' || character === ':' )
    {
        return true;
    }

    var code = character.charCodeAt( 0 );
    return ( code >= 48 && code <= 57 ) ||
        ( code >= 65 && code <= 90 ) ||
        ( code >= 97 && code <= 122 );
}

function isWhitespace( character )
{
    return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f';
}

function isInlineWhitespace( character )
{
    return character === ' ' || character === '\t' || character === '\f';
}

function asArray( value )
{
    if( value === undefined )
    {
        return [];
    }

    return Array.isArray( value ) ? value : [ value ];
}

function readName( text, start )
{
    var index = start;
    while( index < text.length && isNameCharacter( text[ index ] ) )
    {
        index++;
    }

    return {
        value: text.slice( start, index ),
        end: index
    };
}

function findTagEnd( text, start )
{
    var index = start;
    var quote = undefined;

    while( index < text.length )
    {
        var character = text[ index ];

        if( quote !== undefined )
        {
            if( character === quote )
            {
                quote = undefined;
            }
        }
        else if( character === '"' || character === '\'' )
        {
            quote = character;
        }
        else if( character === '>' )
        {
            return index;
        }

        index++;
    }

    return undefined;
}

function parseAttributes( text, start, end )
{
    var attributes = {};
    var index = start;

    while( index < end )
    {
        while( index < end && isWhitespace( text[ index ] ) )
        {
            index++;
        }

        if( index >= end || text[ index ] === '/' )
        {
            break;
        }

        var name = readName( text, index );
        var key = normalizeToken( name.value );
        index = name.end;

        while( index < end && isWhitespace( text[ index ] ) )
        {
            index++;
        }

        var value = "";
        if( text[ index ] === '=' )
        {
            index++;
            while( index < end && isWhitespace( text[ index ] ) )
            {
                index++;
            }

            if( text[ index ] === '"' || text[ index ] === '\'' )
            {
                var quote = text[ index ];
                var valueStart = index + 1;
                index = valueStart;
                while( index < end && text[ index ] !== quote )
                {
                    index++;
                }
                value = text.slice( valueStart, index );
                if( index < end )
                {
                    index++;
                }
            }
            else
            {
                var unquotedStart = index;
                while( index < end && isWhitespace( text[ index ] ) !== true && text[ index ] !== '>' )
                {
                    index++;
                }
                value = text.slice( unquotedStart, index );
            }
        }

        if( key.length > 0 )
        {
            attributes[ key ] = value;
        }
    }

    return attributes;
}

function readLineBounds( text, start )
{
    var index = start;
    var next;

    while( index < text.length && text[ index ] !== '\n' && text[ index ] !== '\r' )
    {
        index++;
    }

    next = index;
    if( index < text.length )
    {
        next = text[ index ] === '\r' && text[ index + 1 ] === '\n' ? index + 2 : index + 1;
    }

    return {
        end: index,
        next: next
    };
}

function hasOnlyInlineWhitespace( text, start, end )
{
    var index = start;

    while( index < end )
    {
        if( isInlineWhitespace( text[ index ] ) !== true )
        {
            return false;
        }

        index++;
    }

    return true;
}

function isSelfClosingTag( text, tagEnd )
{
    var index = tagEnd - 1;
    while( index >= 0 && isWhitespace( text[ index ] ) )
    {
        index--;
    }

    return text[ index ] === '/';
}

function readTagAt( text, start )
{
    if( text[ start ] !== '<' )
    {
        return undefined;
    }

    var index = start + 1;
    var closing = false;

    if( text[ index ] === '/' )
    {
        closing = true;
        index++;
    }
    else if( text[ index ] === '!' || text[ index ] === '?' )
    {
        return undefined;
    }

    var name = readName( text, index );
    if( name.value.length === 0 )
    {
        return undefined;
    }

    var tagEnd = findTagEnd( text, name.end );
    if( tagEnd === undefined )
    {
        return {
            name: normalizeToken( name.value ),
            start: start,
            nameEnd: name.end,
            tagEnd: undefined,
            closing: closing,
            selfClosing: false,
            attributes: {}
        };
    }

    return {
        name: normalizeToken( name.value ),
        start: start,
        nameEnd: name.end,
        tagEnd: tagEnd,
        closing: closing,
        selfClosing: isSelfClosingTag( text, tagEnd ),
        attributes: closing ? {} : parseAttributes( text, name.end, tagEnd )
    };
}

function findClosingElement( text, cursor, elementName, rawText )
{
    var depth = 1;
    var index = cursor;

    while( index < text.length )
    {
        var tagStart = text.indexOf( '<', index );
        if( tagStart === -1 )
        {
            return undefined;
        }

        var tag = readTagAt( text, tagStart );
        if( !tag || tag.tagEnd === undefined )
        {
            index = tagStart + 1;
            continue;
        }

        if( tag.name === elementName )
        {
            if( tag.closing )
            {
                depth--;
                if( depth === 0 )
                {
                    return {
                        contentEnd: tag.start,
                        tagEnd: tag.tagEnd + 1
                    };
                }
            }
            else if( rawText !== true && tag.selfClosing !== true )
            {
                depth++;
            }
        }

        index = tag.tagEnd + 1;
    }

    return undefined;
}

function readLeadingFenceStart( text, fenceDescriptor )
{
    var startToken = fenceDescriptor.start;
    var startLine;

    if( typeof ( startToken ) !== 'string' || text.indexOf( startToken ) !== 0 )
    {
        return undefined;
    }

    startLine = readLineBounds( text, 0 );
    if( hasOnlyInlineWhitespace( text, startToken.length, startLine.end ) !== true )
    {
        return undefined;
    }

    return {
        contentStart: startLine.next
    };
}

function findClosingFence( text, cursor, fenceDescriptor )
{
    var endToken = fenceDescriptor.end;
    var lineStart = cursor;

    while( lineStart < text.length )
    {
        var line = readLineBounds( text, lineStart );
        var tokenStart = lineStart;
        var tokenEnd;

        while( tokenStart < line.end && isInlineWhitespace( text[ tokenStart ] ) )
        {
            tokenStart++;
        }

        tokenEnd = tokenStart + endToken.length;
        if(
            text.slice( tokenStart, tokenEnd ) === endToken &&
            hasOnlyInlineWhitespace( text, tokenEnd, line.end )
        )
        {
            return {
                contentEnd: lineStart,
                rangeEnd: line.next
            };
        }

        if( line.next <= lineStart )
        {
            break;
        }

        lineStart = line.next;
    }

    return undefined;
}

function resolveTypeAlias( regionDescriptor, typeValue )
{
    var aliases = regionDescriptor.typeAliases || {};
    var normalized = normalizeToken( typeValue );

    return aliases[ normalized ];
}

function resolveRegionPatternFileName( regionDescriptor, attributes, catalog )
{
    var languageAttribute = normalizeToken( regionDescriptor.languageAttribute );
    var typeAttribute = normalizeToken( regionDescriptor.typeAttribute );
    var typeValue = typeAttribute.length > 0 ? attributes[ typeAttribute ] : undefined;
    var languageValue = languageAttribute.length > 0 ? attributes[ languageAttribute ] : undefined;
    var typeAlias = typeof ( typeValue ) === 'string' ? resolveTypeAlias( regionDescriptor, typeValue ) : undefined;
    var hasLanguageValue = typeof ( languageValue ) === 'string' && languageValue.length > 0;
    var hasTypeValue = typeof ( typeValue ) === 'string' && typeValue.length > 0;
    var resolved;

    if( hasLanguageValue )
    {
        resolved = catalog.resolvePatternFileName( languageValue );
        if( resolved !== undefined )
        {
            return resolved;
        }
    }

    if( typeof ( typeAlias ) === 'string' && typeAlias.length > 0 )
    {
        resolved = catalog.resolvePatternFileName( typeAlias );
        if( resolved !== undefined )
        {
            return resolved;
        }
    }

    if( hasTypeValue )
    {
        resolved = catalog.resolveMimePatternFileName( typeValue );
        if( resolved !== undefined )
        {
            return resolved;
        }
    }

    if( hasLanguageValue === true || hasTypeValue === true )
    {
        return undefined;
    }

    if( typeof ( regionDescriptor.defaultLanguage ) === 'string' && regionDescriptor.defaultLanguage.length > 0 )
    {
        return catalog.resolvePatternFileName( regionDescriptor.defaultLanguage );
    }

    return undefined;
}

function toNormalizedList( value )
{
    return ( Array.isArray( value ) ? value : [ value ] )
        .filter( function( item )
        {
            return typeof ( item ) === 'string';
        } )
        .map( normalizeToken );
}

function readAttributeValue( attributes, key )
{
    return attributes[ normalizeToken( key ) ];
}

function attributeEquals( actualValue, expectedValue )
{
    if( typeof ( actualValue ) !== 'string' )
    {
        return false;
    }

    return toNormalizedList( expectedValue ).indexOf( normalizeToken( actualValue ) ) !== -1;
}

function attributesEqual( attributes, expectedAttributes )
{
    return Object.keys( expectedAttributes || {} ).every( function( key )
    {
        return attributeEquals( readAttributeValue( attributes, key ), expectedAttributes[ key ] );
    } );
}

function attributesPresent( attributes, names )
{
    return toNormalizedList( names ).every( function( name )
    {
        return Object.prototype.hasOwnProperty.call( attributes, name );
    } );
}

function attributesAbsent( attributes, names )
{
    return toNormalizedList( names ).every( function( name )
    {
        return Object.prototype.hasOwnProperty.call( attributes, name ) !== true;
    } );
}

function attributesMatch( attributes, expectedPatterns )
{
    return Object.keys( expectedPatterns || {} ).every( function( key )
    {
        var actualValue = readAttributeValue( attributes, key );
        var pattern = expectedPatterns[ key ];
        var regex;

        if( typeof ( actualValue ) !== 'string' )
        {
            return false;
        }

        if( typeof ( pattern ) === 'string' )
        {
            regex = new RegExp( pattern );
        }
        else
        {
            regex = new RegExp( pattern.source || '', pattern.flags || '' );
        }

        return regex.test( actualValue );
    } );
}

function regionMatchesAttributes( regionDescriptor, attributes )
{
    return attributesEqual( attributes, regionDescriptor.attributes ) &&
        attributesPresent( attributes, regionDescriptor.attributePresent ) &&
        attributesAbsent( attributes, regionDescriptor.attributeAbsent ) &&
        attributesMatch( attributes, regionDescriptor.attributeMatches );
}

function createDelimitedRegion( element, regionDescriptor, catalog, startOffset, endOffset, rangeStartOffset, rangeEndOffset, closed, text )
{
    return {
        element: element,
        patternFileName: resolveRegionPatternFileName( regionDescriptor, {}, catalog ),
        startOffset: startOffset,
        endOffset: endOffset,
        rangeStartOffset: rangeStartOffset,
        rangeEndOffset: rangeEndOffset,
        closed: closed,
        text: text
    };
}

function parseLeadingFenceRegions( text, fenceDescriptors, catalog )
{
    var regions = [];
    var cursor = 0;

    asArray( fenceDescriptors ).some( function( fenceDescriptor )
    {
        var start = readLeadingFenceStart( text, fenceDescriptor );
        var closing;
        var contentEnd;
        var rangeEnd;
        var region;

        if( start === undefined )
        {
            return false;
        }

        closing = findClosingFence( text, start.contentStart, fenceDescriptor );
        contentEnd = closing ? closing.contentEnd : text.length;
        rangeEnd = closing ? closing.rangeEnd : text.length;
        region = createDelimitedRegion(
            fenceDescriptor.element || 'frontmatter',
            fenceDescriptor,
            catalog,
            start.contentStart,
            contentEnd,
            0,
            rangeEnd,
            closing !== undefined,
            text.slice( start.contentStart, contentEnd )
        );
        if( region.patternFileName !== undefined || fenceDescriptor.maskWhenUnresolved === true )
        {
            regions.push( region );
        }
        cursor = rangeEnd;
        return true;
    } );

    return {
        regions: regions,
        cursor: cursor
    };
}

function sortedMaskRanges( regions )
{
    return regions.map( function( region )
    {
        return {
            start: region.rangeStartOffset,
            end: region.rangeEndOffset
        };
    } ).sort( function( left, right )
    {
        return left.start - right.start || left.end - right.end;
    } );
}

function advanceMaskRangeIndex( ranges, rangeIndex, offset )
{
    while( rangeIndex < ranges.length && ranges[ rangeIndex ].end <= offset )
    {
        rangeIndex++;
    }

    return rangeIndex;
}

function parseWrappedRegions( text, wrappedDescriptors, catalog, baseRegions )
{
    var regions = [];
    var ranges = sortedMaskRanges( baseRegions );

    asArray( wrappedDescriptors ).forEach( function( wrappedDescriptor )
    {
        var cursor = 0;
        var rangeIndex = 0;

        while( cursor < text.length )
        {
            var start = text.indexOf( wrappedDescriptor.start, cursor );
            var end;
            var rangeEnd;
            var region;

            if( start === -1 )
            {
                break;
            }

            rangeIndex = advanceMaskRangeIndex( ranges, rangeIndex, start );
            if( rangeIndex < ranges.length && start >= ranges[ rangeIndex ].start && start < ranges[ rangeIndex ].end )
            {
                cursor = ranges[ rangeIndex ].end;
                continue;
            }

            end = text.indexOf( wrappedDescriptor.end, start + wrappedDescriptor.start.length );
            rangeEnd = end === -1 ? text.length : end + wrappedDescriptor.end.length;
            region = createDelimitedRegion(
                wrappedDescriptor.element || 'wrapped-region',
                wrappedDescriptor,
                catalog,
                start,
                rangeEnd,
                start,
                rangeEnd,
                end !== -1,
                text.slice( start, rangeEnd )
            );
            if( region.patternFileName !== undefined || wrappedDescriptor.maskWhenUnresolved === true )
            {
                regions.push( region );
            }
            cursor = rangeEnd;
        }
    } );

    return regions;
}

function HtmlLikeEmbeddedDocumentParser( descriptor, catalog )
{
    this.descriptor = descriptor;
    this.catalog = catalog;
    this.regionsByElement = new Map();

    descriptor.regions.forEach( function( region )
    {
        var element = normalizeToken( region.element );

        if( this.regionsByElement.has( element ) !== true )
        {
            this.regionsByElement.set( element, [] );
        }

        this.regionsByElement.get( element ).push( region );
    }, this );
}

HtmlLikeEmbeddedDocumentParser.prototype.parseElementRegions = function( text, startCursor )
{
    var regions = [];
    var cursor = startCursor || 0;

    while( cursor < text.length )
    {
        var tagStart = text.indexOf( '<', cursor );
        if( tagStart === -1 )
        {
            break;
        }

        var tag = readTagAt( text, tagStart );
        if( !tag || tag.closing || this.regionsByElement.has( tag.name ) !== true )
        {
            cursor = tagStart + 1;
            continue;
        }

        if( tag.tagEnd === undefined )
        {
            break;
        }

        var descriptor = this.regionsByElement.get( tag.name ).find( function( region )
        {
            return regionMatchesAttributes( region, tag.attributes );
        } );

        if( descriptor === undefined )
        {
            cursor = tag.tagEnd + 1;
            continue;
        }

        if( tag.selfClosing === true )
        {
            cursor = tag.tagEnd + 1;
            continue;
        }

        var contentStart = tag.tagEnd + 1;
        var closing = findClosingElement( text, contentStart, tag.name, descriptor.rawText === true );
        var contentEnd = closing ? closing.contentEnd : text.length;
        var patternFileName = resolveRegionPatternFileName( descriptor, tag.attributes, this.catalog );

        if( contentEnd >= contentStart && ( patternFileName !== undefined || descriptor.maskWhenUnresolved === true ) )
        {
            regions.push( {
                element: tag.name,
                patternFileName: patternFileName,
                startOffset: contentStart,
                endOffset: contentEnd,
                rangeStartOffset: tag.start,
                rangeEndOffset: closing ? closing.tagEnd : text.length,
                closed: closing !== undefined,
                text: text.slice( contentStart, contentEnd )
            } );
        }

        cursor = closing ? closing.tagEnd : text.length;
    }

    return regions;
};

HtmlLikeEmbeddedDocumentParser.prototype.parse = function( text )
{
    var leading = parseLeadingFenceRegions( text, this.descriptor.leadingFences, this.catalog );
    var regions = leading.regions.concat( this.parseElementRegions( text, leading.cursor ) );

    regions = regions.concat( parseWrappedRegions( text, this.descriptor.wrappedRegions, this.catalog, regions ) );
    regions.sort( function( left, right )
    {
        return left.rangeStartOffset - right.rangeStartOffset || left.rangeEndOffset - right.rangeEndOffset;
    } );

    return regions;
};

function createHtmlLikeEmbeddedDocumentParser( options )
{
    options = options || {};

    return new HtmlLikeEmbeddedDocumentParser( options.descriptor, options.catalog );
}

module.exports.HtmlLikeEmbeddedDocumentParser = HtmlLikeEmbeddedDocumentParser;
module.exports.createHtmlLikeEmbeddedDocumentParser = createHtmlLikeEmbeddedDocumentParser;
