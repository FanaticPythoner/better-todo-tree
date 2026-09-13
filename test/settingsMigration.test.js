var migration = require( '../src/runtime/settingsMigration.js' );
var packageJson = require( '../package.json' );

function createEnvironment()
{
    var values = new Map();
    var writes = [];
    var listeners = new Set();
    var environment = {
        values: values,
        writes: writes,
        listeners: listeners,
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        workspace: {
            onDidChangeConfiguration: function( listener )
            {
                listeners.add( listener );
                return { dispose: function() { listeners.delete( listener ); } };
            },
            workspaceFile: 'file:/workspace/customer.code-workspace',
            workspaceFolders: [ { uri: 'file:/first' }, { uri: 'file:/second' } ],
            getConfiguration: function( namespace, scope )
            {
                var uri = typeof scope === 'object' ? scope.uri : scope;
                var languageId = typeof scope === 'object' ? scope.languageId : undefined;
                var result = {
                    inspect: function( setting )
                    {
                        var result = { languageIds: [ 'python', 'javascript' ] };
                        [ 'globalValue', 'workspaceValue', 'workspaceFolderValue' ].forEach( function( field )
                        {
                            var location = field === 'workspaceFolderValue' ? uri : '';
                            result[ field ] = values.get( [ namespace, setting, field, location, '' ].join( '|' ) );
                            result[ field.replace( 'Value', 'LanguageValue' ) ] = values.get(
                                [ namespace, setting, field, location, languageId ].join( '|' ) );
                        } );
                        return result;
                    },
                    update: async function( setting, value, target, override )
                    {
                        var field = [ '', 'globalValue', 'workspaceValue', 'workspaceFolderValue' ][ target ];
                        var key = [ namespace, setting, field, target === 3 ? uri : '', override ? languageId : '' ].join( '|' );
                        if( environment.beforeWrite )
                        {
                            await environment.beforeWrite( { namespace: namespace, setting: setting, value: value, key: key } );
                        }
                        function commit()
                        {
                            if( value === undefined )
                            {
                                values.delete( key );
                            }
                            else
                            {
                                values.set( key, value );
                            }
                            writes.push( { key: key, value: value } );
                            listeners.forEach( function( listener ) { listener(); } );
                        }
                        if( environment.deferPropagation ) { setTimeout( commit, 5 ); }
                        else { commit(); }
                    }
                };
                if( namespace === undefined )
                {
                    values.forEach( function( value, key )
                    {
                        var parts = key.split( '|' );
                        if( parts[ 0 ] === '' && parts[ 1 ].startsWith( '[' ) )
                        {
                            result[ parts[ 1 ] ] = value;
                        }
                    } );
                }
                return result;
            }
        }
    };
    environment.set = function( namespace, setting, field, value, uri, languageId )
    {
        if( languageId )
        {
            var overrideKey = [ '', '[' + languageId + ']', field, uri || '', '' ].join( '|' );
            var valuesAtScope = values.get( overrideKey ) || {};
            valuesAtScope[ namespace + '.' + setting ] = value;
            values.set( overrideKey, valuesAtScope );
            return;
        }
        values.set( [ namespace, setting, field, uri || '', languageId || '' ].join( '|' ), value );
    };
    return environment;
}

QUnit.module( 'settings migration' );

var compatibility = require( '../src/settingsCompatibility.js' );
compatibility.getSchemas( packageJson ).forEach( function( schema, setting )
{
    compatibility.getSources( setting ).forEach( function( source )
    {
        QUnit.test( 'import explicit Todo Tree setting: ' + source, async function( assert )
        {
            var environment = createEnvironment();
            var value = source === 'tree.showTagsFromOpenFilesOnly' ? true : schema.default;
            var expected = source === 'tree.showTagsFromOpenFilesOnly' ? 'open files' : value;
            environment.set( 'todo-tree', source, 'workspaceValue', value );
            var operations = migration.collect( environment, packageJson );
            assert.equal( await migration.apply( environment, operations ), 1 );
            assert.deepEqual( environment.values.get( 'better-todo-tree|' + setting + '|workspaceValue||' ), expected );
            assert.deepEqual( environment.values.get( 'todo-tree|' + source + '|workspaceValue||' ), value );
            assert.equal( migration.collect( environment, packageJson ).length, 0 );
        } );
    } );
} );

