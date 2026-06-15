var path = require( 'path' );

var baseLanguages = require( 'comment-patterns/db-generated/base.js' );
var defaultAliases = require( './commentPatternAliases.json' );

function normalizeToken( value )
{
    if( typeof ( value ) !== 'string' )
    {
        return "";
    }

    return value.trim().toLowerCase();
}

function compactIdentifier( value )
{
    var normalized = normalizeToken( value );
    var compact = "";
    var index;

    for( index = 0; index < normalized.length; index++ )
    {
        var code = normalized.charCodeAt( index );
        if( ( code >= 48 && code <= 57 ) || ( code >= 97 && code <= 122 ) )
        {
            compact += normalized[ index ];
        }
    }

    return compact;
}

function firstMatcher( language )
{
    if( !language || !Array.isArray( language.nameMatchers ) || language.nameMatchers.length === 0 )
    {
        return undefined;
    }

    return language.nameMatchers[ 0 ];
}

function splitMimeType( value )
{
    var normalized = normalizeToken( value );
    var semicolonIndex = normalized.indexOf( ';' );
    var mediaType = semicolonIndex === -1 ? normalized : normalized.slice( 0, semicolonIndex ).trim();
    var slashIndex = mediaType.indexOf( '/' );
    var subtype = slashIndex === -1 ? mediaType : mediaType.slice( slashIndex + 1 );
    var candidates = [ mediaType, subtype ];
    var plusParts = subtype.split( '+' );

    plusParts.forEach( function( part )
    {
        candidates.push( part );
        if( part.indexOf( 'x-' ) === 0 )
        {
            candidates.push( part.slice( 2 ) );
        }
    } );

    if( subtype.indexOf( 'x-' ) === 0 )
    {
        candidates.push( subtype.slice( 2 ) );
    }

    return candidates.filter( function( candidate )
    {
        return candidate.length > 0;
    } );
}

function addMapping( mappings, token, patternFileName )
{
    var normalized = normalizeToken( token );
    var compact = compactIdentifier( token );

    if( normalized.length > 0 && mappings.byToken.has( normalized ) !== true )
    {
        mappings.byToken.set( normalized, patternFileName );
    }

    if( compact.length > 0 && mappings.byCompactToken.has( compact ) !== true )
    {
        mappings.byCompactToken.set( compact, patternFileName );
    }
}

function createMappingStore()
{
    return {
        byToken: new Map(),
        byCompactToken: new Map()
    };
}

function CommentPatternCatalog( aliases, languages )
{
    this.aliases = aliases || {};
    this.languages = Array.isArray( languages ) ? languages : baseLanguages;
    this.mappings = createMappingStore();
    this.build();
}

CommentPatternCatalog.prototype.resolveAlias = function( patternFileName )
{
    var normalized = normalizeToken( patternFileName );
    var extension = normalized.charAt( 0 ) === '.' ? normalized : path.extname( normalized );
    var alias = this.aliases[ extension ];

    if( alias )
    {
        return alias;
    }

    return patternFileName;
};

CommentPatternCatalog.prototype.addCandidate = function( token, patternFileName )
{
    if( typeof ( patternFileName ) !== 'string' || patternFileName.length === 0 )
    {
        return;
    }

    addMapping( this.mappings, token, this.resolveAlias( patternFileName ) );
};

CommentPatternCatalog.prototype.build = function()
{
    var self = this;

    this.languages.forEach( function( language )
    {
        var patternFileName = self.resolveAlias( firstMatcher( language ) );

        if( typeof ( patternFileName ) !== 'string' || patternFileName.length === 0 )
        {
            return;
        }

        self.addCandidate( language.name, patternFileName );
        if( Array.isArray( language.nameMatchers ) )
        {
            language.nameMatchers.forEach( function( matcher )
            {
                self.addCandidate( matcher, patternFileName );
            } );
        }
    } );

    Object.keys( this.aliases ).forEach( function( alias )
    {
        self.addCandidate( alias, self.aliases[ alias ] );
        if( alias.charAt( 0 ) === '.' )
        {
            self.addCandidate( alias.slice( 1 ), self.aliases[ alias ] );
        }
    } );
};

CommentPatternCatalog.prototype.resolvePatternFileName = function( value )
{
    var normalized = normalizeToken( value );
    var compact = compactIdentifier( value );
    var dotted = normalized.length > 0 && normalized.charAt( 0 ) !== '.' ? '.' + normalized : normalized;

    if( this.mappings.byToken.has( normalized ) )
    {
        return this.mappings.byToken.get( normalized );
    }

    if( this.mappings.byCompactToken.has( compact ) )
    {
        return this.mappings.byCompactToken.get( compact );
    }

    if( this.mappings.byToken.has( dotted ) )
    {
        return this.mappings.byToken.get( dotted );
    }

    return undefined;
};

CommentPatternCatalog.prototype.resolveMimePatternFileName = function( value )
{
    var self = this;
    var candidates = splitMimeType( value );
    var resolved;

    candidates.some( function( candidate )
    {
        resolved = self.resolvePatternFileName( candidate );
        return resolved !== undefined;
    } );

    return resolved;
};

function createCommentPatternCatalog( options )
{
    options = options || {};

    return new CommentPatternCatalog(
        options.aliases || defaultAliases,
        options.languages || baseLanguages
    );
}

module.exports.CommentPatternCatalog = CommentPatternCatalog;
module.exports.createCommentPatternCatalog = createCommentPatternCatalog;
module.exports.normalizeToken = normalizeToken;
module.exports.compactIdentifier = compactIdentifier;
