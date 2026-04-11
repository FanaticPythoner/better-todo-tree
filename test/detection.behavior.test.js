var utils = require( '../src/utils.js' );
var detection = require( '../src/detection.js' );

function createConfig( overrides )
{
    var config = {
        tagList: [ "TODO", "FIXME", "[ ]", "[x]" ],
        regexSource: utils.DEFAULT_REGEX_SOURCE,
        caseSensitive: true,
        multiLine: false,
        subTagRegexString: "(^:\\s*)",
        tags()
        {
            return this.tagList;
        },
        regex()
        {
            return {
                tags: this.tagList,
                regex: this.regexSource,
                caseSensitive: this.caseSensitive,
                multiLine: this.multiLine
            };
        },
        subTagRegex()
        {
            return this.subTagRegexString;
        },
        isRegexCaseSensitive()
        {
            return this.caseSensitive;
        },
        shouldGroupByTag()
        {
            return false;
        },
        globs()
        {
            return [];
        },
        shouldUseColourScheme()
        {
            return false;
        },
        defaultHighlight()
        {
            return {};
        },
        customHighlight()
        {
            return {};
        },
        foregroundColourScheme()
        {
            return [];
        },
        backgroundColourScheme()
        {
            return [];
        }
    };

    return Object.assign( config, overrides || {} );
}

function createUri( fsPath )
{
    return {
        fsPath: fsPath,
        toString: function()
        {
            return fsPath;
        }
    };
}

function createNotebookCellDocument( notebookFsPath, cellId, languageId, text, commentPatternFileName )
{
    return {
        uri: {
            fsPath: notebookFsPath,
            scheme: 'vscode-notebook-cell',
            toString: function()
            {
                return 'vscode-notebook-cell://' + notebookFsPath + '#cell-' + cellId;
            }
        },
        fileName: notebookFsPath,
        languageId: languageId,
        commentPatternFileName: commentPatternFileName,
        getText: function()
        {
            return text;
        }
    };
}

