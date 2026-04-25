'use strict';

var SUMMARY_START_MARKER = '<!-- README_BENCHMARK_SUMMARY:START -->';
var SUMMARY_END_MARKER = '<!-- README_BENCHMARK_SUMMARY:END -->';

var SUMMARY_ROWS = Object.freeze( [
    {
        category: 'speed',
        scenario: 'open-file-custom-save-rescan-visible-tree',
        label: '**Custom Regex Rescans**',
        metric: 'p50Ms',
        format: 'ms',
        headlineTarget: 'TODO rescans',
    },
    {
        category: 'speed',
        scenario: 'visible-editor-highlight-open-file',
        label: '**Visible Editor Highlights**',
        metric: 'p50Ms',
        format: 'ms',
    },
    {
        category: 'speed',
        scenario: 'visible-editor-custom-highlight-config-open-file',
        label: '**Custom Highlight Configs**',
        metric: 'p50Ms',
        format: 'ms',
    },
    {
        category: 'speed',
        scenario: 'visible-editor-highlight-change-open-file',
        label: '**Editor Highlight Refreshes**',
        metric: 'p50Ms',
        format: 'ms',
    },
    {
        category: 'speed',
        scenario: 'workspace-custom-relative-rebuild-visible-tree',
        label: '**Custom Regex Workspace Refreshes**',
        metric: 'p50Ms',
        format: 'ms',
    },
    {
        category: 'speed',
        scenario: 'open-file-default-save-rescan-visible-tree',
        label: '**Visible File Rescans**',
        metric: 'p50Ms',
        format: 'ms',
        headlineTarget: 'TODO rescans',
    },
    {
        category: 'efficiency',
        scenario: 'workspace-custom-relative-rebuild-visible-tree',
        label: '**Workspace Refresh RSS Burst (Peak Gain)**',
        metric: 'rssBurstMaxMiB',
        format: 'mib',
    },
    {
        category: 'efficiency',
        scenario: 'workspace-custom-relative-rebuild-visible-tree',
        label: '**Workspace Refresh Peak RSS**',
        metric: 'peakRssMiB',
        format: 'mib',
    }
] );

function getResultByScenario( payload, scenario )
{
    return ( payload.results || [] ).find( function( entry )
    {
        return entry.name === scenario;
    } );
}

function canRenderReadmeBenchmarkSummary( payload )
{
    return SUMMARY_ROWS.every( function( row )
    {
        var result = getResultByScenario( payload, row.scenario );
        return result && result.current && result.baseline;
    } );
}

function formatFixedNumber( value )
{
    return Number( value ).toLocaleString( 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    } );
}

