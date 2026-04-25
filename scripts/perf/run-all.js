#!/usr/bin/env node

/* eslint-env node */

'use strict';

var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var vm = require( 'vm' );
var Module = require( 'module' );
var childProcess = require( 'child_process' );
var extensionScenarios = require( './extensionScenarios.js' );
var readmeSummary = require( './readmeSummary.js' );

var repoRoot = path.resolve( __dirname, '..', '..' );
var artifactRoot = path.join( repoRoot, 'artifacts', 'perf' );
var DEFAULT_UPSTREAM_BASELINE_REF = 'a6f60e0ce830c4649ac34fc05e5a1799ec91d151';
var USER_FLOW_LATENCY_WARMUP_ITERATIONS = 3;
var MIN_BENCHMARK_AVAILABLE_MEMORY_BYTES = 8 * 1024 * 1024 * 1024;
var MIN_BENCHMARK_AVAILABLE_MEMORY_FRACTION = 0.15;
var MAX_BENCHMARK_LOAD_PER_LOGICAL_CPU = 1.5;
var REQUIRED_MEASUREMENT_FIELDS = Object.freeze( [
    'p50Ms',
    'p90Ms',
    'p95Ms',
    'peakRssP50MiB',
    'peakRssP90MiB',
    'peakRssP95MiB',
    'peakRssMiB',
    'rssBurstP50MiB',
    'rssBurstP90MiB',
    'rssBurstP95MiB',
    'rssBurstMaxMiB'
] );

// Per-scenario progress is enabled by default so that long benchmarks
// (10-minute tree-view-cycle on 120-file fixtures, etc.) cannot be
// confused with hangs; opt out via PERF_TRACE_SCENARIOS=0.
var perfTraceEnabled = process.env.PERF_TRACE_SCENARIOS !== '0';

function tracePerf( message )
{
    if( perfTraceEnabled === true )
    {
        process.stderr.write( message );
    }
}

function ensureDirectory( directory )
{
    fs.mkdirSync( directory, { recursive: true } );
}

function currentFilePath( relativePath )
{
    return path.join( repoRoot, relativePath );
}

function loadModuleFromSource( filename, source, stubs, timerStubs )
{
    var localModule = new Module( filename, module );
    var originalLoad = Module._load;
    var previousTimers = global.__betterTodoTreePerfTimers;
    var prologue = timerStubs ? [
        'var setTimeout = global.__betterTodoTreePerfTimers.setTimeout;',
        'var clearTimeout = global.__betterTodoTreePerfTimers.clearTimeout;',
        'var setInterval = global.__betterTodoTreePerfTimers.setInterval;',
        'var clearInterval = global.__betterTodoTreePerfTimers.clearInterval;'
    ].join( '\n' ) + '\n' : '';

    localModule.filename = filename;
    localModule.paths = Module._nodeModulePaths( path.dirname( filename ) );

    Module._load = function( request, parent, isMain )
    {
        if( stubs && Object.prototype.hasOwnProperty.call( stubs, request ) )
        {
            return stubs[ request ];
        }

        return originalLoad.call( this, request, parent, isMain );
    };

    try
    {
        global.__betterTodoTreePerfTimers = timerStubs;

        var wrapped = Module.wrap( prologue + source );
        var compiled = vm.runInThisContext( wrapped, { filename: filename } );
        compiled.call(
            localModule.exports,
            localModule.exports,
            function( request )
            {
                return Module._load( request, localModule, false );
            },
            localModule,
            filename,
            path.dirname( filename )
        );
        return localModule.exports;
    }
    finally
    {
        Module._load = originalLoad;
        global.__betterTodoTreePerfTimers = previousTimers;
    }
}

function loadCurrentModule( relativePath, stubs, timerStubs )
{
    var filename = currentFilePath( relativePath );
    var source = fs.readFileSync( filename, 'utf8' );

    return loadModuleFromSource( filename, source, stubs, timerStubs );
}

function loadRefModule( relativePath, ref, stubs, timerStubs )
{
    var filename = currentFilePath( relativePath );
    var source = childProcess.execFileSync( 'git', [ 'show', ref + ':' + relativePath ], {
        cwd: repoRoot,
        encoding: 'utf8'
    } );

    return loadModuleFromSource( filename + '#' + ref, source, stubs, timerStubs );
}

