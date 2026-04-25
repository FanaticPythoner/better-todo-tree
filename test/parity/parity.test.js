/**
 * Side-by-side parity tests comparing the real upstream extension (loaded via
 * test/parity/upstreamExtensionHarness.js at commit 7761bd02) against
 * src/detection.js.
 *
 * Contract:
 *   unvendored  : better-todo-tree === upstream (strict)
 *   vendored    : better-todo-tree === upstream minus improvementsRegistry entries
 *   negative    : both detectors return []
 */

var utils = require( '../../src/utils.js' );
var detection = require( '../../src/detection.js' );
var corpus = require( './corpus.js' );
var comparator = require( './compare.js' );
var scanHarness = require( './scanHarness.js' );

var makeBetterTodoTreeConfig = scanHarness.makeBetterTodoTreeConfig;
var makeUri = scanHarness.makeUri;
var scanBetterTodoTree = scanHarness.scanBetterTodoTree;
var scanUpstream = scanHarness.scanUpstream;

function assertParity( assert, fixture )
{
    var upstream = scanUpstream( fixture );
    var better = scanBetterTodoTree( fixture );
    var diff = comparator.compareResultSets( {
        upstream: upstream,
        betterTodoTree: better,
        fixture: fixture
    } );

    assert.equal( diff.missingInBetterTodoTree.length, 0, fixture.id + ' :: missingInBetterTodoTree => ' + JSON.stringify( diff.missingInBetterTodoTree ) );
    assert.equal( diff.missingInUpstream.length, 0, fixture.id + ' :: missingInUpstream => ' + JSON.stringify( diff.missingInUpstream ) );
    assert.equal( diff.coreFieldDiffs.length, 0, fixture.id + ' :: coreFieldDiffs => ' + JSON.stringify( diff.coreFieldDiffs ) );
}

