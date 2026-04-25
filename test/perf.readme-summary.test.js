var QUnit = require( 'qunit' );
var readmeSummary = require( '../scripts/perf/readmeSummary.js' );

function createPayload()
{
    return {
        baselineRef: 'refs/test',
        node: 'v24.8.0',
        results: [
            {
                name: 'open-file-custom-save-rescan-visible-tree',
                baseline: { p50Ms: 126.73 },
                current: { p50Ms: 3.52 }
            },
            {
                name: 'visible-editor-highlight-open-file',
                baseline: { p50Ms: 17.41 },
                current: { p50Ms: 1.89 }
            },
            {
                name: 'visible-editor-custom-highlight-config-open-file',
                baseline: { p50Ms: 1445.64 },
                current: { p50Ms: 4.21 }
            },
            {
                name: 'visible-editor-highlight-change-open-file',
                baseline: { p50Ms: 24.86 },
                current: { p50Ms: 1.92 }
            },
            {
                name: 'workspace-custom-relative-rebuild-visible-tree',
                baseline: { p50Ms: 44.39, rssBurstMaxMiB: 7.88, peakRssMiB: 181.55 },
                current: { p50Ms: 25.30, rssBurstMaxMiB: 0.63, peakRssMiB: 142.88 }
            },
            {
                name: 'open-file-default-save-rescan-visible-tree',
                baseline: { p50Ms: 106.36 },
                current: { p50Ms: 2.12 }
            }
        ]
    };
}

QUnit.module( 'perf readme summary' );

QUnit.test( 'renderReadmeBenchmarkSummary preserves the hero-table style and emoji tiers', function( assert )
{
    var rendered = readmeSummary.renderReadmeBenchmarkSummary( createPayload() );

    assert.ok( rendered.indexOf( '**Made TODO rescans 50.2X faster (so you don\'t have time to feel guilty for not fixing them... 🥀)**' ) >= 0 );
    assert.ok( rendered.indexOf( '| Target | Before | After | Speed/Efficiency Gain |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Custom Regex Rescans** | 126.73 ms | 3.52 ms | **36.0X** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Visible Editor Highlights** | 17.41 ms | 1.89 ms | **9.2X** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Custom Highlight Configs** | 1,445.64 ms | 4.21 ms | **343.4X** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Editor Highlight Refreshes** | 24.86 ms | 1.92 ms | **12.9X** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Custom Regex Workspace Refreshes** | 44.39 ms | 25.30 ms | **1.8X** 🔥 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Visible File Rescans** | 106.36 ms | 2.12 ms | **50.2X** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Workspace Refresh RSS Burst (Peak Gain)** | 7.88 MiB | 0.63 MiB | **92.0% less** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Workspace Refresh Peak RSS** | 181.55 MiB | 142.88 MiB | **21.3% less** 🔥 |' ) >= 0 );
    assert.ok( rendered.indexOf( '... And it\'s just getting warmed up!' ) >= 0 );
} );

QUnit.test( 'renderReadmeBenchmarkSummary picks the highest meaningful TODO-rescan speed gain for the headline', function( assert )
{
    var rendered = readmeSummary.renderReadmeBenchmarkSummary( createPayload() );

    assert.ok( rendered.indexOf( 'TODO rescans 50.2X faster' ) >= 0 );
    assert.ok( rendered.indexOf( 'highlight passes' ) === -1 );
} );

QUnit.test( 'updateReadmeBenchmarkSummary replaces only the marked benchmark block', function( assert )
{
    var original = [
        '# Better Todo Tree',
        '',
        readmeSummary.SUMMARY_START_MARKER,
        'stale benchmark summary',
        readmeSummary.SUMMARY_END_MARKER,
        '',
        'tail content'
    ].join( '\n' );
    var updated = readmeSummary.updateReadmeBenchmarkSummary( original, createPayload() );

    assert.ok( updated.indexOf( 'stale benchmark summary' ) === -1 );
    assert.ok( updated.indexOf( readmeSummary.SUMMARY_START_MARKER ) >= 0 );
    assert.ok( updated.indexOf( readmeSummary.SUMMARY_END_MARKER ) >= 0 );
    assert.ok( updated.indexOf( 'tail content' ) >= 0 );
} );

QUnit.test( 'renderReadmeBenchmarkSummary uses the poker-face tier for flat or worse regressions', function( assert )
{
    var payload = createPayload();
    payload.results = payload.results.map( function( entry )
    {
        if( entry.name === 'open-file-default-save-rescan-visible-tree' )
        {
            return {
                name: entry.name,
                baseline: { p50Ms: 100 },
                current: { p50Ms: 125 }
            };
        }

        return entry;
    } );

    var rendered = readmeSummary.renderReadmeBenchmarkSummary( payload );

    assert.ok( rendered.indexOf( '| **Visible File Rescans** | 100.00 ms | 125.00 ms | **0.80X** 😐 |' ) >= 0 );
} );

QUnit.test( 'renderReadmeBenchmarkSummary formats eliminated efficiency spikes without infinity ratios', function( assert )
{
    var payload = createPayload();
    payload.results = payload.results.map( function( entry )
    {
        if( entry.name === 'workspace-custom-relative-rebuild-visible-tree' )
        {
            return {
                name: entry.name,
                baseline: { p50Ms: 44.39, rssBurstMaxMiB: 16.25, peakRssMiB: 181.55 },
                current: { p50Ms: 25.30, rssBurstMaxMiB: 0, peakRssMiB: 0 }
            };
        }

        return entry;
    } );

    var rendered = readmeSummary.renderReadmeBenchmarkSummary( payload );

    assert.ok( rendered.indexOf( '| **Workspace Refresh RSS Burst (Peak Gain)** | 16.25 MiB | 0.00 MiB | **100.0% less** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '| **Workspace Refresh Peak RSS** | 181.55 MiB | 0.00 MiB | **100.0% less** 🚀 |' ) >= 0 );
    assert.ok( rendered.indexOf( '∞X' ) === -1 );
} );

QUnit.test( 'renderReadmeBenchmarkSummary falls back to the first headlineTarget row when no speed gain is present', function( assert )
{
    var payload = createPayload();
    payload.results = payload.results.map( function( entry )
    {
        if( entry.name === 'open-file-custom-save-rescan-visible-tree' )
        {
            return {
                name: entry.name,
                baseline: { p50Ms: 1 },
                current: { p50Ms: 1 }
            };
        }
        if( entry.name === 'open-file-default-save-rescan-visible-tree' )
        {
            return {
                name: entry.name,
                baseline: { p50Ms: 1 },
                current: { p50Ms: 1 }
            };
        }
        return entry;
    } );

    var rendered = readmeSummary.renderReadmeBenchmarkSummary( payload );

    assert.ok( rendered.indexOf( '**Made TODO rescans 1.0X faster' ) >= 0, 'flat baseline still renders the headlineTarget from the first headline-eligible row' );
} );