QUnit.test( 'import all scopes, language overrides, empty values and flat keys without source changes', async function( assert )
{
    var environment = createEnvironment();
    environment.set( 'todo-tree', 'general.tags', 'globalValue', [ 'GLOBAL' ] );
    environment.set( 'todo-tree', 'general.tags', 'workspaceValue', [] );
    environment.set( 'todo-tree', 'general.tags', 'workspaceFolderValue', [ 'FIRST' ], 'file:/first' );
    environment.set( 'todo-tree', 'general.tags', 'workspaceFolderValue', [ 'SECOND' ], 'file:/second' );
    environment.set( 'todo-tree', 'highlights.useColourScheme', 'globalValue', false );
    environment.set( 'todo-tree', 'highlightDelay', 'globalValue', 0 );
    environment.set( 'todo-tree', 'regex.regex', 'workspaceFolderValue', 'PYTHON', 'file:/second', 'python' );
    var operations = migration.collect( environment, packageJson );
    assert.equal( operations.length, 7 );
    assert.equal( await migration.apply( environment, operations ), 7 );
    assert.equal( migration.collect( environment, packageJson ).length, 0 );
    assert.deepEqual( environment.values.get( 'better-todo-tree|general.tags|workspaceValue||' ), [] );
    assert.strictEqual( environment.values.get( 'better-todo-tree|highlights.useColourScheme|globalValue||' ), false );
    assert.strictEqual( environment.values.get( 'better-todo-tree|highlights.highlightDelay|globalValue||' ), 0 );
    assert.equal( environment.values.get( '|[python]|workspaceFolderValue|file:/second|' )[ 'better-todo-tree.regex.regex' ], 'PYTHON' );
} );

QUnit.test( 'explicit destination wins and grouped source wins over flat source', async function( assert )
{
    var environment = createEnvironment();
    environment.set( 'better-todo-tree', 'general.tags', 'globalValue', [ 'CURRENT' ] );
    environment.set( 'todo-tree', 'general.tags', 'globalValue', [ 'SOURCE' ] );
    environment.set( 'todo-tree', 'general.tags', 'workspaceValue', [ 'GROUPED' ] );
    environment.set( 'todo-tree', 'tags', 'workspaceValue', [ 'FLAT' ] );
    environment.set( 'todo-tree', 'regex', 'globalValue', { regex: 'nested property' } );
    await migration.apply( environment, migration.collect( environment, packageJson ) );
    assert.deepEqual( environment.values.get( 'better-todo-tree|general.tags|globalValue||' ), [ 'CURRENT' ] );
    assert.deepEqual( environment.values.get( 'better-todo-tree|general.tags|workspaceValue||' ), [ 'GROUPED' ] );
    assert.deepEqual( environment.values.get( 'todo-tree|regex|globalValue||' ), { regex: 'nested property' } );
} );

QUnit.test( 'failed destination write retains source and permits retry', async function( assert )
{
    var environment = createEnvironment();
    environment.set( 'todo-tree', 'general.tags', 'workspaceValue', [ 'SOURCE' ] );
    environment.beforeWrite = function() { throw new Error( 'denied' ); };
    await assert.rejects( migration.apply( environment, migration.collect( environment, packageJson ) ),
        function( error ) { return error.code === 'DESTINATION_WRITE_FAILED' && error.cause.message === 'denied'; } );
    assert.equal( environment.writes.length, 0 );
    environment.beforeWrite = undefined;
    assert.equal( await migration.apply( environment, migration.collect( environment, packageJson ) ), 1 );
} );

QUnit.test( 'import never writes or removes source keys', async function( assert )
{
    var environment = createEnvironment();
    environment.set( 'todo-tree', 'general.tags', 'globalValue', [ 'SOURCE' ] );
    environment.beforeWrite = function( operation )
    {
        assert.notEqual( operation.namespace, 'todo-tree' );
    };
    assert.equal( await migration.apply( environment, migration.collect( environment, packageJson ) ), 1 );
    assert.deepEqual( environment.values.get( 'todo-tree|general.tags|globalValue||' ), [ 'SOURCE' ] );
    assert.equal( await migration.apply( environment, migration.collect( environment, packageJson ) ), 0 );
} );

