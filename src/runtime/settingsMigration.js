'use strict';

var isDeepStrictEqual = require( 'util' ).isDeepStrictEqual;
var compatibility = require( '../settingsCompatibility.js' );
var SOURCE_NAMESPACE = compatibility.SOURCE_NAMESPACE;
var DESTINATION_NAMESPACE = compatibility.CURRENT_NAMESPACE;

class SettingsMigrationError extends Error
{
    constructor( code, operation, cause )
    {
        super( 'settings import failed for ' + operation.sourceNamespace + '.' + operation.source +
            ' at ' + operation.field + ( operation.overrideKey ? ' ' + operation.overrideKey : '' ) +
            ( operation.uri ? ' (' + operation.uri.toString() + ')' : '' ) );
        this.name = 'SettingsMigrationError';
        this.code = code;
        this.operation = operation;
        this.cause = cause;
    }
}

function configuration( vscode, namespace, operation )
{
    return vscode.workspace.getConfiguration( namespace, operation.uri );
}

function readValue( vscode, namespace, setting, operation )
{
    if( operation.overrideKey )
    {
        var override = configuration( vscode, undefined, operation ).inspect( operation.overrideKey );
        var values = override && override[ operation.field ];
        return values ? values[ namespace + '.' + setting ] : undefined;
    }
    var inspection = configuration( vscode, namespace, operation ).inspect( setting );
    return inspection ? inspection[ operation.field ] : undefined;
}

function writeValue( vscode, namespace, setting, value, operation )
{
    if( operation.overrideKey )
    {
        var root = configuration( vscode, undefined, operation );
        var inspection = root.inspect( operation.overrideKey );
        var values = Object.assign( Object.create( null ), inspection && inspection[ operation.field ] );
        var key = namespace + '.' + setting;
        values[ key ] = value;
        return root.update( operation.overrideKey, values, operation.target );
    }
    return configuration( vscode, namespace, operation ).update( setting, value, operation.target );
}

async function writeAndObserve( vscode, namespace, setting, value, operation )
{
    var resolveObserved;
    var observed = new Promise( function( resolve ) { resolveObserved = resolve; } );
    function observe()
    {
        if( isDeepStrictEqual( readValue( vscode, namespace, setting, operation ), value ) )
        {
            resolveObserved();
        }
    }
    var subscription = vscode.workspace.onDidChangeConfiguration( observe );
    var deadline;
    try
    {
        await writeValue( vscode, namespace, setting, value, operation );
        observe();
        await Promise.race( [ observed, new Promise( function( resolve, reject )
        {
            deadline = setTimeout( function()
            {
                reject( new SettingsMigrationError( 'DESTINATION_VERIFICATION_FAILED', operation ) );
            }, 10000 );
        } ) ] );
    }
    finally
    {
        clearTimeout( deadline );
        subscription.dispose();
    }
}

function collect( vscode, packageJson )
{
    var schemas = compatibility.getSchemas( packageJson );
    var scopes = [ { target: vscode.ConfigurationTarget.Global, field: 'globalValue' } ];
    var folders = vscode.workspace.workspaceFolders || [];
    if( vscode.workspace.workspaceFile || folders.length > 0 )
    {
        scopes.push( { target: vscode.ConfigurationTarget.Workspace, field: 'workspaceValue' } );
    }
    ( vscode.workspace.workspaceFile ? folders : [] ).forEach( function( folder )
    {
        scopes.push( { target: vscode.ConfigurationTarget.WorkspaceFolder,
            field: 'workspaceFolderValue', uri: folder.uri } );
    } );
    var operations = [];
    scopes.forEach( function( scope )
    {
        var rootConfiguration = configuration( vscode, undefined, scope );
        var overrideKeys = Object.keys( rootConfiguration ).filter( function( key )
        {
            return key.startsWith( '[' ) && key.endsWith( ']' );
        } );
        [ undefined ].concat( overrideKeys ).forEach( function( overrideKey )
        {
            schemas.forEach( function( schema, destination )
            {
                var operation = Object.assign( { sourceNamespace: SOURCE_NAMESPACE,
                    destination: destination, overrideKey: overrideKey }, scope );
                if( readValue( vscode, DESTINATION_NAMESPACE, destination, operation ) !== undefined ) { return; }
                var source = compatibility.getSources( destination ).find( function( name )
                {
                    return compatibility.accepts( name, destination,
                        readValue( vscode, SOURCE_NAMESPACE, name, operation ), schema );
                } );
                if( source !== undefined )
                {
                    operations.push( Object.assign( { source: source,
                        value: readValue( vscode, SOURCE_NAMESPACE, source, operation ) }, operation ) );
                }
            } );
        } );
    } );
    return operations;
}

async function apply( vscode, operations, isCancelled )
{
    var writes = 0;
    for( var operation of operations )
    {
        if( isCancelled && isCancelled() )
        {
            throw new SettingsMigrationError( 'MIGRATION_CANCELLED', operation );
        }
        var source = readValue( vscode, operation.sourceNamespace, operation.source, operation );
        if( !isDeepStrictEqual( source, operation.value ) )
        {
            throw new SettingsMigrationError( 'SOURCE_CHANGED', operation );
        }
        var destination = readValue( vscode, DESTINATION_NAMESPACE, operation.destination, operation );
        if( destination !== undefined ) { continue; }
        var value = compatibility.convert( operation.source, source );
        try
        {
            await writeAndObserve( vscode, DESTINATION_NAMESPACE, operation.destination, value, operation );
        }
        catch( error )
        {
            if( error instanceof SettingsMigrationError ) { throw error; }
            throw new SettingsMigrationError( 'DESTINATION_WRITE_FAILED', operation, error );
        }
        writes++;
        if( !isDeepStrictEqual( readValue( vscode, DESTINATION_NAMESPACE, operation.destination, operation ), value ) )
        {
            throw new SettingsMigrationError( 'DESTINATION_VERIFICATION_FAILED', operation );
        }
        if( !isDeepStrictEqual( readValue( vscode, SOURCE_NAMESPACE, operation.source, operation ), source ) )
        {
            throw new SettingsMigrationError( 'SOURCE_CHANGED', operation );
        }
    }
    return writes;
}

module.exports.collect = collect;
module.exports.apply = apply;
module.exports.SettingsMigrationError = SettingsMigrationError;
