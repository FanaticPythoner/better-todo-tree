var path = require( 'path' );

var micromatch = require( 'micromatch' );
var baseLanguages = require( 'comment-patterns/db-generated/base.js' );

var commentPatternCatalog = require( './commentPatternCatalog.js' );
var regexRegistry = require( './regexRegistry.js' );

var config;
var compiledSignature;
var compiledConfiguration;
var globMagicRegex = regexRegistry.createRegExp( 'globMagicCharacter' );

function CustomLanguageConfigurationError( message )
{
    this.name = 'CustomLanguageConfigurationError';
    this.message = message;
    Error.captureStackTrace( this, CustomLanguageConfigurationError );
}

CustomLanguageConfigurationError.prototype = Object.create( Error.prototype );
CustomLanguageConfigurationError.prototype.constructor = CustomLanguageConfigurationError;

function init( configuration )
{
    config = configuration;
    compiledSignature = undefined;
    compiledConfiguration = undefined;
}

function stableStringify( value )
{
    if( Array.isArray( value ) )
    {
        return '[' + value.map( stableStringify ).join( ',' ) + ']';
    }

    if( value && typeof ( value ) === 'object' )
    {
        return '{' + Object.keys( value ).sort().map( function( key )
        {
            return JSON.stringify( key ) + ':' + stableStringify( value[ key ] );
        } ).join( ',' ) + '}';
    }

    return JSON.stringify( value );
}

function readConfigArray( methodName )
{
    var value = config && typeof ( config[ methodName ] ) === 'function' ? config[ methodName ]() : [];

    if( value === undefined )
    {
        return [];
    }

    if( Array.isArray( value ) !== true )
    {
        throw new CustomLanguageConfigurationError(
            'customLanguageConfiguration: ' + methodName + ' must be an array.'
        );
    }

    return value;
}

function readRawConfiguration()
{
    return {
        customCommentPatterns: readConfigArray( 'customCommentPatterns' ),
        customEmbeddedDocuments: readConfigArray( 'customEmbeddedDocuments' )
    };
}

function requireObject( value, location )
{
    if( !value || typeof ( value ) !== 'object' || Array.isArray( value ) )
    {
        throw new CustomLanguageConfigurationError(
            'customLanguageConfiguration: ' + location + ' must be an object.'
        );
    }

    return value;
}

function requireString( value, location )
{
    if( typeof ( value ) !== 'string' || value.length === 0 )
    {
        throw new CustomLanguageConfigurationError(
            'customLanguageConfiguration: ' + location + ' must be a non-empty string.'
        );
    }

    return value;
}

function readStringArray( value, location )
{
    if( value === undefined )
    {
        return [];
    }

    if( Array.isArray( value ) !== true )
    {
        throw new CustomLanguageConfigurationError(
            'customLanguageConfiguration: ' + location + ' must be an array.'
        );
    }

    return value.map( function( item, index )
    {
        return requireString( item, location + '[' + index + ']' );
    } );
}

function uniqueStrings( values )
{
    var seen = new Set();

    return values.filter( function( value )
    {
        if( typeof ( value ) !== 'string' || value.length === 0 || seen.has( value ) )
        {
            return false;
        }

        seen.add( value );
        return true;
    } );
}

function readSingleLineEntry( value, location )
{
    if( typeof ( value ) === 'string' )
    {
        return {
            start: requireString( value, location )
        };
    }

    requireObject( value, location );

    return {
        start: requireString( value.start, location + '.start' )
    };
}

function readSingleLineComments( value, location )
{
    if( value === undefined )
    {
        return [];
    }

    if( Array.isArray( value ) !== true )
    {
        throw new CustomLanguageConfigurationError(
            'customLanguageConfiguration: ' + location + ' must be an array.'
        );
    }

    return value.map( function( entry, index )
    {
        return readSingleLineEntry( entry, location + '[' + index + ']' );
    } );
}

function compileStartPattern( value, location )
{
    if( value.start !== undefined )
    {
        return requireString( value.start, location + '.start' );
    }

    if( value.startRegex !== undefined )
    {
        requireObject( value.startRegex, location + '.startRegex' );
        return new RegExp(
            requireString( value.startRegex.source, location + '.startRegex.source' ),
            value.startRegex.flags || ''
        );
    }

    throw new CustomLanguageConfigurationError(
        'customLanguageConfiguration: ' + location + ' requires start or startRegex.'
    );
}

function readMultiLineEntry( value, location )
{
    requireObject( value, location );

    var entry = {
        start: compileStartPattern( value, location ),
        end: requireString( value.end, location + '.end' )
    };

    if( value.middle !== undefined )
    {
        entry.middle = requireString( value.middle, location + '.middle' );
    }

    if( value.apidoc === true )
    {
        entry.apidoc = true;
    }

    return entry;
}

