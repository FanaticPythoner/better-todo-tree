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

module.exports.loadWithStubs = loadWithStubs;