QUnit.module( "behavioral detection", function( hooks )
{
    hooks.beforeEach( function()
    {
        utils.init( createConfig() );
    } );

    QUnit.test( "default detection ignores tag-like identifiers", function( assert )
    {
        var results = detection.scanText( createUri( "/tmp/sample.js" ), [
            "const todoVariable = 1;",
            "const fixmeFlag = false;",
            "const bugCount = 3;",
            "// TODO real item"
        ].join( "\n" ) );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, "TODO" );
        assert.equal( results[ 0 ].displayText, "real item" );
    } );

    QUnit.test( "default detection still ignores issue-report identifier examples when matching case-insensitively", function( assert )
    {
        utils.init( createConfig( {
            tagList: [ "TODO", "FIXME", "BUG" ],
            caseSensitive: false
        } ) );

        var results = detection.scanText( createUri( "/tmp/sample.js" ), [
            "todo_data = generate_intents(clustered_content, tenant_id, ref_id, site_url[0])",
            "fixmeList = []",
            "bugList = []",
            "// TODO: real item"
        ].join( "\n" ) );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, "TODO" );
        assert.equal( results[ 0 ].displayText, "real item" );
    } );

    QUnit.test( "markdown headings are ignored while markdown task list items are detected", function( assert )
    {
        var results = detection.scanText( createUri( "/tmp/notes.md" ), [
            "# TODO heading",
            "- [ ] real task",
            "## FIXME heading"
        ].join( "\n" ) );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, "[ ]" );
        assert.equal( results[ 0 ].displayText, "real task" );
    } );

    QUnit.test( "numbered markdown task list items reuse the same built-in marker parsing as unordered items", function( assert )
    {
        var results = detection.scanText( createUri( "/tmp/ordered-notes.md" ), [
            "1. [x] completed task",
            "2. [ ] pending task"
        ].join( "\n" ) );

        assert.equal( results.length, 2 );
        assert.equal( results[ 0 ].actualTag, "[x]" );
        assert.equal( results[ 0 ].displayText, "completed task" );
        assert.equal( results[ 1 ].actualTag, "[ ]" );
        assert.equal( results[ 1 ].displayText, "pending task" );
    } );

    QUnit.test( "markdown headings are ignored while html comments and task list items are detected", function( assert )
    {
        utils.init( createConfig( {
            tagList: [ "TODO", "FIXME", "[ ]" ]
        } ) );

        var results = detection.scanText( createUri( "/tmp/notes.md" ), [
            "# TODO heading",
            "<!-- FIXME This is a test",
            "and this is a",
            "TODO test -->",
            "- [ ] real task",
            "## FIXME heading"
        ].join( "\n" ) );

        assert.equal( results.length, 3 );
        assert.equal( results[ 0 ].actualTag, "FIXME" );
        assert.equal( results[ 0 ].displayText, "This is a test" );
        assert.deepEqual( results[ 0 ].continuationText, [ "and this is a" ] );
        assert.equal( results[ 1 ].actualTag, "TODO" );
        assert.equal( results[ 1 ].displayText, "test" );
        assert.equal( results[ 2 ].actualTag, "[ ]" );
        assert.equal( results[ 2 ].displayText, "real task" );
    } );

    QUnit.test( "python triple-quoted todos and line comments are detected", function( assert )
    {
        var results = detection.scanText( createUri( "/tmp/sample.py" ), [
            "\"\"\"",
            "TODO first",
            "next line",
            "\"\"\"",
            "# TODO second"
        ].join( "\n" ) );

        assert.equal( results.length, 2 );
        assert.equal( results[ 0 ].actualTag, "TODO" );
        assert.equal( results[ 0 ].displayText, "first" );
        assert.deepEqual( results[ 0 ].continuationText, [ "next line" ] );
        assert.equal( results[ 1 ].displayText, "second" );
    } );

    QUnit.test( "issue #710 ignores indented non-comment tags while keeping real comment matches", function( assert )
    {
        var results = detection.scanText( createUri( "/tmp/sample.js" ), [
            "\tTODO not a real comment",
            "    FIXME also not a real comment",
            "// TODO real item"
        ].join( "\n" ) );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, "TODO" );
        assert.equal( results[ 0 ].displayText, "real item" );
    } );

    QUnit.test( "block comments preserve continuation lines as one logical todo", function( assert )
    {
        var results = detection.scanText( createUri( "/tmp/sample.cpp" ), [
            "/*",
            " * TODO investigate parser",
            " * keep multiline detail",
            " */"
        ].join( "\n" ) );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].displayText, "investigate parser" );
        assert.deepEqual( results[ 0 ].continuationText, [ "keep multiline detail" ] );
    } );

    QUnit.test( "issue #812 inline block comments stop at the closing delimiter and ignore NOT-TODO controls", function( assert )
    {
        var text = [
            "abstract class SomeClass {",
            "  void someMethod(/* TODO */ String arg);",
            "  void anotherMethod(/* NOT-TODO */ String arg);",
            "}"
        ].join( "\n" );
        var results = detection.scanText( createUri( "/tmp/sample.dart" ), text );
        var inlineComment = "/* TODO */";
        var commentStartOffset = text.indexOf( inlineComment );
        var trailingCodeOffset = text.indexOf( " String arg" );
        var tagStartOffset = text.indexOf( "TODO" );

        assert.equal( results.length, 1 );
        assert.equal( results[ 0 ].actualTag, "TODO" );
        assert.equal( results[ 0 ].commentStartOffset, commentStartOffset );
        assert.equal( results[ 0 ].commentEndOffset, commentStartOffset + inlineComment.length );
        assert.equal( results[ 0 ].matchStartOffset, tagStartOffset );
        assert.equal( results[ 0 ].matchEndOffset, tagStartOffset + "TODO".length );
        assert.equal( results[ 0 ].commentEndOffset, trailingCodeOffset );
    } );

    QUnit.test( "document and text scanning produce the same canonical match shape", function( assert )
    {
        var uri = createUri( "/tmp/workspace.js" );
        var text = [
            "const value = 1; // TODO inline",
            "/* TODO block */"
        ].join( "\n" );

        var fromText = detection.scanText( uri, text );
        var fromDocument = detection.scanDocument( {
            uri: uri,
            getText: function()
            {
                return text;
            }
        } );

        assert.deepEqual( fromDocument, fromText );
    } );

    QUnit.test( "notebook cells resolve comment patterns from comment-patterns language data instead of the .ipynb container extension", function( assert )
    {
        var pythonCell = createNotebookCellDocument( '/tmp/notebook.ipynb', 'python', 'python', '# TODO notebook code item', '.py' );
        var markdownCell = createNotebookCellDocument( '/tmp/notebook.ipynb', 'markdown', 'markdown', '- [ ] notebook markdown task', '.md' );

        var pythonResults = detection.scanDocument( pythonCell );
        var markdownResults = detection.scanDocument( markdownCell );

        assert.equal( pythonResults.length, 1 );
        assert.equal( pythonResults[ 0 ].actualTag, 'TODO' );
        assert.equal( pythonResults[ 0 ].displayText, 'notebook code item' );
        assert.equal( markdownResults.length, 1 );
        assert.equal( markdownResults[ 0 ].actualTag, '[ ]' );
        assert.equal( markdownResults[ 0 ].displayText, 'notebook markdown task' );
    } );

    QUnit.test( "customHighlight entries do not register new tags until general.tags includes them", function( assert )
    {
        var uri = createUri( '/tmp/issue-898.js' );
        var text = [
            '// ChangeNote needs registration',
            '// TODO stays detected'
        ].join( '\n' );
        var config = createConfig( {
            tagList: [ 'TODO' ],
            regexSource: '(?://|#)\\s*($TAGS).*',
            customHighlight: function()
            {
                return {
                    ChangeNote: {
                        foreground: '#00C03F'
                    }
                };
            }
        } );

        utils.init( config );
        assert.deepEqual(
            detection.scanText( uri, text ).map( function( result ) { return result.actualTag; } ),
            [ 'TODO' ]
        );

        config.tagList = [ 'TODO', 'ChangeNote' ];
        utils.init( config );

        assert.deepEqual(
            detection.scanText( uri, text ).map( function( result ) { return result.actualTag; } ),
            [ 'ChangeNote', 'TODO' ]
        );
    } );
} );
