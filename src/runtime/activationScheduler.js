function createHandleRegistry( schedule, cancel, repeats, isDisposed )
{
    var handles = new Set();

    function add( callback, delay )
    {
        var completedSynchronously = false;
        var handle;

        if( isDisposed() === true )
        {
            return undefined;
        }

        function invoke()
        {
            completedSynchronously = true;
            if( repeats !== true && handle !== undefined )
            {
                handles.delete( handle );
            }
            if( isDisposed() !== true )
            {
                callback();
            }
        }

        handle = delay === undefined ? schedule( invoke ) : schedule( invoke, delay );

        if( isDisposed() === true )
        {
            if( handle !== undefined )
            {
                cancel( handle );
            }
        }
        else if( handle !== undefined && ( repeats === true || completedSynchronously !== true ) )
        {
            handles.add( handle );
        }

        return handle;
    }

    function remove( handle )
    {
        if( handle !== undefined )
        {
            handles.delete( handle );
            cancel( handle );
        }
    }

    function dispose()
    {
        handles.forEach( cancel );
        handles.clear();
    }

    return {
        add: add,
        remove: remove,
        dispose: dispose
    };
}

function createActivationScheduler( clock )
{
    var disposed = false;

    [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate'
    ].forEach( function( method )
    {
        if( !clock || typeof ( clock[ method ] ) !== 'function' )
        {
            throw new TypeError( 'activation scheduler requires clock.' + method );
        }
    } );

    function isDisposed()
    {
        return disposed;
    }

    var timeouts = createHandleRegistry( clock.setTimeout, clock.clearTimeout, false, isDisposed );
    var intervals = createHandleRegistry( clock.setInterval, clock.clearInterval, true, isDisposed );
    var immediates = createHandleRegistry( clock.setImmediate, clock.clearImmediate, false, isDisposed );

    function dispose()
    {
        if( disposed === true )
        {
            return;
        }

        disposed = true;
        timeouts.dispose();
        intervals.dispose();
        immediates.dispose();
    }

    return {
        scheduleTimeout: timeouts.add,
        cancelTimeout: timeouts.remove,
        scheduleInterval: intervals.add,
        cancelInterval: intervals.remove,
        scheduleImmediate: immediates.add,
        cancelImmediate: immediates.remove,
        isDisposed: isDisposed,
        dispose: dispose
    };
}

module.exports.createActivationScheduler = createActivationScheduler;
