var QUnit = require( 'qunit' );
var perfRunner = require( '../scripts/perf/run-all.js' );

function createMachineProfile()
{
    return {
        host: {
            hostname: 'test-host',
            osPrettyName: 'Test OS 1.0',
            kernel: '1.2.3-test',
            architecture: 'x64'
        },
        cpu: {
            accessible: true,
            modelName: 'Test CPU',
            vendorId: 'GenuineTest',
            logicalCpus: 16,
            threadsPerCore: 2,
            coresPerSocket: 8,
            sockets: 1,
            minMHz: 800,
            maxMHz: 5800,
            l1dCache: '384 KiB',
            l1iCache: '256 KiB',
            l2Cache: '16 MiB',
            l3Cache: '36 MiB',
            numaNodes: 1
        },
        memory: {
            totalBytes: 67119828992,
            availableBytesAtCollection: 34359738368,
            swapTotalBytes: 8589934592,
            swapFreeBytesAtCollection: 4294967296,
            layoutAccessible: true,
            onlinePhysicalBytes: 70866960384,
            dmi: {
                accessible: false,
                error: 'Permission denied'
            }
        },
        storage: {
            accessible: true,
            rootDevice: {
                name: 'nvme0n1',
                model: 'Test SSD',
                sizeBytes: 4000787030016,
                transport: 'nvme',
                rotational: false,
                readOnly: false
            }
        }
    };
}

function createMeasurement( values )
{
    return Object.assign( {
        p50Ms: 0,
        p90Ms: 0,
        p95Ms: 0,
        peakRssP50MiB: 0,
        peakRssP90MiB: 0,
        peakRssP95MiB: 0,
        peakRssMiB: 0,
        rssBurstP50MiB: 0,
        rssBurstP90MiB: 0,
        rssBurstP95MiB: 0,
        rssBurstMaxMiB: 0
    }, values );
}

QUnit.module( 'perf runtime benchmarks' );

