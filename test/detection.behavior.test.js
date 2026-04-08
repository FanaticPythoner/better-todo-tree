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
} );
