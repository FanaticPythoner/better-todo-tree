'use strict';

var createWorkspaceFileWatcher = require( '../src/runtime/workspaceFileWatcher.js' ).createWorkspaceFileWatcher;

QUnit.module( 'workspace file watcher' );

QUnit.test( 'watcher ownership covers changes, replacement, disable and disposal', function( assert )
{
    var created = [];
    var events = [];
    var owner = createWorkspaceFileWatcher( {
        createFileSystemWatcher: function( glob )
        {
            var watcher = { glob: glob, disposed: 0,
                dispose: function() { watcher.disposed++; },
                onDidCreate: function( handler ) { watcher.create = handler; },
                onDidChange: function( handler ) { watcher.change = handler; },
                onDidDelete: function( handler ) { watcher.remove = handler; } };
            created.push( watcher );
            return watcher;
        }
    }, function( uri ) { events.push( uri ); } );
    owner.configure( undefined );
    assert.equal( created.length, 0 );
    owner.configure( '**/*.js' );
    owner.configure( '**/*.js' );
    assert.equal( created.length, 1 );
    created[ 0 ].create( 'first' );
    created[ 0 ].change( 'second' );
    created[ 0 ].remove( 'third' );
    assert.deepEqual( events, [ 'first', 'second', 'third' ] );
    owner.configure( '**/*.py' );
    assert.equal( created[ 0 ].disposed, 1 );
    assert.equal( created[ 1 ].glob, '**/*.py' );
    created[ 0 ].change( 'stale replaced watcher' );
    assert.deepEqual( events, [ 'first', 'second', 'third' ] );
    owner.configure( undefined );
    assert.equal( created[ 1 ].disposed, 1 );
    created[ 1 ].change( 'stale disabled watcher' );
    assert.deepEqual( events, [ 'first', 'second', 'third' ] );
    owner.dispose();
    assert.equal( created[ 1 ].disposed, 1 );
} );

QUnit.test( 'watcher creation failures propagate and permit explicit retry', function( assert )
{
    var fail = true;
    var watcher = { onDidCreate: function() {}, onDidChange: function() {},
        onDidDelete: function() {}, dispose: function() {} };
    var owner = createWorkspaceFileWatcher( { createFileSystemWatcher: function()
    {
        if( fail ) { throw new Error( 'watch denied' ); }
        return watcher;
    } }, function() {} );
    assert.throws( function() { owner.configure( '**/*' ); },
        function( error ) { return error.message === 'watch denied'; } );
    fail = false;
    owner.configure( '**/*' );
    owner.dispose();
} );
