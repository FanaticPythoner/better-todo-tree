var Module = require( 'module' );

function loadWithStubs( modulePath, stubs )
{
    var originalLoad = Module._load;
    delete require.cache[ require.resolve( modulePath ) ];

    Module._load = function( request, parent, isMain )
    {
        if( stubs && Object.prototype.hasOwnProperty.call( stubs, request ) )
        {
            return stubs[ request ];
        }

        return originalLoad.call( this, request, parent, isMain );
    };

    try
    {
        return require( modulePath );
    }
    finally
    {
        Module._load = originalLoad;
    }
}

function withRegExpWithoutIndices( callback )
{
    var nativeRegExp = global.RegExp;

    function restoreRegExp()
    {
        global.RegExp = nativeRegExp;
    }

    function RegExpWithoutIndices( source, flags )
    {
        if( typeof flags === 'string' && flags.indexOf( 'd' ) !== -1 )
        {
            throw new SyntaxError( 'Invalid flags: ' + flags.split( '' ).sort().join( '' ) );
        }

        return new nativeRegExp( source, flags );
    }

    RegExpWithoutIndices.prototype = nativeRegExp.prototype;
    Object.setPrototypeOf( RegExpWithoutIndices, nativeRegExp );

    try
    {
        global.RegExp = RegExpWithoutIndices;
        var result = callback();

        if( result && typeof ( result.then ) === 'function' )
        {
            return result.then( function( value )
            {
                restoreRegExp();
                return value;
            }, function( error )
            {
                restoreRegExp();
                throw error;
            } );
        }

        restoreRegExp();
        return result;
    }
    catch( error )
    {
        restoreRegExp();
        throw error;
    }
}

module.exports.loadWithStubs = loadWithStubs;
module.exports.withRegExpWithoutIndices = withRegExpWithoutIndices;