function createBaselineModuleLoader( baselineRef )
{
    return function( relativePath, stubs, timerStubs )
    {
        return loadRefModule( relativePath, baselineRef, stubs, timerStubs );
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

function percentile( values, fraction )
{
    if( values.length === 0 )
    {
        return 0;
    }

    var index = Math.max( 0, Math.min( values.length - 1, Math.ceil( values.length * fraction ) - 1 ) );
    return values[ index ];
}

function round( value )
{
    return Number( value.toFixed( 2 ) );
}

function bytesToMiB( value )
{
    return value / 1024 / 1024;
}

function resourceMaxRssToBytes( maxRss )
{
    if( process.platform === 'linux' || process.platform === 'darwin' )
    {
        return maxRss * 1024;
    }

    return maxRss;
}

function createSeriesSummary( values, transform )
{
    if( values.length === 0 )
    {
        return {
            min: 0,
            p50: 0,
            p90: 0,
            p95: 0,
            max: 0,
            samples: []
        };
    }

    var sorted = values.slice().sort( function( a, b ) { return a - b; } );
    var mapValue = typeof ( transform ) === 'function' ? transform : function( value ) { return value; };

    return {
        min: round( mapValue( sorted[ 0 ] ) ),
        p50: round( mapValue( percentile( sorted, 0.5 ) ) ),
        p90: round( mapValue( percentile( sorted, 0.9 ) ) ),
        p95: round( mapValue( percentile( sorted, 0.95 ) ) ),
        max: round( mapValue( sorted[ sorted.length - 1 ] ) ),
        samples: sorted.map( function( value ) { return round( mapValue( value ) ); } )
    };
}

async function createMeasurement( name, iterations, fn )
{
    // Microbenchmark sampler. Captures per-iteration latency, post-iteration
    // RSS, and burst (delta from pre-iteration RSS), populating every field
    // required by validateResultMeasurement.
    var latencySamplesMs = [];
    var rssSamplesBytes = [];
    var burstSamplesBytes = [];
    var lastValue;
    var index;

    for( index = 0; index < iterations; ++index )
    {
        if( typeof ( global.gc ) === 'function' )
        {
            global.gc();
        }

        var rssBeforeBytes = process.memoryUsage().rss;
        var iterationStart = process.hrtime.bigint();
        lastValue = await fn();
        var elapsedMs = Number( process.hrtime.bigint() - iterationStart ) / 1000000;
        var rssAfterBytes = process.memoryUsage().rss;

        latencySamplesMs.push( elapsedMs );
        rssSamplesBytes.push( rssAfterBytes );
        burstSamplesBytes.push( Math.max( 0, rssAfterBytes - rssBeforeBytes ) );
    }

    var latencySummary = createSeriesSummary( latencySamplesMs );
    var rssSummary = createSeriesSummary( rssSamplesBytes, bytesToMiB );
    var burstSummary = createSeriesSummary( burstSamplesBytes, bytesToMiB );

    return {
        name: name,
        iterations: iterations,
        p50Ms: latencySummary.p50,
        p90Ms: latencySummary.p90,
        p95Ms: latencySummary.p95,
        minMs: latencySummary.min,
        maxMs: latencySummary.max,
        sampleMs: latencySummary.samples,
        peakRssP50MiB: rssSummary.p50,
        peakRssP90MiB: rssSummary.p90,
        peakRssP95MiB: rssSummary.p95,
        peakRssMiB: rssSummary.max,
        peakAdditionalRssMiB: burstSummary.max,
        rssBurstP50MiB: burstSummary.p50,
        rssBurstP90MiB: burstSummary.p90,
        rssBurstP95MiB: burstSummary.p95,
        rssBurstMaxMiB: burstSummary.max,
        lastValue: lastValue
    };
}

function createLatencyMeasurementFromSamples( name, latencySamplesMs, lastValue )
{
    var latencySummary = createSeriesSummary( latencySamplesMs );

    return {
        name: name,
        iterations: latencySamplesMs.length,
        p50Ms: latencySummary.p50,
        p90Ms: latencySummary.p90,
        p95Ms: latencySummary.p95,
        minMs: latencySummary.min,
        maxMs: latencySummary.max,
        sampleMs: latencySummary.samples,
        lastValue: lastValue
    };
}

function createMemoryMeasurementFromSamples( name, burstSamplesBytes, peakRssSamplesBytes, lastValue )
{
    var burstSummary = createSeriesSummary( burstSamplesBytes, bytesToMiB );
    var peakRssSummary = createSeriesSummary( peakRssSamplesBytes, bytesToMiB );

    return {
        name: name,
        iterations: burstSamplesBytes.length,
        peakRssP50MiB: peakRssSummary.p50,
        peakRssP90MiB: peakRssSummary.p90,
        peakRssP95MiB: peakRssSummary.p95,
        peakRssMiB: peakRssSummary.max,
        peakAdditionalRssMiB: burstSummary.max,
        rssBurstP50MiB: burstSummary.p50,
        rssBurstP90MiB: burstSummary.p90,
        rssBurstP95MiB: burstSummary.p95,
        rssBurstMaxMiB: burstSummary.max,
        lastValue: lastValue
    };
}

async function disposeUserFlowHarness( harness )
{
    if( harness.extension && typeof ( harness.extension.deactivate ) === 'function' )
    {
        await Promise.resolve( harness.extension.deactivate() );
    }

    if( harness.timerStubs && typeof ( harness.timerStubs.dispose ) === 'function' )
    {
        harness.timerStubs.dispose();
    }
}

async function measureUserFlowHarnessIteration( definition, harness, fixture )
{
    if( typeof ( global.gc ) === 'function' )
    {
        global.gc();
    }

    definition.resetHarnessMetrics( harness );

    var iterationStart = process.hrtime.bigint();
    var lastValue = await definition.runFlow( harness, fixture );
    var elapsedMs = Number( process.hrtime.bigint() - iterationStart ) / 1000000;

    return {
        elapsedMs: elapsedMs,
        lastValue: lastValue
    };
}

function getPairedVariantOrder( index )
{
    return index % 2 === 0 ? [ 'current', 'baseline' ] : [ 'baseline', 'current' ];
}

async function runIsolatedUserFlowIterationWorker( scenarioName, variant, baselineRef )
{
    // stdio = [ 'ignore', 'pipe', 'pipe' ] keeps worker stderr from bleeding
    // into the parent terminal; PERF_TRACE_SCENARIOS=0 silences worker-side
    // progress so only the orchestrator emits the [perf] lines.
    var workerEnv = Object.assign( {}, process.env, { PERF_TRACE_SCENARIOS: '0' } );
    var workerOutput = childProcess.execFileSync( process.execPath, [
        '--expose-gc',
        __filename,
        '--baseline-ref',
        baselineRef,
        '--worker-user-flow-scenario',
        scenarioName,
        '--worker-user-flow-variant',
        variant
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: workerEnv,
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    } );

    return JSON.parse( workerOutput );
}

async function createPairedProfiledUserFlowMeasurements( definition, baselineRef )
{
    var samplesByVariant = {
        current: {
            burstSamplesBytes: [],
            peakRssSamplesBytes: [],
            lastValue: undefined
        },
        baseline: {
            burstSamplesBytes: [],
            peakRssSamplesBytes: [],
            lastValue: undefined
        }
    };
    var index;

    for( index = 0; index < definition.iterations; ++index )
    {
        var iterationStartedAt = process.hrtime.bigint();
        var orderedVariants = getPairedVariantOrder( index );
        var orderedIndex;

        for( orderedIndex = 0; orderedIndex < orderedVariants.length; ++orderedIndex )
        {
            var variant = orderedVariants[ orderedIndex ];
            var sample = await runIsolatedUserFlowIterationWorker( definition.name, variant, baselineRef );

            samplesByVariant[ variant ].burstSamplesBytes.push( sample.peakAdditionalRssBytes );
            samplesByVariant[ variant ].peakRssSamplesBytes.push( sample.profiledPeakRssBytes );
            samplesByVariant[ variant ].lastValue = sample.lastValue;
        }

        var iterationElapsedMs = Number( ( process.hrtime.bigint() - iterationStartedAt ) / 1000000n );
        tracePerf(
            '[perf]   ' + definition.name + ' memory ' + ( index + 1 ) + '/' + definition.iterations +
            ' (' + iterationElapsedMs + 'ms)\n'
        );
    }

    return {
        current: createMemoryMeasurementFromSamples(
            definition.name + '-current',
            samplesByVariant.current.burstSamplesBytes,
            samplesByVariant.current.peakRssSamplesBytes,
            samplesByVariant.current.lastValue
        ),
        baseline: createMemoryMeasurementFromSamples(
            definition.name + '-baseline',
            samplesByVariant.baseline.burstSamplesBytes,
            samplesByVariant.baseline.peakRssSamplesBytes,
            samplesByVariant.baseline.lastValue
        )
    };
}

async function createPairedWarmUserFlowMeasurements( definition, baselineLoader )
{
    var samplesByVariant = {
        current: [],
        baseline: []
    };
    var lastValueByVariant = {
        current: undefined,
        baseline: undefined
    };
    var warmupIterations = definition.warmupIterations || USER_FLOW_LATENCY_WARMUP_ITERATIONS;
    var index;

    for( index = 0; index < definition.iterations; ++index )
    {
        var iterationStartedAt = process.hrtime.bigint();
        var currentFixture = definition.createFixture ? definition.createFixture() : undefined;
        var baselineFixture = definition.createFixture ? definition.createFixture() : undefined;
        var currentHarness = await definition.setupHarness( loadCurrentModule, currentFixture );
        var baselineHarness = await definition.setupHarness( baselineLoader, baselineFixture );
        var warmupIndex;

        try
        {
            for( warmupIndex = 0; warmupIndex < warmupIterations; ++warmupIndex )
            {
                var warmupOrder = getPairedVariantOrder( warmupIndex );
                var orderedWarmupIndex;

                for( orderedWarmupIndex = 0; orderedWarmupIndex < warmupOrder.length; ++orderedWarmupIndex )
                {
                    if( warmupOrder[ orderedWarmupIndex ] === 'current' )
                    {
                        definition.resetHarnessMetrics( currentHarness );
                        await definition.runFlow( currentHarness, currentFixture );
                    }
                    else
                    {
                        definition.resetHarnessMetrics( baselineHarness );
                        await definition.runFlow( baselineHarness, baselineFixture );
                    }
                }
            }

            var orderedVariants = getPairedVariantOrder( index );
            var orderedIndex;

            for( orderedIndex = 0; orderedIndex < orderedVariants.length; ++orderedIndex )
            {
                var variant = orderedVariants[ orderedIndex ];
                var sample = variant === 'current' ?
                    await measureUserFlowHarnessIteration( definition, currentHarness, currentFixture ) :
                    await measureUserFlowHarnessIteration( definition, baselineHarness, baselineFixture );

                samplesByVariant[ variant ].push( sample.elapsedMs );
                lastValueByVariant[ variant ] = sample.lastValue;
            }
        }
        finally
        {
            await disposeUserFlowHarness( currentHarness );
            await disposeUserFlowHarness( baselineHarness );
        }

        var iterationElapsedMs = Number( ( process.hrtime.bigint() - iterationStartedAt ) / 1000000n );
        tracePerf(
            '[perf]   ' + definition.name + ' latency ' + ( index + 1 ) + '/' + definition.iterations +
            ' (' + iterationElapsedMs + 'ms)\n'
        );
    }

    return {
        current: createLatencyMeasurementFromSamples( definition.name + '-current', samplesByVariant.current, lastValueByVariant.current ),
        baseline: createLatencyMeasurementFromSamples( definition.name + '-baseline', samplesByVariant.baseline, lastValueByVariant.baseline )
    };
}

function mergeUserFlowMeasurements( latencyMeasurement, memoryMeasurement )
{
    return Object.assign( {}, latencyMeasurement, {
        peakRssP50MiB: memoryMeasurement.peakRssP50MiB,
        peakRssP90MiB: memoryMeasurement.peakRssP90MiB,
        peakRssP95MiB: memoryMeasurement.peakRssP95MiB,
        peakRssMiB: memoryMeasurement.peakRssMiB,
        peakAdditionalRssMiB: memoryMeasurement.peakAdditionalRssMiB,
        rssBurstP50MiB: memoryMeasurement.rssBurstP50MiB,
        rssBurstP90MiB: memoryMeasurement.rssBurstP90MiB,
        rssBurstP95MiB: memoryMeasurement.rssBurstP95MiB,
        rssBurstMaxMiB: memoryMeasurement.rssBurstMaxMiB
    } );
}

async function runProfiledUserFlowScenario( definition, baselineRef )
{
    var baselineLoader = createBaselineModuleLoader( baselineRef );
    var latencyMeasurements = await createPairedWarmUserFlowMeasurements( definition, baselineLoader );
    var memoryMeasurements = await createPairedProfiledUserFlowMeasurements( definition, baselineRef );

    return {
        name: definition.name,
        current: mergeUserFlowMeasurements( latencyMeasurements.current, memoryMeasurements.current ),
        baseline: mergeUserFlowMeasurements( latencyMeasurements.baseline, memoryMeasurements.baseline )
    };
}

function createDetectionConfig( options )
{
    return {
        tags: function()
        {
            return options.tags.slice();
        },
        regex: function()
        {
            return {
                tags: options.tags.slice(),
                regex: options.regex,
                caseSensitive: options.caseSensitive !== false,
                multiLine: options.multiLine === true
            };
        },
        subTagRegex: function()
        {
            return options.subTagRegex || '(^:\\s*)';
        }
    };
}

function buildDefaultDetectionText( lineCount )
{
    var lines = [];
    var index;

    for( index = 0; index < lineCount; ++index )
    {
        if( index % 17 === 0 )
        {
            lines.push( '// TODO item ' + index );
        }
        else
        {
            lines.push( 'const value' + index + ' = ' + index + ';' );
        }
    }

    return lines.join( '\n' );
}

function buildCustomDetectionText( lineCount )
{
    var lines = [];
    var index;

    for( index = 0; index < lineCount; ++index )
    {
        if( index % 13 === 0 )
        {
            lines.push( '/* TODO: custom item ' + index + ' */' );
        }
        else
        {
            lines.push( 'const custom' + index + ' = "value";' );
        }
    }

    return lines.join( '\n' );
}

function createLineOffsets( text )
{
    var offsets = [ 0 ];
    var index;

    for( index = 0; index < text.length; ++index )
    {
        if( text[ index ] === '\n' )
        {
            offsets.push( index + 1 );
        }
    }

    return offsets;
}

function positionAtOffset( lineOffsets, offset )
{
    var low = 0;
    var high = lineOffsets.length - 1;

    while( low <= high )
    {
        var mid = Math.floor( ( low + high ) / 2 );
        if( lineOffsets[ mid ] <= offset )
        {
            if( mid === lineOffsets.length - 1 || lineOffsets[ mid + 1 ] > offset )
            {
                return {
                    line: mid,
                    character: offset - lineOffsets[ mid ]
                };
            }
            low = mid + 1;
        }
        else
        {
            high = mid - 1;
        }
    }

    return {
        line: 0,
        character: offset
    };
}

function createTextDocumentForBench( uri, text )
{
    var lineOffsets = createLineOffsets( text );

    return {
        uri: uri,
        fileName: uri.fsPath,
        getText: function()
        {
            return text;
        },
        positionAt: function( offset )
        {
            return positionAtOffset( lineOffsets, offset );
        },
        lineAt: function( input )
        {
            var line = typeof ( input ) === 'number' ? input : input.line;
            var start = lineOffsets[ line ];
            var end = line + 1 < lineOffsets.length ? lineOffsets[ line + 1 ] - 1 : text.length;

            return {
                text: text.slice( start, end )
            };
        }
    };
}

function createUpstreamEditorScanner( baselineUtils, config )
{
    baselineUtils.init( config );

    return function( uri, text )
    {
        var document = createTextDocumentForBench( uri, text );
        var regex = baselineUtils.getRegexForEditorSearch( true );
        var results = [];
        var match;

        while( ( match = regex.exec( text ) ) !== null )
        {
            while( text[ match.index ] === '\n' || text[ match.index ] === '\r' )
            {
                match.index++;
                match[ 0 ] = match[ 0 ].substring( 1 );
            }

            var offset = match.index;
            var sections = match[ 0 ].split( '\n' );
            var position = document.positionAt( offset );
            var line = document.lineAt( position.line ).text;
            var result = {
                uri: document.uri,
                line: position.line + 1,
                column: position.character + 1,
                match: line
            };

            if( sections.length > 1 )
            {
                result.extraLines = [];
                offset += sections[ 0 ].length + 1;
                sections.shift();
                sections.forEach( function( section )
                {
                    var extraPosition = document.positionAt( offset );
                    var extraLine = baselineUtils.removeLineComments( document.lineAt( extraPosition.line ).text, document.fileName );

                    result.extraLines.push( {
                        uri: document.uri,
                        line: extraPosition.line + 1,
                        column: extraPosition.character + 1,
                        match: extraLine
                    } );
                    offset += section.length + 1;
                } );
            }

            results.push( result );
        }

        return results.length;
    };
}

async function benchmarkScanLargeDefault( baselineLoader )
{
    var currentUtils = loadCurrentModule( 'src/utils.js' );
    var currentDetection = loadCurrentModule( 'src/detection.js', {
        './utils.js': currentUtils
    } );
    var baselineUtils = baselineLoader( 'src/utils.js' );
    var defaultConfig = createDetectionConfig( {
        tags: [ 'TODO', 'FIXME', 'BUG', 'HACK', 'XXX', '[ ]', '[x]' ],
        regex: currentUtils.DEFAULT_REGEX_SOURCE
    } );
    var defaultText = buildDefaultDetectionText( 50000 );
    var defaultUri = createUri( '/tmp/large-default.js' );
    var baselineScan = createUpstreamEditorScanner( baselineUtils, defaultConfig );

    currentUtils.init( defaultConfig );
    return {
        name: 'scan-large-default',
        current: await createMeasurement( 'scan-large-default-current', 15, function()
        {
            return currentDetection.scanText( defaultUri, defaultText ).length;
        } ),
        baseline: await createMeasurement( 'scan-large-default-baseline', 15, function()
        {
            return baselineScan( defaultUri, defaultText );
        } )
    };
}

async function benchmarkScanLargeCustomRegex( baselineLoader )
{
    var currentUtils = loadCurrentModule( 'src/utils.js' );
    var currentDetection = loadCurrentModule( 'src/detection.js', {
        './utils.js': currentUtils
    } );
    var baselineUtils = baselineLoader( 'src/utils.js' );
    var customConfig = createDetectionConfig( {
        tags: [ 'TODO' ],
        regex: '(TODO):\\s*[^\\n]+',
        multiLine: false
    } );
    var customText = buildCustomDetectionText( 50000 );
    var customUri = createUri( '/tmp/large-custom.js' );
    var baselineScan = createUpstreamEditorScanner( baselineUtils, customConfig );

    currentUtils.init( customConfig );

    return {
        name: 'scan-large-custom-regex',
        current: await createMeasurement( 'scan-large-custom-regex-current', 15, function()
        {
            return currentDetection.scanText( customUri, customText ).length;
        } ),
        baseline: await createMeasurement( 'scan-large-custom-regex-baseline', 15, function()
        {
            return baselineScan( customUri, customText );
        } )
    };
}

function createTreeVscodeStub()
{
    function EventEmitter()
    {
        this._listener = undefined;
        this.event = function( listener )
        {
            this._listener = listener;
        }.bind( this );
        this.fire = function( value )
        {
            if( this._listener )
            {
                this._listener( value );
            }
        }.bind( this );
    }

    function TreeItem( label )
    {
        this.label = label;
    }

    function ThemeIcon( name )
    {
        this.id = name;
    }

    ThemeIcon.Folder = new ThemeIcon( 'folder' );
    ThemeIcon.File = new ThemeIcon( 'file' );

    function Position( line, character )
    {
        this.line = line;
        this.character = character;
    }

    function Selection( start, end )
    {
        this.start = start;
        this.end = end;
    }

    return {
        EventEmitter: EventEmitter,
        TreeItem: TreeItem,
        ThemeIcon: ThemeIcon,
        Position: Position,
        Selection: Selection,
        Uri: {
            file: createUri
        },
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2
        },
        workspace: {
            getConfiguration: function()
            {
                return {
                    compactFolders: false,
                    get: function( key, defaultValue )
                    {
                        return key === 'revealBehaviour' ? 'start of todo' : defaultValue;
                    },
                    inspect: function( key )
                    {
                        return {
                            defaultValue: key === 'revealBehaviour' ? 'start of todo' : undefined,
                            globalValue: undefined,
                            workspaceValue: undefined,
                            workspaceFolderValue: undefined
                        };
                    }
                };
            }
        }
    };
}

function createTreeConfig()
{
    return {
        tags: function() { return [ 'TODO', 'FIXME' ]; },
        shouldGroupByTag: function() { return false; },
        shouldGroupBySubTag: function() { return false; },
        shouldShowTagsOnly: function() { return false; },
        shouldFlatten: function() { return false; },
        shouldCompactFolders: function() { return false; },
        shouldExpand: function() { return false; },
        shouldShowScanModeInTree: function() { return false; },
        scanMode: function() { return 'workspace'; },
        showBadges: function() { return false; },
        shouldShowCounts: function() { return true; },
        shouldHideIconsWhenGroupedByTag: function() { return false; },
        tooltipFormat: function() { return '${filepath}, ${line}'; },
        labelFormat: function() { return '${tag} ${after}'; },
        subTagClickUrl: function() { return ''; },
        isRegexCaseSensitive: function() { return true; },
        shouldHideFromTree: function() { return false; },
        shouldHideFromStatusBar: function() { return false; },
        shouldHideFromActivityBar: function() { return false; },
        shouldSortTree: function() { return true; },
        shouldSortTagsOnlyViewAlphabetically: function() { return false; },
        showFilterCaseSensitive: function() { return false; },
        tagGroup: function() { return undefined; }
    };
}

function createWorkspaceState()
{
    var store = {};
    return {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( store, key ) ? store[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            store[ key ] = value;
            return Promise.resolve();
        }
    };
}

function createTreeResults()
{
    var resultsByUri = new Map();
    var fileIndex;
    var todoIndex;

    for( fileIndex = 0; fileIndex < 480; ++fileIndex )
    {
        var uri = createUri(
            '/workspace/src/pkg-' + Math.floor( fileIndex / 48 ) +
            '/feature-' + ( fileIndex % 12 ) +
            '/slice-' + Math.floor( fileIndex / 6 ) +
            '/file-' + fileIndex + '.js'
        );
        var fileResults = [];

        for( todoIndex = 0; todoIndex < 36; ++todoIndex )
        {
            fileResults.push( {
                uri: uri,
                line: todoIndex + 1,
                column: 1,
                endLine: todoIndex + 1,
                endColumn: 12,
                actualTag: todoIndex % 2 === 0 ? 'TODO' : 'FIXME',
                displayText: 'item ' + fileIndex + ':' + todoIndex,
                continuationText: [],
                match: 'TODO item ' + fileIndex + ':' + todoIndex
            } );
        }

        resultsByUri.set( uri.toString(), {
            uri: uri,
            results: fileResults
        } );
    }

    return Array.from( resultsByUri.values() );
}

function extractTagForBaselineTree( text )
{
    var trimmed = text.trim();
    var parts = trimmed.split( /\s+/ );
    var tag = parts[ 0 ] || 'TODO';
    var remainder = trimmed.slice( tag.length ).trim();

    return {
        tag: tag,
        withoutTag: remainder,
        before: '',
        after: remainder,
        subTag: undefined
    };
}

function loadTreeModule(relativePath)
{
    var vscodeStub = createTreeVscodeStub();
    var configStub = createTreeConfig();

    return loadCurrentModule( relativePath, {
        vscode: vscodeStub,
        './utils.js': {
            formatLabel: function( template, node ) { return node.label || template; },
            toGlobArray: function( value ) { return Array.isArray( value ) ? value : []; }
        },
        './icons.js': {
            getTreeIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            }
        },
        './config.js': configStub,
        './extensionIdentity.js': {
            COMMANDS: {
                revealInFile: 'better-todo-tree.revealInFile',
                openUrl: 'better-todo-tree.openUrl'
            },
            getSetting: function( setting, defaultValue )
            {
                return setting === 'general.revealBehaviour' ? 'start of todo' : defaultValue;
            }
        }
    } );
}

