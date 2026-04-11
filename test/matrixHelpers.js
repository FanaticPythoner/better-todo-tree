var stubs = require( './stubs.js' );
var utils = require( '../src/utils.js' );
var languageMatrix = require( './languageMatrix.js' );

function uriKey( uri )
{
    if( uri === undefined || uri === null )
    {
        return "";
    }

    if( typeof ( uri ) === 'string' )
    {
        return uri;
    }

    if( typeof ( uri.toString ) === 'function' )
    {
        return uri.toString();
    }

    return String( uri );
}

function createUri( fsPath, scheme, stringValue )
{
    return {
        fsPath: fsPath,
        path: fsPath,
        scheme: scheme || 'file',
        toString: function()
        {
            return stringValue || fsPath;
        }
    };
}

function createLineOffsets( text )
{
    var offsets = [ 0 ];

    for( var index = 0; index < text.length; ++index )
    {
        if( text[ index ] === '\n' )
        {
            offsets.push( index + 1 );
        }
    }

    return offsets;
}

function positionAtOffset( lineOffsets, offset )
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

function createDocument( fsPath, text, version )
{
    var uri = createUri( fsPath );
    var lineOffsets = createLineOffsets( text );

    function positionAt( offset )
    {
        return positionAtOffset( lineOffsets, offset );
    }

    function offsetAt( position )
    {
        return lineOffsets[ position.line ] + position.character;
    }

    function lineAt( input )
    {
        var line = typeof ( input ) === 'number' ? input : input.line;
        var start = lineOffsets[ line ];
        var end = line + 1 < lineOffsets.length ? lineOffsets[ line + 1 ] - 1 : text.length;

        return {
            range: {
                start: {
                    line: line,
                    character: 0
                },
                end: {
                    line: line,
                    character: end - start
                }
            }
        };
    }

    return {
        version: version === undefined ? 1 : version,
        uri: uri,
        fileName: fsPath,
        getText: function()
        {
            return text;
        },
        positionAt: positionAt,
        offsetAt: offsetAt,
        lineAt: lineAt
    };
}

function createNotebookCellDocument( notebookFsPath, cellId, text, languageId, version )
{
    var document = createDocument(
        notebookFsPath,
        text,
        version
    );

    document.uri = createUri(
        notebookFsPath,
        'vscode-notebook-cell',
        'vscode-notebook-cell://' + notebookFsPath + '#cell-' + cellId
    );
    document.languageId = languageId;

    return document;
}

function createNotebookDocument( notebookFsPath, cellDocuments, version )
{
    var uri = createUri( notebookFsPath );
    var notebook;
    var cells = cellDocuments.map( function( document, index )
    {
        return {
            index: index,
            document: document
        };
    } );

    notebook = {
        uri: uri,
        version: version === undefined ? 1 : version,
        cellCount: cells.length,
        getCells: function()
        {
            return cells.slice();
        }
    };

    cells.forEach( function( cell )
    {
        cell.document.notebook = notebook;
    } );

    return notebook;
}

function createWorkspaceState( initialValues )
{
    var store = Object.assign( {}, initialValues || {} );

    return {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( store, key ) ? store[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            store[ key ] = value;
            return Promise.resolve();
        }
    };
}

function createConfig( overrides )
{
    var config = stubs.getTestConfig();
    config.tagList = languageMatrix.DEFAULT_TAGS.slice();
    config.regexSource = utils.DEFAULT_REGEX_SOURCE;
    config.shouldBeCaseSensitive = true;
    config.enableMultiLineFlag = false;
    config.subTagRegexString = "";
    config.customHighlights = {};
    config.defaultHighlightValue = {};
    config.uriOverrides = {};
    config.setUriOverride = function( uri, override )
    {
        this.uriOverrides[ uriKey( uri ) ] = Object.assign( {}, override );
        return this;
    };
    config.tagGroup = function()
    {
        return undefined;
    };
    config.shouldShowIconsInsteadOfTagsInStatusBar = function()
    {
        return false;
    };
    config.defaultHighlight = function()
    {
        return this.defaultHighlightValue;
    };
    config.customHighlight = function()
    {
        return this.customHighlights;
    };

    return Object.assign( config, overrides || {} );
}

