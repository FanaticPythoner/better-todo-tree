#!/usr/bin/env node

'use strict';

var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var performance = require( 'perf_hooks' ).performance;

var detection = require( '../../src/detection.js' );
var embeddedDescriptors = require( '../../src/embeddedDocumentDescriptors.json' );
var commentPatternCatalog = require( '../../src/commentPatternCatalog.js' );
var regexRegistry = require( '../../src/regexRegistry.js' );
var utils = require( '../../src/utils.js' );

var FILE_COUNT = 250;
var ITERATIONS = 41;
var TAGS = Object.freeze( [ 'TODO', 'FIXME', '[ ]', '[x]' ] );
var repoRoot = path.resolve( __dirname, '..', '..' );
var artifactRoot = path.join( repoRoot, 'artifacts', 'perf' );
var defaultJsonPath = path.join( artifactRoot, 'issue19-embedded-documents.json' );
var defaultReportPath = path.join( artifactRoot, 'issue19-embedded-documents.md' );
var catalog = commentPatternCatalog.createCommentPatternCatalog();
var baselineExtension = catalog.resolvePatternFileName( embeddedDescriptors[ 0 ].baseLanguage );
var TARGETS = Object.freeze( [
    {
        name: 'Vue SFC descriptor scan',
        extension: '.vue',
        regionsPerFile: 3,
        expectedMatchesPerFile: 4,
        lines: function( index )
        {
            return [
                '<script setup>',
                'const item' + index + ' = ' + index + ';',
                '// TODO script line ' + index,
                '/*',
                'TODO script block ' + index,
                '*/',
                '</script>',
                '<style lang="scss">',
                '// FIXME style line ' + index,
                '</style>',
                '<template>',
                '<!-- TODO template markup ' + index + ' -->',
                '</template>'
            ];
        }
    },
    {
        name: 'Svelte descriptor scan',
        extension: '.svelte',
        regionsPerFile: 3,
        expectedMatchesPerFile: 4,
        lines: function( index )
        {
            return [
                '<script module>',
                '// TODO module script ' + index,
                '</script>',
                '<script lang="ts">',
                '// FIXME instance script ' + index,
                '</script>',
                '<style lang="scss">',
                '// TODO style line ' + index,
                '</style>',
                '<!-- TODO markup ' + index + ' -->'
            ];
        }
    },
    {
        name: 'Astro descriptor scan',
        extension: '.astro',
        regionsPerFile: 4,
        expectedMatchesPerFile: 5,
        lines: function( index )
        {
            return [
                '---',
                '// TODO frontmatter ' + index,
                '---',
                '<script>',
                '// FIXME browser script ' + index,
                '</script>',
                '<style>',
                '/* TODO style block ' + index + ' */',
                '</style>',
                '{/* TODO expression ' + index + ' */}',
                '<!-- TODO markup ' + index + ' -->'
            ];
        }
    }
] );

function parseArgs( args )
{
    var options = {
        jsonPath: defaultJsonPath,
        reportPath: defaultReportPath
    };
    var index = 0;

    while( index < args.length )
    {
        var arg = args[ index ];

        if( arg === '--json-out' )
        {
            options.jsonPath = path.resolve( repoRoot, args[ index + 1 ] );
            index += 2;
            continue;
        }

        if( arg === '--report-out' )
        {
            options.reportPath = path.resolve( repoRoot, args[ index + 1 ] );
            index += 2;
            continue;
        }

        throw new Error( 'unknown argument: ' + arg );
    }

    return options;
}

function createConfig()
{
    return {
        tags: function() { return TAGS.slice(); },
        regex: function()
        {
            return {
                tags: TAGS.slice(),
                regex: utils.DEFAULT_REGEX_SOURCE,
                caseSensitive: true,
                multiLine: false
            };
        },
        subTagRegex: function()
        {
            return regexRegistry.pattern( 'subTagPrefixCapture' );
        }
    };
}

function createUri( fsPath )
{
    return {
        scheme: 'file',
        fsPath: fsPath,
        path: fsPath,
        toString: function()
        {
            return fsPath;
        }
    };
}

function createFixtureText( target, index )
{
    return target.lines( index ).join( '\n' );
}

function createCorpus( target )
{
    var files = [];
    var index;

    for( index = 0; index < FILE_COUNT; index++ )
    {
        files.push( {
            currentUri: createUri( '/tmp/embedded-language-support/current-' + index + target.extension ),
            baselineUri: createUri( '/tmp/embedded-language-support/baseline-' + index + baselineExtension ),
            text: createFixtureText( target, index )
        } );
    }

    return files;
}

function scanCorpus( corpus, key )
{
    var count = 0;

    corpus.forEach( function( entry )
    {
        count += detection.scanText( entry[ key ], entry.text ).length;
    } );

    return count;
}

