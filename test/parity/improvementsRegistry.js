// Registry of intentional deviations between upstream todo-tree and
// better-todo-tree. Each entry carries an upstream reference, an
// applicability(fixture) predicate, and a tolerated*Match predicate.

var path = require( 'path' );
var regexRegistry = require( '../../src/regexRegistry.js' );

function isVendoredFixture( fixture )
{
    return fixture && fixture.tier === 'vendored';
}

function isMarkdownFixture( fixture )
{
    if( !fixture )
    {
        return false;
    }

    var basename = path.basename( fixture.fsPath || '' ).toLowerCase();
    var extension = path.extname( basename );
    return [ '.md', '.markdown', '.mkd', '.mkdn', '.mdown' ].indexOf( extension ) !== -1;
}

function isJsonFixture( fixture )
{
    if( !fixture )
    {
        return false;
    }

    return path.extname( fixture.fsPath || '' ).toLowerCase() === '.json';
}

function extensionOfFixture( fixture )
{
    return path.extname( fixture && fixture.fsPath || '' ).toLowerCase();
}

function isNewCommentAwareAliasFixture( fixture )
{
    return Object.prototype.hasOwnProperty.call( {
        '.astro': true,
        '.jsx': true,
        '.svelte': true,
        '.tsx': true
    }, extensionOfFixture( fixture ) );
}

function lineForMatch( fixture, match )
{
    var lines = String( fixture && fixture.text || '' ).split( '\n' );
    var line = match && typeof ( match.line ) === 'number' ? match.line : 0;

    return lines[ line - 1 ] || '';
}

function characterBeforeMatch( fixture, match )
{
    var line = lineForMatch( fixture, match );
    var column = match && typeof ( match.column ) === 'number' ? match.column : 0;
    var index = column - 2;

    return index >= 0 ? line[ index ] : '';
}

function offsetFromLineColumn( text, line, column )
{
    var offset = 0;
    var currentLine = 1;

    while( currentLine < line && offset < text.length )
    {
        if( text[ offset ] === '\n' )
        {
            currentLine += 1;
        }
        offset += 1;
    }

    return offset + Math.max( column - 1, 0 );
}

function offsetForMatch( fixture, match )
{
    if( match && typeof ( match.tagStartOffset ) === 'number' )
    {
        return match.tagStartOffset;
    }

    return offsetFromLineColumn(
        String( fixture && fixture.text || '' ),
        match && typeof ( match.line ) === 'number' ? match.line : 1,
        match && typeof ( match.column ) === 'number' ? match.column : 1
    );
}

function insideDelimitedRegion( fixture, match, start, end )
{
    var text = String( fixture && fixture.text || '' );
    var offset = offsetForMatch( fixture, match );
    var before = text.slice( 0, offset );
    var after = text.slice( offset );
    var openIndex = before.lastIndexOf( start );
    var closeBeforeIndex = before.lastIndexOf( end );

    return openIndex !== -1 && openIndex > closeBeforeIndex && after.indexOf( end ) !== -1;
}

function isInlineBlockCommentMatch( match )
{
    if( !match || typeof ( match.match ) !== 'string' )
    {
        return false;
    }

    var line = match.match;
    var openIndex = line.indexOf( '/*' );
    var closeIndex = line.indexOf( '*/' );
    return openIndex !== -1 && closeIndex !== -1 && closeIndex > openIndex + 1;
}

function indentOrCodeFenceOnly( line )
{
    if( typeof ( line ) !== 'string' )
    {
        return false;
    }
    var match = line.match( regexRegistry.createRegExp( 'linePrefixRemainder' ) );
    if( !match )
    {
        return false;
    }
    var leading = match[ 1 ];
    var remainder = match[ 2 ];
    return leading.length > 0 &&
        !regexRegistry.createRegExp( 'leadingNonDefaultCommentPrefix' ).test( remainder );
}

function matchPrefixToken( match )
{
    var matched;

    if( !match || typeof ( match.match ) !== 'string' )
    {
        return undefined;
    }

    matched = match.match.match( regexRegistry.createRegExp( 'linePrefixRemainder' ) );
    if( !matched )
    {
        return undefined;
    }

    return ( matched[ 2 ].match( regexRegistry.createRegExp( 'leadingNonDefaultCommentPrefix' ) ) || [] )[ 1 ];
}

