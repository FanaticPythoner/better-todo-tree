var regexRegistry = require( '../src/regexRegistry.js' );
var regexEngine = require( '../src/regexEngine.js' );
var utils = require( '../src/utils.js' );
var languageMatrix = require( './languageMatrix.js' );
var fs = require( 'fs' );
var path = require( 'path' );

QUnit.module( 'regex registry' );

QUnit.test( 'manifest and runtime default regex sources share one registry output', function( assert )
{
    var currentRegex = languageMatrix.findConfigurationProperty( 'better-todo-tree.regex.regex' );
    var legacyRegex = languageMatrix.findConfigurationProperty( 'todo-tree.regex.regex' );

    assert.equal( regexRegistry.DEFAULT_REGEX_SOURCE, currentRegex.default );
    assert.equal( regexRegistry.DEFAULT_REGEX_SOURCE, legacyRegex.default );
    assert.equal( utils.DEFAULT_REGEX_SOURCE, regexRegistry.DEFAULT_REGEX_SOURCE );
} );

QUnit.test( 'missing registry names throw typed errors', function( assert )
{
    assert.throws( function()
    {
        regexRegistry.fragment( 'missing-fragment' );
    }, regexRegistry.RegexRegistryError );

    assert.throws( function()
    {
        regexRegistry.pattern( 'missing-pattern' );
    }, regexRegistry.RegexRegistryError );
} );

QUnit.test( 'fragment factories compose default registry sources', function( assert )
{
    var builder = regexRegistry.createRegexBuilder();

    assert.equal( regexRegistry.fragment( 'blockCommentBannerPrefix' ), builder.sequence( [
        regexRegistry.fragment( 'blockCommentStart' ),
        '{3,}',
        regexRegistry.fragment( 'lineFeed' )
    ] ) );
    assert.equal( regexRegistry.fragment( 'markdownDefaultListPrefix' ), builder.sequence( [
        regexRegistry.fragment( 'lineStart' ),
        regexRegistry.fragment( 'horizontalWhitespaceZeroOrMore' ),
        regexRegistry.fragment( 'markdownDefaultListMarker' )
    ] ) );
    assert.equal( regexRegistry.fragment( 'markdownTaskCheckboxLine' ), builder.sequence( [
        regexRegistry.fragment( 'lineStart' ),
        regexRegistry.fragment( 'whitespaceZeroOrMore' ),
        regexRegistry.fragment( 'markdownTaskListMarker' ),
        regexRegistry.fragment( 'whitespaceZeroOrMore' ),
        regexRegistry.fragment( 'markdownTaskCheckbox' )
    ] ) );
    assert.equal( regexRegistry.fragment( 'legacyMarkdownTaskFragment' ), builder.sequence( [
        '|',
        regexRegistry.fragment( 'markdownMigrationListPrefix' ),
        ')'
    ] ) );
    assert.equal( regexRegistry.fragment( 'subTagPrefixCapture' ), builder.capture(
        regexRegistry.fragment( 'subTagPrefix' )
    ) );
    assert.equal( regexRegistry.fragment( 'tagNotIdentifierSuffix' ), builder.negativeLookahead(
        regexRegistry.fragment( 'identifierCharacter' )
    ) );
    assert.equal( regexRegistry.pattern( 'markdownTaskListLine' ), builder.sequence( [
        regexRegistry.fragment( 'lineStart' ),
        builder.capture( regexRegistry.fragment( 'markdownTaskListPrefix' ) ),
        regexRegistry.fragment( 'markdownTaskCheckbox' )
    ] ) );
    assert.equal( regexRegistry.fragment( 'namedBackreferenceBrace' ), builder.sequence( [
        builder.namedCapture( 'tag', regexRegistry.fragment( 'todoLiteral' ) ),
        regexRegistry.fragment( 'whitespaceOneOrMore' ),
        '\\k{tag}'
    ] ) );
    assert.equal( regexRegistry.pattern( 'tagAnyText' ), builder.sequence( [
        regexRegistry.pattern( 'tagCapturePlaceholder' ),
        regexRegistry.fragment( 'anyTextZeroOrMore' )
    ] ) );
    assert.equal( regexRegistry.pattern( 'tagPositiveHashLookbehind' ), builder.sequence( [
        regexRegistry.fragment( 'tagPositiveHashLookbehindPrefix' ),
        regexRegistry.pattern( 'tagCapturePlaceholder' )
    ] ) );
} );

