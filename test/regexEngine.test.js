var regexEngine = require( '../src/regexEngine.js' );

QUnit.module( "regex engine classification" );

QUnit.test( "lookaround requires PCRE2", function( assert )
{
    assert.equal( regexEngine.containsLookAround( undefined ), false );
    assert.equal( regexEngine.requiresPcre2( '($TAGS)(?![A-Za-z0-9_])' ), true );
    assert.equal( regexEngine.requiresPcre2( '(?<=# )($TAGS)' ), true );
    assert.equal( regexEngine.requiresPcre2( '\\(\\?=literal\\)($TAGS)' ), false );
    assert.equal( regexEngine.requiresPcre2( '[()?=]+($TAGS)' ), false );
} );

QUnit.test( "backreference requires PCRE2", function( assert )
{
    assert.equal( regexEngine.containsBackreference( undefined ), false );
    assert.equal( regexEngine.requiresPcre2( '($TAGS)\\s+\\1' ), true );
    assert.equal( regexEngine.requiresPcre2( '(?<tag>TODO)\\s+\\k<tag>' ), true );
    assert.equal( regexEngine.requiresPcre2( '(?<tag>TODO)\\s+\\k{tag}' ), true );
    assert.equal( regexEngine.requiresPcre2( '(?<tag>TODO)\\s+\\g{tag}' ), true );
    assert.equal( regexEngine.requiresPcre2( '($TAGS)\\s+\\g{1}' ), true );
    assert.equal( regexEngine.requiresPcre2( '(?<tag>TODO)\\s+(?P=tag)' ), true );
    assert.equal( regexEngine.requiresPcre2( '($TAGS)\\\\1' ), false );
} );

QUnit.test( "ripgrep engine args respect explicit engine selection", function( assert )
{
    assert.deepEqual( regexEngine.buildRegexEngineArgs( '($TAGS)(?!x)', [] ), [ '--pcre2' ] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( '($TAGS)(?!x)', [ '--pcre2' ] ), [] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( '($TAGS)(?!x)', [ '-P' ] ), [] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( '($TAGS)(?!x)', [ '--engine=default' ] ), [] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( '($TAGS)', [] ), [] );
} );

QUnit.test( "tag candidate scan covers default and PCRE2 tag regexes", function( assert )
{
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: true,
        regex: '($TAGS)'
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: '($TAGS)(?![A-Za-z0-9_])'
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: '($TAGS):.*'
    } ), false );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: '(?<![A-Z])NOTE'
    } ), false );
} );

QUnit.test( "tag candidate scan excludes PCRE2 syntax unsupported by JavaScript RegExp", function( assert )
{
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( undefined ), false );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( '(?<tag>TODO)\\s+\\k<tag>' ), false );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( '(?<tag>TODO)\\s+\\k{tag}' ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( '(?<tag>TODO)\\s+\\g{tag}' ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( '($TAGS)\\s+\\g{1}' ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( '(?<tag>TODO)\\s+(?P=tag)' ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( '[\\g{1}]($TAGS)' ), false );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: '($TAGS)\\s+\\g{1}'
    } ), false );
} );