QUnit.test( 'concurrent source edits and cancellation preserve unconsumed configuration', async function( assert )
{
    var environment = createEnvironment();
    environment.set( 'todo-tree', 'general.tags', 'globalValue', [ 'FIRST' ] );
    var operations = migration.collect( environment, packageJson );
    environment.set( 'todo-tree', 'general.tags', 'globalValue', [ 'SECOND' ] );
    await assert.rejects( migration.apply( environment, operations ),
        function( error ) { return error.code === 'SOURCE_CHANGED'; } );
    await assert.rejects( migration.apply( environment, migration.collect( environment, packageJson ), function() { return true; } ),
        function( error ) { return error.code === 'MIGRATION_CANCELLED'; } );
    assert.equal( environment.writes.length, 0 );
} );

QUnit.test( 'a workspace added after another migration receives its own settings', async function( assert )
{
    var environment = createEnvironment();
    environment.set( 'todo-tree', 'general.tags', 'workspaceFolderValue', [ 'FIRST' ], 'file:/first' );
    await migration.apply( environment, migration.collect( environment, packageJson ) );
    environment.workspace.workspaceFolders.push( { uri: 'file:/third' } );
    environment.set( 'todo-tree', 'general.tags', 'workspaceFolderValue', [ 'THIRD' ], 'file:/third' );
    assert.equal( await migration.apply( environment, migration.collect( environment, packageJson ) ), 1 );
    assert.deepEqual( environment.values.get( 'better-todo-tree|general.tags|workspaceFolderValue|file:/third|' ), [ 'THIRD' ] );
} );

QUnit.test( 'single-folder workspace uses the shared settings file once', async function( assert )
{
    var environment = createEnvironment();
    environment.workspace.workspaceFile = undefined;
    environment.workspace.workspaceFolders.length = 1;
    environment.set( 'todo-tree', 'highlights.useColourScheme', 'workspaceValue', false );
    environment.set( 'todo-tree', 'highlights.useColourScheme', 'workspaceFolderValue', false, 'file:/first' );
    var operations = migration.collect( environment, packageJson );
    assert.equal( operations.length, 1 );
    assert.equal( operations[ 0 ].field, 'workspaceValue' );
    assert.equal( await migration.apply( environment, operations ), 1 );
} );

QUnit.test( 'retained and unknown settings remain untouched', async function( assert )
{
    var environment = createEnvironment();
    environment.set( 'todo-tree', 'tree.showInExplorer', 'workspaceValue', true );
    environment.set( 'todo-tree', 'ripgrep.ripgrepMaxBuffer', 'workspaceValue', 600 );
    environment.set( 'todo-tree', 'customerExtensionSetting', 'globalValue', { x: 1 } );
    var before = Array.from( environment.values.entries() );
    assert.equal( await migration.apply( environment, migration.collect( environment, packageJson ) ), 0 );
    assert.deepEqual( Array.from( environment.values.entries() ), before );
} );

QUnit.test( 'combined language blocks preserve their identity and unrelated settings', async function( assert )
{
    var environment = createEnvironment();
    var key = '|[python][javascript]|workspaceValue||';
    environment.values.set( key, { 'todo-tree.regex.regex': '(SOURCE)', 'editor.tabSize': 3 } );
    var operations = migration.collect( environment, packageJson );
    assert.equal( operations.length, 1 );
    assert.equal( operations[ 0 ].overrideKey, '[python][javascript]' );
    assert.equal( await migration.apply( environment, operations ), 1 );
    assert.deepEqual( environment.values.get( key ), {
        'todo-tree.regex.regex': '(SOURCE)', 'better-todo-tree.regex.regex': '(SOURCE)', 'editor.tabSize': 3
    } );
    assert.equal( migration.collect( environment, packageJson ).length, 0 );
} );

QUnit.test( 'import waits for configuration propagation and disposes its observer', async function( assert )
{
    var environment = createEnvironment();
    environment.deferPropagation = true;
    environment.set( 'todo-tree', 'filtering.includeGlobs', 'workspaceValue', [] );
    assert.equal( await migration.apply( environment, migration.collect( environment, packageJson ) ), 1 );
    assert.equal( migration.collect( environment, packageJson ).length, 0 );
    assert.deepEqual( environment.values.get( 'better-todo-tree|filtering.includeGlobs|workspaceValue||' ), [] );
    assert.equal( environment.listeners.size, 0 );
} );