var IMPROVEMENT_INDENTED_NON_COMMENT_REJECTED = Object.freeze( {
    id: 'IMPROVEMENT_INDENTED_NON_COMMENT_REJECTED',
    description: 'Indented non-comment lines starting with a tag in vendored languages are rejected by better-todo-tree.',
    upstreamReferences: Object.freeze( [ 'Gruntfuggly/todo-tree#710' ] ),
    applicability: function( fixture )
    {
        return isVendoredFixture( fixture ) && !isMarkdownFixture( fixture );
    },
    toleratedUpstreamMatch: function( match )
    {
        return indentOrCodeFenceOnly( match && match.match );
    }
} );

var IMPROVEMENT_MARKDOWN_HEADING_REJECTED = Object.freeze( {
    id: 'IMPROVEMENT_MARKDOWN_HEADING_REJECTED',
    description: 'Markdown files treat # heading lines as headings, not as tag-bearing comments.',
    upstreamReferences: Object.freeze( [ 'commit:75b4a6c' ] ),
    applicability: function( fixture )
    {
        return isMarkdownFixture( fixture );
    },
    toleratedUpstreamMatch: function( match )
    {
        return typeof ( match && match.match ) === 'string' &&
            regexRegistry.createRegExp( 'leadingMarkdownHeading' ).test( match.match );
    }
} );

var IMPROVEMENT_MARKDOWN_NON_LIST_PLAIN_TAG_REJECTED = Object.freeze( {
    id: 'IMPROVEMENT_MARKDOWN_NON_LIST_PLAIN_TAG_REJECTED',
    description: 'Markdown files only emit tags inside HTML comments or list-item task checkboxes.',
    upstreamReferences: Object.freeze( [ 'commit:75b4a6c' ] ),
    applicability: function( fixture )
    {
        return isMarkdownFixture( fixture );
    },
    toleratedUpstreamMatch: function( match )
    {
        if( !match || typeof ( match.match ) !== 'string' )
        {
            return false;
        }
        var line = match.match;
        if( regexRegistry.createRegExp( 'htmlCommentStart' ).test( line ) )
        {
            return false;
        }
        if( regexRegistry.createRegExp( 'markdownTaskCheckboxLine' ).test( line ) )
        {
            return false;
        }
        return true;
    }
} );

var IMPROVEMENT_INLINE_BLOCK_COMMENT_BOUNDS = Object.freeze( {
    id: 'IMPROVEMENT_INLINE_BLOCK_COMMENT_BOUNDS',
    description: 'Inline block-comment matches are clipped to the closing delimiter in comment-aware vendored languages.',
    upstreamReferences: Object.freeze( [ 'Gruntfuggly/todo-tree#812' ] ),
    applicability: function( fixture )
    {
        return isVendoredFixture( fixture );
    },
    toleratedUpstreamMatch: function( match, fixture )
    {
        return isInlineBlockCommentMatch( match ) && isVendoredFixture( fixture );
    },
    affectsDisplayTextOnly: true
} );

var IMPROVEMENT_JSON_NO_COMMENTS = Object.freeze( {
    id: 'IMPROVEMENT_JSON_NO_COMMENTS',
    description: 'JSON (RFC 8259) admits no comments; better-todo-tree returns no matches for .json files.',
    upstreamReferences: Object.freeze( [ 'comment-patterns/db-generated:JSON' ] ),
    applicability: function( fixture )
    {
        return isJsonFixture( fixture );
    },
    toleratedUpstreamMatch: function()
    {
        return true;
    }
} );

var IMPROVEMENT_COMMENT_AWARE_NEW_LANGUAGE_ALIASES = Object.freeze( {
    id: 'IMPROVEMENT_COMMENT_AWARE_NEW_LANGUAGE_ALIASES',
    description: 'New language aliases use comment-aware scanners and reject upstream default-regex prefixes outside the target syntax.',
    upstreamReferences: Object.freeze( [ 'better-todo-tree#19', 'comment-patterns/db-generated' ] ),
    applicability: function( fixture )
    {
        return isNewCommentAwareAliasFixture( fixture );
    },
    toleratedUpstreamMatch: function( match, fixture )
    {
        var extension = extensionOfFixture( fixture );
        var token = matchPrefixToken( match );

        if( extension === '.jsx' || extension === '.tsx' )
        {
            return [ '//', '/*' ].indexOf( token ) === -1;
        }

        if( extension === '.svelte' )
        {
            return token !== '<!--';
        }

        if( extension === '.astro' )
        {
            return token !== '<!--' && ( token !== '/*' || characterBeforeMatch( fixture, match ) !== '{' );
        }

        return false;
    }
} );

