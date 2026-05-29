#!/usr/bin/env node

var fs = require( 'fs' );
var path = require( 'path' );
var cp = require( "child_process" );

var codiconMappingUrl = "https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/template/mapping.json";
var outputPath = path.join( __dirname, "src/codiconNames.js" );
var raw = cp.execFileSync( "curl", [ "-fsSL", codiconMappingUrl ], { encoding: "utf8" } );
var mappings = JSON.parse( raw );

if( !mappings || Array.isArray( mappings ) || typeof mappings !== "object" )
{
    throw new Error( "codicon mapping: object required" );
}

var names = [];

Object.keys( mappings ).forEach( function( codepoint )
{
    var aliases = mappings[ codepoint ];

    if( Array.isArray( aliases ) !== true )
    {
        throw new Error( "codicon mapping " + codepoint + ": alias array required" );
    }

    aliases.forEach( function( alias )
    {
        if( typeof alias !== "string" || alias.length === 0 )
        {
            throw new Error( "codicon mapping " + codepoint + ": non-empty alias required" );
        }

        names.push( alias );
    } );
} );

names = Array.from( new Set( names ) ).sort();

var output = "module.exports = " + JSON.stringify( names, null, 2 ) + ";\n";

if( fs.existsSync( outputPath ) && fs.readFileSync( outputPath, "utf8" ) === output )
{
    process.exit( 0 );
}

fs.writeFileSync( outputPath, output );
