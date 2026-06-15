var commentPatternCatalog = require( './commentPatternCatalog.js' );

function createCommentPatternLanguageResolver( vscode, utils )
{
    var cachedMappings;
    var cachedSignature;

    validateUtils( utils );

    function toMappingKeys( value )
    {
        var normalized = commentPatternCatalog.normalizeToken( value );
        var compact = commentPatternCatalog.compactIdentifier( value );
        var keys = [];

        if( normalized.length > 0 )
        {
            keys.push( normalized );
        }

        if( compact.length > 0 && compact !== normalized )
        {
            keys.push( compact );
        }

        return keys;
    }

    function addMapping( mappings, token, patternFileName )
    {
        toMappingKeys( token ).forEach( function( key )
        {
            if( mappings.has( key ) !== true )
            {
                mappings.set( key, patternFileName );
            }
        } );
    }

    function getMapping( mappings, token )
    {
        var keys = toMappingKeys( token );
        var index;

        for( index = 0; index < keys.length; index++ )
        {
            if( mappings.has( keys[ index ] ) )
            {
                return mappings.get( keys[ index ] );
            }
        }

        return undefined;
    }

    function hasNormalizedMapping( mappings, token )
    {
        var normalized = commentPatternCatalog.normalizeToken( token );

        return normalized.length > 0 && mappings.has( normalized );
    }

    function toCandidateList( contribution )
    {
        return []
            .concat( Array.isArray( contribution.extensions ) ? contribution.extensions : [] )
            .concat( Array.isArray( contribution.filenames ) ? contribution.filenames : [] )
            .concat( typeof ( contribution.id ) === 'string' ? [ contribution.id ] : [] )
            .concat( Array.isArray( contribution.aliases ) ? contribution.aliases : [] );
    }

    function toLanguageTokens( contribution )
    {
        return [ contribution.id ]
            .concat( Array.isArray( contribution.aliases ) ? contribution.aliases : [] )
            .concat( Array.isArray( contribution.extensions ) ? contribution.extensions : [] )
            .concat( Array.isArray( contribution.filenames ) ? contribution.filenames : [] );
    }

    function buildMappings()
    {
        var mappings = new Map();
        var extensions = vscode && vscode.extensions && Array.isArray( vscode.extensions.all ) ? vscode.extensions.all : [];

        extensions.forEach( function( extension )
        {
            var contributions = extension &&
                extension.packageJSON &&
                extension.packageJSON.contributes &&
                Array.isArray( extension.packageJSON.contributes.languages ) ?
                extension.packageJSON.contributes.languages :
                [];

            contributions.forEach( function( contribution )
            {
                if( typeof ( contribution.id ) !== 'string' || contribution.id.length === 0 || hasNormalizedMapping( mappings, contribution.id ) )
                {
                    return;
                }

                var patternFileName = toCandidateList( contribution ).find( function( candidate )
                {
                    return utils.getCommentPattern( candidate ) !== undefined;
                } );

                if( patternFileName )
                {
                    toLanguageTokens( contribution ).forEach( function( token )
                    {
                        if( typeof ( token ) === 'string' && token.length > 0 )
                        {
                            addMapping( mappings, token, patternFileName );
                        }
                    } );
                }
            } );
        } );

        return mappings;
    }

    return function resolveCommentPatternFileNameForLanguage( languageId )
    {
        var signature = utils.getLanguageConfigurationSignature();

        if( cachedMappings === undefined || cachedSignature !== signature )
        {
            cachedMappings = buildMappings();
            cachedSignature = signature;
        }

        return getMapping( cachedMappings, languageId ) || utils.resolveCommentPatternFileName( languageId );
    };
}

function validateUtils( utils )
{
    if( !utils || typeof ( utils.getCommentPattern ) !== 'function' )
    {
        throw new Error( 'commentPatternLanguageResolver: utils.getCommentPattern is required.' );
    }

    if( typeof ( utils.resolveCommentPatternFileName ) !== 'function' )
    {
        throw new Error( 'commentPatternLanguageResolver: utils.resolveCommentPatternFileName is required.' );
    }

    if( typeof ( utils.getLanguageConfigurationSignature ) !== 'function' )
    {
        throw new Error( 'commentPatternLanguageResolver: utils.getLanguageConfigurationSignature is required.' );
    }
}

module.exports.createCommentPatternLanguageResolver = createCommentPatternLanguageResolver;
