/**
 * Robustness suite for the parity pipeline. Verifies fixture identity
 * uniqueness, detector idempotency on the full corpora, harness purity,
 * cross-fixture isolation, JSON serializability, positional invariants,
 * adversarial-input liveness, and a performance ceiling on the largest
 * fuzz-stress fixtures.
 */

var utils = require( '../../src/utils.js' );
var detection = require( '../../src/detection.js' );
var corpus = require( './corpus.js' );
var comparator = require( './compare.js' );
var scanHarness = require( './scanHarness.js' );

var ADVERSARIAL_INPUT_LENGTH = 200000;
var PERFORMANCE_CEILING_MS = 1500;

function snapshotResults( results )
{
    return results.map( comparator.coreFieldsSnapshot );
}

function assertPositionalInvariants( assert, fixture, results )
{
    var textLength = fixture.text.length;

    results.forEach( function( result, index )
    {
        var location = fixture.id + ' :: result[' + index + ']';
        assert.ok( typeof( result.line ) === 'number' && result.line >= 1, location + ' :: line >= 1' );
        assert.ok( typeof( result.column ) === 'number' && result.column >= 1, location + ' :: column >= 1' );
        assert.ok( typeof( result.tagStartOffset ) === 'number' && result.tagStartOffset >= 0, location + ' :: tagStartOffset >= 0' );
        assert.ok( typeof( result.tagEndOffset ) === 'number' && result.tagEndOffset > result.tagStartOffset, location + ' :: tagEndOffset > tagStartOffset' );
        assert.ok( result.tagEndOffset <= textLength, location + ' :: tagEndOffset <= text.length' );
        assert.equal( typeof( result.actualTag ), 'string', location + ' :: actualTag is string' );
        assert.ok( result.actualTag.length > 0, location + ' :: actualTag non-empty' );
        assert.equal( result.fsPath, fixture.fsPath, location + ' :: fsPath matches fixture' );
    } );
}

function withInitialisedConfig( hooks )
{
    hooks.beforeEach( function()
    {
        utils.init( scanHarness.makeBetterTodoTreeConfig() );
    } );
}

