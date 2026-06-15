var fs = require( 'fs' );
var path = require( 'path' );
var performance = require( 'perf_hooks' ).performance;

var utils = require( '../../src/utils.js' );
var detection = require( '../../src/detection.js' );
var matrixHelpers = require( '../../test/matrixHelpers.js' );

var outputDirectory = path.join( 'TODOS_LISTS', 'language-configuration' );
var patternCount = 128;
var lookupQueries = 4096;
var scanCount = 16;
var iterations = 61;
var customPatterns = Array.from( { length: patternCount }, function( item, index )
{
    return {
        id: 'benchlang' + index,
        name: 'Bench Language ' + index,
        aliases: [ 'Bench Language Alias ' + index ],
        languageIds: [ 'bench-language-' + index ],
        extensions: [ '.bench' + index ],
        filenameGlobs: [ '**/*.benchglob' + index ],
        singleLineComments: [ '@@' + index ],
        multiLineComments: [ { start: '<#' + index, middle: '#', end: '#>' } ]
    };
} );
var embeddedDocuments = [ {
    id: 'bench-compound',
    parser: 'html-like-element-regions',
    match: { extensions: [ '.benchcmp' ] },
    baseLanguage: 'html',
    regions: customPatterns.slice( 0, 8 ).map( function( entry, index )
    {
        return {
            element: 'region',
            attributes: { kind: 'k' + index },
            defaultLanguage: entry.id,
            rawText: true
        };
    } )
} ];
var defaultConfig = matrixHelpers.createConfig();
var customConfig = matrixHelpers.createConfig( {
    customCommentPatterns: function()
    {
        return customPatterns;
    },
    customEmbeddedDocuments: function()
    {
        return embeddedDocuments;
    }
} );
var compoundUri = matrixHelpers.createUri( '/workspace/view.benchcmp' );
var compoundText = customPatterns.slice( 0, 8 ).map( function( entry, index )
{
    return '<region kind="k' + index + '">@@' + index + ' TODO region ' + index + '</region>';
} ).concat( [ '<!-- FIXME base markup -->' ] ).join( '\n' );
var vueUri = matrixHelpers.createUri( '/workspace/view.vue' );
var vueText = [
    '<template><!-- TODO template --></template>',
    '<script setup>// FIXME script</script>',
    '<style>/* TODO style */</style>'
].join( '\n' );

function percentile( sorted, ratio )
{
    return sorted[ Math.min( sorted.length - 1, Math.floor( ( sorted.length - 1 ) * ratio ) ) ];
}

function summarize( samples )
{
    var sorted = samples.slice().sort( function( left, right )
    {
        return left - right;
    } );

    return {
        min: Number( sorted[ 0 ].toFixed( 3 ) ),
        p50: Number( percentile( sorted, 0.50 ).toFixed( 3 ) ),
        p95: Number( percentile( sorted, 0.95 ).toFixed( 3 ) ),
        max: Number( sorted[ sorted.length - 1 ].toFixed( 3 ) )
    };
}

function measureLookups( config, resolver )
{
    utils.init( config );

    for( var warm = 0; warm < 5; warm++ )
    {
        resolver( warm );
    }

    return Array.from( { length: iterations }, function( item, iteration )
    {
        var started = performance.now();
        var hits = resolver( iteration );

        return {
            latencyMs: performance.now() - started,
            hits: hits
        };
    } );
}

function measureScans( config, uri, text )
{
    utils.init( config );

    for( var warm = 0; warm < 5; warm++ )
    {
        detection.scanText( uri, text );
    }

    return Array.from( { length: iterations }, function()
    {
        var started = performance.now();
        var hits = 0;
        var scan;

        for( scan = 0; scan < scanCount; scan++ )
        {
            hits += detection.scanText( uri, text ).length;
        }

        return {
            latencyMs: performance.now() - started,
            hits: hits
        };
    } );
}

function sumHits( samples )
{
    return samples.reduce( function( total, sample )
    {
        return total + sample.hits;
    }, 0 );
}

function latencySamples( samples )
{
    return samples.map( function( sample )
    {
        return sample.latencyMs;
    } );
}

