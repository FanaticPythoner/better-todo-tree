var utils = require( '../src/utils.js' );
var detection = require( '../src/detection.js' );
var regexRegistry = require( '../src/regexRegistry.js' );

var languageMatrix = require( './languageMatrix.js' );
var issue888Helpers = require( './issue888Helpers.js' );
var matrixHelpers = require( './matrixHelpers.js' );
var stubs = require( './stubs.js' );

function tagRegexWithTail( tail )
{
    var builder = regexRegistry.createRegexBuilder();

    return builder.sequence( [
        builder.pattern( 'tagCapturePlaceholder' ),
        tail
    ] );
}

function slashHashTagRegexWithTail( tail )
{
    var builder = regexRegistry.createRegexBuilder();

    return builder.sequence( [
        builder.nonCapture( builder.alternationFragments( [ 'slashCommentPrefix', 'hashCommentPrefix' ] ) ),
        builder.fragment( 'whitespaceZeroOrMore' ),
        builder.capture( builder.fragment( 'tagPlaceholder' ) ),
        tail
    ] );
}

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
            regexSource: regexRegistry.TAG_CAPTURE_PLACEHOLDER
        } );
        stubs.setUriOverride( config, overriddenUri, {
            regexSource: regexRegistry.pattern( 'xxxCapture' )
        } );

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
            config.regexSource = regexRegistry.TAG_CAPTURE_PLACEHOLDER;
            config.shouldBeCaseSensitive = true;
        } );

        var caseInsensitive = scanWithConfig( '/tmp/case.js', 'todo item', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = regexRegistry.TAG_CAPTURE_PLACEHOLDER;
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
            config.regexSource = regexRegistry.pattern( 'tagNewlineSecondLine' );
        } );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].line, 1 );
        assert.equal( results[ 0 ].endLine, 2 );
        assert.deepEqual( results[ 0 ].continuationText, [ 'second line' ] );
    } );

    QUnit.test( "enableMultiLine allows registry multiline regexes to cross line boundaries", function( assert )
    {
        var results = scanWithConfig( '/tmp/multiline.js', 'TODO: first\nsecond\nEND', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = regexRegistry.pattern( 'tagColonAnyTextUntilEndLazy' );
            config.enableMultiLineFlag = true;
            config.subTagRegexString = regexRegistry.pattern( 'subTagPrefix' );
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
            config.regexSource = regexRegistry.pattern( 'tagColonFollowUp' );
            config.subTagRegexString = regexRegistry.pattern( 'subTagPrefix' );
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
            config.regexSource = regexRegistry.pattern( 'tagAnyText' );
            config.subTagRegexString = regexRegistry.pattern( 'leadingParenthesizedSubTag' );
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
            config.regexSource = regexRegistry.TAG_CAPTURE_PLACEHOLDER;
        } );

        assert.equal( results.length, 2 );
        assert.equal( results[ 0 ].actualTag, 'TODO(API)' );
        assert.equal( results[ 1 ].actualTag, 'A|B' );
    } );

    QUnit.test( "regexes without the tag placeholder use the raw match as the actual tag", function( assert )
    {
        var results = scanWithConfig( '/tmp/note.js', 'NOTE relevant', function( config )
        {
            config.tagList = [ 'TODO' ];
            config.regexSource = regexRegistry.pattern( 'noteCapture' );
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
            config.regexSource = regexRegistry.pattern( 'tagParenSubTagCapture' );
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
            config.regexSource = regexRegistry.TAG_CAPTURE_PLACEHOLDER;
        } );

        assert.equal( results.length, languageMatrix.DEFAULT_TAGS.length );
        assert.deepEqual( results.map( function( result ) { return result.actualTag; } ), languageMatrix.DEFAULT_TAGS );
        results.forEach( function( result, index )
        {
            assert.equal( result.displayText, 'custom-item-' + index );
            assert.equal( result.after, 'custom-item-' + index );
            assert.equal( utils.formatLabel( '${tag} ${after}', result ), languageMatrix.DEFAULT_TAGS[ index ] + ' custom-item-' + index );
            assert.equal( result.line, index + 1 );
        } );
    } );

    QUnit.test( "issue #36 default regex labels render text after the tag", function( assert )
    {
        var uri = matrixHelpers.createUri( '/tmp/issue-36.js' );
        var text = [
            '// TODO customer-visible text',
            '// FIXME second-visible text',
            '// HACK third-visible text'
        ].join( '\n' );

        utils.init( matrixHelpers.createConfig( {
            tagList: [ 'TODO', 'FIXME', 'HACK' ],
            regexSource: utils.DEFAULT_REGEX_SOURCE,
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } ) );

        var results = detection.scanText( uri, text );

        assert.deepEqual(
            results.map( function( result ) { return utils.formatLabel( '${tag} ${after}', result ); } ),
            [ 'TODO customer-visible text', 'FIXME second-visible text', 'HACK third-visible text' ]
        );
        assert.deepEqual(
            results.map( function( result ) { return result.before; } ),
            [ '', '', '' ]
        );
        assert.deepEqual(
            results.map( function( result ) { return result.after; } ),
            [ 'customer-visible text', 'second-visible text', 'third-visible text' ]
        );
    } );

    QUnit.test( "issue #36 workspace regex labels match editor labels", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: regexRegistry.pattern( 'legacyMarkdownCompatibilityTodo' ),
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } );
        var uri = matrixHelpers.createUri( '/tmp/issue-36-workspace.js' );
        var text = '// TODO workspace-visible text';

        utils.init( config );

        var scanned = detection.scanText( uri, text )[ 0 ];
        var normalized = detection.normalizeWorkspaceRegexMatch( uri, {
            fsPath: uri.fsPath,
            line: 1,
            column: 1,
            lines: text,
            match: '// TODO',
            absoluteOffset: 0,
            submatches: [ {
                match: '// TODO',
                start: 0,
                end: 7
            } ]
        } );

        assert.equal( utils.formatLabel( '${tag} ${after}', normalized ), 'TODO workspace-visible text' );
        assert.equal( utils.formatLabel( '${tag} ${after}', normalized ), utils.formatLabel( '${tag} ${after}', scanned ) );
        assert.equal( normalized.before, '//' );
        assert.equal( normalized.after, 'workspace-visible text' );
    } );

    QUnit.test( "issue #36 comment-prefix labels match reload labels", function( assert )
    {
        function stripCaptureGroupOffsets( results )
        {
            return results.map( function( result )
            {
                var copy = Object.assign( {}, result );
                delete copy.captureGroupOffsets;
                return copy;
            } );
        }

        function createRipgrepMatch( uri, text, regex, result )
        {
            var lineStartOffset = text.split( '\n' ).slice( 0, result.line - 1 ).join( '\n' ).length;
            if( result.line > 1 )
            {
                lineStartOffset++;
            }

            var lineEndOffset = text.indexOf( '\n', lineStartOffset );
            if( lineEndOffset === -1 )
            {
                lineEndOffset = text.length;
            }

            var lineText = text.slice( lineStartOffset, lineEndOffset );
            var lineRegex = new RegExp( regex.source, regex.flags.replace( 'g', '' ) );
            var match = lineRegex.exec( lineText );

            return {
                fsPath: uri.fsPath,
                line: result.line,
                column: match.index + 1,
                match: match[ 0 ],
                lines: lineText + '\n',
                absoluteOffset: lineStartOffset,
                submatches: [ {
                    match: match[ 0 ],
                    start: match.index,
                    end: match.index + match[ 0 ].length
                } ]
            };
        }

        var tagList = [ 'BUG', 'FIXME', 'HACK', 'TODO', '[ ]', '[x]', 'MOMA' ];
        var regexSource = regexRegistry.pattern( 'commentPrefixTagCapture' );
        var uri = matrixHelpers.createUri( '/tmp/shared-prefixes.txt' );
        var text = [
            '// TODO:   JavaScript TODO',
            '# FIXME:  Python FIXME',
            '<!-- HACK: HTML HACK',
            '; BUG:    Semicolon BUG',
            '/* MOMA:  Block MOMA',
            '      *> BUG:   COBOL BUG',
            '      *> FIXME: COBOL FIXME',
            '      *> TODO:  COBOL TODO',
            '      *> MOMA:  COBOL MOMA',
            '      *> [ ]:   COBOL [ ]',
            '      *> [x]:   COBOL [x]',
            '',
            '       -- BUG:   SQL BUG',
            '       -- FIXME: SQL FIXME',
            '       -- TODO:  SQL TODO',
            '       -- MOMA:  SQL MOMA',
            '       -- [ ]:   SQL [ ]',
            '       -- [x]:   SQL [x]'
        ].join( '\n' );
        var config = matrixHelpers.createConfig( {
            tagList: tagList,
            regexSource: regexSource,
            shouldBeCaseSensitive: false,
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } );

        utils.init( config );

        var openResults = detection.scanText( uri, text );
        var expandedRegex = new RegExp(
            regexSource.replace( regexRegistry.TAG_PLACEHOLDER, utils.getTagRegexSource( uri, tagList ) ),
            'i'
        );
        var reloadResults = openResults.map( function( result )
        {
            return detection.normalizeWorkspaceRegexMatch(
                uri,
                createRipgrepMatch( uri, text, expandedRegex, result )
            );
        } );

        assert.deepEqual(
            openResults.map( function( result ) { return result.actualTag + ':' + result.after; } ),
            [
                'TODO:JavaScript TODO',
                'FIXME:Python FIXME',
                'HACK:HTML HACK',
                'BUG:Semicolon BUG',
                'MOMA:Block MOMA',
                'BUG:COBOL BUG',
                'FIXME:COBOL FIXME',
                'TODO:COBOL TODO',
                'MOMA:COBOL MOMA',
                '[ ]:COBOL [ ]',
                '[x]:COBOL [x]',
                'BUG:SQL BUG',
                'FIXME:SQL FIXME',
                'TODO:SQL TODO',
                'MOMA:SQL MOMA',
                '[ ]:SQL [ ]',
                '[x]:SQL [x]'
            ]
        );
        assert.deepEqual( stripCaptureGroupOffsets( reloadResults ), stripCaptureGroupOffsets( openResults ) );
    } );

    QUnit.test( "issue #53 raw ripgrep byte offsets match editor normalization", function( assert )
    {
        function byteLength( value )
        {
            return Buffer.byteLength( value, 'utf8' );
        }

        function resultSnapshot( result )
        {
            return {
                line: result.line,
                column: result.column,
                actualTag: result.actualTag,
                displayText: result.displayText,
                after: result.after,
                match: result.match
            };
        }

        function createRipgrepMatches( fsPath, text, regex )
        {
            var lines = text.split( '\n' );
            var matches = [];
            var charOffset = 0;
            var lineIndex;

            for( lineIndex = 0; lineIndex < lines.length; lineIndex++ )
            {
                var line = lines[ lineIndex ];
                var lineRegex = new RegExp( regex.source, regex.flags.replace( 'g', '' ) );
                var match = lineRegex.exec( line );

                if( match )
                {
                    matches.push( {
                        fsPath: fsPath,
                        line: lineIndex + 1,
                        column: match.index + 1,
                        match: match[ 0 ],
                        lines: line + '\n',
                        absoluteOffset: byteLength( text.slice( 0, charOffset ) ),
                        submatches: [ {
                            match: match[ 0 ],
                            start: byteLength( line.slice( 0, match.index ) ),
                            end: byteLength( line.slice( 0, match.index + match[ 0 ].length ) )
                        } ]
                    } );
                }

                charOffset += line.length + 1;
            }

            return matches;
        }

        var tagList = [ 'BUG', 'FIXME', 'HACK', 'TODO', '[ ]', '[x]', 'MOMA' ];
        var regexSource = '(//|#|<!--|;|/\\*|\\*>|^......\\*|\\-\\-)\\s*($TAGS)';
        var uri = matrixHelpers.createUri( '/tmp/issue-53.cbl' );
        var text = [
            '000001* Préfixe accentué',
            '000002* déjà accès créé',
            '      *> BUG:   COBOL BUG',
            '      *> FIXME: COBOL FIXME',
            '      *> TODO:  COBOL TODO',
            '      *> MOMA:  COBOL MOMA',
            '      *> [ ]:   COBOL [ ]',
            '      *> [x]:   COBOL [x]',
            '',
            '       -- BUG:   SQL BUG',
            '       -- FIXME: SQL FIXME',
            '       -- TODO:  SQL TODO',
            '       -- MOMA:  SQL MOMA',
            '       -- [ ]:   SQL [ ]',
            '       -- [x]:   SQL [x]',
            'éé -- TODO: unicode prefix SQL',
            'cdDM00*> --- Gestion Accès DM'
        ].join( '\n' );
        var config = matrixHelpers.createConfig( {
            tagList: tagList,
            regexSource: regexSource,
            shouldBeCaseSensitive: false,
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } );
        var expandedRegex = new RegExp(
            regexSource.replace( regexRegistry.TAG_PLACEHOLDER, utils.getTagRegexSource( uri, tagList ) ),
            'i'
        );

        utils.init( config );

        var openResults = detection.scanText( uri, text );
        var reloadResults = createRipgrepMatches( uri.fsPath, text, expandedRegex ).map( function( match )
        {
            return detection.normalizeRegexMatch( uri, text, match );
        } ).filter( function( result )
        {
            return result !== undefined;
        } );

        assert.deepEqual( reloadResults.map( resultSnapshot ), openResults.map( resultSnapshot ) );
        assert.deepEqual(
            reloadResults.map( function( result ) { return result.line; } ),
            [ 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16 ]
        );
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
            config.regexSource = slashHashTagRegexWithTail( regexRegistry.fragment( 'anyTextZeroOrMore' ) );
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
            config.regexSource = slashHashTagRegexWithTail( regexRegistry.fragment( 'anyTextZeroOrMore' ) );
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
            regexSource: regexRegistry.pattern( 'tagAnyText' ),
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
            regexSource: regexRegistry.pattern( 'tagColonAnyTextUntilEndLazy' ),
            enableMultiLineFlag: true,
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
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
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
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

    QUnit.test( "context normalization reuses snapshot resource config for raw ripgrep matches", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: regexRegistry.TAG_CAPTURE_PLACEHOLDER,
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } );
        var uri = matrixHelpers.createUri( '/tmp/context-snapshot.js' );
        var text = '// FIXME via snapshot';
        var snapshot = {
            getResourceConfig: function()
            {
                return {
                    tags: [ 'FIXME' ],
                    regex: regexRegistry.TAG_CAPTURE_PLACEHOLDER,
                    regexCaseSensitive: true,
                    isDefaultRegex: false,
                    subTagRegex: regexRegistry.pattern( 'subTagPrefix' )
                };
            }
        };
        var context;
        var normalized;

        utils.init( config );

        context = detection.createScanContext( uri, text, snapshot, {
            regexSource: regexRegistry.TAG_CAPTURE_PLACEHOLDER,
            skipExactRegex: true
        } );
        normalized = detection.normalizeRegexMatchWithContext( context, {
            fsPath: uri.fsPath,
            line: 1,
            column: 4,
            match: 'FIXME via snapshot'
        } );

        assert.equal( normalized.actualTag, 'FIXME' );
        assert.equal( normalized.displayText, 'via snapshot' );
        assert.equal( normalized.column, 4 );
    } );

    QUnit.test( "no-capture raw ripgrep normalization avoids exact regex execution", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: 'TODO: [^\\n]+',
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } );
        var uri = matrixHelpers.createUri( '/tmp/no-capture-fast-path.js' );
        var text = 'TODO: fast path';
        var context;
        var normalized;

        utils.init( config );

        context = detection.createScanContext( uri, text );
        context.exactRegex = {
            exec: function()
            {
                throw new Error( 'exact regex execution disabled for no-capture raw matches' );
            }
        };
        normalized = detection.normalizeRegexMatchWithContext( context, {
            fsPath: uri.fsPath,
            line: 1,
            column: 1,
            match: text
        } );

        assert.equal( normalized.actualTag, text );
        assert.equal( normalized.displayText, text );
        assert.equal( normalized.column, 1 );
    } );

    QUnit.test( "raw workspace regex normalization matches the editor path for multiline ripgrep payloads", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: regexRegistry.pattern( 'tagColonAnyTextUntilEndLazy' ),
            enableMultiLineFlag: true,
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
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

    QUnit.test( "issue #42 PCRE2 markdown task payload keeps display text", function( assert )
    {
        var regexSource = regexRegistry.pattern( 'defaultTodoWithoutSemicolon' );
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO', '[ ]', '[x]' ],
            regexSource: regexSource,
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } );
        var uri = matrixHelpers.createUri( '/tmp/issue-42.md' );
        var text = '- [ ] Task 1\n- [ ] Task 2\n';

        utils.init( config );

        var scanned = detection.scanText( uri, text );
        var normalized = detection.normalizeWorkspaceRegexMatch( uri, {
            fsPath: uri.fsPath,
            line: 1,
            column: 1,
            match: '- [ ]',
            lines: '- [ ] Task 1\n',
            absoluteOffset: 0,
            submatches: [ {
                match: '- [ ]',
                start: 0,
                end: 5
            } ]
        } );

        assert.equal( scanned[ 0 ].actualTag, '[ ]' );
        assert.equal( scanned[ 0 ].displayText, 'Task 1' );
        assert.equal( normalized.actualTag, scanned[ 0 ].actualTag );
        assert.equal( normalized.displayText, scanned[ 0 ].displayText );
        assert.equal( normalized.match, scanned[ 0 ].match );
    } );

    QUnit.test( "PCRE2-only workspace tag payload normalizes without JavaScript regex compilation", function( assert )
    {
        var config = matrixHelpers.createConfig( {
            tagList: [ 'TODO' ],
            regexSource: regexRegistry.pattern( 'tagWhitespaceBackreference' ),
            subTagRegexString: regexRegistry.pattern( 'subTagPrefix' )
        } );
        var uri = matrixHelpers.createUri( '/tmp/pcre2-only.js' );

        utils.init( config );

        var normalized = detection.normalizeWorkspaceRegexMatch( uri, {
            fsPath: uri.fsPath,
            line: 1,
            column: 1,
            match: 'TODO TODO',
            lines: 'TODO TODO\n',
            absoluteOffset: 0,
            submatches: [ {
                match: 'TODO TODO',
                start: 0,
                end: 9
            } ]
        } );

        assert.equal( normalized.actualTag, 'TODO' );
        assert.equal( normalized.displayText, 'TODO' );
        assert.equal( normalized.match, 'TODO TODO' );
        assert.equal( normalized.line, 1 );
        assert.equal( normalized.column, 1 );
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