QUnit.module( 'parity robustness', function( hooks )
{
    withInitialisedConfig( hooks );

    QUnit.test( 'fixture ids are unique across every corpus', function( assert )
    {
        var seen = Object.create( null );
        var duplicates = [];

        scanHarness.allFixtures().forEach( function( fixture )
        {
            if( seen[ fixture.id ] )
            {
                duplicates.push( fixture.id );
                return;
            }
            seen[ fixture.id ] = true;
        } );

        assert.deepEqual( duplicates, [], 'no duplicate fixture ids => ' + JSON.stringify( duplicates ) );
    } );

    QUnit.test( 'every fixture has a non-empty fsPath, deterministic id, and string text', function( assert )
    {
        scanHarness.allFixtures().forEach( function( fixture )
        {
            assert.equal( typeof( fixture.id ), 'string', 'id is a string' );
            assert.ok( fixture.id.length > 0, fixture.id + ' :: id non-empty' );
            assert.equal( typeof( fixture.fsPath ), 'string', fixture.id + ' :: fsPath is string' );
            assert.ok( fixture.fsPath.length > 0, fixture.id + ' :: fsPath non-empty' );
            assert.equal( typeof( fixture.text ), 'string', fixture.id + ' :: text is string' );
        } );
    } );

    QUnit.test( 'scanText is idempotent across the entire corpus', function( assert )
    {
        scanHarness.allFixtures().forEach( function( fixture )
        {
            var first = scanHarness.scanBetterTodoTree( fixture );
            var second = scanHarness.scanBetterTodoTree( fixture );
            assert.deepEqual( snapshotResults( first ), snapshotResults( second ), fixture.id + ' :: scanText is stable across two invocations' );
        } );
    } );

    QUnit.test( 'scanText output is JSON-serializable (no circular references, no functions)', function( assert )
    {
        scanHarness.allFixtures().forEach( function( fixture )
        {
            var results = scanHarness.scanBetterTodoTree( fixture );
            var roundTripped = JSON.parse( JSON.stringify( results.map( comparator.coreFieldsSnapshot ) ) );
            assert.deepEqual( roundTripped, results.map( comparator.coreFieldsSnapshot ), fixture.id + ' :: results survive JSON roundtrip' );
        } );
    } );

    QUnit.test( 'every scanText result satisfies positional invariants', function( assert )
    {
        scanHarness.allFixtures().forEach( function( fixture )
        {
            assertPositionalInvariants( assert, fixture, scanHarness.scanBetterTodoTree( fixture ) );
        } );
    } );

    QUnit.test( 'cross-fixture isolation :: scanning A then B then A reproduces A bit-for-bit', function( assert )
    {
        var fixtureA = corpus.REALISTIC_CODE_CORPUS[ 0 ];
        var fixtureB = corpus.REALISTIC_CODE_CORPUS[ 1 ];

        var firstA = snapshotResults( scanHarness.scanBetterTodoTree( fixtureA ) );
        scanHarness.scanBetterTodoTree( fixtureB );
        var secondA = snapshotResults( scanHarness.scanBetterTodoTree( fixtureA ) );

        assert.deepEqual( firstA, secondA, 'fixtureA results are independent of fixtureB scan' );
    } );

    QUnit.test( 'upstream harness is pure :: repeated invocation produces identical results', function( assert )
    {
        var samples = corpus.REALISTIC_CODE_CORPUS.concat(
            corpus.UNVENDORED_CORPUS.slice( 0, 6 ),
            corpus.EDGE_CASE_CORPUS.slice( 0, 6 ),
            corpus.MULTI_TAG_CORPUS.slice( 0, 4 ),
            corpus.FUZZ_CORPUS.slice( 0, 6 )
        );

        samples.forEach( function( fixture )
        {
            var first = snapshotResults( scanHarness.scanUpstream( fixture ) );
            var second = snapshotResults( scanHarness.scanUpstream( fixture ) );
            assert.deepEqual( first, second, fixture.id + ' :: upstream harness is idempotent' );
        } );
    } );

    QUnit.test( 'upstream harness cross-fixture isolation :: scanning A then B then A reproduces A', function( assert )
    {
        var fixtureA = corpus.REALISTIC_CODE_CORPUS[ 0 ];
        var fixtureB = corpus.REALISTIC_CODE_CORPUS[ 1 ];

        var firstA = snapshotResults( scanHarness.scanUpstream( fixtureA ) );
        scanHarness.scanUpstream( fixtureB );
        var secondA = snapshotResults( scanHarness.scanUpstream( fixtureA ) );

        assert.deepEqual( firstA, secondA, 'upstream harness preserves fixtureA results across fixtureB invocation' );
    } );

    QUnit.test( 'scanText terminates and returns no matches on a 200k-character all-whitespace adversarial input', function( assert )
    {
        var adversarial = ' '.repeat( ADVERSARIAL_INPUT_LENGTH );
        var start = Date.now();
        var results = detection.scanText( scanHarness.makeUri( '/tmp/adversarial-whitespace.tmpl' ), adversarial );
        var elapsed = Date.now() - start;

        assert.equal( results.length, 0, 'no matches on whitespace-only input' );
        assert.ok( elapsed < PERFORMANCE_CEILING_MS, 'completed in ' + elapsed + 'ms (< ' + PERFORMANCE_CEILING_MS + 'ms ceiling)' );
    } );

    QUnit.test( 'scanText terminates on a 200k-character repeated-prefix adversarial input', function( assert )
    {
        var adversarial = '/'.repeat( ADVERSARIAL_INPUT_LENGTH );
        var start = Date.now();
        var results = detection.scanText( scanHarness.makeUri( '/tmp/adversarial-slashes.tmpl' ), adversarial );
        var elapsed = Date.now() - start;

        assert.equal( results.length, 0, 'no tag matches on prefix-only adversarial input' );
        assert.ok( elapsed < PERFORMANCE_CEILING_MS, 'completed in ' + elapsed + 'ms (< ' + PERFORMANCE_CEILING_MS + 'ms ceiling)' );
    } );

    QUnit.test( 'scanText terminates on a 200k-character repeated-tag adversarial input', function( assert )
    {
        var line = '// TODO ';
        var lines = new Array( Math.floor( ADVERSARIAL_INPUT_LENGTH / line.length ) ).fill( line ).join( '\n' );
        var start = Date.now();
        var results = detection.scanText( scanHarness.makeUri( '/tmp/adversarial-tag-flood.tmpl' ), lines );
        var elapsed = Date.now() - start;

        assert.ok( results.length > 0, 'tag flood produces matches' );
        assert.ok( elapsed < PERFORMANCE_CEILING_MS, 'completed in ' + elapsed + 'ms (< ' + PERFORMANCE_CEILING_MS + 'ms ceiling)' );
    } );

    QUnit.test( 'fuzz-stress fixtures complete inside the performance ceiling', function( assert )
    {
        var stressFixtures = corpus.FUZZ_CORPUS.filter( function( fixture )
        {
            return fixture.id.indexOf( 'fuzz-stress::' ) === 0;
        } );

        assert.ok( stressFixtures.length > 0, 'at least one fuzz-stress fixture exists' );

        stressFixtures.forEach( function( fixture )
        {
            var start = Date.now();
            var results = scanHarness.scanBetterTodoTree( fixture );
            var elapsed = Date.now() - start;
            assert.ok( elapsed < PERFORMANCE_CEILING_MS, fixture.id + ' :: ' + elapsed + 'ms (< ' + PERFORMANCE_CEILING_MS + 'ms ceiling)' );
            assert.ok( results.length > 0, fixture.id + ' :: produced matches' );
        } );
    } );

    QUnit.test( 'every fixture id encodes its tier as the leading namespace', function( assert )
    {
        var legalPrefixes = [ 'vendored::', 'vendored-alias::', 'unvendored::', 'negative::', 'edge::', 'multi-tag::', 'fuzz::', 'fuzz-stress::', 'realistic::' ];
        scanHarness.allFixtures().forEach( function( fixture )
        {
            var matchesAny = legalPrefixes.some( function( prefix )
            {
                return fixture.id.indexOf( prefix ) === 0;
            } );
            assert.ok( matchesAny, fixture.id + ' :: id starts with a known tier prefix' );
        } );
    } );

    QUnit.test( 'parity tag list contains exactly the seven canonical tags', function( assert )
    {
        assert.deepEqual( corpus.PARITY_TAG_LIST.slice(), [ 'TODO', 'FIXME', 'HACK', 'BUG', 'XXX', '[ ]', '[x]' ] );
    } );

    QUnit.test( 'parity regex source contains every default-regex prefix alternation', function( assert )
    {
        var prefixes = [ '^', '//', '#', '<!--', ';', '/\\*' ];
        prefixes.forEach( function( prefix )
        {
            assert.ok( corpus.PARITY_REGEX_SOURCE.indexOf( prefix ) !== -1, 'parity regex contains alternation ' + prefix );
        } );
    } );
} );
