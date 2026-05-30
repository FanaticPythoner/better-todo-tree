var regexEngine = require( '../src/regexEngine.js' );

QUnit.module( "regex engine classification" );

QUnit.test( "lookaround requires PCRE2", function( assert )
{
    assert.equal( regexEngine.requiresPcre2( '($TAGS)(?![A-Za-z0-9_])' ), true );
    assert.equal( regexEngine.requiresPcre2( '(?<=# )($TAGS)' ), true );
    assert.equal( regexEngine.requiresPcre2( '\\(\\?=literal\\)($TAGS)' ), false );
    assert.equal( regexEngine.requiresPcre2( '[()?=]+($TAGS)' ), false );
} );

QUnit.test( "backreference requires PCRE2", function( assert )
{
    assert.equal( regexEngine.requiresPcre2( '($TAGS)\\s+\\1' ), true );
    assert.equal( regexEngine.requiresPcre2( '(?<tag>TODO)\\s+\\k<tag>' ), true );
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