function loadBaselineTreeModule( baselineLoader )
{
    var vscodeStub = createTreeVscodeStub();
    var configStub = createTreeConfig();

    return baselineLoader( 'src/tree.js', {
        vscode: vscodeStub,
        './utils.js': {
            formatLabel: function( template, node ) { return node.label || template; },
            toGlobArray: function( value ) { return Array.isArray( value ) ? value : []; },
            removeBlockComments: function( text ) { return text; },
            extractTag: function( text ) { return extractTagForBaselineTree( text ); }
        },
        './icons.js': {
            getIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            },
            getTreeIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            }
        },
        './config.js': configStub,
        './extensionIdentity.js': {
            COMMANDS: {
                revealInFile: 'better-todo-tree.revealInFile',
                openUrl: 'better-todo-tree.openUrl'
            },
            getSetting: function( setting, defaultValue )
            {
                return setting === 'general.revealBehaviour' ? 'start of todo' : defaultValue;
            }
        }
    } );
}

function renderTree(provider)
{
    function visit(node)
    {
        provider.getTreeItem( node );
        ( provider.getChildren( node ) || [] ).forEach( visit );
    }

    ( provider.getChildren() || [] ).forEach( visit );
    return provider.getChildren().length;
}

function replaceProviderDocumentResults( provider, uri, results )
{
    if( typeof ( provider.replaceDocument ) === 'function' )
    {
        provider.replaceDocument( uri, results );
        return;
    }

    if( typeof ( provider.reset ) === 'function' )
    {
        provider.reset( uri );
    }

    results.forEach( function( result )
    {
        provider.add( result );
    } );
}

function finalizeProviderTreeState( provider )
{
    if( typeof ( provider.finalizePendingChanges ) === 'function' )
    {
        provider.finalizePendingChanges( undefined, { fullSort: true, refilterAll: true } );
        return;
    }

    if( typeof ( provider.rebuild ) === 'function' )
    {
        provider.rebuild();
    }

    provider.refresh();
}

async function benchmarkTreeRender( baselineLoader )
{
    var currentTree = loadTreeModule( 'src/tree.js' );
    var baselineTree = loadBaselineTreeModule( baselineLoader );
    var workspaceState = createWorkspaceState();
    var workspaceFolder = {
        name: 'workspace',
        uri: {
            scheme: 'file',
            fsPath: '/workspace'
        }
    };
    var treeEntries = createTreeResults();
    var currentProvider = new currentTree.TreeNodeProvider( { workspaceState: workspaceState }, function() {}, function() {} );
    var baselineProvider = new baselineTree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

    currentProvider.clear( [ workspaceFolder ] );
    baselineProvider.clear( [ workspaceFolder ] );

    treeEntries.forEach( function( entry )
    {
        replaceProviderDocumentResults( currentProvider, entry.uri, entry.results );
        replaceProviderDocumentResults( baselineProvider, entry.uri, entry.results );
    } );

    finalizeProviderTreeState( currentProvider );
    finalizeProviderTreeState( baselineProvider );

    return {
        name: 'tree-render-counts',
        current: await createMeasurement( 'tree-render-counts-current', 15, function()
        {
            return renderTree( currentProvider );
        } ),
        baseline: await createMeasurement( 'tree-render-counts-baseline', 15, function()
        {
            return renderTree( baselineProvider );
        } )
    };
}

