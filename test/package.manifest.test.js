var fs = require( 'fs' );
var path = require( 'path' );

QUnit.test( "showTreeView context menu is scoped to todo-tree views", function( assert )
{
    var packageJson = JSON.parse( fs.readFileSync( path.join( __dirname, '..', 'package.json' ), 'utf8' ) );
    var menuEntry = packageJson.contributes.menus[ 'view/item/context' ].find( function( entry )
    {
        return entry.command === 'todo-tree.showTreeView';
    } );

    assert.equal( menuEntry.when, "view =~ /todo-tree/ && (todo-tree-flat == true || todo-tree-tags-only == true)" );
} );