QUnit.test( 'fragment sources and passthrough pattern declarations stay deduplicated', function( assert )
{
    var sourceByFragment = new Map();
    var sourceByPattern = new Map();
    var duplicateSources;
    var duplicatePatternSources;
    var registrySource = fs.readFileSync( path.join( __dirname, '../src/regexRegistry.js' ), 'utf8' );
    var patternBlock = registrySource.slice( registrySource.indexOf( 'patterns: Object.freeze' ) );

    regexRegistry.fragmentNames().forEach( function( name )
    {
        var source = regexRegistry.fragment( name );
        var names = sourceByFragment.get( source ) || [];
        names.push( name );
        sourceByFragment.set( source, names );
    } );

    duplicateSources = Array.from( sourceByFragment.entries() ).filter( function( entry )
    {
        return entry[ 1 ].length > 1;
    } );
    regexRegistry.patternNames().forEach( function( name )
    {
        var source = regexRegistry.pattern( name );
        var names = sourceByPattern.get( source ) || [];
        names.push( name );
        sourceByPattern.set( source, names );
    } );
    duplicatePatternSources = Array.from( sourceByPattern.entries() ).filter( function( entry )
    {
        return entry[ 1 ].length > 1;
    } );

    assert.deepEqual( duplicateSources, [] );
    assert.deepEqual( duplicatePatternSources, [] );
    assert.equal(
        patternBlock.indexOf( "builder.pattern( 'tagCapturePlaceholder' ) + builder.fragment" ),
        -1
    );
    assert.equal(
        patternBlock.indexOf( "'(?<tag>',\n                builder.fragment( 'todoLiteral' )," ),
        -1
    );
    assert.equal(
        regexRegistry.createRegExp( 'passthroughPatternDeclaration' ).test( patternBlock ),
        false
    );
    assert.equal( registrySource.indexOf( 'DEFAULT_FRAGMENT_PATTERN_NAMES' ), -1 );
    assert.equal( registrySource.indexOf( 'DEFAULT_TAG_CAPTURE_TAIL_PATTERNS' ), -1 );
    assert.equal( registrySource.indexOf( 'DEFAULT_TAG_CAPTURE_SUFFIX_PATTERNS' ), -1 );
    assert.equal( registrySource.indexOf( "fragmentName === 'anyTextZeroOrMore'" ), -1 );
    assert.equal( registrySource.indexOf( "fragmentName === 'colonAnyTextUntilEndLazy'" ), -1 );
    assert.equal( registrySource.indexOf( '/^tag[A-Z]/' ), -1 );
    assert.equal( registrySource.indexOf( 'replace( /ZeroOrMore$/' ), -1 );
    assert.ok( regexRegistry.fragmentPatternNames().indexOf( 'escapedSlashCommentPrefix' ) !== -1 );
    regexRegistry.fragmentPatternNames().forEach( function( name )
    {
        assert.equal( regexRegistry.pattern( name ), regexRegistry.fragment( name ), name );
    } );
} );