function createHighlightModule(relativePath)
{
    var creationCount = { value: 0 };
    var matches = [];
    var index;

    for( index = 0; index < 200; ++index )
    {
        matches.push( {
            actualTag: 'TODO',
            commentStartOffset: index * 20,
            commentEndOffset: index * 20 + 18,
            matchStartOffset: index * 20 + 3,
            matchEndOffset: index * 20 + 12,
            tagStartOffset: index * 20 + 3,
            tagEndOffset: index * 20 + 7
        } );
    }

    var moduleExports = loadCurrentModule( relativePath, {
        vscode: {
            ThemeColor: function( name ) { this.name = name; },
            Position: function( line, character )
            {
                this.line = line;
                this.character = character;
            },
            Range: function( start, end )
            {
                this.start = start;
                this.end = end;
            },
            window: {
                createTextEditorDecorationType: function( options )
                {
                    creationCount.value++;
                    return Object.assign( {
                        dispose: function() {}
                    }, options );
                }
            }
        },
        './config.js': {
            customHighlight: function() { return {}; },
            subTagRegex: function() { return '(^:\\s*)'; },
            tagGroup: function() { return undefined; }
        },
        './utils.js': {
            isHexColour: function() { return false; },
            isRgbColour: function() { return false; },
            isValidColour: function() { return true; },
            isThemeColour: function() { return false; },
            hexToRgba: function( value ) { return value; },
            complementaryColour: function() { return '#ffffff'; },
            setRgbAlpha: function( value ) { return value; }
        },
        './attributes.js': {
            getForeground: function() { return undefined; },
            getBackground: function() { return undefined; },
            hasCustomHighlight: function() { return false; },
            getAttribute: function( tag, attribute, defaultValue )
            {
                if( attribute === 'type' )
                {
                    return 'tag';
                }
                return defaultValue;
            }
        },
        './icons.js': {
            getGutterIcon: function()
            {
                return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
            }
        },
        './detection.js': {
            scanDocument: function()
            {
                return matches;
            }
        },
        './extensionIdentity.js': {
            getSetting: function( setting, defaultValue )
            {
                return defaultValue;
            }
        }
    } );
    var text = Array.from( { length: 200 }, function( _, indexValue )
    {
        return '// TODO item ' + indexValue;
    } ).join( '\n' );
    var highlightDocument = createHighlightEditorDocument( '/tmp/highlight.js', text );
    var editor = {
        viewColumn: 1,
        document: highlightDocument,
        setDecorations: function() {}
    };

    moduleExports.init( { subscriptions: { push: function() {} } }, function() {} );

    return {
        module: moduleExports,
        editor: editor,
        creationCount: creationCount
    };
}

function createBaselineHighlightModule( baselineLoader )
{
    var creationCount = { value: 0 };
    var matches = [];
    var index;

    for( index = 0; index < 200; ++index )
    {
        matches.push( {
            actualTag: 'TODO',
            commentStartOffset: index * 20,
            commentEndOffset: index * 20 + 18,
            matchStartOffset: index * 20 + 3,
            matchEndOffset: index * 20 + 12,
            tagStartOffset: index * 20 + 3,
            tagEndOffset: index * 20 + 7
        } );
    }

    var moduleExports = baselineLoader( 'src/highlights.js', {
        'regexp-match-indices': {
            shim: function()
            {
                return function() {};
            }
        },
        vscode: {
            ThemeColor: function( name ) { this.name = name; },
            Position: function( line, character )
            {
                this.line = line;
                this.character = character;
            },
            Range: function( start, end )
            {
                this.start = start;
                this.end = end;
            },
            window: {
                createTextEditorDecorationType: function( options )
                {
                    creationCount.value++;
                    return Object.assign( {
                        dispose: function() {}
                    }, options );
                }
            },
            workspace: {
                getConfiguration: function()
                {
                    return {
                        get: function( key, defaultValue )
                        {
                            if( key === 'enabled' )
                            {
                                return true;
                            }

                            if( key === 'highlightDelay' )
                            {
                                return 0;
                            }

                            return defaultValue;
                        }
                    };
                }
            }
        },
        './config.js': {
            customHighlight: function() { return {}; },
            subTagRegex: function() { return '(^:\\s*)'; },
            tagGroup: function() { return undefined; }
        },
        './utils.js': {
            isHexColour: function() { return false; },
            isRgbColour: function() { return false; },
            isValidColour: function() { return true; },
            isThemeColour: function() { return false; },
            hexToRgba: function( value ) { return value; },
            complementaryColour: function() { return '#ffffff'; },
            setRgbAlpha: function( value ) { return value; },
            getRegexForEditorSearch: function()
            {
                return /TODO/g;
            },
            extractTag: function( text )
            {
                return extractTagForBaselineTree( text );
            },
            updateBeforeAndAfter: function( result, text )
            {
                var extracted = extractTagForBaselineTree( text );

                result.tagOffset = text.indexOf( extracted.tag );
                result.text = extracted.after;
                result.after = extracted.after;
                result.before = extracted.before;
                result.subTag = extracted.subTag;
                return result;
            }
        },
        './attributes.js': {
            getForeground: function() { return undefined; },
            getBackground: function() { return undefined; },
            getAttribute: function( tag, attribute, defaultValue )
            {
                if( attribute === 'type' )
                {
                    return 'tag';
                }
                return defaultValue;
            }
        },
        './icons.js': {
            getIcon: function()
            {
                return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
            },
            getGutterIcon: function()
            {
                return { dark: '/tmp/gutter.svg', light: '/tmp/gutter.svg' };
            }
        },
        './detection.js': {
            scanDocument: function()
            {
                return matches;
            }
        },
        './extensionIdentity.js': {
            getSetting: function( setting, defaultValue )
            {
                return defaultValue;
            }
        }
    }, {
        setTimeout: function( callback, delay, value )
        {
            callback( value );
            return 1;
        },
        clearTimeout: function() {},
        setInterval: function( callback, delay, value )
        {
            callback( value );
            return 1;
        },
        clearInterval: function() {}
    } );
    var text = Array.from( { length: 200 }, function( _, indexValue )
    {
        return '// TODO item ' + indexValue;
    } ).join( '\n' );
    var highlightDocument = createHighlightEditorDocument( '/tmp/highlight.js', text );
    var editor = {
        viewColumn: 1,
        document: highlightDocument,
        setDecorations: function() {}
    };

    moduleExports.init( { subscriptions: { push: function() {} } }, function() {} );

    return {
        module: moduleExports,
        editor: editor,
        creationCount: creationCount
    };
}

function createHighlightEditorDocument( fsPath, text )
{
    var uri = createUri( fsPath );
    var lineOffsets = createLineOffsets( text );

    return {
        uri: uri,
        version: 1,
        getText: function() { return text; },
        positionAt: function( offset )
        {
            return positionAtOffset( lineOffsets, offset );
        },
        offsetAt: function( position )
        {
            return lineOffsets[ position.line ] + position.character;
        },
        lineAt: function( line )
        {
            var lineNumber = typeof ( line ) === 'number' ? line : line.line;
            var start = lineOffsets[ lineNumber ];
            var end = lineNumber + 1 < lineOffsets.length ? lineOffsets[ lineNumber + 1 ] - 1 : text.length;

            return {
                text: text.slice( start, end ),
                range: {
                    end: {
                        line: lineNumber,
                        character: end - start
                    }
                }
            };
        }
    };
}

function runHighlightMeasurement( harness )
{
    if( typeof ( harness.module.highlight ) === 'function' )
    {
        harness.module.highlight( harness.editor );
    }
    else
    {
        harness.module.triggerHighlight( harness.editor );
    }

    return harness.creationCount.value;
}

async function benchmarkHighlights( baselineLoader )
{
    var currentHarness = createHighlightModule( 'src/highlights.js' );
    var baselineHarness = createBaselineHighlightModule( baselineLoader );

    return {
        name: 'highlight-repeat-visible-doc',
        current: await createMeasurement( 'highlight-repeat-visible-doc-current', 25, function()
        {
            return runHighlightMeasurement( currentHarness );
        } ),
        baseline: await createMeasurement( 'highlight-repeat-visible-doc-baseline', 25, function()
        {
            return runHighlightMeasurement( baselineHarness );
        } )
    };
}

function createAttributesConfig(customHighlightCount)
{
    var customHighlights = {};
    var index;

    for( index = 0; index < customHighlightCount; ++index )
    {
        customHighlights[ 'TAG' + index ] = {
            foreground: 'red',
            background: 'yellow',
            icon: 'check',
            type: 'tag'
        };
    }

    return {
        isRegexCaseSensitive: function() { return false; },
        customHighlight: function() { return customHighlights; },
        defaultHighlight: function() { return { background: 'blue' }; },
        shouldUseColourScheme: function() { return false; },
        backgroundColourScheme: function() { return []; },
        foregroundColourScheme: function() { return []; },
        tags: function()
        {
            return Object.keys( customHighlights );
        }
    };
}

async function benchmarkAttributes( baselineLoader )
{
    var config = createAttributesConfig( 200 );
    var currentAttributes = loadCurrentModule( 'src/attributes.js' );
    var baselineAttributes = baselineLoader( 'src/attributes.js' );
    var lookupTags = Array.from( { length: 1000 }, function( _, index )
    {
        return 'TAG' + ( index % 200 );
    } );

    currentAttributes.init( config );
    baselineAttributes.init( config );

    return {
        name: 'attributes-custom-highlight',
        current: await createMeasurement( 'attributes-custom-highlight-current', 25, function()
        {
            return lookupTags.reduce( function( count, tag )
            {
                return count + ( currentAttributes.getAttribute( tag, 'foreground', undefined ) ? 1 : 0 );
            }, 0 );
        } ),
        baseline: await createMeasurement( 'attributes-custom-highlight-baseline', 25, function()
        {
            return lookupTags.reduce( function( count, tag )
            {
                return count + ( baselineAttributes.getAttribute( tag, 'foreground', undefined ) ? 1 : 0 );
            }, 0 );
        } )
    };
}

function createWorkspaceFileEntry(fileIndex, matchesPerFile)
{
    var filePath = '/workspace/src/file-' + fileIndex + '.txt';
    var lines = [];
    var matches = [];
    var matchIndex;
    var lineNumber = 1;

    for( matchIndex = 0; matchIndex < matchesPerFile; ++matchIndex )
    {
        var text = 'TODO: workspace item ' + fileIndex + ':' + matchIndex;
        lines.push( text );
        matches.push( {
            fsPath: filePath,
            line: lineNumber,
            column: 1,
            match: text
        } );
        lineNumber++;
        lines.push( 'const filler' + matchIndex + ' = 1;' );
        lineNumber++;
    }

    return {
        filePath: filePath,
        text: lines.join( '\n' ),
        matches: matches
    };
}

