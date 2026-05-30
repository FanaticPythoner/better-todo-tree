#!/usr/bin/env node

/* jshint esversion:6, node: true */

'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var harness = require( './regexRegistryEquivalenceHarness.js' );

var repoRoot = path.resolve( __dirname, '..', '..' );
var defaultJsonPath = path.join( repoRoot, 'artifacts', 'accuracy', 'regex-registry-equivalence.json' );
var defaultMarkdownPath = path.join( repoRoot, 'artifacts', 'accuracy', 'regex-registry-equivalence.md' );

function parseArgs( args )
{
    var options = {
        baselineRef: 'auto',
        jsonPath: defaultJsonPath,
        markdownPath: defaultMarkdownPath
    };
    var index = 0;

    while( index < args.length )
    {
        var arg = args[ index ];

        if( arg === '--baseline-ref' )
        {
            options.baselineRef = args[ index + 1 ];
            index += 2;
            continue;
        }

        if( arg === '--json-out' )
        {
            options.jsonPath = path.resolve( repoRoot, args[ index + 1 ] );
            index += 2;
            continue;
        }

        if( arg === '--markdown-out' )
        {
            options.markdownPath = path.resolve( repoRoot, args[ index + 1 ] );
            index += 2;
            continue;
        }

        throw new Error( 'unknown argument: ' + arg );
    }

    return options;
}

function ensureDirectory( filePath )
{
    fs.mkdirSync( path.dirname( filePath ), { recursive: true } );
}

function escapeMarkdownCode( value )
{
    var escaped = '';
    var index;

    for( index = 0; index < value.length; index++ )
    {
        escaped += value[ index ] === '`' ? '\\`' : value[ index ];
    }

    return escaped;
}

function renderMarkdown( payload )
{
    var metrics = payload.metrics;
    var lines = [
        '# Regex Registry Equivalence',
        '',
        '| Field | Value |',
        '| --- | ---: |',
        '| Baseline regex entries | ' + metrics.baselineRegexEntries + ' |',
        '| Baseline unique regexes | ' + metrics.baselineUniqueRegexes + ' |',
        '| Current hardcoded regex entries | ' + metrics.currentHardcodedRegexEntries + ' |',
        '| Registry fragments | ' + metrics.registryFragments + ' |',
        '| Registry patterns | ' + metrics.registryPatterns + ' |',
        '| Source coverage | ' + metrics.sourceCoverageCovered + '/' + metrics.sourceCoverageTotal + ' |',
        '| Behavior parity | ' + metrics.behaviorParityPassed + '/' + metrics.behaviorParityTotal + ' |',
        '| Compiled baseline regexes | ' + metrics.compiledBaselineRegexes + '/' + metrics.baselineUniqueRegexes + ' |',
        '| Elapsed ms | ' + metrics.elapsedMs + ' |',
        '',
        '## Behavior Matrix',
        '',
        '| Group | Passed | Total |',
        '| --- | ---: | ---: |'
    ];

    payload.behaviorParity.groups.forEach( function( group )
    {
        var passed = group.rows.filter( function( row )
        {
            return row.passed === true;
        } ).length;

        lines.push( '| ' + group.name + ' | ' + passed + ' | ' + group.rows.length + ' |' );
    } );

    lines.push( '' );
    lines.push( '## Source Gaps' );
    lines.push( '' );

    if( payload.sourceCoverage.missing.length === 0 )
    {
        lines.push( 'None.' );
    }
    else
    {
        lines.push( '| Source | Flags | Baseline refs |' );
        lines.push( '| --- | --- | --- |' );
        payload.sourceCoverage.missing.forEach( function( row )
        {
            lines.push(
                '| `' + escapeMarkdownCode( row.source ) + '` | `' + row.flags + '` | ' +
                row.baselineRefs.join( ', ' ) + ' |'
            );
        } );
    }

    lines.push( '' );
    return lines.join( '\n' );
}

function main()
{
    var options = parseArgs( process.argv.slice( 2 ) );
    var payload = harness.runEquivalenceAudit( {
        baselineRef: options.baselineRef
    } );

    ensureDirectory( options.jsonPath );
    ensureDirectory( options.markdownPath );

    fs.writeFileSync( options.jsonPath, JSON.stringify( payload, null, 2 ) + '\n' );
    fs.writeFileSync( options.markdownPath, renderMarkdown( payload ) );
    process.stdout.write( JSON.stringify( payload.metrics, null, 2 ) + '\n' );
}

if( require.main === module )
{
    try
    {
        main();
    }
    catch( error )
    {
        process.stderr.write( error.stack + '\n' );
        process.exitCode = 1;
    }
}
