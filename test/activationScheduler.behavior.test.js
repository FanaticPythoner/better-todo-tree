var activationScheduler = require( '../src/runtime/activationScheduler.js' );

function createClock( synchronousMethod )
{
    var handles = [];

    function schedule( method, callback, delay )
    {
        var handle = {
            method: method,
            callback: callback,
            delay: delay,
            cancellations: 0
        };
        handles.push( handle );
        if( synchronousMethod === method )
        {
            callback();
        }
        return handle;
    }

    function cancel( handle )
    {
        handle.cancellations++;
    }

    return {
        handles: handles,
        setTimeout: function( callback, delay ) { return schedule( 'timeout', callback, delay ); },
        clearTimeout: cancel,
        setInterval: function( callback, delay ) { return schedule( 'interval', callback, delay ); },
        clearInterval: cancel,
        setImmediate: function( callback ) { return schedule( 'immediate', callback ); },
        clearImmediate: cancel
    };
}

QUnit.module( 'activation scheduler' );

QUnit.test( 'completed one-shot work leaves no disposable handle', function( assert )
{
    var clock = createClock();
    var scheduler = activationScheduler.createActivationScheduler( clock );
    var calls = 0;
    var handle = scheduler.scheduleTimeout( function() { calls++; }, 25 );

    handle.callback();
    scheduler.dispose();

    assert.equal( calls, 1 );
    assert.equal( handle.cancellations, 0 );
} );

QUnit.test( 'disposal cancels pending work once and suppresses retained callbacks', function( assert )
{
    var clock = createClock();
    var scheduler = activationScheduler.createActivationScheduler( clock );
    var calls = 0;
    var timeout = scheduler.scheduleTimeout( function() { calls++; }, 25 );
    var interval = scheduler.scheduleInterval( function() { calls++; }, 50 );
    var immediate = scheduler.scheduleImmediate( function() { calls++; } );

    scheduler.dispose();
    scheduler.dispose();
    timeout.callback();
    interval.callback();
    immediate.callback();

    assert.equal( calls, 0 );
    assert.equal( timeout.cancellations, 1 );
    assert.equal( interval.cancellations, 1 );
    assert.equal( immediate.cancellations, 1 );
    assert.strictEqual( scheduler.scheduleTimeout( function() {}, 1 ), undefined );
} );

QUnit.test( 'explicit cancellation removes handles from activation disposal', function( assert )
{
    var clock = createClock();
    var scheduler = activationScheduler.createActivationScheduler( clock );
    var timeout = scheduler.scheduleTimeout( function() {}, 25 );
    var interval = scheduler.scheduleInterval( function() {}, 50 );
    var immediate = scheduler.scheduleImmediate( function() {} );

    scheduler.cancelTimeout( timeout );
    scheduler.cancelInterval( interval );
    scheduler.cancelImmediate( immediate );
    scheduler.dispose();

    assert.deepEqual( clock.handles.map( function( handle ) { return handle.cancellations; } ), [ 1, 1, 1 ] );
} );

QUnit.test( 'synchronous one-shot clocks preserve callback execution and cleanup', function( assert )
{
    [ 'timeout', 'immediate' ].forEach( function( method )
    {
        var clock = createClock( method );
        var scheduler = activationScheduler.createActivationScheduler( clock );
        var calls = 0;
        var handle = method === 'timeout' ?
            scheduler.scheduleTimeout( function() { calls++; }, 0 ) :
            scheduler.scheduleImmediate( function() { calls++; } );

        scheduler.dispose();

        assert.equal( calls, 1, method + ' callback count' );
        assert.equal( handle.cancellations, 0, method + ' cancellation count' );
    } );
} );

QUnit.test( 'clock contract rejects missing scheduling methods', function( assert )
{
    var thrown;

    try
    {
        activationScheduler.createActivationScheduler( {} );
    }
    catch( error )
    {
        thrown = error;
    }

    assert.ok( thrown instanceof TypeError );
    assert.equal( thrown.message, 'activation scheduler requires clock.setTimeout' );
} );