async function benchmarkWorkspaceStreaming( baselineLoader )
{
    var currentUtils = loadCurrentModule( 'src/utils.js' );
    var currentDetection = loadCurrentModule( 'src/detection.js', {
        './utils.js': currentUtils
    } );
    var baselineSearchResults = baselineLoader( 'src/searchResults.js' );
    var config = createDetectionConfig( {
        tags: [ 'TODO' ],
        regex: '(TODO):\\s*[^\\n]+'
    } );
    var fileCount = 1500;
    var matchesPerFile = 20;

    currentUtils.init( config );

    function normalizeFile(filePath, text, fileMatches)
    {
        var uri = createUri( filePath );
        var context = currentDetection.createScanContext( uri, text );
        return fileMatches.map( function( match )
        {
            return currentDetection.normalizeRegexMatchWithContext( context, match );
        } ).filter( Boolean ).length;
    }

    return {
        name: 'workspace-json-streaming',
        current: await createMeasurement( 'workspace-json-streaming-current', 10, function()
        {
            var total = 0;
            var fileIndex;

            for( fileIndex = 0; fileIndex < fileCount; ++fileIndex )
            {
                var entry = createWorkspaceFileEntry( fileIndex, matchesPerFile );
                total += normalizeFile( entry.filePath, entry.text, entry.matches );
            }

            return total;
        } ),
        baseline: await createMeasurement( 'workspace-json-streaming-baseline', 10, function()
        {
            var total = 0;
            var fileIndex;

            baselineSearchResults.clear();

            for( fileIndex = 0; fileIndex < fileCount; ++fileIndex )
            {
                var entry = createWorkspaceFileEntry( fileIndex, matchesPerFile );
                entry.matches.forEach( function( match )
                {
                    baselineSearchResults.add( {
                        uri: createUri( match.fsPath ),
                        fsPath: match.fsPath,
                        line: match.line,
                        column: match.column,
                        match: match.match
                    } );
                } );
            }

            total = baselineSearchResults.count();
            baselineSearchResults.clear();

            return total;
        } )
    };
}

function createSearchResultStoreFixture(options)
{
    var entries = [];
    var fileIndex;

    for( fileIndex = 0; fileIndex < options.fileCount; ++fileIndex )
    {
        var fsPath = '/workspace/src/' + ( options.filePrefix || 'file' ) + '-' + fileIndex + '.js';
        var uri = createUri( fsPath );
        var baseResults = [];
        var updatedResults = [];
        var matchIndex;

        for( matchIndex = 0; matchIndex < options.matchesPerFile; ++matchIndex )
        {
            var line = ( matchIndex * 2 ) + 1;
            var baseDisplayText = ( options.customRegex === true ? 'regex item ' : 'workspace item ' ) + fileIndex + ':' + matchIndex;
            var updatedDisplayText = 'updated ' + baseDisplayText;
            var baseMatch = options.customRegex === true ?
                'TODO(' + fileIndex + '-' + matchIndex + '): ' + baseDisplayText :
                'TODO: ' + baseDisplayText;
            var updatedMatch = options.customRegex === true ?
                'TODO(' + fileIndex + '-' + matchIndex + '): ' + updatedDisplayText :
                'TODO: ' + updatedDisplayText;
            var baseResult = {
                uri: uri,
                fsPath: fsPath,
                sourceId: options.customRegex === true ? 'regex:' + fileIndex : 'workspace:' + fileIndex,
                line: line,
                column: 1,
                endLine: line,
                endColumn: baseMatch.length + 1,
                actualTag: 'TODO',
                displayText: baseDisplayText,
                before: '',
                after: baseDisplayText,
                match: baseMatch,
                continuationText: []
            };
            var updatedResult = Object.assign( {}, baseResult, {
                displayText: updatedDisplayText,
                after: updatedDisplayText,
                match: updatedMatch,
                endColumn: updatedMatch.length + 1
            } );

            if( options.customRegex === true )
            {
                baseResult.captureGroupOffsets = [ undefined, [ 0, 4 ] ];
                updatedResult.captureGroupOffsets = [ undefined, [ 0, 4 ] ];
            }

            baseResults.push( baseResult );
            updatedResults.push( updatedResult );
        }

        entries.push( {
            uri: uri,
            baseResults: baseResults,
            updatedResults: updatedResults
        } );
    }

    return {
        entries: entries,
        updateTargets: entries.slice( 0, options.updateCount )
    };
}

function populateCurrentSearchResultsStore(store, entries)
{
    entries.forEach( function( entry )
    {
        store.replaceUriResults( entry.uri, entry.baseResults );
    } );
    store.drainDirtyResults();
}

function populateBaselineSearchResultsStore(searchResultsModule, entries)
{
    searchResultsModule.clear();
    entries.forEach( function( entry )
    {
        entry.baseResults.forEach( function( result )
        {
            searchResultsModule.add( result );
        } );
    } );
}

async function benchmarkWorkspaceIncrementalRescans( baselineLoader )
{
    var currentSearchResults = loadCurrentModule( 'src/searchResults.js' );
    var baselineSearchResults = baselineLoader( 'src/searchResults.js' );
    var fixture = createSearchResultStoreFixture( {
        fileCount: 3000,
        matchesPerFile: 20,
        updateCount: 500,
        filePrefix: 'workspace-rescan',
        customRegex: true
    } );

    return {
        name: 'workspace-incremental-rescans',
        current: await createMeasurement( 'workspace-incremental-rescans-current', 5, function()
        {
            var store = currentSearchResults.createStore();

            populateCurrentSearchResultsStore( store, fixture.entries );
            fixture.updateTargets.forEach( function( entry )
            {
                store.replaceUriResults( entry.uri, entry.baseResults );
                store.drainDirtyResults();
            } );

            return store.count();
        } ),
        baseline: await createMeasurement( 'workspace-incremental-rescans-baseline', 5, function()
        {
            populateBaselineSearchResultsStore( baselineSearchResults, fixture.entries );

            fixture.updateTargets.forEach( function( entry )
            {
                baselineSearchResults.remove( entry.uri );
                entry.baseResults.forEach( function( result )
                {
                    baselineSearchResults.add( result );
                } );
            } );

            var total = baselineSearchResults.count();
            baselineSearchResults.clear();
            return total;
        } )
    };
}

async function benchmarkWorkspaceIncrementalUpdates( baselineLoader )
{
    var currentSearchResults = loadCurrentModule( 'src/searchResults.js' );
    var baselineSearchResults = baselineLoader( 'src/searchResults.js' );
    var fixture = createSearchResultStoreFixture( {
        fileCount: 3000,
        matchesPerFile: 20,
        updateCount: 500,
        filePrefix: 'workspace-update',
        customRegex: false
    } );

    return {
        name: 'workspace-incremental-updates',
        current: await createMeasurement( 'workspace-incremental-updates-current', 5, function()
        {
            var store = currentSearchResults.createStore();

            populateCurrentSearchResultsStore( store, fixture.entries );
            fixture.updateTargets.forEach( function( entry )
            {
                store.replaceUriResults( entry.uri, entry.updatedResults );
                store.drainDirtyResults();
            } );

            return store.count();
        } ),
        baseline: await createMeasurement( 'workspace-incremental-updates-baseline', 5, function()
        {
            populateBaselineSearchResultsStore( baselineSearchResults, fixture.entries );

            fixture.updateTargets.forEach( function( entry )
            {
                baselineSearchResults.remove( entry.uri );
                entry.updatedResults.forEach( function( result )
                {
                    baselineSearchResults.add( result );
                } );
            } );

            var total = baselineSearchResults.count();
            baselineSearchResults.clear();
            return total;
        } )
    };
}

function buildScenarioDefinitions( baselineLoader )
{
    var microbenchmarkDefinitions = [
        {
            name: 'scan-large-default',
            run: function()
            {
                return benchmarkScanLargeDefault( baselineLoader );
            }
        },
        {
            name: 'scan-large-custom-regex',
            run: function()
            {
                return benchmarkScanLargeCustomRegex( baselineLoader );
            }
        },
        {
            name: 'tree-render-counts',
            run: function()
            {
                return benchmarkTreeRender( baselineLoader );
            }
        },
        {
            name: 'highlight-repeat-visible-doc',
            run: function()
            {
                return benchmarkHighlights( baselineLoader );
            }
        },
        {
            name: 'workspace-json-streaming',
            run: function()
            {
                return benchmarkWorkspaceStreaming( baselineLoader );
            }
        },
        {
            name: 'attributes-custom-highlight',
            run: function()
            {
                return benchmarkAttributes( baselineLoader );
            }
        },
        {
            name: 'workspace-incremental-rescans',
            run: function()
            {
                return benchmarkWorkspaceIncrementalRescans( baselineLoader );
            }
        },
        {
            name: 'workspace-incremental-updates',
            run: function()
            {
                return benchmarkWorkspaceIncrementalUpdates( baselineLoader );
            }
        }
    ].map( function( definition )
    {
        return Object.assign( { kind: 'microbenchmark' }, definition );
    } );
    var userFlowDefinitions = extensionScenarios.buildExtensionScenarioDefinitions( {
        repoRoot: repoRoot,
        loadCurrentModule: loadCurrentModule,
        loadBaselineModule: baselineLoader,
        createMeasurement: createMeasurement,
        createUri: createUri,
        createWorkspaceState: createWorkspaceState
    } ).map( function( definition )
    {
        return Object.assign( { kind: 'user-flow' }, definition );
    } );

    return microbenchmarkDefinitions.concat( userFlowDefinitions );
}

function validateReadmeSummaryRows( definitions )
{
    var definitionsByName = new Map( definitions.map( function( definition )
    {
        return [ definition.name, definition ];
    } ) );

    readmeSummary.SUMMARY_ROWS.forEach( function( row )
    {
        var definition = definitionsByName.get( row.scenario );

        if( definition === undefined )
        {
            throw new Error( 'README benchmark summary row references an unknown scenario: ' + row.scenario );
        }

        if( definition.kind !== 'user-flow' )
        {
            throw new Error( 'README benchmark summary row must reference a user-flow scenario: ' + row.scenario );
        }
    } );
}

function formatScenarioList( definitions )
{
    return definitions.map( function( definition )
    {
        return definition.name;
    } ).join( '\n' ) + '\n';
}

function runLocalCommand( executable, args )
{
    // stdio captures child stderr into result.stderr instead of inheriting it
    // to the parent's tty (execFileSync inherits stderr by default).
    try
    {
        return {
            ok: true,
            stdout: childProcess.execFileSync( executable, args, {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: [ 'ignore', 'pipe', 'pipe' ]
            } ).trim()
        };
    }
    catch( error )
    {
        return {
            ok: false,
            stdout: String( error.stdout || '' ).trim(),
            stderr: String( error.stderr || '' ).trim(),
            message: error.message
        };
    }
}

function getCommandError( commandResult )
{
    return ( commandResult.stderr || commandResult.stdout || commandResult.message || 'unknown error' ).trim();
}

function parseJsonCommandOutput( commandResult, propertyName )
{
    if( commandResult.ok !== true )
    {
        return {
            accessible: false,
            entries: [],
            error: getCommandError( commandResult )
        };
    }

    var parsed = JSON.parse( commandResult.stdout );
    return {
        accessible: true,
        entries: Array.isArray( parsed[ propertyName ] ) ? parsed[ propertyName ] : []
    };
}