function formatPercentNumber( value )
{
    return Number( value ).toLocaleString( 'en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    } );
}

function getPerformanceRatio( before, after )
{
    if( !before || !after )
    {
        return before > 0 && after === 0 ? Number.POSITIVE_INFINITY : 1;
    }

    return before / after;
}

function getPerformanceEmoji( before, after )
{
    var performanceRatio = getPerformanceRatio( before, after );

    if( performanceRatio >= 4 )
    {
        return '🚀';
    }

    if( performanceRatio >= 1.2 )
    {
        return '🔥';
    }

    return '😐';
}

function formatDisplayValue( value, format )
{
    switch( format )
    {
    case 'renders':
        return Number( value ).toLocaleString( 'en-US' ) + ' render' + ( Number( value ) === 1 ? '' : 's' );
    case 'writes':
        return Number( value ).toLocaleString( 'en-US' ) + ' write' + ( Number( value ) === 1 ? '' : 's' );
    case 'mib':
        return formatFixedNumber( value ) + ' MiB';
    case 'ms':
    default:
        return formatFixedNumber( value ) + ' ms';
    }
}

function formatPerformanceRatio( before, after )
{
    var ratio = getPerformanceRatio( before, after );
    var minimumFractionDigits = ratio < 1 ? 2 : 1;
    var maximumFractionDigits = ratio < 1 ? 2 : 1;

    if( Number.isFinite( ratio ) !== true )
    {
        return '∞X';
    }

    return Number( ratio ).toLocaleString( 'en-US', {
        minimumFractionDigits: minimumFractionDigits,
        maximumFractionDigits: maximumFractionDigits
    } ) + 'X';
}

function formatSpeedIncreaseCell( before, after )
{
    return '**' + formatPerformanceRatio( before, after ) + '** ' + getPerformanceEmoji( before, after );
}

function getEfficiencyDeltaFraction( before, after )
{
    if( before === 0 )
    {
        return 0;
    }

    return Math.abs( before - after ) / before;
}

function getEfficiencyEmoji( before, after )
{
    var deltaFraction = getEfficiencyDeltaFraction( before, after );

    if( after < before )
    {
        if( deltaFraction >= 0.75 )
        {
            return '🚀';
        }

        if( deltaFraction >= 0.2 )
        {
            return '🔥';
        }
    }

    return '😐';
}

function formatEfficiencyCell( before, after )
{
    if( before === after )
    {
        return '**No change** 😐';
    }

    var deltaPercent = getEfficiencyDeltaFraction( before, after ) * 100;
    var direction = after < before ? 'less' : 'more';

    return '**' + formatPercentNumber( deltaPercent ) + '% ' + direction + '** ' + getEfficiencyEmoji( before, after );
}

function chooseHeadlineRow( rows )
{
    var bestRow = rows.filter( function( row )
    {
        return row.definition.category === 'speed' &&
            row.definition.headlineTarget &&
            getPerformanceRatio( row.before, row.after ) > 1;
    } ).reduce( function( best, row )
    {
        if( !best )
        {
            return row;
        }

        return getPerformanceRatio( row.before, row.after ) > getPerformanceRatio( best.before, best.after ) ? row : best;
    }, undefined );

    if( bestRow )
    {
        return bestRow;
    }

    var fallback = rows.find( function( row )
    {
        return row.definition.category === 'speed' && row.definition.headlineTarget;
    } ) || rows.find( function( row )
    {
        return row.definition.headlineTarget;
    } );

    if( !fallback )
    {
        throw new Error( 'chooseHeadlineRow: SUMMARY_ROWS has no entry with a headlineTarget; the README headline cannot be rendered.' );
    }

    return fallback;
}

function formatHeadlineGain( row )
{
    return formatPerformanceRatio( row.before, row.after ) + ' faster';
}

function buildSummaryRows( payload )
{
    return SUMMARY_ROWS.map( function( definition )
    {
        var result = getResultByScenario( payload, definition.scenario );
        var before = result.baseline[ definition.metric ];
        var after = result.current[ definition.metric ];

        return {
            definition: definition,
            before: before,
            after: after
        };
    } );
}

function renderSummaryTable( rows, comparisonHeader )
{
    return [
        '| Target | Before | After | ' + comparisonHeader + ' |',
        '| --- | ---: | ---: | --- |'
    ].concat( rows.map( function( row )
    {
        var comparisonCell = row.definition.category === 'efficiency' ?
            formatEfficiencyCell( row.before, row.after ) :
            formatSpeedIncreaseCell( row.before, row.after );

        return '| ' + row.definition.label +
            ' | ' + formatDisplayValue( row.before, row.definition.format ) +
            ' | ' + formatDisplayValue( row.after, row.definition.format ) +
            ' | ' + comparisonCell + ' |';
    } ) );
}

function renderReadmeBenchmarkSummary( payload )
{
    var rows = buildSummaryRows( payload );
    var headlineRow = chooseHeadlineRow( rows );

    return [
        '**Made ' + headlineRow.definition.headlineTarget + ' ' + formatHeadlineGain( headlineRow ) + ' (so you don\'t have time to feel guilty for not fixing them... 🥀)**',
        '',
    ].concat( renderSummaryTable( rows, 'Speed/Efficiency Gain' ) ).concat( [
        '',
        '... And it\'s just getting warmed up!'
    ] ).join( '\n' );
}

function updateReadmeBenchmarkSummary( readmeContent, payload )
{
    if( canRenderReadmeBenchmarkSummary( payload ) !== true )
    {
        return readmeContent;
    }

    var startIndex = readmeContent.indexOf( SUMMARY_START_MARKER );
    var endIndex = readmeContent.indexOf( SUMMARY_END_MARKER );

    if( startIndex === -1 || endIndex === -1 || endIndex < startIndex )
    {
        throw new Error( 'README benchmark summary markers are missing or out of order.' );
    }

    var replacement = [
        SUMMARY_START_MARKER,
        renderReadmeBenchmarkSummary( payload ),
        SUMMARY_END_MARKER
    ].join( '\n' );

    return readmeContent.slice( 0, startIndex ) +
        replacement +
        readmeContent.slice( endIndex + SUMMARY_END_MARKER.length );
}

module.exports.SUMMARY_START_MARKER = SUMMARY_START_MARKER;
module.exports.SUMMARY_END_MARKER = SUMMARY_END_MARKER;
module.exports.SUMMARY_ROWS = SUMMARY_ROWS;
module.exports.canRenderReadmeBenchmarkSummary = canRenderReadmeBenchmarkSummary;
module.exports.renderReadmeBenchmarkSummary = renderReadmeBenchmarkSummary;
module.exports.updateReadmeBenchmarkSummary = updateReadmeBenchmarkSummary;