var IMPROVEMENTS = Object.freeze( [
    IMPROVEMENT_INDENTED_NON_COMMENT_REJECTED,
    IMPROVEMENT_MARKDOWN_HEADING_REJECTED,
    IMPROVEMENT_MARKDOWN_NON_LIST_PLAIN_TAG_REJECTED,
    IMPROVEMENT_INLINE_BLOCK_COMMENT_BOUNDS,
    IMPROVEMENT_JSON_NO_COMMENTS,
    IMPROVEMENT_COMMENT_AWARE_NEW_LANGUAGE_ALIASES
] );

var DEFAULT_REGEX_PREFIX_TOKENS = Object.freeze( [ '//', '#', '<!--', ';', '/*' ] );

function commentFamilyStartToken( fixture )
{
    if( !fixture || typeof ( fixture.commentFamily ) !== 'string' )
    {
        return undefined;
    }

    var family = fixture.commentFamily;
    if( family.indexOf( 'singleLine:' ) === 0 )
    {
        return family.slice( 'singleLine:'.length );
    }
    if( family.indexOf( 'multiLine:' ) === 0 )
    {
        var rest = family.slice( 'multiLine:'.length );
        var separator = rest.indexOf( '...' );
        return separator === -1 ? rest : rest.slice( 0, separator );
    }

    return undefined;
}

function upstreamPrefixTokenRecognised( token )
{
    if( typeof ( token ) !== 'string' || token.length === 0 )
    {
        return false;
    }

    return DEFAULT_REGEX_PREFIX_TOKENS.indexOf( token ) !== -1;
}

var ENHANCEMENT_COMMENT_AWARE_PREFIXES = Object.freeze( {
    id: 'ENHANCEMENT_COMMENT_AWARE_PREFIXES',
    description: 'better-todo-tree\'s comment-aware scanner detects tags behind comment tokens the upstream default regex does not enumerate (e.g. /**, --, %, ###, //-, {{!, {{!--).',
    upstreamReferences: Object.freeze( [ 'comment-patterns/db-generated', 'better-todo-tree::efcf972' ] ),
    applicability: function( fixture )
    {
        return isVendoredFixture( fixture ) || isNewCommentAwareAliasFixture( fixture );
    },
    toleratedBetterTodoTreeMatch: function( match, fixture )
    {
        var token = commentFamilyStartToken( fixture );
        return ( token !== undefined && !upstreamPrefixTokenRecognised( token ) ) ||
            ( isNewCommentAwareAliasFixture( fixture ) && insideDelimitedRegion( fixture, match, '/*', '*/' ) );
    }
} );

var ENHANCEMENTS = Object.freeze( [
    ENHANCEMENT_COMMENT_AWARE_PREFIXES
] );

function applicableImprovements( fixture )
{
    return IMPROVEMENTS.filter( function( improvement )
    {
        return improvement.applicability( fixture );
    } );
}

function applicableEnhancements( fixture )
{
    return ENHANCEMENTS.filter( function( enhancement )
    {
        return enhancement.applicability( fixture );
    } );
}

function isToleratedUpstreamDeviation( match, fixture )
{
    return applicableImprovements( fixture ).some( function( improvement )
    {
        if( improvement.affectsDisplayTextOnly === true )
        {
            return false;
        }
        return improvement.toleratedUpstreamMatch( match, fixture );
    } );
}

function isToleratedBetterTodoTreeMatch( match, fixture )
{
    return applicableEnhancements( fixture ).some( function( enhancement )
    {
        return enhancement.toleratedBetterTodoTreeMatch( match, fixture );
    } );
}

module.exports.isToleratedUpstreamDeviation = isToleratedUpstreamDeviation;
module.exports.isToleratedBetterTodoTreeMatch = isToleratedBetterTodoTreeMatch;
