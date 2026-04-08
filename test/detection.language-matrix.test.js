var utils = require( '../src/utils.js' );
var detection = require( '../src/detection.js' );

var languageMatrix = require( './languageMatrix.js' );
var matrixHelpers = require( './matrixHelpers.js' );

QUnit.module( "detection language matrix", function( hooks )
{
    function sortMatches( matches )
    {
        return matches.slice().sort( function( a, b )
        {
            return a.matchStartOffset - b.matchStartOffset ||
                a.commentStartOffset - b.commentStartOffset ||
                ( a.actualTag > b.actualTag ? 1 : ( b.actualTag > a.actualTag ? -1 : 0 ) );
        } );
    }

    function canonicalSnapshot( match )
    {
        return {
            fsPath: match.fsPath,
            actualTag: match.actualTag,
            displayText: match.displayText,
            continuationText: match.continuationText,
            before: match.before,
            after: match.after,
            line: match.line,
            column: match.column,
            endLine: match.endLine,
            endColumn: match.endColumn,
            commentStartOffset: match.commentStartOffset,
            commentEndOffset: match.commentEndOffset,
            matchStartOffset: match.matchStartOffset,
            matchEndOffset: match.matchEndOffset,
            tagStartOffset: match.tagStartOffset,
            tagEndOffset: match.tagEndOffset
        };
    }

    hooks.beforeEach( function()
    {
        utils.init( matrixHelpers.createConfig() );
    } );

    QUnit.test( "vendored language list matches the frozen supported matrix", function( assert )
    {
        assert.deepEqual( languageMatrix.CURRENT_LANGUAGE_NAMES, languageMatrix.EXPECTED_LANGUAGE_NAMES );
    } );

    languageMatrix.LANGUAGES.forEach( function( language )
    {
        QUnit.test( language.name + " default built-in detection covers its declared comment forms", function( assert )
        {
            var uri = matrixHelpers.createUri( "/tmp/" + language.fileName );
            var scenario = matrixHelpers.buildLanguageScenario( language );
            var results = sortMatches( detection.scanText( uri, scenario.text ) );
            var expectedResults = sortMatches( scenario.expectations );

            assert.equal( results.length, expectedResults.length, language.name + " positive result count" );
            expectedResults.forEach( function( expected, index )
            {
                matrixHelpers.assertMatch( assert, results[ index ], expected, language.name + " result " + index );
            } );

            var fromDocument = sortMatches( detection.scanDocument( matrixHelpers.createDocument( "/tmp/" + language.fileName, scenario.text ) ) );
            assert.equal( fromDocument.length, results.length, language.name + " scanDocument parity count" );
            fromDocument.forEach( function( match, index )
            {
                assert.deepEqual( canonicalSnapshot( match ), canonicalSnapshot( results[ index ] ), language.name + " scanDocument parity " + index );
            } );

            var negativeResults = detection.scanText( uri, scenario.negativeText );
            assert.equal( negativeResults.length, 0, language.name + " negative result count" );
        } );
    } );
} );