QUnit.test( 'generated patterns derive from fragment and pattern definitions', function( assert )
{
    var registry = new regexRegistry.RegexRegistry( {
        fragments: {
            alpha: 'a',
            anyTextTokenZeroOrMore: 'any',
            beta: 'b',
            colonAnyTextTokenLazy: 'colon',
            tagCapturePlaceholder: '($TAGS)',
            tagDoneSuffix: 'suffix',
            tagFooPlaceholder: 'placeholder',
            tagFooTail: 'tail',
            tagFooPrefix: 'pre',
            tagFooSyntax: 'syntax'
        },
        patterns: {
            beta: 'bb'
        }
    } );
    var fragmentPatternNames = registry.fragmentPatternNames();

    assert.notEqual( fragmentPatternNames.indexOf( 'alpha' ), -1 );
    assert.notEqual( fragmentPatternNames.indexOf( 'anyTextTokenZeroOrMore' ), -1 );
    assert.notEqual( fragmentPatternNames.indexOf( 'colonAnyTextTokenLazy' ), -1 );
    assert.notEqual( fragmentPatternNames.indexOf( 'tagCapturePlaceholder' ), -1 );
    assert.notEqual( fragmentPatternNames.indexOf( 'tagDoneSuffix' ), -1 );
    assert.notEqual( fragmentPatternNames.indexOf( 'tagFooPlaceholder' ), -1 );
    assert.notEqual( fragmentPatternNames.indexOf( 'tagFooPrefix' ), -1 );
    assert.equal( fragmentPatternNames.indexOf( 'beta' ), -1 );
    assert.equal( fragmentPatternNames.indexOf( 'tagFooTail' ), -1 );
    assert.equal( fragmentPatternNames.indexOf( 'tagFooSyntax' ), -1 );
    assert.equal( registry.pattern( 'alpha' ), 'a' );
    assert.equal( registry.pattern( 'beta' ), 'bb' );
    assert.equal( registry.pattern( 'tagAnyTextToken' ), '($TAGS)any' );
    assert.equal( registry.pattern( 'tagColonAnyTextTokenLazy' ), '($TAGS)colon' );
    assert.equal( registry.pattern( 'tagCaptureDoneSuffix' ), '($TAGS)suffix' );
    assert.equal( registry.pattern( 'tagFooTail' ), '($TAGS)tail' );
    assert.equal( registry.pattern( 'tagFoo' ), 'pre($TAGS)' );
    assert.equal( registry.pattern( 'tagFooPrefix' ), 'pre' );
    assert.equal( registry.pattern( 'tagFooPlaceholder' ), 'placeholder' );
    assert.equal( registry.pattern( 'tagFooSyntax' ), 'syntax($TAGS)' );
} );

QUnit.test( 'fragment and pattern cycles throw typed registry errors', function( assert )
{
    var fragmentCycle = new regexRegistry.RegexRegistry( {
        fragments: {
            a: function( builder )
            {
                return builder.fragment( 'b' );
            },
            b: function( builder )
            {
                return builder.fragment( 'a' );
            }
        },
        patterns: {}
    } );
    var patternCycle = new regexRegistry.RegexRegistry( {
        fragments: {
            x: 'x'
        },
        patterns: {
            a: function( builder )
            {
                return builder.pattern( 'b' );
            },
            b: function( builder )
            {
                return builder.pattern( 'a' );
            }
        }
    } );
    var invalidFragment = new regexRegistry.RegexRegistry( {
        fragments: {
            x: function()
            {
                return 7;
            }
        },
        patterns: {}
    } );
    var duplicateFragmentPattern = {
        fragments: {
            x: 'x'
        },
        fragmentPatterns: [ 'x', 'x' ],
        patterns: {}
    };
    var overridingFragmentPattern = {
        fragments: {
            x: 'x'
        },
        fragmentPatterns: [ 'x' ],
        patterns: {
            x: 'y'
        }
    };

    assert.throws( function()
    {
        fragmentCycle.fragment( 'a' );
    }, function( error )
    {
        return error instanceof regexRegistry.RegexRegistryError &&
            error.message === 'fragment cycle: a -> b -> a';
    } );
    assert.throws( function()
    {
        patternCycle.pattern( 'a' );
    }, function( error )
    {
        return error instanceof regexRegistry.RegexRegistryError &&
            error.message === 'pattern cycle: a -> b -> a';
    } );
    assert.throws( function()
    {
        invalidFragment.fragment( 'x' );
    }, regexRegistry.RegexRegistryError );
    assert.throws( function()
    {
        return new regexRegistry.RegexRegistry( duplicateFragmentPattern );
    }, regexRegistry.RegexRegistryError );
    assert.throws( function()
    {
        return new regexRegistry.RegexRegistry( overridingFragmentPattern );
    }, regexRegistry.RegexRegistryError );
} );

QUnit.test( 'builder composes comment-prefix tag capture from fragments', function( assert )
{
    var builder = regexRegistry.createRegexBuilder();
    var source = builder.sequence( [
        builder.capture( builder.alternationFragments( [
            'slashCommentPrefix',
            'hashCommentPrefix',
            'htmlCommentStart',
            'semicolonCommentPrefix',
            'blockCommentStart',
            'cobolCommentPrefix',
            'cobolFixedColumnCommentPrefix',
            'sqlLineCommentPrefix'
        ] ) ),
        builder.fragment( 'whitespaceZeroOrMore' ),
        builder.capture( builder.fragment( 'tagPlaceholder' ) )
    ] );

    assert.equal( source, regexRegistry.pattern( 'commentPrefixTagCapture' ) );
    assert.equal( regexEngine.shouldUseTagCandidateScan( {
        isDefaultRegex: false,
        regex: source
    } ), true );
} );