function percentile( values, fraction )
{
    var index = Math.max( 0, Math.min( values.length - 1, Math.ceil( values.length * fraction ) - 1 ) );
    return values[ index ];
}

function round( value )
{
    return Number( value.toFixed( 3 ) );
}

function bytesToMiB( value )
{
    return value / 1024 / 1024;
}

function summarizeSeries( values, transform )
{
    var sorted = values.slice().sort( function( a, b ) { return a - b; } );
    var mapValue = typeof ( transform ) === 'function' ? transform : function( value ) { return value; };

    return {
        min: round( mapValue( sorted[ 0 ] ) ),
        p50: round( mapValue( percentile( sorted, 0.5 ) ) ),
        p95: round( mapValue( percentile( sorted, 0.95 ) ) ),
        max: round( mapValue( sorted[ sorted.length - 1 ] ) )
    };
}

function measureStrategy( name, corpus, key, expectedMatches )
{
    var latencies = [];
    var rssSamples = [];
    var matches = 0;
    var iteration;

    for( iteration = 0; iteration < ITERATIONS; iteration++ )
    {
        if( global.gc )
        {
            global.gc();
        }

        var start = performance.now();
        matches = scanCorpus( corpus, key );
        latencies.push( performance.now() - start );
        rssSamples.push( process.memoryUsage().rss );

        if( matches !== expectedMatches )
        {
            throw new Error( name + ': expected ' + expectedMatches + ' matches, got ' + matches + '.' );
        }
    }

    var latency = summarizeSeries( latencies );
    var rss = summarizeSeries( rssSamples, bytesToMiB );

    return {
        name: name,
        matches: matches,
        latencyMs: latency,
        throughputMatchesPerSecondP50: round( matches / ( latency.p50 / 1000 ) ),
        peakRssMiB: rss.max,
        rssMiB: rss
    };
}

function measureTarget( target )
{
    var corpus = createCorpus( target );

    return [
        measureStrategy(
            target.name + ' baseline markup',
            corpus,
            'baselineUri',
            FILE_COUNT
        ),
        measureStrategy(
            target.name,
            corpus,
            'currentUri',
            FILE_COUNT * target.expectedMatchesPerFile
        )
    ];
}

function ensureDirectory( filePath )
{
    fs.mkdirSync( path.dirname( filePath ), { recursive: true } );
}

function renderReport( payload )
{
    return [
        '# Issue 19 Embedded Documents Benchmark',
        '',
        '## Corpus',
        '',
        '| Field | Value |',
        '| --- | ---: |',
        '| Files | ' + payload.corpus.files + ' |',
        '| Iterations | ' + payload.corpus.iterations + ' |',
        '| Targets | ' + payload.corpus.targets.length + ' |',
        '| Baseline extension | `' + payload.corpus.baselineExtension + '` |',
        '',
        '## Results',
        '',
        '| Strategy | Matches | p50 ms | p95 ms | Throughput matches/s | Peak RSS MiB |',
        '| --- | ---: | ---: | ---: | ---: | ---: |'
    ].concat( payload.measurements.map( function( measurement )
    {
        return '| ' + measurement.name + ' | ' +
            measurement.matches + ' | ' +
            measurement.latencyMs.p50 + ' | ' +
            measurement.latencyMs.p95 + ' | ' +
            measurement.throughputMatchesPerSecondP50 + ' | ' +
            measurement.peakRssMiB + ' |';
    } ) ).concat( [
        '',
        '## Command',
        '',
        '```bash',
        'node --expose-gc scripts/perf/issue19-embedded-documents.js',
        '```',
        ''
    ] ).join( '\n' );
}

function main()
{
    var options = parseArgs( process.argv.slice( 2 ) );
    var measurements = [];
    var payload;

    utils.init( createConfig() );

    TARGETS.forEach( function( target )
    {
        measurements = measurements.concat( measureTarget( target ) );
    } );

    payload = {
        corpus: {
            files: FILE_COUNT,
            iterations: ITERATIONS,
            targets: TARGETS.map( function( target )
            {
                return {
                    name: target.name,
                    extension: target.extension,
                    regionsPerFile: target.regionsPerFile,
                    expectedMatches: FILE_COUNT * target.expectedMatchesPerFile
                };
            } ),
            baselineExtension: baselineExtension
        },
        measurements: measurements,
        system: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpus: os.cpus().length
        }
    };

    ensureDirectory( options.jsonPath );
    ensureDirectory( options.reportPath );
    fs.writeFileSync( options.jsonPath, JSON.stringify( payload, null, 2 ) + '\n' );
    fs.writeFileSync( options.reportPath, renderReport( payload ), 'utf8' );
    process.stdout.write( JSON.stringify( payload, null, 2 ) + '\n' );
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