function parseLscpuFields( entries )
{
    return entries.reduce( function( fields, entry )
    {
        var key = String( entry.field || '' ).replace( /:$/, '' ).trim();

        if( key.length > 0 )
        {
            fields[ key ] = entry.data;
        }

        return fields;
    }, {} );
}

function parseMeminfo( text )
{
    return String( text ).split( /\n/ ).reduce( function( entries, line )
    {
        var match = line.match( /^([^:]+):\s+(\d+)\s+kB$/ );

        if( match )
        {
            entries[ match[ 1 ] ] = Number( match[ 2 ] ) * 1024;
        }

        return entries;
    }, {} );
}

function parseOsRelease( text )
{
    return String( text ).split( /\n/ ).reduce( function( entries, line )
    {
        var match = line.match( /^([A-Z0-9_]+)=(.*)$/ );

        if( match )
        {
            entries[ match[ 1 ] ] = match[ 2 ].replace( /^"/, '' ).replace( /"$/, '' );
        }

        return entries;
    }, {} );
}

function flattenBlockDevices( devices, parentDisk, output )
{
    output = output || [];
    devices.forEach( function( device )
    {
        var diskParent = device.type === 'disk' ? device : parentDisk;
        output.push( {
            device: device,
            parentDisk: diskParent
        } );

        if( Array.isArray( device.children ) )
        {
            flattenBlockDevices( device.children, diskParent, output );
        }
    } );

    return output;
}

function formatBytes( value )
{
    if( Number.isFinite( value ) !== true )
    {
        return '-';
    }

    var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ];
    var unitIndex = 0;
    var current = value;

    while( current >= 1024 && unitIndex < units.length - 1 )
    {
        current /= 1024;
        unitIndex += 1;
    }

    return Number( current ).toLocaleString( 'en-US', {
        minimumFractionDigits: current >= 100 || unitIndex === 0 ? 0 : 2,
        maximumFractionDigits: current >= 100 || unitIndex === 0 ? 0 : 2
    } ) + ' ' + units[ unitIndex ];
}

function formatExactBytes( value )
{
    if( Number.isFinite( value ) !== true )
    {
        return '-';
    }

    return formatBytes( value ) + ' (`' + Number( value ).toLocaleString( 'en-US' ) + ' bytes`)';
}

function formatMHz( value )
{
    if( Number.isFinite( value ) !== true || value <= 0 )
    {
        return '-';
    }

    return Number( value ).toLocaleString( 'en-US', {
        minimumFractionDigits: value >= 100 ? 0 : 2,
        maximumFractionDigits: value >= 100 ? 0 : 2
    } ) + ' MHz';
}

function formatInlineText( value )
{
    return String( value || '' ).replace( /\s+/g, ' ' ).trim();
}

function formatUnavailable( value )
{
    return 'Unavailable: ' + formatInlineText( value || 'unknown error' );
}

function formatMachineValue( value )
{
    return typeof ( value ) === 'string' && value.length > 0 ? value : '-';
}

function buildMachineProfileRows( machine )
{
    var rows = [];
    var cpu = machine && machine.cpu ? machine.cpu : {};
    var memory = machine && machine.memory ? machine.memory : {};
    var storage = machine && machine.storage ? machine.storage : {};
    var rootDevice = storage.rootDevice;

    rows.push( '| Host | Hostname | ' + formatMachineValue( machine && machine.host && machine.host.hostname ) + ' |' );
    rows.push( '| Host | OS | ' + formatMachineValue( machine && machine.host && machine.host.osPrettyName ) + ' |' );
    rows.push( '| Host | Kernel | ' + formatMachineValue( machine && machine.host && machine.host.kernel ) + ' |' );
    rows.push( '| Host | Architecture | ' + formatMachineValue( machine && machine.host && machine.host.architecture ) + ' |' );
    rows.push( '| Host | Load Average | ' + formatMachineValue( machine && machine.host && machine.host.loadAverage ) + ' |' );
    rows.push( '| Host | Available Parallelism | ' + formatMachineValue( machine && machine.host && machine.host.availableParallelism ) + ' |' );

    if( cpu.accessible === true )
    {
        rows.push( '| CPU | Model | ' + formatMachineValue( cpu.modelName ) + ' |' );
        rows.push( '| CPU | Vendor | ' + formatMachineValue( cpu.vendorId ) + ' |' );
        rows.push(
            '| CPU | Topology | ' +
            Number( cpu.logicalCpus ).toLocaleString( 'en-US' ) + ' logical CPU(s), ' +
            Number( cpu.threadsPerCore ).toLocaleString( 'en-US' ) + ' thread(s)/core, ' +
            Number( cpu.coresPerSocket ).toLocaleString( 'en-US' ) + ' core(s)/socket, ' +
            Number( cpu.sockets ).toLocaleString( 'en-US' ) + ' socket(s), ' +
            Number( cpu.numaNodes ).toLocaleString( 'en-US' ) + ' NUMA node(s) |'
        );
        rows.push( '| CPU | Frequency | ' + formatMHz( cpu.minMHz ) + ' to ' + formatMHz( cpu.maxMHz ) + ' |' );
        rows.push( '| CPU | Cache | L1d ' + formatMachineValue( cpu.l1dCache ) + ', L1i ' + formatMachineValue( cpu.l1iCache ) + ', L2 ' + formatMachineValue( cpu.l2Cache ) + ', L3 ' + formatMachineValue( cpu.l3Cache ) + ' |' );
    }
    else
    {
        rows.push( '| CPU | Probe | ' + formatUnavailable( cpu.error ) + ' |' );
    }

    rows.push( '| Memory | Total RAM | ' + formatExactBytes( memory.totalBytes ) + ' |' );
    rows.push( '| Memory | Available At Collection | ' + formatExactBytes( memory.availableBytesAtCollection ) + ' |' );
    rows.push( '| Memory | Online Physical RAM | ' + ( memory.layoutAccessible === true ? formatExactBytes( memory.onlinePhysicalBytes ) : formatUnavailable( memory.layoutError ) ) + ' |' );
    rows.push( '| Memory | Swap | total ' + formatExactBytes( memory.swapTotalBytes ) + '; free ' + formatExactBytes( memory.swapFreeBytesAtCollection ) + ' |' );
    rows.push( '| Memory | DMI / SPD | ' + ( memory.dmi && memory.dmi.accessible === true ? formatMachineValue( memory.dmi.summary ) : formatUnavailable( memory.dmi && memory.dmi.error ) ) + ' |' );

    if( storage.accessible === true && rootDevice )
    {
        rows.push(
            '| Storage | Root Device | ' +
            formatMachineValue( rootDevice.name ) + ' (' + formatMachineValue( rootDevice.model ) + '), ' +
            formatExactBytes( rootDevice.sizeBytes ) + ', transport ' + formatMachineValue( rootDevice.transport ) +
            ', rotational=' + String( rootDevice.rotational ) + ', readOnly=' + String( rootDevice.readOnly ) + ' |'
        );
    }
    else
    {
        rows.push( '| Storage | Root Device | ' + formatUnavailable( storage.error ) + ' |' );
    }

    return rows;
}

function collectMachineSpecs()
{
    var osModule = os;
    var osRelease = parseOsRelease( fs.readFileSync( '/etc/os-release', 'utf8' ) );
    var meminfo = parseMeminfo( fs.readFileSync( '/proc/meminfo', 'utf8' ) );
    var lscpuResult = parseJsonCommandOutput( runLocalCommand( 'lscpu', [ '-J' ] ), 'lscpu' );
    var lsmemResult = parseJsonCommandOutput( runLocalCommand( 'lsmem', [ '-b', '-J' ] ), 'memory' );
    var lsblkResult = parseJsonCommandOutput( runLocalCommand( 'lsblk', [ '-b', '-J', '-o', 'NAME,MODEL,SIZE,TYPE,ROTA,TRAN,RO,MOUNTPOINTS' ] ), 'blockdevices' );
    var lscpuFields = parseLscpuFields( lscpuResult.entries );
    var flattenedBlockDevices = flattenBlockDevices( lsblkResult.entries );
    var rootEntry = flattenedBlockDevices.find( function( entry )
    {
        return Array.isArray( entry.device.mountpoints ) && entry.device.mountpoints.indexOf( '/' ) >= 0;
    } );
    var dmiMemory = runLocalCommand( 'dmidecode', [ '-t', 'memory' ] );

    return {
        host: {
            hostname: osModule.hostname(),
            osPrettyName: osRelease.PRETTY_NAME || osRelease.NAME || '-',
            kernel: osModule.release(),
            architecture: osModule.arch(),
            loadAverage: osModule.loadavg().map( function( value )
            {
                return round( value );
            } ).join( ', ' ),
            availableParallelism: typeof ( osModule.availableParallelism ) === 'function' ? osModule.availableParallelism() : osModule.cpus().length
        },
        cpu: {
            accessible: lscpuResult.accessible,
            modelName: lscpuFields[ 'Model name' ] || '-',
            vendorId: lscpuFields[ 'Vendor ID' ] || '-',
            logicalCpus: Number( lscpuFields[ 'CPU(s)' ] || 0 ),
            threadsPerCore: Number( lscpuFields[ 'Thread(s) per core' ] || 0 ),
            coresPerSocket: Number( lscpuFields[ 'Core(s) per socket' ] || 0 ),
            sockets: Number( lscpuFields[ 'Socket(s)' ] || 0 ),
            minMHz: Number( lscpuFields[ 'CPU min MHz' ] || 0 ),
            maxMHz: Number( lscpuFields[ 'CPU max MHz' ] || 0 ),
            l1dCache: lscpuFields[ 'L1d cache' ] || '-',
            l1iCache: lscpuFields[ 'L1i cache' ] || '-',
            l2Cache: lscpuFields[ 'L2 cache' ] || '-',
            l3Cache: lscpuFields[ 'L3 cache' ] || '-',
            numaNodes: Number( lscpuFields[ 'NUMA node(s)' ] || 0 ),
            error: lscpuResult.accessible === true ? undefined : lscpuResult.error
        },
        memory: {
            totalBytes: meminfo.MemTotal || 0,
            availableBytesAtCollection: meminfo.MemAvailable || 0,
            swapTotalBytes: meminfo.SwapTotal || 0,
            swapFreeBytesAtCollection: meminfo.SwapFree || 0,
            layoutAccessible: lsmemResult.accessible,
            onlinePhysicalBytes: lsmemResult.entries.reduce( function( total, entry )
            {
                return entry.state === 'online' ? total + Number( entry.size || 0 ) : total;
            }, 0 ),
            layoutError: lsmemResult.accessible === true ? undefined : lsmemResult.error,
            dmi: dmiMemory.ok === true ? {
                accessible: true,
                summary: 'Accessible'
            } : {
                accessible: false,
                error: getCommandError( dmiMemory )
            }
        },
        storage: lsblkResult.accessible === true ? {
            accessible: true,
            rootDevice: rootEntry ? {
                name: rootEntry.parentDisk.name,
                model: rootEntry.parentDisk.model || '-',
                sizeBytes: Number( rootEntry.parentDisk.size || 0 ),
                transport: rootEntry.parentDisk.tran || '-',
                rotational: rootEntry.parentDisk.rota === true || Number( rootEntry.parentDisk.rota ) === 1,
                readOnly: rootEntry.parentDisk.ro === true || Number( rootEntry.parentDisk.ro ) === 1
            } : undefined
        } : {
            accessible: false,
            error: lsblkResult.error
        }
    };
}

