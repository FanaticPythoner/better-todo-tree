function createCommentPatternLanguageResolver( vscode, utils )
{
    var cachedMappings;

    function toCandidateList( contribution )
    {
        return []
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
                if( typeof ( contribution.id ) !== 'string' || contribution.id.length === 0 || mappings.has( contribution.id ) )
                {
                    return;
                }

                var patternFileName = toCandidateList( contribution ).find( function( candidate )
                {
                    return utils.getCommentPattern( candidate ) !== undefined;
                } );

                if( patternFileName )
                {
                    mappings.set( contribution.id, patternFileName );
                }
            } );
        } );

        return mappings;
    }

    return function resolveCommentPatternFileNameForLanguage( languageId )
    {
        if( cachedMappings === undefined )
        {
            cachedMappings = buildMappings();
        }

        return cachedMappings.get( languageId );
    };
}

module.exports.createCommentPatternLanguageResolver = createCommentPatternLanguageResolver;
