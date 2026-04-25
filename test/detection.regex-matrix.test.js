var utils = require( '../src/utils.js' );
var detection = require( '../src/detection.js' );

var languageMatrix = require( './languageMatrix.js' );
var issue888Helpers = require( './issue888Helpers.js' );
var matrixHelpers = require( './matrixHelpers.js' );
var stubs = require( './stubs.js' );

QUnit.module( "detection regex matrix", function()
{
    function scanWithConfig( fsPath, text, configure )
    {
        var config = matrixHelpers.createConfig();

        if( configure )
        {
            configure( config );
        }

        utils.init( config );
        return detection.scanText( matrixHelpers.createUri( fsPath ), text );
    }

    QUnit.test( "uri scoped regex overrides are resolved per resource", function( assert )
    {
        var defaultUri = matrixHelpers.createUri( '/tmp/default.js' );
        var overriddenUri = matrixHelpers.createUri( '/tmp/override.js' );
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO', 'XXX' ],
            regexSource: '($TAGS)'
        } );
        stubs.setUriOverride( config, overriddenUri, { regexSource: '(XXX)' } );

        utils.init( config );

        assert.equal( detection.scanText( defaultUri, 'TODO item' ).length, 1 );
        assert.equal( detection.scanText( overriddenUri, 'TODO item' ).length, 0 );
        assert.equal( detection.scanText( overriddenUri, 'XXX item' )[ 0 ].actualTag, 'XXX' );
    } );

    QUnit.test( "custom regex matching honours case sensitivity", function( assert )
    {
        var caseSensitive = scanWithConfig( '/tmp/case.js', 'todo item', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '($TAGS)';
            config.shouldBeCaseSensitive = true;
        } );

        var caseInsensitive = scanWithConfig( '/tmp/case.js', 'todo item', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '($TAGS)';
            config.shouldBeCaseSensitive = false;
        } );

        assert.equal( caseSensitive.length, 0 );
        assert.equal( caseInsensitive.length, 1 );
        assert.equal( caseInsensitive[ 0 ].actualTag, 'TODO' );
    } );

    QUnit.test( "explicit newline regexes span multiple lines without enableMultiLine", function( assert )
    {
        var results = scanWithConfig( '/tmp/multiline.js', 'TODO\nsecond line', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '($TAGS)\\nsecond line';
        } );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].line, 1 );
        assert.equal( results[ 0 ].endLine, 2 );
        assert.deepEqual( results[ 0 ].continuationText, [ 'second line' ] );
    } );

    QUnit.test( "enableMultiLine allows [\\\\s\\\\S] regexes to cross line boundaries", function( assert )
    {
        var results = scanWithConfig( '/tmp/multiline.js', 'TODO: first\nsecond\nEND', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '($TAGS):[\\s\\S]*?END';
            config.enableMultiLineFlag = true;
            config.subTagRegexString = '^:\\s*';
        } );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].displayText, 'first' );
        assert.deepEqual( results[ 0 ].continuationText, [ 'second', 'END' ] );
        assert.equal( results[ 0 ].endLine, 3 );
    } );

    QUnit.test( "subTagRegex strips punctuation from the display text", function( assert )
    {
        var results = scanWithConfig( '/tmp/subtag.js', 'TODO: follow up', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '($TAGS):\\s*follow up';
            config.subTagRegexString = '^:\\s*';
        } );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].displayText, 'follow up' );
        assert.equal( results[ 0 ].after, 'follow up' );
    } );

    QUnit.test( "subTagRegex can extract a grouped sub tag", function( assert )
    {
        var results = scanWithConfig( '/tmp/subtag.js', 'TODO (alice) follow up', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '($TAGS).*';
            config.subTagRegexString = '^\\s*\\((.*)\\)';
        } );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].subTag, 'alice' );
        assert.equal( results[ 0 ].displayText, 'follow up' );
    } );

    QUnit.test( "overlapping and metacharacter tags normalise to configured tags", function( assert )
    {
        var results = scanWithConfig( '/tmp/tags.js', 'TODO(API) first\nA|B second', function( config )
        {
            config.tagList = [ 'TODO(API)', 'TODO', 'A|B' ];
            config.regexSource = '($TAGS)';
        } );

        assert.equal( results.length, 2 );
        assert.equal( results[ 0 ].actualTag, 'TODO(API)' );
        assert.equal( results[ 1 ].actualTag, 'A|B' );
    } );

    QUnit.test( "regexes without $TAGS use the raw match as the actual tag", function( assert )
    {
        var results = scanWithConfig( '/tmp/note.js', 'NOTE important', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '(NOTE)';
        } );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, 'NOTE' );
        assert.equal( results[ 0 ].displayText, 'NOTE' );
    } );

    QUnit.test( "custom regex matches preserve capture group offsets", function( assert )
    {
        var results = scanWithConfig( '/tmp/capture.js', 'TODO(api)', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = '($TAGS)\\(([^)]+)\\)';
        } );

        assert.equal( results.length, 1 );
        assert.deepEqual( results[ 0 ].captureGroupOffsets[ 1 ], [ 0, 4 ] );
        assert.deepEqual( results[ 0 ].captureGroupOffsets[ 2 ], [ 5, 8 ] );
    } );

    QUnit.test( "custom regex normalization covers the full manifest default tag corpus", function( assert )
    {
        var text = languageMatrix.DEFAULT_TAGS.map( function( tag, index )
        {
            return tag + ' custom-item-' + index;
        } ).join( '\n' );
        var results = scanWithConfig( '/tmp/default-tags.js', text, function( config )
        {
            config.tagList = languageMatrix.DEFAULT_TAGS.slice();
            config.regexSource = '($TAGS)';
        } );

        assert.equal( results.length, languageMatrix.DEFAULT_TAGS.length );
        assert.deepEqual( results.map( function( result ) { return result.actualTag; } ), languageMatrix.DEFAULT_TAGS );
        results.forEach( function( result, index )
        {
            assert.equal( result.displayText, languageMatrix.DEFAULT_TAGS[ index ] );
            assert.equal( result.line, index + 1 );
        } );
    } );

    QUnit.test( "issue 898 punctuation-heavy custom tags normalize through custom regexes", function( assert )
    {
        var results = scanWithConfig( '/tmp/issue-898-punctuation.js', [
            '// TODO: first',
            '// BUG: second',
            '// FIXME: third',
            '// HACK: fourth',
            '// ?: fifth'
        ].join( '\n' ), function( config )
        {
            config.tagList = [ 'TODO:', 'BUG:', 'FIXME:', 'HACK:', '?:' ];
            config.regexSource = '(?://|#)\\s*($TAGS).*';
            config.shouldBeCaseSensitive = false;
        } );

        assert.deepEqual( results.map( function( result ) { return result.actualTag; } ), [ 'TODO:', 'BUG:', 'FIXME:', 'HACK:', '?:' ] );
        assert.deepEqual( results.map( function( result ) { return result.displayText; } ), [ 'first', 'second', 'third', 'fourth', 'fifth' ] );
    } );

    QUnit.test( "issue 898 custom word tags and spaced tags normalize through custom regexes", function( assert )
    {
        var results = scanWithConfig( '/tmp/issue-898-custom-tags.js', [
            '// ChangeNote queued',
            '// Change_Note aliased',
            '// CHANGE NOTE spaced',
            '// ToTest pending',
            '// NOTE documented'
        ].join( '\n' ), function( config )
        {
            config.tagList = [ 'NOTE', 'ChangeNote', 'Change_Note', 'CHANGE NOTE', 'ToTest' ];
            config.regexSource = '(?://|#)\\s*($TAGS).*';
        } );

        assert.deepEqual(
            results.map( function( result ) { return result.actualTag; } ),
            [ 'ChangeNote', 'Change_Note', 'CHANGE NOTE', 'ToTest', 'NOTE' ]
        );
        assert.deepEqual(
            results.map( function( result ) { return result.displayText; } ),
            [ 'queued', 'aliased', 'spaced', 'pending', 'documented' ]
        );
    } );

    QUnit.test( "issue 885 hash-prefixed custom tags in markdown stay repeatable across editor and ripgrep normalization", function( assert )
    {
        var uri = matrixHelpers.createUri( '/tmp/issue-885.md' );
        var text = [
            '#LATER alpha',
            '#LATER beta',
            '#LATER #TODO gamma',
            '#LATER delta'
        ].join( '\n' );
        var config = matrixHelpers.createConfig( {
            tagList: [ '#LATER' ],
            regexSource: '($TAGS).*',
            shouldBeCaseSensitive: true
        } );

        utils.init( config );

        var scanned = detection.scanText( uri, text );
        var normalized = scanned.map( function( result )
        {
            return detection.normalizeRegexMatch( uri, text, {
                fsPath: uri.fsPath,
                line: result.line,
                column: result.column,
                match: result.match
            } );
        } );

        function comparableSnapshot( result )
        {
            return {
                line: result.line,
                column: result.column,
                actualTag: result.actualTag,
                displayText: result.displayText,
                match: result.match
            };
        }

        assert.equal( scanned.length, 4 );
        assert.deepEqual(
            scanned.map( function( result ) { return result.actualTag; } ),
            [ '#LATER', '#LATER', '#LATER', '#LATER' ]
        );
        assert.deepEqual(
            scanned.map( function( result ) { return result.displayText; } ),
            [ 'alpha', 'beta', '#TODO gamma', 'delta' ]
        );
        assert.deepEqual(
            normalized.map( comparableSnapshot ),
            scanned.map( comparableSnapshot )
        );
    } );

    QUnit.test( "ripgrep style normalization matches editor normalization for multiline results", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: '($TAGS):[\\s\\S]*?END',
            enableMultiLineFlag: true,
            subTagRegexString: '^:\\s*'
        } );
        var uri = matrixHelpers.createUri( '/tmp/workspace.js' );
        var text = 'TODO: first\nsecond\nEND';

        utils.init( config );

        var scanned = detection.scanText( uri, text )[ 0 ];
        var normalized = detection.normalizeRegexMatch( uri, text, {
            fsPath: uri.fsPath,
            line: 1,
            column: 1,
            match: 'TODO: first',
            extraLines: [ { match: 'second' }, { match: 'END' } ]
        } );

        assert.deepEqual( normalized.actualTag, scanned.actualTag );
        assert.deepEqual( normalized.displayText, scanned.displayText );
        assert.deepEqual( normalized.continuationText, scanned.continuationText );
        assert.equal( normalized.line, scanned.line );
        assert.equal( normalized.endLine, scanned.endLine );
    } );

    QUnit.test( "default regex normalization extends index-free matches to the full todo line", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: utils.DEFAULT_REGEX_SOURCE,
            subTagRegexString: '^:\\s*'
        } );
        var uri = matrixHelpers.createUri( '/tmp/index-free.rs' );
        var text = '// TODO restore detection';

        utils.init( config );

        var match = utils.getRegexForEditorSearch( false, uri ).exec( text );
        var context = detection.createScanContext( uri, text );
        var normalized = detection.normalizeRegexMatchWithContext( context, match );

        assert.equal( match.indices, undefined );
        assert.equal( normalized.actualTag, 'TODO' );
        assert.equal( normalized.line, 1 );
        assert.equal( normalized.column, 4 );
        assert.equal( normalized.displayText, 'restore detection' );
        assert.equal( normalized.match, text );
        assert.equal( normalized.commentEndOffset, text.length );
        assert.equal( normalized.matchEndOffset, text.length );
    } );

    QUnit.test( "raw workspace regex normalization matches the editor path for multiline ripgrep payloads", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: '($TAGS):[\\s\\S]*?END',
            enableMultiLineFlag: true,
            subTagRegexString: '^:\\s*'
        } );
        var uri = matrixHelpers.createUri( '/tmp/workspace-raw.js' );
        var text = 'TODO: first\nsecond\nEND\n';

        utils.init( config );

        var scanned = detection.scanText( uri, text )[ 0 ];
        var normalized = detection.normalizeWorkspaceRegexMatch( uri, {
            fsPath: uri.fsPath,
            line: 1,
            column: 1,
            match: 'TODO: first\nsecond\nEND\n',
            lines: 'TODO: first\nsecond\nEND\n',
            absoluteOffset: 0,
            submatches: [ {
                match: 'TODO: first\nsecond\nEND\n',
                start: 0,
                end: text.length
            } ]
        } );

        assert.equal( normalized.actualTag, scanned.actualTag );
        assert.equal( normalized.displayText, scanned.displayText );
        assert.deepEqual( normalized.continuationText, scanned.continuationText );
        assert.equal( normalized.line, scanned.line );
        assert.equal( normalized.endLine, scanned.endLine );
        assert.equal( normalized.matchStartOffset, scanned.matchStartOffset );
        assert.equal( normalized.matchEndOffset, scanned.matchEndOffset );
    } );

    QUnit.test( "issue #888 multiline banner regex anchors the star tag to the content line", function( assert )
    {
        var uri = matrixHelpers.createUri( '/tmp/issue-888.js' );
        var text = issue888Helpers.createIssue888Text();
        var config = issue888Helpers.createIssue888Config();
        var tagLine = ' * Helpers';

        utils.init( config );

        var results = detection.scanText( uri, text );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, '*' );
        assert.equal( results[ 0 ].line, 2 );
        assert.equal( results[ 0 ].column, 2 );
        assert.equal( results[ 0 ].displayText, 'Helpers' );
        assert.deepEqual( results[ 0 ].continuationText, [] );
        assert.equal( results[ 0 ].match, tagLine );
        assert.equal( results[ 0 ].matchStartOffset, text.indexOf( tagLine ) + 1 );
        assert.equal( results[ 0 ].tagStartOffset, text.indexOf( tagLine ) + 1 );
        assert.equal( results[ 0 ].matchEndOffset, text.indexOf( tagLine ) + tagLine.length );
        assert.equal( results[ 0 ].commentStartOffset, 0 );
    } );
} );
