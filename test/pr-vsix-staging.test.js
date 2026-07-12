var path = require( 'path' );
var pathToFileURL = require( 'url' ).pathToFileURL;

var modulePromise = import( pathToFileURL(
    path.join( __dirname, '..', 'scripts', 'ci', 'delete-pr-vsix-staging.mjs' )
).href );

QUnit.module( 'PR VSIX staging artifact cleanup' );

QUnit.test( 'deletes the exact staging artifact', async function( assert )
{
    var module = await modulePromise;
    var deleted = [];
    var api = {
        listRunArtifacts: async function( runId )
        {
            assert.equal( runId, 200 );
            return [
                { id: 300, name: 'better-todo-tree-pr-19-win32-x64.vsix' },
                { id: 400, name: 'better-todo-tree-pr-19-staging-200-1' }
            ];
        },
        deleteArtifact: async function( artifactId ) { deleted.push( artifactId ); }
    };

    assert.deepEqual( await module.deleteStagingArtifact(
        api,
        200,
        'better-todo-tree-pr-19-staging-200-1'
    ), {
        deletedArtifactId: 400,
        stagingName: 'better-todo-tree-pr-19-staging-200-1'
    } );
    assert.deepEqual( deleted, [ 400 ] );
} );

QUnit.test( 'rejects missing and duplicate staging artifacts', async function( assert )
{
    var module = await modulePromise;
    var api = {
        listRunArtifacts: async function() { return []; },
        deleteArtifact: async function() {}
    };

    await assert.rejects( module.deleteStagingArtifact( api, 200, 'stage' ), function( error )
    {
        return error.message === 'staging artifact stage: expected one current artifact, found 0';
    } );
    api.listRunArtifacts = async function()
    {
        return [ { id: 1, name: 'stage' }, { id: 2, name: 'stage' } ];
    };
    await assert.rejects( module.deleteStagingArtifact( api, 200, 'stage' ), function( error )
    {
        return error.message === 'staging artifact stage: expected one current artifact, found 2';
    } );
} );