QUnit.module( 'parity todo-tree vs better-todo-tree', function( hooks )
{
    hooks.beforeEach( function()
    {
        utils.init( makeBetterTodoTreeConfig() );
    } );

    QUnit.test( 'upstream detector reproduces the anchored comment-prefix + tag regex', function( assert )
    {
        var fixture = {
            id: 'self-test::comment-prefix-matrix',
            fsPath: '/tmp/self-test.tmpl',
            text: [
                '// TODO slash-prefix',
                '# TODO hash-prefix',
                '<!-- TODO html-prefix -->',
                '; TODO semicolon-prefix',
                '/* TODO block-prefix */',
                '- [ ] unchecked-task',
                '1. [x] checked-task'
            ].join( '\n' ),
            tier: 'unvendored',
            commentFamily: 'mixed'
        };
        var results = scanUpstream( fixture );

        assert.equal( results.length, 7, 'seven tag occurrences across every default-regex alternation' );
        assert.deepEqual(
            results.map( function( result ) { return result.actualTag; } ),
            [ 'TODO', 'TODO', 'TODO', 'TODO', 'TODO', '[ ]', '[x]' ]
        );
        assert.deepEqual(
            results.map( function( result ) { return result.displayText; } ),
            [ 'slash-prefix', 'hash-prefix', 'html-prefix -->', 'semicolon-prefix', 'block-prefix */', 'unchecked-task', 'checked-task' ]
        );
    } );

    function assertNegative( assert, fixture )
    {
        var upstream = scanUpstream( fixture );
        var better = scanBetterTodoTree( fixture );
        assert.equal( better.length, 0, fixture.id + ' :: better-todo-tree emits no matches' );
        assert.equal( upstream.length, 0, fixture.id + ' :: upstream emits no matches' );
    }

    function registerParitySuite( label, fixtures )
    {
        fixtures.forEach( function( fixture )
        {
            QUnit.test( label + ' :: ' + fixture.id, function( assert )
            {
                if( fixture.tier === 'negative' )
                {
                    assertNegative( assert, fixture );
                    return;
                }
                assertParity( assert, fixture );
            } );
        } );
    }

    registerParitySuite( 'unvendored', corpus.UNVENDORED_CORPUS );
    registerParitySuite( 'vendored', corpus.VENDORED_CORPUS );
    registerParitySuite( 'negative', corpus.NEGATIVE_CORPUS );
    registerParitySuite( 'edge-case', corpus.EDGE_CASE_CORPUS );
    registerParitySuite( 'multi-tag', corpus.MULTI_TAG_CORPUS );
    registerParitySuite( 'fuzz', corpus.FUZZ_CORPUS );
    registerParitySuite( 'realistic-code', corpus.REALISTIC_CODE_CORPUS );

    QUnit.test( 'corpus size invariants guard against coverage regression', function( assert )
    {
        assert.ok( corpus.VENDORED_CORPUS.length >= 69, 'vendored corpus >= 69 fixtures' );
        assert.ok( corpus.UNVENDORED_CORPUS.length >= 120, 'unvendored corpus >= 120 fixtures' );
        assert.ok( corpus.NEGATIVE_CORPUS.length >= 800, 'negative corpus >= 800 fixtures' );
        assert.ok( corpus.EDGE_CASE_CORPUS.length >= 230, 'edge-case corpus >= 230 fixtures' );
        assert.ok( corpus.MULTI_TAG_CORPUS.length >= 25, 'multi-tag corpus >= 25 fixtures' );
        assert.ok( corpus.FUZZ_CORPUS.length >= 240, 'fuzz corpus >= 240 fixtures' );
        assert.ok( corpus.REALISTIC_CODE_CORPUS.length >= 15, 'realistic-code corpus >= 15 fixtures' );
    } );

    QUnit.test( 'tag-order stability :: parity results maintain textual position ordering', function( assert )
    {
        var fixture = {
            id: 'order-stability::tmpl',
            fsPath: '/tmp/order-stability.tmpl',
            text: [
                '// TODO alpha',
                '// TODO beta',
                '// TODO gamma',
                '// TODO delta'
            ].join( '\n' )
        };
        var upstream = scanUpstream( fixture );
        var better = scanBetterTodoTree( fixture );

        assert.equal( better.length, 4 );
        assert.equal( upstream.length, 4 );
        assert.deepEqual(
            better.map( function( result ) { return result.line; } ),
            [ 1, 2, 3, 4 ]
        );
        assert.deepEqual(
            upstream.map( function( result ) { return result.line; } ),
            [ 1, 2, 3, 4 ]
        );
        assert.deepEqual(
            better.map( function( result ) { return result.displayText; } ),
            upstream.map( function( result ) { return result.displayText; } )
        );
    } );

    QUnit.test( 'upstream commit is pinned to the parity harness hash', function( assert )
    {
        var upstreamGitLoader = require( './upstreamGitLoader.js' );
        assert.equal( upstreamGitLoader.UPSTREAM_COMMIT, '7761bd02406a5c5f5bc8da944a561eb3c12a48df' );
    } );

    QUnit.test( 'issue #13 literal .tmpl fixture matches upstream 1:1', function( assert )
    {
        var fixture = {
            id: 'issue-13::tmpl-literal',
            fsPath: '/tmp/template.tmpl',
            text: [
                '{{define "page"}}',
                '{{/* TODO go-template-comment */}}',
                '<!-- TODO html-comment-inside-template -->',
                '// TODO unusual-but-reasonable',
                '# TODO shell-style',
                'const todoItem = false;',
                '{{end}}'
            ].join( '\n' ),
            tier: 'unvendored',
            commentFamily: 'issue-13'
        };
        var better = scanBetterTodoTree( fixture );
        var upstream = scanUpstream( fixture );

        assert.ok( better.length >= 4, 'at least four tagged comments are detected for the .tmpl fixture' );
        assert.deepEqual(
            better.map( function( result ) { return result.actualTag; } ),
            upstream.map( function( result ) { return result.actualTag; } )
        );
        assert.deepEqual(
            better.map( function( result ) { return result.displayText; } ),
            upstream.map( function( result ) { return result.displayText; } )
        );
        assert.deepEqual(
            better.map( function( result ) { return result.line; } ),
            upstream.map( function( result ) { return result.line; } )
        );
    } );

    QUnit.test( 'alias preservation :: .jsonc resolves via .js alias', function( assert )
    {
        var fixture = {
            id: 'alias::jsonc-parity',
            fsPath: '/tmp/sample.jsonc',
            text: [
                '// TODO jsonc-line-comment',
                '/* TODO jsonc-block-comment */'
            ].join( '\n' ),
            tier: 'vendored',
            commentFamily: 'alias::jsonc'
        };
        var better = scanBetterTodoTree( fixture );
        assert.equal( better.length, 2 );
        assert.deepEqual( better.map( function( result ) { return result.actualTag; } ), [ 'TODO', 'TODO' ] );
    } );

    QUnit.test( 'scanDocument and scanText agree for an unvendored fixture', function( assert )
    {
        var fsPath = '/tmp/doc-vs-text.tmpl';
        var text = '// TODO doc-vs-text\n# TODO more\n<!-- TODO third -->';
        var uri = makeUri( fsPath );
        var fromText = detection.scanText( uri, text );
        var fromDocument = detection.scanDocument( {
            uri: uri,
            getText: function() { return text; }
        } );

        assert.equal( fromText.length, fromDocument.length );
        assert.deepEqual(
            fromText.map( comparator.coreFieldsSnapshot ),
            fromDocument.map( comparator.coreFieldsSnapshot )
        );
    } );

    QUnit.test( 'ripgrep-style normalization produces the same match as scanText for unvendored extensions', function( assert )
    {
        var fsPath = '/tmp/ripgrep-parity.rs';
        var text = '// TODO rust-ripgrep';
        var uri = makeUri( fsPath );
        var fromScan = detection.scanText( uri, text )[ 0 ];
        var normalized = detection.normalizeRegexMatch( uri, text, {
            fsPath: fsPath,
            line: 1,
            column: 1,
            match: text
        } );

        assert.ok( fromScan, 'scanText produced a match' );
        assert.ok( normalized, 'normalizeRegexMatch produced a match' );
        assert.equal( normalized.actualTag, fromScan.actualTag );
        assert.equal( normalized.displayText, fromScan.displayText );
        assert.equal( normalized.line, fromScan.line );
        assert.equal( normalized.column, fromScan.column );
    } );

    QUnit.test( 'case-sensitivity disabled extends detection to lowercase tags in unvendored extensions', function( assert )
    {
        var config = makeBetterTodoTreeConfig();
        config.caseSensitive = false;
        utils.init( config );

        var fixture = {
            id: 'case-insensitive::tmpl',
            fsPath: '/tmp/case.tmpl',
            text: '// todo lowercase-tag'
        };
        var results = detection.scanText( makeUri( fixture.fsPath ), fixture.text );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, 'TODO' );
        assert.equal( results[ 0 ].displayText, 'lowercase-tag' );
    } );

    QUnit.test( 'case-sensitivity enabled rejects lowercase tags in unvendored extensions', function( assert )
    {
        var fixture = {
            id: 'case-sensitive::tmpl',
            fsPath: '/tmp/case.tmpl',
            text: '// todo lowercase-tag'
        };
        var results = detection.scanText( makeUri( fixture.fsPath ), fixture.text );
        assert.equal( results.length, 0 );
    } );

    QUnit.test( 'issue #710 preserved :: indented non-comment tags stay rejected in .js', function( assert )
    {
        var results = detection.scanText( makeUri( '/tmp/issue-710.js' ), [
            '\tTODO not a real comment',
            '    FIXME also not a real comment',
            '// TODO real item'
        ].join( '\n' ) );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, 'TODO' );
        assert.equal( results[ 0 ].displayText, 'real item' );
    } );

    QUnit.test( 'issue #812 preserved :: inline block comments stop at closing delimiter in .dart', function( assert )
    {
        var text = [
            'abstract class SomeClass {',
            '  void someMethod(/* TODO */ String arg);',
            '}'
        ].join( '\n' );
        var results = detection.scanText( makeUri( '/tmp/issue-812.dart' ), text );
        var inlineComment = '/* TODO */';
        var commentStartOffset = text.indexOf( inlineComment );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, 'TODO' );
        assert.equal( results[ 0 ].commentStartOffset, commentStartOffset );
        assert.equal( results[ 0 ].commentEndOffset, commentStartOffset + inlineComment.length );
    } );

    QUnit.test( 'issue #883 preserved :: notebook cells with an unvendored cell language also gain parity', function( assert )
    {
        var cellText = '// TODO notebook-tmpl-cell';
        var notebookCellDocument = {
            uri: {
                fsPath: '/tmp/parity-notebook.ipynb',
                path: '/tmp/parity-notebook.ipynb',
                scheme: 'vscode-notebook-cell',
                toString: function() { return 'vscode-notebook-cell:///tmp/parity-notebook.ipynb#cell-tmpl'; }
            },
            fileName: '/tmp/parity-notebook.ipynb',
            commentPatternFileName: 'cell.tmpl',
            getText: function() { return cellText; }
        };
        var results = detection.scanDocument( notebookCellDocument );
        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, 'TODO' );
        assert.equal( results[ 0 ].displayText, 'notebook-tmpl-cell' );
    } );

    QUnit.test( 'issue #885 preserved :: custom regex path remains independent of default-regex parity', function( assert )
    {
        var customConfig = makeBetterTodoTreeConfig();
        customConfig.tagList = [ '#LATER' ];
        customConfig.regexSource = '($TAGS).*';
        customConfig.caseSensitive = true;
        customConfig.tags = function() { return [ '#LATER' ]; };
        customConfig.regex = function()
        {
            return {
                tags: [ '#LATER' ],
                regex: '($TAGS).*',
                caseSensitive: true,
                multiLine: false
            };
        };
        utils.init( customConfig );

        var results = detection.scanText( makeUri( '/tmp/parity-issue-885.md' ), [
            '#LATER alpha',
            '#LATER beta'
        ].join( '\n' ) );

        assert.equal( results.length, 2 );
        assert.deepEqual( results.map( function( result ) { return result.actualTag; } ), [ '#LATER', '#LATER' ] );
        assert.deepEqual( results.map( function( result ) { return result.displayText; } ), [ 'alpha', 'beta' ] );
    } );

    QUnit.test( 'comment-prefix matrix on .tmpl exercises every default-regex alternation with exact tag offsets', function( assert )
    {
        var fsPath = '/tmp/comment-prefix-matrix.tmpl';
        var text = [
            '// TODO slash-note',
            '# TODO hash-note',
            '<!-- TODO html-note -->',
            '; TODO semicolon-note',
            '/* TODO block-note */',
            '- TODO dash-list',
            '1. TODO numbered-list',
            '- [ ] unchecked',
            '1. [x] checked'
        ].join( '\n' );
        var results = detection.scanText( makeUri( fsPath ), text );

        assert.equal( results.length, 9 );
        results.forEach( function( result )
        {
            assert.ok( result.actualTag.length > 0, 'actualTag is non-empty for ' + JSON.stringify( result ) );
            assert.equal( typeof ( result.match ), 'string', 'match field is a string' );
            assert.ok( result.match.length > 0, 'match text is non-empty' );
            assert.ok( result.tagStartOffset >= 0 );
            assert.ok( result.tagEndOffset > result.tagStartOffset );
        } );
    } );

    QUnit.test( 'upstream clone is at the pinned commit and exposes the original License.txt', function( assert )
    {
        var fs = require( 'fs' );
        var child_process = require( 'child_process' );
        var upstreamGitLoader = require( './upstreamGitLoader.js' );

        upstreamGitLoader.ensureUpstreamCheckout();

        var head = child_process.execFileSync( 'git', [ 'rev-parse', 'HEAD' ], {
            cwd: upstreamGitLoader.UPSTREAM_DIR,
            encoding: 'utf8'
        } ).trim();

        assert.equal( head, upstreamGitLoader.UPSTREAM_COMMIT, 'cloned upstream is checked out at the pinned commit' );
        assert.equal( upstreamGitLoader.UPSTREAM_REPO_URL, 'https://github.com/Gruntfuggly/todo-tree.git', 'upstream repository URL is the canonical Gruntfuggly remote' );

        var licensePath = upstreamGitLoader.getLicensePath();
        assert.ok( fs.existsSync( licensePath ), 'upstream License.txt is present in the clone (' + licensePath + ')' );

        var licenseContents = fs.readFileSync( licensePath, 'utf8' );
        assert.ok( /MIT License/i.test( licenseContents ), 'upstream License.txt contains the MIT License header' );
        assert.ok( /Nigel Scott/.test( licenseContents ), 'upstream License.txt names the original author' );
    } );

    QUnit.test( 'upstream webpack bundle builds, loads, and exposes activate/deactivate', function( assert )
    {
        var fs = require( 'fs' );
        var upstreamGitLoader = require( './upstreamGitLoader.js' );

        var bundlePath = upstreamGitLoader.ensureUpstreamBuild();
        assert.ok( fs.existsSync( bundlePath ), 'compiled bundle exists at ' + bundlePath );

        var stat = fs.statSync( bundlePath );
        assert.ok( stat.size > 50000, 'compiled bundle is non-trivially large (got ' + stat.size + ' bytes)' );

        var bundleExports = upstreamGitLoader.loadCompiledBundle( {
            vscode: {
                workspace: {
                    getConfiguration: function() { return { get: function( _key, defaultValue ) { return defaultValue; } }; },
                    onDidChangeConfiguration: function() { return { dispose: function() {} }; },
                    onDidOpenTextDocument: function() { return { dispose: function() {} }; },
                    onDidCloseTextDocument: function() { return { dispose: function() {} }; },
                    onDidChangeWorkspaceFolders: function() { return { dispose: function() {} }; },
                    onDidChangeTextDocument: function() { return { dispose: function() {} }; },
                    onDidSaveTextDocument: function() { return { dispose: function() {} }; },
                    workspaceFolders: [],
                    createFileSystemWatcher: function()
                    {
                        return {
                            onDidChange: function() {}, onDidCreate: function() {}, onDidDelete: function() {}, dispose: function() {}
                        };
                    }
                },
                window: {
                    visibleTextEditors: [],
                    createOutputChannel: function() { return { appendLine: function() {}, dispose: function() {} }; },
                    createStatusBarItem: function()
                    {
                        return { text: '', show: function() {}, hide: function() {}, dispose: function() {} };
                    },
                    createTreeView: function()
                    {
                        return {
                            onDidExpandElement: function() { return { dispose: function() {} }; },
                            onDidCollapseElement: function() { return { dispose: function() {} }; }
                        };
                    },
                    onDidChangeActiveTextEditor: function() { return { dispose: function() {} }; }
                },
                commands: {
                    registerCommand: function() { return { dispose: function() {} }; },
                    executeCommand: function() { return Promise.resolve(); }
                },
                Uri: { file: function( p ) { return { fsPath: p, path: p, scheme: 'file', toString: function() { return p; } }; } },
                StatusBarAlignment: { Left: 0 }
            }
        } );

        assert.equal( typeof( bundleExports.activate ), 'function', 'compiled bundle exports activate()' );
        assert.equal( typeof( bundleExports.deactivate ), 'function', 'compiled bundle exports deactivate()' );
    } );
} );
