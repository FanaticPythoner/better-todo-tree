var path = require( 'path' );

var micromatch = require( 'micromatch' );
var commentPatternCatalog = require( './commentPatternCatalog.js' );
var customLanguageConfiguration = require( './customLanguageConfiguration.js' );
var defaultDescriptors = require( './embeddedDocumentDescriptors.json' );
var embeddedDocumentParserRegistry = require( './embeddedDocumentParserRegistry.js' );
var htmlLikeEmbeddedDocumentParser = require( './htmlLikeEmbeddedDocumentParser.js' );

var HTML_LIKE_ELEMENT_REGIONS_PARSER_ID = 'html-like-element-regions';
var defaultResolverCache;

function normalizeToken( value )
{
    return commentPatternCatalog.normalizeToken( value );
}

function asArray( value )
{
    return Array.isArray( value ) ? value : [];
}

function validateDelimitedRegionDescriptor( descriptor, region, location )
{
    if( !region || typeof ( region ) !== 'object' )
    {
        throw new Error( 'embeddedDocuments: ' + location + ' from ' + descriptor.id + ' must be an object.' );
    }

    if( typeof ( region.start ) !== 'string' || region.start.length === 0 )
    {
        throw new Error( 'embeddedDocuments: ' + location + '.start is required for ' + descriptor.id + '.' );
    }

    if( typeof ( region.end ) !== 'string' || region.end.length === 0 )
    {
        throw new Error( 'embeddedDocuments: ' + location + '.end is required for ' + descriptor.id + '.' );
    }
}

function validateDelimitedRegionDescriptors( descriptor, fieldName )
{
    if( descriptor[ fieldName ] === undefined )
    {
        return;
    }

    if( !Array.isArray( descriptor[ fieldName ] ) )
    {
        throw new Error( 'embeddedDocuments: descriptor.' + fieldName + ' must be an array for ' + descriptor.id + '.' );
    }

    descriptor[ fieldName ].forEach( function( region, index )
    {
        validateDelimitedRegionDescriptor( descriptor, region, fieldName + '[' + index + ']' );
    } );
}

function validateDescriptor( descriptor )
{
    if( !descriptor || typeof ( descriptor ) !== 'object' )
    {
        throw new Error( 'embeddedDocuments: descriptor object is required.' );
    }

    if( typeof ( descriptor.id ) !== 'string' || descriptor.id.length === 0 )
    {
        throw new Error( 'embeddedDocuments: descriptor.id is required.' );
    }

    if( typeof ( descriptor.parser ) !== 'string' || descriptor.parser.length === 0 )
    {
        throw new Error( 'embeddedDocuments: descriptor.parser is required for ' + descriptor.id + '.' );
    }

    if( !Array.isArray( descriptor.regions ) )
    {
        throw new Error( 'embeddedDocuments: descriptor.regions is required for ' + descriptor.id + '.' );
    }

    descriptor.regions.forEach( function( region )
    {
        if( !region || typeof ( region.element ) !== 'string' || region.element.length === 0 )
        {
            throw new Error( 'embeddedDocuments: region.element is required for ' + descriptor.id + '.' );
        }
    } );

    validateDelimitedRegionDescriptors( descriptor, 'leadingFences' );
    validateDelimitedRegionDescriptors( descriptor, 'wrappedRegions' );
}

function descriptorMatches( descriptor, fileName, options )
{
    var match = descriptor.match || {};
    var languageId = normalizeToken( options && options.languageId );
    var rawFileName = fileName || "";
    var baseName = path.basename( rawFileName );
    var normalizedBaseName = normalizeToken( baseName );
    var extension = normalizeToken( path.extname( baseName ) );
    var extensions = asArray( match.extensions ).map( normalizeToken );
    var filenames = asArray( match.filenames ).map( normalizeToken );
    var languageIds = asArray( match.languageIds ).map( normalizeToken );
    var filenameGlobs = asArray( match.filenameGlobs );

    return ( extension.length > 0 && extensions.indexOf( extension ) !== -1 ) ||
        ( normalizedBaseName.length > 0 && filenames.indexOf( normalizedBaseName ) !== -1 ) ||
        ( languageId.length > 0 && languageIds.indexOf( languageId ) !== -1 ) ||
        filenameGlobs.some( function( glob )
        {
            return micromatch.isMatch( rawFileName, glob, { dot: true, nocase: true } ) ||
                micromatch.isMatch( baseName, glob, { dot: true, nocase: true } );
        } );
}

function validateParserRegistry( parserRegistry )
{
    if( !parserRegistry || typeof ( parserRegistry.create ) !== 'function' )
    {
        throw new Error( 'embeddedDocuments: parserRegistry.create is required.' );
    }
}

