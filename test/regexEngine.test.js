var regexEngine = require( '../src/regexEngine.js' );
var regexRegistry = require( '../src/regexRegistry.js' );

QUnit.module( "regex engine classification" );

QUnit.test( "lookaround requires PCRE2", function( assert )
{
    assert.equal( regexEngine.containsLookAround( undefined ), false );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'tagCaptureNotIdentifierSuffix' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'tagPositiveHashLookbehind' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'tagEscapedLookaheadLiteral' ) ), false );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'tagLookaroundSyntaxCharacterClass' ) ), false );
} );

QUnit.test( "backreference requires PCRE2", function( assert )
{
    assert.equal( regexEngine.containsBackreference( undefined ), false );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'tagBackreferenceOne' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'namedBackreferenceAngle' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'namedBackreferenceBrace' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'namedBackreferenceGBrace' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'tagWhitespaceBackreference' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'namedBackreferencePython' ) ), true );
    assert.equal( regexEngine.requiresPcre2( regexRegistry.pattern( 'tagEscapedBackreferenceOne' ) ), false );
} );

QUnit.test( "ripgrep engine args respect explicit engine selection", function( assert )
{
    assert.deepEqual( regexEngine.buildRegexEngineArgs( regexRegistry.pattern( 'tagNegativeXLookahead' ), [] ), [ '--pcre2' ] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( regexRegistry.pattern( 'tagNegativeXLookahead' ), [ '--pcre2' ] ), [] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( regexRegistry.pattern( 'tagNegativeXLookahead' ), [ '-P' ] ), [] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( regexRegistry.pattern( 'tagNegativeXLookahead' ), [ '--engine=default' ] ), [] );
    assert.deepEqual( regexEngine.buildRegexEngineArgs( regexRegistry.pattern( 'tagCapturePlaceholder' ), [] ), [] );
} );

QUnit.test( "tag candidate scan covers default and JavaScript-compatible tag regexes", function( assert )
{
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: true,
        regex: regexRegistry.pattern( 'tagCapturePlaceholder' )
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'tagCaptureNotIdentifierSuffix' )
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'tagColonAnyText' )
    } ), false );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'commentPrefixTagCapture' )
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'tagEndAnchor' )
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'tagWordBoundary' )
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'tagBeforeColon' )
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'tagCaptureNotIdentifierSuffix' )
    } ), true );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'negativeUppercaseLookbehindNote' )
    } ), false );
} );

QUnit.test( "tag candidate scan excludes PCRE2 syntax unsupported by JavaScript RegExp", function( assert )
{
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( undefined ), false );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( regexRegistry.pattern( 'namedBackreferenceAngle' ) ), false );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( regexRegistry.pattern( 'namedBackreferenceBrace' ) ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( regexRegistry.pattern( 'namedBackreferenceGBrace' ) ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( regexRegistry.pattern( 'tagWhitespaceBackreference' ) ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( regexRegistry.pattern( 'namedBackreferencePython' ) ), true );
    assert.equal( regexEngine.containsJavaScriptIncompatibleBackreference( regexRegistry.pattern( 'tagCharacterClassBackreferenceSyntax' ) ), false );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: regexRegistry.pattern( 'tagWhitespaceBackreference' )
    } ), false );
} );

QUnit.test( "tag candidate scan rejects regex tails that consume characters after tags", function( assert )
{
    [
        regexRegistry.pattern( 'tagColonAnyText' ),
        regexRegistry.pattern( 'tagAnyText' ),
        regexRegistry.pattern( 'tagQuestionTail' ),
        regexRegistry.pattern( 'tagQuantifiedOneTail' ),
        regexRegistry.pattern( 'tagAlternationBugTail' ),
        regexRegistry.pattern( 'tagUncheckedTaskTail' ),
        regexRegistry.pattern( 'tagWhitespaceItemTail' ),
        regexRegistry.pattern( 'tagNonCaptureItemTail' ),
        regexRegistry.pattern( 'tagUnterminatedLookaheadTail' ),
        regexRegistry.pattern( 'tagUnbalancedCloseTail' ),
        regexRegistry.pattern( 'tagCharacterClassPlaceholder' )
    ].forEach( function( regex )
    {
        assert.equal( regexEngine.shouldUseTagCandidateScan( {
            isDefaultRegex: false,
            regex: regex
        } ), false, regex );
    } );
} );