function readMultiLineComments( value, location )
{
    if( value === undefined )
    {
        return [];
    }

    if( Array.isArray( value ) !== true )
    {
        throw new CustomLanguageConfigurationError(
            'customLanguageConfiguration: ' + location + ' must be an array.'
        );
    }

    return value.map( function( entry, index )
    {
        return readMultiLineEntry( entry, location + '[' + index + ']' );
    } );
}

function createPatternRegex( pattern )
{
    var multiLineComment = pattern.multiLineComment || [];
    var sources;

    if( multiLineComment.length === 0 )
    {
        return undefined;
    }

    sources = multiLineComment.map( function( entry )
    {
        var startSource = typeof ( entry.start ) === 'string' ?
            regexRegistry.escapeRegexLiteral( entry.start ) :
            entry.start.source;

        return startSource + '([\\s\\S]*?)' + regexRegistry.escapeRegexLiteral( entry.end );
    } );

    return {
        regex: new RegExp( '^([ \\t]*)(?:' + sources.join( '|' ) + ')[\\r\\n]*', 'gm' ),
        cg: {
            indent: 1,
            contentStart: 2
        },
        middle: multiLineComment.map( function( entry )
        {
            return entry.middle || '';
        } ),
        name: pattern.name,
        info: multiLineComment.map( function( entry )
        {
            return {
                type: 'multiline',
                apidoc: entry.apidoc === true
            };
        } )
    };
}

function getLiteralGlobExtension( glob )
{
    var extension = path.extname( path.basename( glob ) );

    if( extension.length === 0 || globMagicRegex.test( extension ) )
    {
        return undefined;
    }

    return extension.toLowerCase();
}

function createFilenameGlobMatcher( glob )
{
    return {
        matcher: micromatch.matcher( glob, { dot: true, nocase: true } ),
        extension: getLiteralGlobExtension( glob )
    };
}

function compileCommentPattern( definition, index )
{
    var location = 'customCommentPatterns[' + index + ']';
    var descriptor = requireObject( definition, location );
    var id = requireString( descriptor.id, location + '.id' );
    var aliases = readStringArray( descriptor.aliases, location + '.aliases' )
        .concat( readStringArray( descriptor.languageIds, location + '.languageIds' ) );
    var extensions = readStringArray( descriptor.extensions, location + '.extensions' );
    var filenames = readStringArray( descriptor.filenames, location + '.filenames' );
    var filenameGlobs = readStringArray( descriptor.filenameGlobs, location + '.filenameGlobs' );
    var singleLineComment = readSingleLineComments(
        descriptor.singleLineComments || descriptor.singleLineComment,
        location + '.singleLineComments'
    );
    var multiLineComment = readMultiLineComments(
        descriptor.multiLineComments || descriptor.multiLineComment,
        location + '.multiLineComments'
    );
    var pattern = {
        name: typeof ( descriptor.name ) === 'string' && descriptor.name.length > 0 ? descriptor.name : id,
        nameMatchers: uniqueStrings( [ id ].concat( aliases, extensions, filenames ) ),
        singleLineComment: singleLineComment,
        multiLineComment: multiLineComment
    };

    if( descriptor.commentsOnly === true )
    {
        pattern.commentsOnly = true;
    }

    if( pattern.commentsOnly !== true && singleLineComment.length === 0 && multiLineComment.length === 0 )
    {
        throw new CustomLanguageConfigurationError(
            'customLanguageConfiguration: ' + location + ' requires a comment delimiter.'
        );
    }

    return {
        id: id,
        pattern: pattern,
        patternRegex: createPatternRegex( pattern ),
        matchers: pattern.nameMatchers,
        filenameGlobs: filenameGlobs,
        filenameGlobMatchers: filenameGlobs.map( createFilenameGlobMatcher )
    };
}

function createMappingStore()
{
    return {
        byToken: new Map(),
        byCompactToken: new Map()
    };
}

function addMapping( mappings, token, compiledPattern )
{
    var normalized = commentPatternCatalog.normalizeToken( token );
    var compact = commentPatternCatalog.compactIdentifier( token );

    if( normalized.length > 0 && mappings.byToken.has( normalized ) !== true )
    {
        mappings.byToken.set( normalized, compiledPattern );
    }

    if( compact.length > 0 && mappings.byCompactToken.has( compact ) !== true )
    {
        mappings.byCompactToken.set( compact, compiledPattern );
    }
}