function collectBenchmarkMachineHealth( machine )
{
    var logicalCpus = Math.max( 1, Number( machine && machine.cpu && machine.cpu.logicalCpus ) || 1 );
    var loadAverage1 = Number( os.loadavg()[ 0 ] || 0 );
    var loadPerLogicalCpu = loadAverage1 / logicalCpus;
    var totalBytes = Number( machine && machine.memory && machine.memory.totalBytes ) || 0;
    var availableBytes = Number( machine && machine.memory && machine.memory.availableBytesAtCollection ) || 0;
    var minimumAvailableBytes = Math.max(
        MIN_BENCHMARK_AVAILABLE_MEMORY_BYTES,
        Math.floor( totalBytes * MIN_BENCHMARK_AVAILABLE_MEMORY_FRACTION )
    );
    var reasons = [];

    if( availableBytes < minimumAvailableBytes )
    {
        reasons.push(
            'available memory ' + formatBytes( availableBytes ) +
            ' is below the benchmark floor of ' + formatBytes( minimumAvailableBytes )
        );
    }

    if( loadPerLogicalCpu > MAX_BENCHMARK_LOAD_PER_LOGICAL_CPU )
    {
        reasons.push(
            '1-minute load average per logical CPU is ' + round( loadPerLogicalCpu ) +
            ' which exceeds the benchmark ceiling of ' + MAX_BENCHMARK_LOAD_PER_LOGICAL_CPU
        );
    }

    return {
        stable: reasons.length === 0,
        reasons: reasons
    };
}

