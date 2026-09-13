var exporter = require( '../src/treeExport.js' );

QUnit.module( 'text tree export' );

QUnit.test( 'reserved property names render from records without prototypes', function( assert )
{
    var root = Object.create( null );
    root.__proto__ = Object.create( null );
    root.__proto__.hasOwnProperty = 'TODO retained';
    root.constructor = 'FIXME retained';
    assert.equal( exporter.formatTree( root ),
        '├─ __proto__\n│  └─ hasOwnProperty: TODO retained\n└─ constructor: FIXME retained\n' );
} );

QUnit.test( 'multiline values preserve branches and ignore inherited properties', function( assert )
{
    var root = Object.create( { inherited: 'excluded' } );
    root.file = { 'line 1': 'TODO first\ncontinuation' };
    root.empty = {};
    assert.equal( exporter.formatTree( root ),
        '├─ file\n│  └─ line 1: TODO first\n│     continuation\n└─ empty\n' );
    assert.equal( exporter.formatTree( {} ), '' );
} );

QUnit.test( 'invalid nodes and cycles reject with typed errors', function( assert )
{
    [ null, [], 1, undefined, { invalid: null }, { invalid: function() {} } ].forEach( function( input )
    {
        assert.throws( function() { exporter.formatTree( input ); }, function( error )
        {
            return error instanceof exporter.TreeExportError && error.code === 'INVALID_EXPORT_NODE';
        } );
    } );
    var root = {};
    root.cycle = root;
    assert.throws( function() { exporter.formatTree( root ); }, function( error )
    {
        return error instanceof exporter.TreeExportError && error.code === 'CYCLIC_EXPORT';
    } );
} );

QUnit.test( 'shared subtrees render at each path without a false cycle', function( assert )
{
    var shared = { item: 'TODO item' };
    assert.equal( exporter.formatTree( { first: shared, second: shared } ),
        '├─ first\n│  └─ item: TODO item\n└─ second\n   └─ item: TODO item\n' );
} );