function createPayload()
{
    var defaultLookupSamples = measureLookups( defaultConfig, function()
    {
        var hits = 0;
        var query;

        for( query = 0; query < lookupQueries; query++ )
        {
            if( utils.getCommentPattern( '/workspace/src/file' + query + '.js' ) )
            {
                hits++;
            }
        }

        return hits;
    } );
    var customLookupSamples = measureLookups( customConfig, function( iteration )
    {
        var hits = 0;
        var query;

        for( query = 0; query < lookupQueries; query++ )
        {
            var index = ( query + iteration ) % patternCount;

            if( utils.getCommentPattern( '/workspace/src/file' + index + '.bench' + index ) )
            {
                hits++;
            }

            if( utils.resolveCommentPatternFileName( 'Bench Language Alias ' + index ) )
            {
                hits++;
            }
        }

        return hits;
    } );
    var customDefaultLookupSamples = measureLookups( customConfig, function( iteration )
    {
        var hits = 0;
        var query;

        for( query = 0; query < lookupQueries; query++ )
        {
            if( utils.getCommentPattern( '/workspace/src/file' + ( ( query + iteration ) % 200 ) + '.js' ) )
            {
                hits++;
            }
        }

        return hits;
    } );
    var customGlobLookupSamples = measureLookups( customConfig, function( iteration )
    {
        var hits = 0;
        var query;

        for( query = 0; query < lookupQueries; query++ )
        {
            var index = ( query + iteration ) % patternCount;

            if( utils.getCommentPattern( '/workspace/src/file' + index + '.benchglob' + index ) )
            {
                hits++;
            }
        }

        return hits;
    } );
    var vueScanSamples = measureScans( defaultConfig, vueUri, vueText );
    var compoundScanSamples = measureScans( customConfig, compoundUri, compoundText );
    var defaultLookupLatency = summarize( latencySamples( defaultLookupSamples ) );
    var customLookupLatency = summarize( latencySamples( customLookupSamples ) );
    var customDefaultLookupLatency = summarize( latencySamples( customDefaultLookupSamples ) );
    var customGlobLookupLatency = summarize( latencySamples( customGlobLookupSamples ) );
    var vueScanLatency = summarize( latencySamples( vueScanSamples ) );
    var compoundScanLatency = summarize( latencySamples( compoundScanSamples ) );

    return {
        patternCount: patternCount,
        lookupQueries: lookupQueries,
        scanCount: scanCount,
        iterations: iterations,
        totalDefaultLookupQueries: iterations * lookupQueries,
        totalCustomLookupQueries: iterations * lookupQueries * 2,
        totalCustomDefaultLookupQueries: iterations * lookupQueries,
        totalCustomGlobLookupQueries: iterations * lookupQueries,
        totalScans: iterations * scanCount,
        latencyMs: {
            defaultLookup: defaultLookupLatency,
            customLookup: customLookupLatency,
            customDefaultLookup: customDefaultLookupLatency,
            customGlobLookup: customGlobLookupLatency,
            defaultVueScan: vueScanLatency,
            customCompoundScan: compoundScanLatency
        },
        throughput: {
            defaultLookupQueriesPerSecondP50: Number( ( lookupQueries / ( defaultLookupLatency.p50 / 1000 ) ).toFixed( 3 ) ),
            customLookupQueriesPerSecondP50: Number( ( ( lookupQueries * 2 ) / ( customLookupLatency.p50 / 1000 ) ).toFixed( 3 ) ),
            customDefaultLookupQueriesPerSecondP50: Number( ( lookupQueries / ( customDefaultLookupLatency.p50 / 1000 ) ).toFixed( 3 ) ),
            customGlobLookupQueriesPerSecondP50: Number( ( lookupQueries / ( customGlobLookupLatency.p50 / 1000 ) ).toFixed( 3 ) ),
            defaultVueScansPerSecondP50: Number( ( scanCount / ( vueScanLatency.p50 / 1000 ) ).toFixed( 3 ) ),
            customCompoundScansPerSecondP50: Number( ( scanCount / ( compoundScanLatency.p50 / 1000 ) ).toFixed( 3 ) )
        },
        hits: {
            defaultLookup: sumHits( defaultLookupSamples ),
            customLookup: sumHits( customLookupSamples ),
            customDefaultLookup: sumHits( customDefaultLookupSamples ),
            customGlobLookup: sumHits( customGlobLookupSamples ),
            defaultVueScan: sumHits( vueScanSamples ),
            customCompoundScan: sumHits( compoundScanSamples )
        },
        peakRssMb: Number( ( process.memoryUsage().rss / 1024 / 1024 ).toFixed( 3 ) ),
        node: process.version,
        platform: process.platform,
        arch: process.arch
    };
}

function writeMarkdownReport( payload )
{
    var rows = [
        [ 'Custom patterns', payload.patternCount ],
        [ 'Iterations', payload.iterations ],
        [ 'Default lookup p50 ms', payload.latencyMs.defaultLookup.p50 ],
        [ 'Default lookup p95 ms', payload.latencyMs.defaultLookup.p95 ],
        [ 'Custom lookup p50 ms', payload.latencyMs.customLookup.p50 ],
        [ 'Custom lookup p95 ms', payload.latencyMs.customLookup.p95 ],
        [ 'Custom settings default lookup p50 ms', payload.latencyMs.customDefaultLookup.p50 ],
        [ 'Custom settings default lookup p95 ms', payload.latencyMs.customDefaultLookup.p95 ],
        [ 'Custom glob lookup p50 ms', payload.latencyMs.customGlobLookup.p50 ],
        [ 'Custom glob lookup p95 ms', payload.latencyMs.customGlobLookup.p95 ],
        [ 'Default Vue scan p50 ms', payload.latencyMs.defaultVueScan.p50 ],
        [ 'Default Vue scan p95 ms', payload.latencyMs.defaultVueScan.p95 ],
        [ 'Custom compound scan p50 ms', payload.latencyMs.customCompoundScan.p50 ],
        [ 'Custom compound scan p95 ms', payload.latencyMs.customCompoundScan.p95 ],
        [ 'Peak RSS MB', payload.peakRssMb ]
    ];

    return [
        '# Custom Language Benchmark',
        '',
        '| Metric | Value |',
        '| --- | ---: |'
    ].concat( rows.map( function( row )
    {
        return '| ' + row[ 0 ] + ' | ' + row[ 1 ] + ' |';
    } ), [ '' ] ).join( '\n' );
}

fs.mkdirSync( outputDirectory, { recursive: true } );

var payload = createPayload();

fs.writeFileSync(
    path.join( outputDirectory, 'custom-language-benchmark.json' ),
    JSON.stringify( payload, null, 2 ) + '\n'
);
fs.writeFileSync(
    path.join( outputDirectory, 'custom-language-benchmark.md' ),
    writeMarkdownReport( payload )
);
console.log( JSON.stringify( payload, null, 2 ) );