QUnit.test( 'createSeriesSummary returns p50 p90 p95 and max for sorted metrics', function( assert )
{
    var summary = perfRunner.createSeriesSummary( [ 5, 1, 3, 2, 4, 10, 8, 6, 9, 7 ] );

    assert.deepEqual( summary, {
        min: 1,
        p50: 5,
        p90: 9,
        p95: 10,
        max: 10,
        samples: [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
    } );
} );

QUnit.test( 'renderMarkdownReport includes exact machine latency burst and peak sections', function( assert )
{
    var payload = {
        baselineRef: 'refs/test',
        node: 'v24.8.0',
        machine: createMachineProfile(),
        selection: {
            mode: 'suite',
            suite: 'user-flow',
            scenarios: [ 'visible-flow' ],
            kinds: [ 'user-flow' ]
        },
        validation: {
            resultCount: 1,
            allResultsMatchSelection: true,
            allResultsAreUserFlow: true
        },
        results: [
            {
                name: 'visible-flow',
                kind: 'user-flow',
                userFlow: 'Open a visible editor and apply highlights.',
                measurementScope: 'Highlight event handling and decoration application.',
                inputModel: 'Fixture scan results in a VS Code event harness.',
                baseline: createMeasurement( {
                    p50Ms: 100,
                    p90Ms: 120,
                    p95Ms: 125,
                    peakRssP50MiB: 240,
                    peakRssP90MiB: 250,
                    peakRssP95MiB: 254,
                    peakRssMiB: 256,
                    rssBurstP50MiB: 8,
                    rssBurstP90MiB: 12,
                    rssBurstP95MiB: 14,
                    rssBurstMaxMiB: 16
                } ),
                current: createMeasurement( {
                    p50Ms: 5,
                    p90Ms: 7,
                    p95Ms: 8,
                    peakRssP50MiB: 210,
                    peakRssP90MiB: 216,
                    peakRssP95MiB: 219,
                    peakRssMiB: 220,
                    rssBurstP50MiB: 0.5,
                    rssBurstP90MiB: 1,
                    rssBurstP95MiB: 1.1,
                    rssBurstMaxMiB: 1.25
                } )
            }
        ]
    };
    var rendered = perfRunner.renderMarkdownReport( payload );

    assert.ok( rendered.indexOf( '## Machine Profile' ) >= 0 );
    assert.ok( rendered.indexOf( '| Host | Hostname | test-host |' ) >= 0 );
    assert.ok( rendered.indexOf( '| CPU | Model | Test CPU |' ) >= 0 );
    assert.ok( rendered.indexOf( '| Memory | DMI / SPD | Unavailable: Permission denied |' ) >= 0 );
    assert.ok( rendered.indexOf( '## Scenario Model' ) >= 0 );
    assert.ok( rendered.indexOf( '## Metric Model' ) >= 0 );
    assert.ok( rendered.indexOf( '## Latency' ) >= 0 );
    assert.ok( rendered.indexOf( '## Profiled RSS Burst' ) >= 0 );
    assert.ok( rendered.indexOf( '## Profiled Peak RSS' ) >= 0 );
    assert.ok( rendered.indexOf( '| visible-flow | user-flow | 100 | 5 | 120 | 7 | 125 | 8 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| visible-flow | user-flow | 8 | 0.5 | 12 | 1 | 14 | 1.1 | 16 | 1.25 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| visible-flow | user-flow | 240 | 210 | 250 | 216 | 254 | 219 | 256 | 220 |' ) >= 0 );
    assert.equal( rendered.indexOf( 'Burst Duration' ), -1 );
    assert.equal( rendered.indexOf( 'estimated from sampled RSS points' ), -1 );
} );

QUnit.test( 'validateResultsForSelection rejects non-user-flow rows in a user-flow selection', function( assert )
{
    var selection = {
        mode: 'suite',
        suite: 'user-flow',
        scenarios: [ 'micro-a' ],
        kinds: [ 'microbenchmark' ]
    };
    var results = [
        {
            name: 'micro-a',
            kind: 'microbenchmark',
            baseline: createMeasurement( { p50Ms: 1, p90Ms: 1, p95Ms: 1, peakRssP50MiB: 1, peakRssP90MiB: 1, peakRssP95MiB: 1, peakRssMiB: 1 } ),
            current: createMeasurement( { p50Ms: 1, p90Ms: 1, p95Ms: 1, peakRssP50MiB: 1, peakRssP90MiB: 1, peakRssP95MiB: 1, peakRssMiB: 1 } )
        }
    ];

    assert.throws( function()
    {
        perfRunner.validateResultsForSelection( results, selection );
    }, /must be a user-flow/ );
} );

QUnit.test( 'validateMarkdownMatchesPayload accepts the exact markdown render', function( assert )
{
    var payload = {
        baselineRef: 'refs/test',
        node: 'v24.8.0',
        machine: createMachineProfile(),
        selection: {
            mode: 'suite',
            suite: 'user-flow',
            scenarios: [ 'visible-flow' ],
            kinds: [ 'user-flow' ]
        },
        validation: {
            resultCount: 1,
            allResultsMatchSelection: true,
            allResultsAreUserFlow: true
        },
        results: [
            {
                name: 'visible-flow',
                kind: 'user-flow',
                userFlow: 'Open a visible editor and apply highlights.',
                measurementScope: 'Highlight event handling and decoration application.',
                inputModel: 'Fixture scan results in a VS Code event harness.',
                baseline: createMeasurement( {
                    p50Ms: 100,
                    p90Ms: 120,
                    p95Ms: 125,
                    peakRssP50MiB: 240,
                    peakRssP90MiB: 250,
                    peakRssP95MiB: 254,
                    peakRssMiB: 256,
                    rssBurstP50MiB: 8,
                    rssBurstP90MiB: 12,
                    rssBurstP95MiB: 14,
                    rssBurstMaxMiB: 16
                } ),
                current: createMeasurement( {
                    p50Ms: 5,
                    p90Ms: 7,
                    p95Ms: 8,
                    peakRssP50MiB: 210,
                    peakRssP90MiB: 216,
                    peakRssP95MiB: 219,
                    peakRssMiB: 220,
                    rssBurstP50MiB: 0.5,
                    rssBurstP90MiB: 1,
                    rssBurstP95MiB: 1.1,
                    rssBurstMaxMiB: 1.25
                } )
            }
        ]
    };
    var rendered = perfRunner.renderMarkdownReport( payload );

    assert.true( perfRunner.validateMarkdownMatchesPayload( payload, rendered ) );
} );

QUnit.test( 'filterScenarioDefinitionsBySuite selects only the requested suite', function( assert )
{
    var definitions = [
        { name: 'flow-a', kind: 'user-flow' },
        { name: 'flow-b', kind: 'user-flow' },
        { name: 'micro-a', kind: 'microbenchmark' }
    ];

    assert.deepEqual(
        perfRunner.filterScenarioDefinitionsBySuite( definitions, 'user-flow' ).map( function( definition ) { return definition.name; } ),
        [ 'flow-a', 'flow-b' ]
    );
    assert.deepEqual(
        perfRunner.filterScenarioDefinitionsBySuite( definitions, 'microbenchmark' ).map( function( definition ) { return definition.name; } ),
        [ 'micro-a' ]
    );
    assert.deepEqual(
        perfRunner.filterScenarioDefinitionsBySuite( definitions, 'all' ).map( function( definition ) { return definition.name; } ),
        [ 'flow-a', 'flow-b', 'micro-a' ]
    );
} );

QUnit.test( 'validateReadmeSummaryRows rejects summary mappings to microbenchmarks', function( assert )
{
    var definitions = [
        { name: 'open-file-custom-save-rescan-visible-tree', kind: 'user-flow' },
        { name: 'visible-editor-highlight-open-file', kind: 'user-flow' },
        { name: 'visible-editor-custom-highlight-config-open-file', kind: 'user-flow' },
        { name: 'visible-editor-highlight-change-open-file', kind: 'user-flow' },
        { name: 'workspace-custom-relative-rebuild-visible-tree', kind: 'microbenchmark' },
        { name: 'open-file-default-save-rescan-visible-tree', kind: 'user-flow' }
    ];

    assert.throws( function()
    {
        perfRunner.validateReadmeSummaryRows( definitions );
    }, /must reference a user-flow scenario/ );
} );

QUnit.test( 'collectBenchmarkMachineHealth rejects overloaded machine states', function( assert )
{
    var health = perfRunner.collectBenchmarkMachineHealth( {
        cpu: {
            logicalCpus: 8
        },
        memory: {
            totalBytes: 64 * 1024 * 1024 * 1024,
            availableBytesAtCollection: 2 * 1024 * 1024 * 1024
        }
    } );

    assert.equal( health.stable, false );
    assert.ok( health.reasons.some( function( reason ) { return reason.indexOf( 'available memory' ) >= 0; } ) );
} );

QUnit.test( 'collectMachineSpecs does not leak child stderr to the parent process', function( assert )
{
    var path = require( 'path' );
    var childProcess = require( 'child_process' );
    var runAllPath = path.resolve( __dirname, '..', 'scripts', 'perf', 'run-all.js' );
    var probeScript =
        'var perf = require(' + JSON.stringify( runAllPath ) + ');' +
        'var specs = perf.collectMachineSpecs();' +
        'process.stdout.write(JSON.stringify({ ' +
            'dmiAccessible: specs.memory.dmi.accessible, ' +
            'dmiHasError: typeof specs.memory.dmi.error === "string" && specs.memory.dmi.error.length > 0 ' +
        '}));';

    var result = childProcess.spawnSync( process.execPath, [ '-e', probeScript ], {
        cwd: path.resolve( __dirname, '..' ),
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    } );

    assert.equal( result.status, 0, 'probe script exits 0; stderr=' + JSON.stringify( result.stderr ) );

    var parsed = JSON.parse( result.stdout );
    assert.equal( typeof parsed.dmiAccessible, 'boolean', 'dmi.accessible is boolean' );

    if( parsed.dmiAccessible === false )
    {
        assert.ok( parsed.dmiHasError, 'when dmi is inaccessible, an error string is recorded on the result' );
        assert.equal(
            result.stderr,
            '',
            'failing dmidecode probes do NOT leak Permission-denied messages to parent stderr; got: ' + JSON.stringify( result.stderr )
        );
    }
    else
    {
        assert.equal(
            result.stderr,
            '',
            'successful dmidecode probes do not leak any stderr; got: ' + JSON.stringify( result.stderr )
        );
    }
} );

QUnit.test( 'PERF_TRACE_SCENARIOS defaults ON so long benchmark runs surface progress', function( assert )
{
    var fs = require( 'fs' );
    var path = require( 'path' );
    var runAllSource = fs.readFileSync(
        path.resolve( __dirname, '..', 'scripts', 'perf', 'run-all.js' ),
        'utf8'
    );

    assert.ok(
        runAllSource.indexOf( "process.env.PERF_TRACE_SCENARIOS !== '0'" ) >= 0,
        'module treats absent or non-"0" PERF_TRACE_SCENARIOS as enabled (opt-out, not opt-in)'
    );
    assert.equal(
        runAllSource.indexOf( "process.env.PERF_TRACE_SCENARIOS === '1'" ),
        -1,
        'no remaining gate that requires PERF_TRACE_SCENARIOS=1 to surface progress'
    );
    assert.ok(
        /\[perf\] \(' \+ \( index \+ 1 \) \+ '\/' \+ selectedDefinitions\.length/.test( runAllSource ),
        'scenario-level progress lines include the running scenario index out of the total count'
    );
    assert.ok(
        /' done in ' \+ elapsedMs \+ 'ms\\n'/.test( runAllSource ),
        'scenario-level completion lines include the per-scenario wall-clock duration'
    );
    assert.ok(
        /\[perf\]   ' \+ definition\.name \+ ' latency '/.test( runAllSource ),
        'long-running user-flow scenarios emit per-iteration latency progress so they cannot be confused with hangs'
    );
    assert.ok(
        /\[perf\]   ' \+ definition\.name \+ ' memory '/.test( runAllSource ),
        'long-running user-flow scenarios emit per-iteration memory-profiling progress'
    );
    assert.ok(
        /PERF_TRACE_SCENARIOS:\s*'0'/.test( runAllSource ),
        'isolated user-flow worker subprocesses set PERF_TRACE_SCENARIOS=0 so only the orchestrator emits progress'
    );
} );

QUnit.test( 'justfile node_bootstrap re-anchors NVM_DIR onto $SUDO_USER home when run under sudo', function( assert )
{
    var fs = require( 'fs' );
    var path = require( 'path' );
    var justfile = fs.readFileSync( path.resolve( __dirname, '..', 'justfile' ), 'utf8' );

    assert.ok(
        justfile.indexOf( 'SUDO_USER' ) >= 0,
        'justfile node_bootstrap references $SUDO_USER for sudo-aware nvm discovery'
    );
    assert.ok(
        /getent passwd\s+"\$SUDO_USER"/.test( justfile ),
        'justfile resolves $SUDO_USER home directory via getent passwd'
    );
    assert.ok(
        /\/home\/linuxbrew\/\.linuxbrew\/bin\/node/.test( justfile ),
        'justfile node_bootstrap surfaces linuxbrew node when sudo strips PATH (secure_path)'
    );
} );

QUnit.test( 'extensionScenarios.instrumentProvider does not alias caller results into the wrapped add() loop', function( assert )
{
    var fs = require( 'fs' );
    var path = require( 'path' );
    var harnessSource = fs.readFileSync(
        path.resolve( __dirname, '..', 'scripts', 'perf', 'extensionScenarios.js' ),
        'utf8'
    );

    var instrumentBody = harnessSource.match( /function instrumentProvider\([\s\S]*?return provider;\s*\}/ );
    assert.ok( instrumentBody, 'instrumentProvider is defined' );

    if( instrumentBody )
    {
        var body = instrumentBody[ 0 ];
        assert.equal(
            /provider\.replaceDocument\s*=\s*function\([^)]*\)\s*\{[^}]*var entry\s*=\s*\{\s*uri:\s*uri,\s*results:\s*results\s*\}/.test( body ),
            false,
            'wrapped replaceDocument MUST NOT alias the caller-supplied results array (would mutate the searchResults stub via the wrapped add() iterating callback)'
        );
        assert.ok(
            /provider\.replaceDocument\s*=\s*function\([^)]*\)\s*\{[\s\S]*?var entry\s*=\s*\{\s*uri:\s*uri,\s*results:\s*\[\]\s*\}/.test( body ),
            'wrapped replaceDocument starts entry.results as a fresh empty array; the originalReplaceDocument iterations populate it via wrapped add()'
        );
    }

    var stubBody = harnessSource.match( /function createProviderStub\(\)[\s\S]*?return\s*\{[\s\S]*?\};\s*\}/ );
    assert.ok( stubBody, 'createProviderStub is defined' );

    if( stubBody )
    {
        var stub = stubBody[ 0 ];
        assert.equal(
            /replaceDocument:\s*function\([^)]*\)\s*\{[^}]*var entry\s*=\s*\{\s*uri:\s*uri,\s*results:\s*results\s*\}/.test( stub ),
            false,
            'createProviderStub.replaceDocument MUST NOT alias the caller-supplied results array'
        );
        assert.ok(
            /replaceDocument:\s*function\([^)]*\)\s*\{[\s\S]*?results\.slice\(\)/.test( stub ),
            'createProviderStub.replaceDocument defensively copies the caller-supplied results array'
        );
    }
} );

