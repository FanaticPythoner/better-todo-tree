// Structured set-difference between upstream and better-todo-tree result
// sets, consumed by parity assertions.

var improvementsRegistry = require( './improvementsRegistry.js' );

function canonicalKey( result )
{
    return [
        result.fsPath,
        result.line,
        result.column,
        result.actualTag
    ].join( '\u0000' );
}

function coreFieldsSnapshot( result )
{
    return {
        actualTag: result.actualTag,
        line: result.line,
        column: result.column,
        tagStartOffset: result.tagStartOffset,
        tagEndOffset: result.tagEndOffset
    };
}

function indexByKey( results )
{
    var map = new Map();

    results.forEach( function( result )
    {
        map.set( canonicalKey( result ), result );
    } );

    return map;
}

function summariseResult( result )
{
    return {
        line: result.line,
        column: result.column,
        actualTag: result.actualTag,
        displayText: result.displayText,
        match: result.match
    };
}

function compareResultSets( options )
{
    if( !options || !Array.isArray( options.upstream ) || !Array.isArray( options.betterTodoTree ) || !options.fixture )
    {
        throw new Error( 'compareResultSets: { upstream, betterTodoTree, fixture } required' );
    }

    var fixture = options.fixture;
    var upstreamByKey = indexByKey( options.upstream );
    var betterByKey = indexByKey( options.betterTodoTree );

    var missingInBetter = [];
    var missingInUpstream = [];
    var coreFieldDiffs = [];

    upstreamByKey.forEach( function( upstreamResult, key )
    {
        if( betterByKey.has( key ) )
        {
            var betterResult = betterByKey.get( key );
            var upstreamSnapshot = coreFieldsSnapshot( upstreamResult );
            var betterSnapshot = coreFieldsSnapshot( betterResult );
            if( JSON.stringify( upstreamSnapshot ) !== JSON.stringify( betterSnapshot ) )
            {
                coreFieldDiffs.push( {
                    key: key,
                    upstream: upstreamSnapshot,
                    betterTodoTree: betterSnapshot
                } );
            }
            return;
        }

        if( improvementsRegistry.isToleratedUpstreamDeviation( upstreamResult, fixture ) )
        {
            return;
        }

        missingInBetter.push( summariseResult( upstreamResult ) );
    } );

    betterByKey.forEach( function( betterResult, key )
    {
        if( upstreamByKey.has( key ) )
        {
            return;
        }

        if( improvementsRegistry.isToleratedBetterTodoTreeMatch( betterResult, fixture ) )
        {
            return;
        }

        missingInUpstream.push( summariseResult( betterResult ) );
    } );

    return {
        fixtureId: fixture.id,
        missingInBetterTodoTree: missingInBetter,
        missingInUpstream: missingInUpstream,
        coreFieldDiffs: coreFieldDiffs
    };
}

module.exports.coreFieldsSnapshot = coreFieldsSnapshot;
module.exports.compareResultSets = compareResultSets;