function renderMarkdownReport( payload )
{
    var lines = [
        '# Runtime Benchmarks',
        '',
        '- Baseline ref: `' + payload.baselineRef + '`',
        '- Current source: working tree',
        '- Node: `' + payload.node + '`',
        '- Selection mode: `' + payload.selection.mode + '`',
        '- Declared suite: `' + payload.selection.suite + '`',
        '- Result-count validation: `' + payload.validation.resultCount + ' rows, suite-consistent=' + payload.validation.allResultsMatchSelection + ', all-user-flow=' + payload.validation.allResultsAreUserFlow + '`',
        '',
        '## Machine Profile',
        '',
        '| Category | Field | Value |',
        '| --- | --- | --- |'
    ];

    lines = lines.concat( buildMachineProfileRows( payload.machine ) );
    lines = lines.concat( [
        '',
        '## Scenario Model',
        '',
        '| Scenario | Kind | User flow | Measurement scope | Input model |',
        '| --- | --- | --- | --- | --- |'
    ] );
    lines = lines.concat( payload.results.map( function( entry )
    {
        return '| ' + entry.name +
            ' | ' + ( entry.kind || 'benchmark' ) +
            ' | ' + ( entry.userFlow || '-' ) +
            ' | ' + ( entry.measurementScope || '-' ) +
            ' | ' + ( entry.inputModel || '-' ) + ' |';
    } ) );
    lines = lines.concat( [
        '',
        '## Metric Model',
        '',
        '| Table | Value model | Accuracy model |',
        '| --- | --- | --- |',
        '| Latency | Wall-clock elapsed time around each harness flow iteration, summarized as min/p50/p90/p95/max. | Exact for each sampled iteration in this run. |',
        '| Profiled RSS Burst | Difference between the isolated scenario worker RSS measured immediately before the flow and that worker iteration\'s OS high-water-mark peak RSS. | Exact for the measured worker iteration, using `process.memoryUsage().rss` at flow start and `process.resourceUsage().maxRSS` for the peak. |',
        '| Profiled Peak RSS | Highest process RSS reached by each isolated scenario worker iteration. | Exact worker-process high-water mark from `process.resourceUsage().maxRSS`. |',
        '',
        '## Latency',
        '',
        '| Scenario | Kind | Baseline p50 ms | Current p50 ms | Baseline p90 ms | Current p90 ms | Baseline p95 ms | Current p95 ms |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    ] );
    lines = lines.concat( payload.results.map( function( entry )
    {
        return '| ' + entry.name +
            ' | ' + ( entry.kind || 'benchmark' ) +
            ' | ' + ( entry.baseline ? entry.baseline.p50Ms : '-' ) +
            ' | ' + entry.current.p50Ms +
            ' | ' + ( entry.baseline ? entry.baseline.p90Ms : '-' ) +
            ' | ' + entry.current.p90Ms +
            ' | ' + ( entry.baseline ? entry.baseline.p95Ms : '-' ) +
            ' | ' + entry.current.p95Ms + ' |';
    } ) );
    lines = lines.concat( [
        '',
        '## Profiled RSS Burst',
        '',
        '| Scenario | Kind | Baseline p50 MiB | Current p50 MiB | Baseline p90 MiB | Current p90 MiB | Baseline p95 MiB | Current p95 MiB | Baseline Max MiB | Current Max MiB |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    ] );
    lines = lines.concat( payload.results.map( function( entry )
    {
        return '| ' + entry.name +
            ' | ' + ( entry.kind || 'benchmark' ) +
            ' | ' + ( entry.baseline ? entry.baseline.rssBurstP50MiB : '-' ) +
            ' | ' + entry.current.rssBurstP50MiB +
            ' | ' + ( entry.baseline ? entry.baseline.rssBurstP90MiB : '-' ) +
            ' | ' + entry.current.rssBurstP90MiB +
            ' | ' + ( entry.baseline ? entry.baseline.rssBurstP95MiB : '-' ) +
            ' | ' + entry.current.rssBurstP95MiB +
            ' | ' + ( entry.baseline ? entry.baseline.rssBurstMaxMiB : '-' ) +
            ' | ' + entry.current.rssBurstMaxMiB + ' |';
    } ) );
    lines = lines.concat( [
        '',
        '## Profiled Peak RSS',
        '',
        '| Scenario | Kind | Baseline p50 RSS MiB | Current p50 RSS MiB | Baseline p90 RSS MiB | Current p90 RSS MiB | Baseline p95 RSS MiB | Current p95 RSS MiB | Baseline Max RSS MiB | Current Max RSS MiB |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    ] );
    lines = lines.concat( payload.results.map( function( entry )
    {
        return '| ' + entry.name +
            ' | ' + ( entry.kind || 'benchmark' ) +
            ' | ' + ( entry.baseline ? entry.baseline.peakRssP50MiB : '-' ) +
            ' | ' + entry.current.peakRssP50MiB +
            ' | ' + ( entry.baseline ? entry.baseline.peakRssP90MiB : '-' ) +
            ' | ' + entry.current.peakRssP90MiB +
            ' | ' + ( entry.baseline ? entry.baseline.peakRssP95MiB : '-' ) +
            ' | ' + entry.current.peakRssP95MiB +
            ' | ' + ( entry.baseline ? entry.baseline.peakRssMiB : '-' ) +
            ' | ' + entry.current.peakRssMiB + ' |';
    } ) );

    return lines.join( '\n' ) + '\n';
}

function createSelectionMetadata( options, selectedDefinitions )
{
    var kinds = Array.from( new Set( selectedDefinitions.map( function( definition )
    {
        return definition.kind || 'benchmark';
    } ) ) ).sort();

    return {
        mode: options.scenarioNames.length === 0 ? 'suite' : 'scenario-list',
        suite: options.scenarioNames.length === 0 ? options.suite : ( kinds.length === 1 ? kinds[ 0 ] : 'mixed' ),
        scenarios: selectedDefinitions.map( function( definition )
        {
            return definition.name;
        } ),
        kinds: kinds
    };
}

function validateResultMeasurement( measurement, label )
{
    REQUIRED_MEASUREMENT_FIELDS.forEach( function( fieldName )
    {
        if( measurement === undefined || Number.isFinite( measurement[ fieldName ] ) !== true )
        {
            throw new Error( 'Runtime benchmark result is missing numeric field `' + fieldName + '` on ' + label );
        }
    } );
}

function validateResultsForSelection( results, selection )
{
    if( Array.isArray( results ) !== true || results.length === 0 )
    {
        throw new Error( 'Runtime benchmark run produced no results.' );
    }

    results.forEach( function( result )
    {
        if( typeof ( result.name ) !== 'string' || result.name.length === 0 )
        {
            throw new Error( 'Runtime benchmark result is missing a scenario name.' );
        }

        if( typeof ( result.kind ) !== 'string' || result.kind.length === 0 )
        {
            throw new Error( 'Runtime benchmark result is missing a scenario kind for ' + result.name );
        }

        validateResultMeasurement( result.current, result.name + ' current' );
        validateResultMeasurement( result.baseline, result.name + ' baseline' );

        if( selection.suite === 'user-flow' && result.kind !== 'user-flow' )
        {
            throw new Error( 'Runtime benchmark result must be a user-flow for this selection: ' + result.name );
        }

        if( selection.suite === 'microbenchmark' && result.kind !== 'microbenchmark' )
        {
            throw new Error( 'Runtime benchmark result must be a microbenchmark for this selection: ' + result.name );
        }
    } );

    return {
        resultCount: results.length,
        allResultsMatchSelection: selection.suite === 'mixed' ? true : results.every( function( result )
        {
            return selection.suite === 'all' || result.kind === selection.suite;
        } ),
        allResultsAreUserFlow: results.every( function( result )
        {
            return result.kind === 'user-flow';
        } )
    };
}

function validateMarkdownMatchesPayload( payload, markdown )
{
    var expectedMarkdown = renderMarkdownReport( payload );

    if( markdown !== expectedMarkdown )
    {
        throw new Error( 'Runtime benchmark markdown artifact diverged from the JSON payload render.' );
    }

    return true;
}

function parseArguments( argv )
{
    var options = {
        baselineRef: process.env.BENCH_BASELINE_REF || DEFAULT_UPSTREAM_BASELINE_REF,
        scenarioNames: [],
        suite: 'user-flow',
        jsonPath: path.join( artifactRoot, 'runtime-benchmarks.json' ),
        markdownPath: path.join( artifactRoot, 'runtime-benchmarks.md' ),
        readmePath: path.join( repoRoot, 'README.md' ),
        listScenarios: false,
        updateReadme: true,
        allowUnstableMachine: false,
        workerUserFlowScenario: undefined,
        workerUserFlowVariant: undefined,
        help: false
    };
    var index;

    function requireValue( flag )
    {
        if( index + 1 >= argv.length )
        {
            throw new Error( 'Missing value for ' + flag );
        }

        index += 1;
        return argv[ index ];
    }

    function appendScenarios( value )
    {
        value.split( ',' ).map( function( item )
        {
            return item.trim();
        } ).filter( Boolean ).forEach( function( name )
        {
            options.scenarioNames.push( name );
        } );
    }

    for( index = 0; index < argv.length; ++index )
    {
        switch( argv[ index ] )
        {
        case '--baseline-ref':
            options.baselineRef = requireValue( '--baseline-ref' );
            break;
        case '--scenario':
            appendScenarios( requireValue( '--scenario' ) );
            break;
        case '--suite':
            options.suite = requireValue( '--suite' );
            break;
        case '--json-out':
            options.jsonPath = path.resolve( requireValue( '--json-out' ) );
            break;
        case '--markdown-out':
            options.markdownPath = path.resolve( requireValue( '--markdown-out' ) );
            break;
        case '--readme-path':
            options.readmePath = path.resolve( requireValue( '--readme-path' ) );
            break;
        case '--skip-readme-update':
            options.updateReadme = false;
            break;
        case '--allow-unstable-machine':
            options.allowUnstableMachine = true;
            break;
        case '--list-scenarios':
            options.listScenarios = true;
            break;
        case '--help':
        case '-h':
            options.help = true;
            break;
        case '--worker-user-flow-scenario':
            options.workerUserFlowScenario = requireValue( '--worker-user-flow-scenario' );
            break;
        case '--worker-user-flow-variant':
            options.workerUserFlowVariant = requireValue( '--worker-user-flow-variant' );
            break;
        default:
            throw new Error( 'Unknown argument: ' + argv[ index ] );
        }
    }

    return options;
}

function renderHelp()
{
    return [
        'Usage: node --expose-gc scripts/perf/run-all.js [options]',
        '',
        'Options:',
        '  --baseline-ref <ref>   Compare the working tree against <ref> (default: upstream Todo Tree merge-base or $BENCH_BASELINE_REF)',
        '  --scenario <name>      Run one scenario, or a comma-separated list; repeatable',
        '  --suite <name>        Select the default scenario suite: user-flow, microbenchmark, or all (default: user-flow)',
        '  --list-scenarios       Print the available scenario names and exit',
        '  --json-out <path>      Override the JSON artifact path',
        '  --markdown-out <path>  Override the Markdown artifact path',
        '  --readme-path <path>   Override the README path used for summary updates',
        '  --allow-unstable-machine  Run even when local load and available-memory preflight checks fail',
        '  --skip-readme-update   Do not rewrite the README benchmark summary block',
        '  --help, -h             Show this help text'
    ].join( '\n' ) + '\n';
}

async function runWorkerUserFlowIteration( options )
{
    var baselineLoader = createBaselineModuleLoader( options.baselineRef );
    var definitions = buildScenarioDefinitions( baselineLoader );
    var known = new Map( definitions.map( function( definition )
    {
        return [ definition.name, definition ];
    } ) );
    var definition = known.get( options.workerUserFlowScenario );

    if( definition === undefined )
    {
        throw new Error( 'Unknown worker user-flow scenario: ' + options.workerUserFlowScenario );
    }

    if( definition.kind !== 'user-flow' )
    {
        throw new Error( 'Worker scenario is not a user-flow: ' + options.workerUserFlowScenario );
    }

    if( options.workerUserFlowVariant !== 'current' && options.workerUserFlowVariant !== 'baseline' )
    {
        throw new Error( 'Unknown worker user-flow variant: ' + options.workerUserFlowVariant );
    }

    if( typeof ( global.gc ) === 'function' )
    {
        global.gc();
    }

    var moduleLoader = options.workerUserFlowVariant === 'current' ? loadCurrentModule : baselineLoader;
    var workerStartRssBytes = process.memoryUsage().rss;
    var iterationStart = process.hrtime.bigint();
    var lastValue;

    lastValue = await definition.runVariant( moduleLoader );

    var elapsedMs = Number( process.hrtime.bigint() - iterationStart ) / 1000000;
    var profiledPeakRssBytes = resourceMaxRssToBytes( process.resourceUsage().maxRSS );

    return {
        elapsedMs: round( elapsedMs ),
        workerStartRssBytes: workerStartRssBytes,
        profiledPeakRssBytes: profiledPeakRssBytes,
        peakAdditionalRssBytes: Math.max( 0, profiledPeakRssBytes - workerStartRssBytes ),
        lastValue: lastValue
    };
}

function selectScenarioDefinitions( definitions, scenarioNames )
{
    var known = new Map( definitions.map( function( definition )
    {
        return [ definition.name, definition ];
    } ) );
    var selected = scenarioNames.length === 0 ?
        definitions :
        scenarioNames.map( function( name )
        {
            if( known.has( name ) !== true )
            {
                throw new Error( 'Unknown scenario: ' + name );
            }

            return known.get( name );
        } );

    return selected;
}

function filterScenarioDefinitionsBySuite( definitions, suite )
{
    if( suite === 'all' )
    {
        return definitions.slice();
    }

    if( suite === 'user-flow' || suite === 'microbenchmark' )
    {
        return definitions.filter( function( definition )
        {
            return definition.kind === suite;
        } );
    }

    throw new Error( 'Unknown suite: ' + suite );
}

async function main()
{
    var options = parseArguments( process.argv.slice( 2 ) );

    if( options.workerUserFlowScenario )
    {
        process.stdout.write( JSON.stringify( await runWorkerUserFlowIteration( options ) ) + '\n' );
        return;
    }

    var baselineLoader = createBaselineModuleLoader( options.baselineRef );
    var definitions = buildScenarioDefinitions( baselineLoader );
    validateReadmeSummaryRows( definitions );

    if( options.help === true )
    {
        process.stdout.write( renderHelp() );
        return;
    }

    if( options.listScenarios === true )
    {
        process.stdout.write( formatScenarioList( definitions ) );
        return;
    }

    ensureDirectory( artifactRoot );
    ensureDirectory( path.dirname( options.jsonPath ) );
    ensureDirectory( path.dirname( options.markdownPath ) );

    var machine = collectMachineSpecs();
    var machineHealth = collectBenchmarkMachineHealth( machine );

    if( machineHealth.stable !== true && options.allowUnstableMachine !== true )
    {
        throw new Error( 'Benchmark machine preflight failed: ' + machineHealth.reasons.join( '; ' ) );
    }

    var selectedDefinitions = options.scenarioNames.length === 0 ?
        filterScenarioDefinitionsBySuite( definitions, options.suite ) :
        selectScenarioDefinitions( definitions, options.scenarioNames );
    var results = [];
    var index;

    for( index = 0; index < selectedDefinitions.length; ++index )
    {
        var scenarioStartedAt = process.hrtime.bigint();

        tracePerf(
            '[perf] (' + ( index + 1 ) + '/' + selectedDefinitions.length + ') ' +
            selectedDefinitions[ index ].name + ' start\n'
        );

        var result = selectedDefinitions[ index ].kind === 'user-flow' ?
            await runProfiledUserFlowScenario( selectedDefinitions[ index ], options.baselineRef ) :
            await selectedDefinitions[ index ].run();
        result.kind = selectedDefinitions[ index ].kind || 'benchmark';
        result.userFlow = selectedDefinitions[ index ].userFlow || '';
        result.measurementScope = selectedDefinitions[ index ].measurementScope || '';
        result.inputModel = selectedDefinitions[ index ].inputModel || '';
        results.push( result );

        var elapsedMs = Number( ( process.hrtime.bigint() - scenarioStartedAt ) / 1000000n );
        tracePerf(
            '[perf] (' + ( index + 1 ) + '/' + selectedDefinitions.length + ') ' +
            selectedDefinitions[ index ].name + ' done in ' + elapsedMs + 'ms\n'
        );
    }

    var selection = createSelectionMetadata( options, selectedDefinitions );
    var validation = validateResultsForSelection( results, selection );
    var payload = {
        generatedAt: new Date().toISOString(),
        node: process.version,
        baselineRef: options.baselineRef,
        selection: selection,
        machine: machine,
        measurementModel: {
            latency: {
                valueModel: 'Wall-clock elapsed time around each harness flow iteration.',
                summary: 'Min, p50, p90, p95, and max across the recorded iterations.',
                accuracy: 'Exact for each sampled iteration in this run.'
            },
            profiledRssBurst: {
                valueModel: 'Difference between the isolated scenario worker RSS measured immediately before the flow and that worker iteration\'s peak RSS.',
                startSource: 'process.memoryUsage().rss',
                peakSource: 'process.resourceUsage().maxRSS',
                accuracy: 'Exact for the measured worker iteration.'
            },
            profiledPeakRss: {
                valueModel: 'Highest process RSS reached by the isolated scenario worker iteration.',
                peakSource: 'process.resourceUsage().maxRSS',
                accuracy: 'Exact worker-process OS high-water mark.'
            }
        },
        validation: validation,
        results: results
    };

    fs.writeFileSync( options.jsonPath, JSON.stringify( payload, null, 2 ) + '\n' );
    var renderedMarkdown = renderMarkdownReport( payload );
    fs.writeFileSync( options.markdownPath, renderedMarkdown );
    validateMarkdownMatchesPayload( payload, fs.readFileSync( options.markdownPath, 'utf8' ) );

    if( options.updateReadme === true && readmeSummary.canRenderReadmeBenchmarkSummary( payload ) === true )
    {
        fs.writeFileSync(
            options.readmePath,
            readmeSummary.updateReadmeBenchmarkSummary(
                fs.readFileSync( options.readmePath, 'utf8' ),
                payload
            )
        );
    }

    process.stdout.write( JSON.stringify( payload, null, 2 ) + '\n' );
}

module.exports.percentile = percentile;
module.exports.round = round;
module.exports.createSeriesSummary = createSeriesSummary;
module.exports.collectMachineSpecs = collectMachineSpecs;
module.exports.collectBenchmarkMachineHealth = collectBenchmarkMachineHealth;
module.exports.renderMarkdownReport = renderMarkdownReport;
module.exports.createSelectionMetadata = createSelectionMetadata;
module.exports.filterScenarioDefinitionsBySuite = filterScenarioDefinitionsBySuite;
module.exports.validateResultsForSelection = validateResultsForSelection;
module.exports.validateMarkdownMatchesPayload = validateMarkdownMatchesPayload;
module.exports.validateReadmeSummaryRows = validateReadmeSummaryRows;

if( require.main === module )
{
    main().catch( function( error )
    {
        process.stderr.write( error.stack + '\n' );
        process.exitCode = 1;
    } );
}