QUnit.test( 'literal alternation builder preserves tag metacharacters', function( assert )
{
    var tags = [ '[ ]', '[x]', 'TODO+', 'BUG?', 'a.b', 'slash\\tag', '{x}' ];
    var source = '^' + regexRegistry.buildEscapedAlternationCaptureSource( tags ) + '$';
    var regex = new RegExp( source );

    tags.forEach( function( tag )
    {
        assert.equal( regex.test( tag ), true, tag );
    } );
    assert.equal( regex.test( 'TODOO' ), false );
} );

QUnit.test( 'format label placeholders compile through the registry builder', function( assert )
{
    var regex = new RegExp( regexRegistry.buildFormatLabelSource( [
        'tag',
        'after',
        'tag:uppercase'
    ] ), 'gi' );

    assert.deepEqual( '${tag} ${after} ${tag:uppercase}'.match( regex ), [
        '${tag}',
        '${after}',
        '${tag:uppercase}'
    ] );
} );

QUnit.test( 'shared fixture regexes preserve benchmark and parser contracts', function( assert )
{
    var builder = regexRegistry.createRegexBuilder();

    assert.equal( regexRegistry.pattern( 'todoCapture' ), builder.capture( regexRegistry.fragment( 'todoLiteral' ) ) );
    assert.equal( regexRegistry.pattern( 'noteCapture' ), builder.capture( regexRegistry.fragment( 'noteLiteral' ) ) );
    assert.equal( regexRegistry.pattern( 'xxxCapture' ), builder.capture( regexRegistry.fragment( 'xxxLiteral' ) ) );
    assert.equal( regexRegistry.pattern( 'todoFixmeCapture' ), builder.capture( builder.alternationFragments( [
        'todoLiteral',
        'fixmeLiteral'
    ] ) ) );
    assert.equal( regexRegistry.pattern( 'todoColonLine' ), builder.sequence( [
        regexRegistry.pattern( 'todoCapture' ),
        regexRegistry.fragment( 'colonWhitespaceZeroOrMore' ),
        regexRegistry.fragment( 'nonNewlineOneOrMore' )
    ] ) );
    assert.equal( regexRegistry.pattern( 'todoFunctionLine' ), builder.sequence( [
        regexRegistry.fragment( 'todoFunctionPrefix' ),
        regexRegistry.fragment( 'colonWhitespaceZeroOrMore' ),
        regexRegistry.fragment( 'nonNewlineOneOrMore' )
    ] ) );
    assert.equal( regexRegistry.pattern( 'tagPositiveHashLookbehind' ), builder.sequence( [
        regexRegistry.fragment( 'tagPositiveHashLookbehindPrefix' ),
        regexRegistry.pattern( 'tagCapturePlaceholder' )
    ] ) );
    assert.equal( regexRegistry.pattern( 'tagEscapedLookaheadLiteral' ), builder.sequence( [
        regexRegistry.fragment( 'tagEscapedLookaheadLiteralPrefix' ),
        regexRegistry.pattern( 'tagCapturePlaceholder' )
    ] ) );
    assert.equal( regexRegistry.pattern( 'namedBackreferenceBrace' ), regexRegistry.fragment( 'namedBackreferenceBrace' ) );
    assert.equal( regexRegistry.createRegExp( 'digitsOnly' ).test( '12345' ), true );
    assert.equal( regexRegistry.createRegExp( 'digitsOnly' ).test( '12a45' ), false );
    assert.equal( regexRegistry.createRegExp( 'markdownFileExtension', 'i' ).test( 'README.MD' ), true );
    assert.equal( regexRegistry.createRegExp( 'slashTodoLineNumber', 'g' ).exec( '// TODO line27' )[ 1 ], '27' );
    assert.deepEqual(
        regexRegistry.createRegExp( 'slashTodoFixmeWord', 'g' ).exec( '// FIXME real-73' ).slice( 1 ),
        [ 'FIXME', 'real-73' ]
    );
} );