function validateResolvedRegion( descriptor, region, index )
{
    var prefix = 'embeddedDocuments: region ' + index + ' from ' + descriptor.id;

    if( !region || typeof ( region ) !== 'object' )
    {
        throw new Error( prefix + ' must be an object.' );
    }

    if( typeof ( region.element ) !== 'string' || region.element.length === 0 )
    {
        throw new Error( prefix + ' requires element.' );
    }

    if(
        region.patternFileName !== undefined &&
        ( typeof ( region.patternFileName ) !== 'string' || region.patternFileName.length === 0 )
    )
    {
        throw new Error( prefix + ' has invalid patternFileName.' );
    }

    [
        'startOffset',
        'endOffset',
        'rangeStartOffset',
        'rangeEndOffset'
    ].forEach( function( field )
    {
        if( typeof ( region[ field ] ) !== 'number' || region[ field ] < 0 )
        {
            throw new Error( prefix + ' requires non-negative numeric ' + field + '.' );
        }
    } );

    if(
        region.startOffset > region.endOffset ||
        region.rangeStartOffset > region.startOffset ||
        region.endOffset > region.rangeEndOffset
    )
    {
        throw new Error( prefix + ' has inconsistent offsets.' );
    }

    if( typeof ( region.text ) !== 'string' )
    {
        throw new Error( prefix + ' requires text.' );
    }
}

function normalizeResolvedRegions( descriptor, regions )
{
    if( !Array.isArray( regions ) )
    {
        throw new Error( 'embeddedDocuments: parser ' + descriptor.parser + ' for ' + descriptor.id + ' must return an array.' );
    }

    regions.forEach( function( region, index )
    {
        validateResolvedRegion( descriptor, region, index );
    } );

    return regions;
}

function EmbeddedDocumentDescriptorSet( descriptors, catalog, parserRegistry )
{
    this.descriptors = descriptors.map( function( descriptor )
    {
        validateDescriptor( descriptor );
        return descriptor;
    } );
    validateParserRegistry( parserRegistry );
    this.catalog = catalog;
    this.parserRegistry = parserRegistry;
}

EmbeddedDocumentDescriptorSet.prototype.resolve = function( fileName, text, options )
{
    var catalog = this.catalog;
    var descriptor = this.descriptors.find( function( candidate )
    {
        return descriptorMatches( candidate, fileName, options || {} );
    } );

    if( !descriptor )
    {
        return undefined;
    }

    var parser = this.parserRegistry.create( descriptor.parser, {
        descriptor: descriptor,
        catalog: catalog
    } );
    var basePatternFileName = descriptor.baseLanguage ?
        catalog.resolvePatternFileName( descriptor.baseLanguage ) :
        undefined;
    var regions = normalizeResolvedRegions( descriptor, parser.parse( text ) );

    return {
        descriptor: descriptor,
        basePatternFileName: basePatternFileName,
        regions: regions,
        ranges: regions.map( function( region )
        {
            return {
                startOffset: region.rangeStartOffset,
                endOffset: region.rangeEndOffset
            };
        } )
    };
};

function createDefaultParserRegistry()
{
    return embeddedDocumentParserRegistry.createEmbeddedDocumentParserRegistry()
        .register(
            HTML_LIKE_ELEMENT_REGIONS_PARSER_ID,
            htmlLikeEmbeddedDocumentParser.createHtmlLikeEmbeddedDocumentParser
        );
}

function createEmbeddedDocumentResolver( options )
{
    options = options || {};

    return new EmbeddedDocumentDescriptorSet(
        options.descriptors || defaultDescriptors,
        options.catalog || commentPatternCatalog.createCommentPatternCatalog(),
        options.parserRegistry || createDefaultParserRegistry()
    );
}

function getDefaultResolver()
{
    var signature = customLanguageConfiguration.getSignature();

    if( defaultResolverCache === undefined || defaultResolverCache.signature !== signature )
    {
        defaultResolverCache = {
            signature: signature,
            resolver: createEmbeddedDocumentResolver( {
                descriptors: customLanguageConfiguration.getEmbeddedDocumentDescriptors( defaultDescriptors ),
                catalog: customLanguageConfiguration.createCommentPatternCatalog()
            } )
        };
    }

    return defaultResolverCache.resolver;
}

function resolveEmbeddedDocument( fileName, text, options )
{
    return getDefaultResolver().resolve( fileName, text, options || {} );
}

function findTrailingOpenRegionStart( fileName, text, options )
{
    var document = resolveEmbeddedDocument( fileName, text, options || {} );
    var startOffset;

    if( !document )
    {
        return undefined;
    }

    document.regions.forEach( function( region )
    {
        if( region.closed !== true && ( startOffset === undefined || region.rangeStartOffset < startOffset ) )
        {
            startOffset = region.rangeStartOffset;
        }
    } );

    return startOffset;
}

module.exports.createEmbeddedDocumentResolver = createEmbeddedDocumentResolver;
module.exports.createEmbeddedDocumentParserRegistry = embeddedDocumentParserRegistry.createEmbeddedDocumentParserRegistry;
module.exports.createDefaultParserRegistry = createDefaultParserRegistry;
module.exports.resolveEmbeddedDocument = resolveEmbeddedDocument;
module.exports.findTrailingOpenRegionStart = findTrailingOpenRegionStart;
