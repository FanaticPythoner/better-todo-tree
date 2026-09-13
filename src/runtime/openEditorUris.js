'use strict';

function collectOpenEditorUris( groups )
{
    var uris = new Set();
    groups.forEach( function( group )
    {
        group.tabs.forEach( function( tab )
        {
            var input = tab.input;
            if( input )
            {
                [ input.uri, input.original, input.modified ].forEach( function( uri )
                {
                    if( uri )
                    {
                        uris.add( uri.toString() );
                    }
                } );
            }
        } );
    } );
    return uris;
}

module.exports.collectOpenEditorUris = collectOpenEditorUris;