QUnit.test( 'instrumentProvider preserves bounded provider state across repeated view-mode refreshes', function( assert )
{
    var done = assert.async();
    var path = require( 'path' );
    var fs = require( 'fs' );
    var Module = require( 'module' );
    var extensionScenarios = require( '../scripts/perf/extensionScenarios.js' );

    var BASELINE_REF = 'a6f60e0ce830c4649ac34fc05e5a1799ec91d151';
    var runAllPath = path.resolve( __dirname, '..', 'scripts', 'perf', 'run-all.js' );
    var instrumentedSrc = fs.readFileSync( runAllPath, 'utf8' )
        .replace( /if\(\s*require\.main\s*===\s*module\s*\)\s*\{[\s\S]*?\}\s*$/m, '' )
        + '\n\nmodule.exports.__internal = {' +
        'loadCurrentModule, createBaselineModuleLoader, createUri, createWorkspaceState' +
        '};\n';
    var m = new Module( runAllPath, module );
    m.filename = runAllPath;
    m.paths = Module._nodeModulePaths( path.dirname( runAllPath ) );
    m._compile( instrumentedSrc, runAllPath );
    var internal = m.exports.__internal;

    var defs = extensionScenarios.buildExtensionScenarioDefinitions( {
        repoRoot: path.resolve( __dirname, '..' ),
        loadCurrentModule: internal.loadCurrentModule,
        loadBaselineModule: internal.createBaselineModuleLoader( BASELINE_REF ),
        createMeasurement: function() { return {}; },
        createUri: internal.createUri,
        createWorkspaceState: internal.createWorkspaceState
    } );
    var def = defs.find( function( d ) { return d.name === 'tree-view-cycle-visible-tree'; } );

    ( async function()
    {
        var fixture = def.createFixture();
        var harness = await def.setupHarness( internal.loadCurrentModule, fixture );
        var sizes = [];
        var origReplace = harness.provider.replaceDocument;
        harness.provider.replaceDocument = function( uri, results )
        {
            sizes.push( results.length );
            return origReplace.apply( this, arguments );
        };

        var iterationDurations = [];
        for( var i = 0; i < 4; ++i )
        {
            var t0 = process.hrtime.bigint();
            def.resetHarnessMetrics( harness );
            await def.runFlow( harness, fixture );
            iterationDurations.push( Number( ( process.hrtime.bigint() - t0 ) / 1000000n ) );
        }

        var maxSize = Math.max.apply( null, sizes );
        var minSize = Math.min.apply( null, sizes );
        assert.ok(
            maxSize <= minSize * 2,
            'replaceDocument input size stays bounded across repeated view-mode refreshes (max=' +
                maxSize + ', min=' + minSize + ')'
        );

        var lastDuration = iterationDurations[ iterationDurations.length - 1 ];
        var firstDuration = Math.max( iterationDurations[ 0 ], 1 );
        assert.ok(
            lastDuration <= firstDuration * 4,
            'runFlow wall time stays within 4x of the first iteration (durations=' + JSON.stringify( iterationDurations ) + ')'
        );
    } )().then( done, function( error ) { assert.ok( false, error.stack || error ); done(); } );
} );