function createLookupCandidates( value )
{
    var raw = typeof ( value ) === 'string' ? value : "";
    var baseName = path.basename( raw );
    var extension = path.extname( baseName );

    return uniqueStrings( [
        raw,
        baseName,
        extension,
        extension.length > 0 ? extension.slice( 1 ) : ""
    ] );
}

function createGlobMatcherEntries( patterns )
{
    var entries = [];

    patterns.forEach( function( compiledPattern )
    {
        compiledPattern.filenameGlobMatchers.forEach( function( globMatcher )
        {
            entries.push( {
                compiledPattern: compiledPattern,
                matcher: globMatcher.matcher,
                extension: globMatcher.extension
            } );
        } );
    } );

    return entries;
}

function findGlobCompiledPattern( compiled, value )
{
    var raw = typeof ( value ) === 'string' ? value : "";
    var baseName = path.basename( raw );
    var extension = path.extname( baseName ).toLowerCase();
    var found;

    compiled.globMatchers.some( function( globMatcher )
    {
        if( globMatcher.extension !== undefined && globMatcher.extension !== extension )
        {
            return false;
        }

        if( globMatcher.matcher( raw ) || globMatcher.matcher( baseName ) )
        {
            found = globMatcher.compiledPattern;
            return true;
        }

        return false;
    } );

    return found;
}

function findCompiledPattern( value )
{
    var compiled = getCompiledConfiguration();
    var candidates = createLookupCandidates( value );
    var found;

    candidates.some( function( candidate )
    {
        var normalized = commentPatternCatalog.normalizeToken( candidate );
        var compact = commentPatternCatalog.compactIdentifier( candidate );

        if( compiled.mappings.byToken.has( normalized ) )
        {
            found = compiled.mappings.byToken.get( normalized );
            return true;
        }

        if( compiled.mappings.byCompactToken.has( compact ) )
        {
            found = compiled.mappings.byCompactToken.get( compact );
            return true;
        }

        return false;
    } );

    if( found )
    {
        return found;
    }

    return findGlobCompiledPattern( compiled, value );
}

function compileConfiguration( rawConfiguration )
{
    var patterns = rawConfiguration.customCommentPatterns.map( compileCommentPattern );
    var mappings = createMappingStore();
    var catalogLanguages;
    var catalog;

    patterns.forEach( function( compiledPattern )
    {
        compiledPattern.matchers.forEach( function( matcher )
        {
            addMapping( mappings, matcher, compiledPattern );
        } );
    } );

    catalogLanguages = patterns.map( function( compiledPattern )
    {
        return {
            name: compiledPattern.pattern.name,
            nameMatchers: compiledPattern.matchers.slice()
        };
    } ).concat( baseLanguages );
    catalog = commentPatternCatalog.createCommentPatternCatalog( {
        languages: catalogLanguages
    } );

    return {
        patterns: patterns,
        globMatchers: createGlobMatcherEntries( patterns ),
        mappings: mappings,
        embeddedDocuments: rawConfiguration.customEmbeddedDocuments.slice(),
        catalog: catalog
    };
}

function getCompiledConfiguration()
{
    if( compiledConfiguration === undefined )
    {
        var rawConfiguration = readRawConfiguration();
        var signature = stableStringify( rawConfiguration );

        compiledConfiguration = compileConfiguration( rawConfiguration );
        compiledSignature = signature;
    }

    return compiledConfiguration;
}

function getSignature()
{
    getCompiledConfiguration();
    return compiledSignature;
}

function getCommentPattern( fileName )
{
    var compiledPattern = findCompiledPattern( fileName );

    return compiledPattern ? compiledPattern.pattern : undefined;
}

function getCommentPatternRegex( fileName )
{
    var compiledPattern = findCompiledPattern( fileName );

    return compiledPattern ? compiledPattern.patternRegex : undefined;
}

function createCommentPatternCatalog()
{
    return getCompiledConfiguration().catalog;
}

function resolveCommentPatternFileName( value )
{
    return createCommentPatternCatalog().resolvePatternFileName( value );
}

function getEmbeddedDocumentDescriptors( defaultDescriptors )
{
    return getCompiledConfiguration().embeddedDocuments.concat( defaultDescriptors || [] );
}

module.exports.CustomLanguageConfigurationError = CustomLanguageConfigurationError;
module.exports.init = init;
module.exports.getSignature = getSignature;
module.exports.getCommentPattern = getCommentPattern;
module.exports.getCommentPatternRegex = getCommentPatternRegex;
module.exports.createCommentPatternCatalog = createCommentPatternCatalog;
module.exports.resolveCommentPatternFileName = resolveCommentPatternFileName;
module.exports.getEmbeddedDocumentDescriptors = getEmbeddedDocumentDescriptors;