function tagLabel( tag )
{
    if( tag === '[ ]' )
    {
        return 'unchecked-task';
    }
    if( tag === '[x]' )
    {
        return 'checked-task';
    }

    return tag.toLowerCase().replace( /[^a-z0-9]+/g, '-' );
}

function languageLabel( languageName )
{
    return languageName.toLowerCase().replace( /[^a-z0-9]+/g, '-' );
}

function materializeStartToken( startPattern )
{
    if( typeof ( startPattern ) === 'string' )
    {
        return startPattern;
    }

    switch( startPattern.source )
    {
        case '\\/\\*':
            return '/*';
        case '\\/\\*\\*':
        case '\\/\\*\\*?':
            return '/**';
        default:
            throw new Error( 'Unsupported multi-line start token regex ' + startPattern.source );
    }
}

function toGlobalRegex( regex )
{
    var flags = regex.flags && regex.flags.indexOf( 'g' ) === -1 ? regex.flags + 'g' : ( regex.flags || 'g' );
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

function getClosingLineContentEnd( lineText, startToken, middleToken, endToken )
{
    var contentStart = 0;
    var contentEnd = lineText.length;
    var startMatch = startToken ? findTokenStart( lineText, startToken, 0 ) : undefined;

    if( startMatch && startMatch.index === 0 )
    {
        contentStart = startMatch.length;
        if( lineText[ contentStart ] === ' ' )
        {
            contentStart++;
        }
    }
    else if( middleToken && lineText.indexOf( middleToken ) === 0 )
    {
        contentStart = String( middleToken ).length;
        if( lineText[ contentStart ] === ' ' )
        {
            contentStart++;
        }
    }

    var trimmedRight = lineText.replace( /[ \t]+$/, '' );
    if( endToken && trimmedRight.endsWith( endToken ) )
    {
        contentEnd = lineText.lastIndexOf( endToken );
        while( contentEnd > contentStart && lineText[ contentEnd - 1 ] === ' ' )
        {
            contentEnd--;
        }
    }

    if( contentEnd < contentStart )
    {
        contentEnd = contentStart;
    }

    return contentEnd;
}

function TestTextBuilder()
{
    this.lines = [];
    this.offset = 0;
    this.lineNumber = 1;
    this.expectations = [];
}

TestTextBuilder.prototype.addLine = function( text )
{
    var record = {
        text: text,
        startOffset: this.offset,
        lineNumber: this.lineNumber
    };

    this.lines.push( record );
    this.offset += text.length + 1;
    this.lineNumber += 1;

    return record;
};

TestTextBuilder.prototype.addSingleLineCase = function( token, tag, description )
{
    var line = token + ' ' + tag + ' ' + description;
    var record = this.addLine( line );
    var tagStartOffset = record.startOffset + token.length + 1;

    this.expectations.push( {
        actualTag: tag,
        displayText: description,
        continuationText: [],
        before: "",
        after: description,
        line: record.lineNumber,
        column: token.length + 2,
        endLine: record.lineNumber,
        endColumn: record.text.length + 1,
        commentStartOffset: record.startOffset,
        commentEndOffset: record.startOffset + record.text.length,
        matchStartOffset: tagStartOffset,
        matchEndOffset: record.startOffset + record.text.length,
        tagStartOffset: tagStartOffset,
        tagEndOffset: tagStartOffset + tag.length
    } );
};

TestTextBuilder.prototype.addSingleLineBlockCase = function( token, tag, description, continuation )
{
    var firstLine = this.addLine( token + ' ' + tag + ' ' + description );
    var secondLine = this.addLine( token + ' ' + continuation );
    var tagStartOffset = firstLine.startOffset + token.length + 1;

    this.expectations.push( {
        actualTag: tag,
        displayText: description,
        continuationText: [ continuation ],
        before: "",
        after: description,
        line: firstLine.lineNumber,
        column: token.length + 2,
        endLine: secondLine.lineNumber,
        endColumn: secondLine.text.length + 1,
        commentStartOffset: firstLine.startOffset,
        commentEndOffset: secondLine.startOffset + secondLine.text.length,
        matchStartOffset: tagStartOffset,
        matchEndOffset: secondLine.startOffset + secondLine.text.length,
        tagStartOffset: tagStartOffset,
        tagEndOffset: tagStartOffset + tag.length
    } );
};

TestTextBuilder.prototype.addInlineMultiLineCase = function( startToken, endToken, tag, description )
{
    var line = startToken + ' ' + tag + ' ' + description + ' ' + endToken;
    var record = this.addLine( line );
    var tagStartOffset = record.startOffset + startToken.length + 1;
    var contentLength = tag.length + 1 + description.length;
    var matchEndOffset = tagStartOffset + contentLength;

    this.expectations.push( {
        actualTag: tag,
        displayText: description,
        continuationText: [],
        before: "",
        after: description,
        line: record.lineNumber,
        column: startToken.length + 2,
        endLine: record.lineNumber,
        endColumn: matchEndOffset - record.startOffset + 1,
        commentStartOffset: record.startOffset,
        commentEndOffset: record.startOffset + record.text.length,
        matchStartOffset: tagStartOffset,
        matchEndOffset: matchEndOffset,
        tagStartOffset: tagStartOffset,
        tagEndOffset: tagStartOffset + tag.length
    } );
};

TestTextBuilder.prototype.addBlockMultiLineCase = function( startToken, middleToken, endToken, tag, description, continuation )
{
    this.addLine( startToken );
    var tagLine = this.addLine( tag + ' ' + description );
    var continuationLine = this.addLine( continuation );
    var endLine = this.addLine( endToken );
    var closingContentEnd = getClosingLineContentEnd( endLine.text, startToken, middleToken, endToken );

    this.expectations.push( {
        actualTag: tag,
        displayText: description,
        continuationText: [ continuation ],
        before: "",
        after: description,
        line: tagLine.lineNumber,
        column: 1,
        endLine: endLine.lineNumber,
        endColumn: closingContentEnd + 1,
        commentStartOffset: tagLine.startOffset,
        commentEndOffset: endLine.startOffset + endLine.text.length,
        matchStartOffset: tagLine.startOffset,
        matchEndOffset: endLine.startOffset + closingContentEnd,
        tagStartOffset: tagLine.startOffset,
        tagEndOffset: tagLine.startOffset + tag.length
    } );
};

TestTextBuilder.prototype.addMarkdownTask = function( prefix, tag, description )
{
    var line = prefix + tag + ' ' + description;
    var record = this.addLine( line );
    var tagStartOffset = record.startOffset + prefix.length;

    this.expectations.push( {
        actualTag: tag,
        displayText: description,
        continuationText: [],
        before: prefix.trim(),
        after: description,
        line: record.lineNumber,
        column: prefix.length + 1,
        endLine: record.lineNumber,
        endColumn: record.text.length + 1,
        commentStartOffset: record.startOffset,
        commentEndOffset: record.startOffset + record.text.length,
        matchStartOffset: tagStartOffset,
        matchEndOffset: record.startOffset + record.text.length,
        tagStartOffset: tagStartOffset,
        tagEndOffset: tagStartOffset + tag.length
    } );
};

TestTextBuilder.prototype.toText = function()
{
    return this.lines.map( function( line ) { return line.text; } ).join( '\n' );
};

function buildNegativeText( language )
{
    if( language.commentsOnly === true )
    {
        return [
            '# TODO heading',
            '## HACK heading',
            '- TODO plain bullet',
            'Plain [ ] text'
        ].join( '\n' );
    }

    if( language.singleLineTokens.length > 0 )
    {
        return [
            language.singleLineTokens[ 0 ] + ' TODOCount should not match',
            language.singleLineTokens[ 0 ] + ' HACK_flag should not match',
            'Plain TODO text outside comment'
        ].join( '\n' );
    }

    if( language.multiLineEntries.length > 0 )
    {
        var startToken = materializeStartToken( language.multiLineEntries[ 0 ].start );
        var endToken = language.multiLineEntries[ 0 ].end;
        return [
            startToken + ' TODOCount should not match ' + endToken,
            startToken + ' HACK_flag should not match ' + endToken,
            'Plain TODO text outside comment'
        ].join( '\n' );
    }

    return [
        'TODO plain text',
        'HACK plain text',
        '// TODO not a recognised comment for this language'
    ].join( '\n' );
}

function buildLanguageScenario( language )
{
    var builder = new TestTextBuilder();
    var slug = languageLabel( language.name );
    var defaultTags = languageMatrix.DEFAULT_TAGS;
    var representativeTag = defaultTags[ 0 ];

    if( language.commentsOnly === true )
    {
        builder.addMarkdownTask( '- ', '[ ]', slug + '-unchecked' );
        builder.addMarkdownTask( '1. ', '[x]', slug + '-checked' );
        return {
            text: builder.toText(),
            expectations: builder.expectations,
            negativeText: buildNegativeText( language )
        };
    }

    if( language.singleLineTokens.length === 0 && language.multiLineEntries.length === 0 )
    {
        return {
            text: "",
            expectations: [],
            negativeText: buildNegativeText( language )
        };
    }

    if( language.singleLineTokens.length > 0 )
    {
        language.singleLineTokens.forEach( function( token, tokenIndex )
        {
            defaultTags.forEach( function( tag )
            {
                builder.addSingleLineCase( token, tag, slug + '-' + tagLabel( tag ) + '-single-' + tokenIndex );
            } );

            builder.addSingleLineBlockCase( token, representativeTag, slug + '-single-block-' + tokenIndex, slug + '-single-detail-' + tokenIndex );
        } );
    }
    else if( language.multiLineEntries.length > 0 )
    {
        var firstEntry = language.multiLineEntries[ 0 ];
        var firstStart = materializeStartToken( firstEntry.start );

        defaultTags.forEach( function( tag )
        {
            builder.addInlineMultiLineCase( firstStart, firstEntry.end, tag, slug + '-' + tagLabel( tag ) + '-inline-0' );
        } );

        builder.addBlockMultiLineCase( firstStart, firstEntry.middle, firstEntry.end, representativeTag, slug + '-block-0', slug + '-detail-0' );
    }

    language.multiLineEntries.forEach( function( entry, entryIndex )
    {
        if( language.singleLineTokens.length === 0 && entryIndex === 0 )
        {
            return;
        }

        var startToken = materializeStartToken( entry.start );
        builder.addInlineMultiLineCase( startToken, entry.end, representativeTag, slug + '-inline-representative-' + entryIndex );
        builder.addBlockMultiLineCase( startToken, entry.middle, entry.end, representativeTag, slug + '-block-' + entryIndex, slug + '-detail-' + entryIndex );
    } );

    return {
        text: builder.toText(),
        expectations: builder.expectations,
        negativeText: buildNegativeText( language )
    };
}

function assertMatch( assert, actual, expected, prefix )
{
    Object.keys( expected ).forEach( function( key )
    {
        assert.deepEqual( actual[ key ], expected[ key ], prefix + ' ' + key );
    } );
}

function flushAsyncWork()
{
    return new Promise( function( resolve )
    {
        setImmediate( function()
        {
            setImmediate( resolve );
        } );
    } );
}

module.exports.createUri = createUri;
module.exports.createDocument = createDocument;
module.exports.createNotebookCellDocument = createNotebookCellDocument;
module.exports.createNotebookDocument = createNotebookDocument;
module.exports.createWorkspaceState = createWorkspaceState;
module.exports.createConfig = createConfig;
module.exports.materializeStartToken = materializeStartToken;
module.exports.buildLanguageScenario = buildLanguageScenario;
module.exports.assertMatch = assertMatch;
module.exports.flushAsyncWork = flushAsyncWork;
