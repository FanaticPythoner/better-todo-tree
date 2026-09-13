'use strict';

class TreeExportError extends Error
{
    constructor( code, message )
    {
        super( message );
        this.name = 'TreeExportError';
        this.code = code;
    }
}

function requireRecord( value )
{
    if( value === null || typeof value !== 'object' || Array.isArray( value ) )
    {
        throw new TreeExportError( 'INVALID_EXPORT_NODE', 'export containers must be records' );
    }
    return Object.keys( value );
}

function formatTree( root )
{
    var frames = [ { value: root, keys: requireRecord( root ), index: 0, prefix: '' } ];
    var ancestors = new Set( [ root ] );
    var lines = [];

    while( frames.length > 0 )
    {
        var frame = frames[ frames.length - 1 ];
        if( frame.index === frame.keys.length )
        {
            ancestors.delete( frame.value );
            frames.pop();
            continue;
        }
        var key = frame.keys[ frame.index++ ];
        var last = frame.index === frame.keys.length;
        var value = frame.value[ key ];
        var branch = frame.prefix + ( last ? '└─ ' : '├─ ' ) + key;
        var childPrefix = frame.prefix + ( last ? '   ' : '│  ' );

        if( typeof value === 'string' )
        {
            var textLines = value.split( '\n' );
            lines.push( branch + ': ' + textLines[ 0 ] );
            textLines.slice( 1 ).forEach( function( line )
            {
                lines.push( childPrefix + line );
            } );
            continue;
        }
        var keys = requireRecord( value );
        if( ancestors.has( value ) )
        {
            throw new TreeExportError( 'CYCLIC_EXPORT', 'export containers must be acyclic' );
        }
        lines.push( branch );
        ancestors.add( value );
        frames.push( { value: value, keys: keys, index: 0, prefix: childPrefix } );
    }
    return lines.length > 0 ? lines.join( '\n' ) + '\n' : '';
}

module.exports.formatTree = formatTree;
module.exports.TreeExportError = TreeExportError;
