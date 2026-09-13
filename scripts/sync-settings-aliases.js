'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var compatibility = require( '../src/settingsCompatibility.js' );

function synchronize( manifest )
{
    var schemas = compatibility.getSchemas( manifest );
    var prefix = compatibility.SOURCE_NAMESPACE + '.';
    var properties = {};
    schemas.forEach( function( schema, setting )
    {
        compatibility.getSources( setting ).forEach( function( source )
        {
            var alias = JSON.parse( JSON.stringify( schema ) );
            if( source === 'tree.showTagsFromOpenFilesOnly' )
            {
                alias = { type: 'boolean', default: false,
                    markdownDescription: 'Select open-file scanning when enabled; workspace scanning otherwise.' };
            }
            properties[ prefix + source ] = alias;
        } );
    } );
    properties[ prefix + 'tree.showInExplorer' ] = {
        type: 'boolean', default: false,
        markdownDescription: 'Retained Todo Tree view preference. VS Code manages the view location through Move View.'
    };
    [ 'ripgrep.ripgrepMaxBuffer', 'ripgrepMaxBuffer' ].forEach( function( setting )
    {
        properties[ prefix + setting ] = { type: 'integer', default: 200,
            markdownDescription: 'Retained Todo Tree output buffer limit in MB. Better Todo Tree streams search output without an aggregate buffer.' };
    } );
    manifest.contributes.configuration = manifest.contributes.configuration.map( function( group )
    {
        return Object.assign( {}, group, { properties: Object.fromEntries(
            Object.entries( group.properties ).filter( function( entry ) { return !entry[ 0 ].startsWith( prefix ); } ) ) } );
    } ).filter( function( group ) { return Object.keys( group.properties ).length > 0; } );
    manifest.contributes.configuration.push( { title: 'Todo Tree settings', properties: properties } );
    return manifest;
}

if( require.main === module )
{
    var filename = path.resolve( __dirname, '../package.json' );
    var original = fs.readFileSync( filename, 'utf8' );
    var result = JSON.stringify( synchronize( JSON.parse( original ) ), null, 4 ) + '\n';
    if( process.argv.includes( '--check' ) )
    {
        if( result !== original ) { throw new Error( 'settings aliases differ: run npm run settings:sync' ); }
    }
    else if( result !== original ) { fs.writeFileSync( filename, result ); }
}

module.exports = { synchronize };
