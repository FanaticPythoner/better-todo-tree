/* jshint esversion:6, node: true */

'use strict';

class RegexRegistryError extends Error
{
    constructor( message )
    {
        super( message );
        this.name = 'RegexRegistryError';
    }
}

function assertString( name, value )
{
    if( typeof value !== 'string' )
    {
        throw new RegexRegistryError( name + ': expected string' );
    }

    return value;
}

function assertArray( name, value )
{
    if( Array.isArray( value ) !== true )
    {
        throw new RegexRegistryError( name + ': expected array' );
    }

    return value;
}

function assertUniqueStringArray( name, value )
{
    var seen = new Set();

    return assertArray( name, value ).map( function( entry )
    {
        entry = assertString( name + ' entry', entry );

        if( seen.has( entry ) )
        {
            throw new RegexRegistryError( name + ': duplicate entry ' + entry );
        }

        seen.add( entry );

        return entry;
    } );
}

var REGEX_SYNTAX_CHARACTER_SOURCE = '[|\\\\{}()[\\]^$+*?.-]';
var REGEX_SYNTAX_CHARACTER_REGEX = new RegExp( REGEX_SYNTAX_CHARACTER_SOURCE, 'g' );
var TAG_PLACEHOLDER = '$TAGS';
var TAG_CAPTURE_PLACEHOLDER = '($TAGS)';

function escapeRegexLiteral( value )
{
    return assertString( 'value', value ).replace( REGEX_SYNTAX_CHARACTER_REGEX, '\\$&' );
}

function captureSource( source )
{
    return '(' + assertString( 'source', source ) + ')';
}

function joinAlternation( sources )
{
    return assertArray( 'sources', sources ).map( function( source )
    {
        return assertString( 'source', source );
    } ).join( '|' );
}

function buildEscapedAlternationSource( values )
{
    return assertArray( 'values', values ).map( escapeRegexLiteral ).join( '|' );
}

function buildEscapedAlternationCaptureSource( values )
{
    return captureSource( buildEscapedAlternationSource( values ) );
}

function captureLiteralSource( value )
{
    return captureSource( escapeRegexLiteral( value ) );
}

function buildFormatLabelSource( names )
{
    return '\\$\\{' + captureSource( buildEscapedAlternationSource( names ) ) + '\\}';
}

function createFragmentPattern( name )
{
    return function( builder )
    {
        return builder.fragment( name );
    };
}

function createFragmentPatternMap( names )
{
    var patterns = {};

    assertUniqueStringArray( 'fragmentPatterns', names ).forEach( function( name )
    {
        patterns[ name ] = createFragmentPattern( name );
    } );

    return patterns;
}

function upperInitial( value )
{
    value = assertString( 'value', value );

    return value.charAt( 0 ).toUpperCase() + value.slice( 1 );
}

function removeSuffix( value, suffix )
{
    value = assertString( 'value', value );
    suffix = assertString( 'suffix', suffix );

    return value.slice( 0, value.length - suffix.length );
}

function ownKeys( value )
{
    return Object.keys( value || {} );
}

function isUppercaseAscii( value, index )
{
    var code = assertString( 'value', value ).charCodeAt( index );

    return code >= 65 && code <= 90;
}

function hasPrefix( prefix )
{
    prefix = assertString( 'prefix', prefix );

    return function( value )
    {
        return assertString( 'value', value ).indexOf( prefix ) === 0;
    };
}

function hasSuffix( suffix )
{
    suffix = assertString( 'suffix', suffix );

    return function( value )
    {
        value = assertString( 'value', value );

        return value.slice( value.length - suffix.length ) === suffix;
    };
}

function containsText( text )
{
    text = assertString( 'text', text );

    return function( value )
    {
        return assertString( 'value', value ).indexOf( text ) !== -1;
    };
}

function hasCamelPrefix( prefix )
{
    var startsWithPrefix = hasPrefix( prefix );

    return function( value )
    {
        value = assertString( 'value', value );

        return startsWithPrefix( value ) && isUppercaseAscii( value, prefix.length );
    };
}

function hasAnySuffix( suffixes )
{
    var suffixPredicates = assertArray( 'suffixes', suffixes ).map( function( suffix )
    {
        return hasSuffix( assertString( 'suffix', suffix ) );
    } );

    return function( value )
    {
        return suffixPredicates.some( function( predicate )
        {
            return predicate( value );
        } );
    };
}

function andPredicates( predicates )
{
    predicates = assertArray( 'predicates', predicates );

    return function( value )
    {
        return predicates.every( function( predicate )
        {
            return predicate( value );
        } );
    };
}

function notPredicate( predicate )
{
    return function( value )
    {
        return predicate( value ) !== true;
    };
}

function assertRegisteredFragmentName( fragments, context, name )
{
    name = assertString( context, name );

    if( Object.prototype.hasOwnProperty.call( fragments, name ) !== true )
    {
        throw new RegexRegistryError( context + ': fragment not registered ' + name );
    }

    return name;
}

function assertStringMapFragments( fragments, name, mapping )
{
    var values = {};

    mapping = mapping || {};
    Object.keys( mapping ).forEach( function( patternName )
    {
        var fragmentName = assertString( name + ' ' + patternName, mapping[ patternName ] );

        values[ patternName ] = assertRegisteredFragmentName( fragments, name + ' ' + patternName, fragmentName );
    } );

    return values;
}

function createMappedFragmentPatternMap( name, mapping, createPattern )
{
    var patterns = {};

    mapping = mapping || {};
    Object.keys( mapping ).forEach( function( patternName )
    {
        patterns[ patternName ] = createPattern( assertString( name + ' ' + patternName, mapping[ patternName ] ) );
    } );

    return patterns;
}

function mergeGeneratedPatternMaps( maps )
{
    var merged = {};

    assertArray( 'maps', maps ).forEach( function( map )
    {
        Object.keys( map || {} ).forEach( function( name )
        {
            if( Object.prototype.hasOwnProperty.call( merged, name ) === true )
            {
                throw new RegexRegistryError( 'generated pattern duplicate: ' + name );
            }

            merged[ name ] = map[ name ];
        } );
    } );

    return merged;
}

function createNameDerivationRule( predicate, projector )
{
    return Object.freeze( {
        predicate: predicate,
        projector: projector
    } );
}

function deriveNameFromRules( rules, value )
{
    rules = assertArray( 'rules', rules );

    for( var index = 0; index < rules.length; index++ )
    {
        if( rules[ index ].predicate( value ) === true )
        {
            return rules[ index ].projector( value );
        }
    }

    return null;
}

var TAG_PATTERN_NAME_PREFIX = 'tag';
var CAPTURE_NAME_PART = 'Capture';
var ANY_TEXT_NAME_PREFIX = 'anyText';
var ANY_TEXT_NAME_PART = upperInitial( ANY_TEXT_NAME_PREFIX );
var COLON_NAME_PREFIX = 'colon';
var ZERO_OR_MORE_NAME_SUFFIX = 'ZeroOrMore';
var LAZY_NAME_SUFFIX = 'Lazy';
var PREFIX_NAME_SUFFIX = 'Prefix';
var PLACEHOLDER_NAME_SUFFIX = 'Placeholder';
var SUFFIX_NAME_SUFFIX = 'Suffix';
var SYNTAX_NAME_SUFFIX = 'Syntax';
var TAG_CAPTURE_TAIL_EXCLUDED_SUFFIXES = Object.freeze( [
    PLACEHOLDER_NAME_SUFFIX,
    PREFIX_NAME_SUFFIX,
    SYNTAX_NAME_SUFFIX
] );

var TAG_CAPTURE_TAIL_NAME_RULES = Object.freeze( [
    createNameDerivationRule(
        andPredicates( [
            hasPrefix( ANY_TEXT_NAME_PREFIX ),
            hasSuffix( ZERO_OR_MORE_NAME_SUFFIX )
        ] ),
        function( fragmentName )
        {
            return TAG_PATTERN_NAME_PREFIX + upperInitial( removeSuffix( fragmentName, ZERO_OR_MORE_NAME_SUFFIX ) );
        }
    ),
    createNameDerivationRule(
        andPredicates( [
            hasPrefix( COLON_NAME_PREFIX ),
            containsText( ANY_TEXT_NAME_PART ),
            hasSuffix( LAZY_NAME_SUFFIX )
        ] ),
        function( fragmentName )
        {
            return TAG_PATTERN_NAME_PREFIX + upperInitial( fragmentName );
        }
    ),
    createNameDerivationRule(
        andPredicates( [
            hasCamelPrefix( TAG_PATTERN_NAME_PREFIX ),
            hasSuffix( SUFFIX_NAME_SUFFIX )
        ] ),
        function( fragmentName )
        {
            return TAG_PATTERN_NAME_PREFIX + CAPTURE_NAME_PART + fragmentName.slice( TAG_PATTERN_NAME_PREFIX.length );
        }
    ),
    createNameDerivationRule(
        andPredicates( [
            hasCamelPrefix( TAG_PATTERN_NAME_PREFIX ),
            notPredicate( hasAnySuffix( TAG_CAPTURE_TAIL_EXCLUDED_SUFFIXES ) )
        ] ),
        function( fragmentName )
        {
            return fragmentName;
        }
    )
] );

var TAG_CAPTURE_SUFFIX_NAME_RULES = Object.freeze( [
    createNameDerivationRule(
        andPredicates( [
            hasCamelPrefix( TAG_PATTERN_NAME_PREFIX ),
            hasSuffix( PREFIX_NAME_SUFFIX )
        ] ),
        function( fragmentName )
        {
            return removeSuffix( fragmentName, PREFIX_NAME_SUFFIX );
        }
    ),
    createNameDerivationRule(
        andPredicates( [
            hasCamelPrefix( TAG_PATTERN_NAME_PREFIX ),
            hasSuffix( SYNTAX_NAME_SUFFIX )
        ] ),
        function( fragmentName )
        {
            return fragmentName;
        }
    )
] );

function deriveTagCaptureTailPatternName( fragmentName )
{
    return deriveNameFromRules( DEFAULT_DERIVATION_RULE_SETS.tagCaptureTail, fragmentName );
}

function deriveTagCaptureSuffixPatternName( fragmentName )
{
    return deriveNameFromRules( DEFAULT_DERIVATION_RULE_SETS.tagCaptureSuffix, fragmentName );
}

function assertDerivationRuleSets( ruleSets )
{
    Object.keys( ruleSets ).forEach( function( name )
    {
        assertArray( name, ruleSets[ name ] ).forEach( function( rule )
        {
            if( typeof rule.predicate !== 'function' || typeof rule.projector !== 'function' )
            {
                throw new RegexRegistryError( name + ': invalid rule' );
            }
        } );
    } );

    return ruleSets;
}

var DEFAULT_DERIVATION_RULE_SETS = Object.freeze( assertDerivationRuleSets( {
    tagCaptureTail: TAG_CAPTURE_TAIL_NAME_RULES,
    tagCaptureSuffix: TAG_CAPTURE_SUFFIX_NAME_RULES
} ) );

function deriveMappedFragmentPatterns( fragments, derivePatternName )
{
    var mapping = {};

    ownKeys( fragments ).sort().forEach( function( fragmentName )
    {
        var patternName = derivePatternName( fragmentName );

        if( patternName !== null )
        {
            if( Object.prototype.hasOwnProperty.call( mapping, patternName ) === true )
            {
                throw new RegexRegistryError( 'derived pattern duplicate: ' + patternName );
            }

            mapping[ patternName ] = fragmentName;
        }
    } );

    return mapping;
}

function deriveFragmentPatternNames( fragments, occupiedPatternNames )
{
    return ownKeys( fragments ).filter( function( name )
    {
        return occupiedPatternNames.has( name ) !== true;
    } ).sort();
}

function createTagCaptureTailPattern( fragmentName )
{
    return function( builder )
    {
        return builder.sequence( [
            builder.pattern( 'tagCapturePlaceholder' ),
            builder.fragment( fragmentName )
        ] );
    };
}

function createTagCaptureSuffixPattern( fragmentName )
{
    return function( builder )
    {
        return builder.sequence( [
            builder.fragment( fragmentName ),
            builder.pattern( 'tagCapturePlaceholder' )
        ] );
    };
}

function createNamedTodoBackreferenceFragment( backreferenceSource )
{
    backreferenceSource = assertString( 'backreferenceSource', backreferenceSource );

    return function( builder )
    {
        return builder.sequence( [
            builder.namedCapture( 'tag', builder.fragment( 'todoLiteral' ) ),
            builder.fragment( 'whitespaceOneOrMore' ),
            backreferenceSource
        ] );
    };
}

class RegexBuilder
{
    constructor( registry, fragmentStack, patternStack )
    {
        this.registry = registry;
        this.fragmentStack = fragmentStack || [];
        this.patternStack = patternStack || [];
        Object.freeze( this );
    }

    literal( value )
    {
        return escapeRegexLiteral( value );
    }

    fragment( name )
    {
        return this.registry.resolveFragment( name, this.fragmentStack, this.patternStack );
    }

    pattern( name )
    {
        return this.registry.resolvePattern( name, this.fragmentStack, this.patternStack );
    }

    sequence( sources )
    {
        return assertArray( 'sources', sources ).map( function( source )
        {
            return assertString( 'source', source );
        } ).join( '' );
    }

    alternation( sources )
    {
        return joinAlternation( sources );
    }

    alternationFragments( names )
    {
        var builder = this;

        return this.alternation( assertArray( 'names', names ).map( function( name )
        {
            return builder.fragment( name );
        } ) );
    }

    capture( source )
    {
        return captureSource( source );
    }

    namedCapture( name, source )
    {
        return '(?<' + assertString( 'name', name ) + '>' + assertString( 'source', source ) + ')';
    }

    nonCapture( source )
    {
        return '(?:' + assertString( 'source', source ) + ')';
    }

    positiveLookahead( source )
    {
        return '(?=' + assertString( 'source', source ) + ')';
    }

    negativeLookahead( source )
    {
        return '(?!' + assertString( 'source', source ) + ')';
    }

    positiveLookbehind( source )
    {
        return '(?<=' + assertString( 'source', source ) + ')';
    }

    negativeLookbehind( source )
    {
        return '(?<!' + assertString( 'source', source ) + ')';
    }

    zeroOrMore( source )
    {
        return assertString( 'source', source ) + '*';
    }

    oneOrMore( source )
    {
        return assertString( 'source', source ) + '+';
    }

    optional( source )
    {
        return assertString( 'source', source ) + '?';
    }
}

class RegexRegistry
{
    constructor( definition )
    {
        var tagCaptureTailPatterns;
        var tagCaptureSuffixPatterns;
        var tagGeneratedPatterns;
        var occupiedPatternNames;
        var generatedPatterns;

        definition = definition || {};
        this.fragmentDefinitions = Object.freeze( Object.assign( {}, definition.fragments ) );
        tagCaptureTailPatterns = assertStringMapFragments(
            this.fragmentDefinitions,
            'definition.tagCaptureTailPatterns',
            definition.tagCaptureTailPatterns === undefined ?
                deriveMappedFragmentPatterns( this.fragmentDefinitions, deriveTagCaptureTailPatternName ) :
                definition.tagCaptureTailPatterns
        );
        tagCaptureSuffixPatterns = assertStringMapFragments(
            this.fragmentDefinitions,
            'definition.tagCaptureSuffixPatterns',
            definition.tagCaptureSuffixPatterns === undefined ?
                deriveMappedFragmentPatterns( this.fragmentDefinitions, deriveTagCaptureSuffixPatternName ) :
                definition.tagCaptureSuffixPatterns
        );
        tagGeneratedPatterns = mergeGeneratedPatternMaps( [
            createMappedFragmentPatternMap(
                'definition.tagCaptureTailPatterns',
                tagCaptureTailPatterns,
                createTagCaptureTailPattern
            ),
            createMappedFragmentPatternMap(
                'definition.tagCaptureSuffixPatterns',
                tagCaptureSuffixPatterns,
                createTagCaptureSuffixPattern
            )
        ] );
        occupiedPatternNames = new Set( ownKeys( definition.patterns ).concat( ownKeys( tagGeneratedPatterns ) ) );
        this.fragmentPatternNamesValue = Object.freeze( assertUniqueStringArray(
            'definition.fragmentPatterns',
            definition.fragmentPatterns === undefined ?
                deriveFragmentPatternNames( this.fragmentDefinitions, occupiedPatternNames ) :
                definition.fragmentPatterns
        ) );
        this.fragmentPatternNamesValue.forEach( function( name )
        {
            if( Object.prototype.hasOwnProperty.call( this.fragmentDefinitions, name ) !== true )
            {
                throw new RegexRegistryError( 'fragment pattern not registered: ' + name );
            }
        }, this );
        generatedPatterns = mergeGeneratedPatternMaps( [
            tagGeneratedPatterns,
            createFragmentPatternMap( this.fragmentPatternNamesValue )
        ] );
        Object.keys( generatedPatterns ).forEach( function( name )
        {
            if( Object.prototype.hasOwnProperty.call( definition.patterns || {}, name ) === true )
            {
                throw new RegexRegistryError( 'fragment pattern overrides pattern: ' + name );
            }
        }, this );
        this.patterns = Object.freeze( Object.assign( generatedPatterns, definition.patterns ) );
        this.fragmentCache = new Map();
        this.patternCache = new Map();
        Object.freeze( this );
    }

    fragment( name )
    {
        return this.resolveFragment( name, [], [] );
    }

    resolveFragment( name, fragmentStack, patternStack )
    {
        if( this.fragmentCache.has( name ) )
        {
            return this.fragmentCache.get( name );
        }

        if( Object.prototype.hasOwnProperty.call( this.fragmentDefinitions, name ) !== true )
        {
            throw new RegexRegistryError( 'fragment not registered: ' + name );
        }

        if( fragmentStack.indexOf( name ) !== -1 )
        {
            throw new RegexRegistryError( 'fragment cycle: ' + fragmentStack.concat( [ name ] ).join( ' -> ' ) );
        }

        var fragment = this.fragmentDefinitions[ name ];
        var source;

        if( typeof fragment === 'string' )
        {
            source = fragment;
        }
        else if( typeof fragment === 'function' )
        {
            source = fragment( new RegexBuilder( this, fragmentStack.concat( [ name ] ), patternStack ) );
        }
        else
        {
            throw new RegexRegistryError( 'fragment invalid: ' + name );
        }

        source = assertString( 'fragment ' + name, source );
        this.fragmentCache.set( name, source );

        return source;
    }

    pattern( name )
    {
        return this.resolvePattern( name, [], [] );
    }

    resolvePattern( name, fragmentStack, patternStack )
    {
        if( this.patternCache.has( name ) )
        {
            return this.patternCache.get( name );
        }

        var pattern = this.patterns[ name ];

        if( pattern === undefined )
        {
            throw new RegexRegistryError( 'pattern not registered: ' + name );
        }

        if( patternStack.indexOf( name ) !== -1 )
        {
            throw new RegexRegistryError( 'pattern cycle: ' + patternStack.concat( [ name ] ).join( ' -> ' ) );
        }

        var source;

        if( typeof pattern === 'string' )
        {
            source = pattern;
        }
        else if( typeof pattern === 'function' )
        {
            source = pattern( new RegexBuilder( this, fragmentStack, patternStack.concat( [ name ] ) ) );
        }
        else
        {
            throw new RegexRegistryError( 'pattern invalid: ' + name );
        }

        source = assertString( 'pattern ' + name, source );
        this.patternCache.set( name, source );

        return source;
    }

    createRegExp( name, flags )
    {
        return new RegExp( this.pattern( name ), flags || '' );
    }

    createBuilder()
    {
        return new RegexBuilder( this, [], [] );
    }

    fragmentNames()
    {
        return Object.keys( this.fragmentDefinitions ).sort();
    }

    patternNames()
    {
        return Object.keys( this.patterns ).sort();
    }

    fragmentPatternNames()
    {
        return this.fragmentPatternNamesValue.slice().sort();
    }
}

var DEFAULT_DEFINITION = Object.freeze( {
    fragments: Object.freeze( {
        empty: '',
        tagPlaceholder: TAG_PLACEHOLDER,
        tagCapturePlaceholder: TAG_CAPTURE_PLACEHOLDER,
        lineStart: '^',
        tagEndAnchor: '$',
        slashCommentPrefix: '//',
        escapedSlashCommentPrefix: '\\/\\/',
        hashCommentPrefix: '#',
        htmlCommentStart: '<!--',
        semicolonCommentPrefix: ';',
        colon: ':',
        comma: ',',
        equalsSign: '=',
        doubleQuote: '"',
        percent: '%',
        escapedDot: '\\.',
        blockCommentStart: '/\\*',
        escapedBlockCommentStart: '\\/\\*',
        blockCommentBannerPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'blockCommentStart' ),
                '{3,}',
                builder.fragment( 'lineFeed' )
            ] );
        },
        blockCommentStartOptionalApiDoc: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'blockCommentStart' ),
                builder.optional( builder.fragment( 'blockCommentMiddleStar' ) )
            ] );
        },
        blockCommentMiddleStar: '\\*',
        markdownDefaultListMarker: '(-|\\d+.)',
        markdownTaskListMarker: '(?:[-*+]|\\d+\\.)',
        markdownDefaultListPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'horizontalWhitespaceZeroOrMore' ),
                builder.fragment( 'markdownDefaultListMarker' )
            ] );
        },
        markdownMigrationListPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                '- ',
                builder.fragment( 'uncheckedTaskTag' )
            ] );
        },
        legacyMarkdownTaskFragment: function( builder )
        {
            return builder.sequence( [
                '|',
                builder.fragment( 'markdownMigrationListPrefix' ),
                ')'
            ] );
        },
        cobolCommentPrefix: '\\*>',
        cobolFixedColumnCommentPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                '.{6}',
                builder.fragment( 'blockCommentMiddleStar' )
            ] );
        },
        cobolAnySixColumnCommentPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                '......',
                builder.fragment( 'blockCommentMiddleStar' )
            ] );
        },
        sqlLineCommentPrefix: '\\-\\-',
        checkedTaskTag: '\\[x\\]',
        uncheckedTaskTag: '\\[ \\]',
        identifierCharacter: '[A-Za-z0-9_]',
        alphaLettersOneOrMore: '[A-Za-z]+',
        alphaOnly: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'alphaLettersOneOrMore' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        slugNoise: '[^a-z0-9]+',
        spaceCharacter: ' ',
        lineFeed: '\\n',
        carriageReturn: '\\r',
        whitespaceCharacter: '\\s',
        whitespaceZeroOrMore: '\\s*',
        whitespaceOneOrMore: '\\s+',
        horizontalWhitespaceZeroOrMore: '[ \\t]*',
        horizontalWhitespaceOneOrMore: '[ \\t]+',
        nonWhitespaceOneOrMore: '\\S+',
        anyTextZeroOrMore: '.*',
        anyTextOneOrMoreLazy: '.+?',
        anyTextZeroOrMoreLazy: '.*?',
        anyCharacterIncludingLineTerminatorZeroOrMoreLazy: '[\\s\\S]*?',
        nonNewlineOneOrMore: '[^\\n]+',
        digitOneOrMore: '\\d+',
        digitCaptureOneOrMore: '(\\d+)',
        decimalNumber: '\\d+(?:\\.\\d+)?',
        sha1LowercaseBody: '[0-9a-f]{40}',
        leadingWhitespace: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'whitespaceZeroOrMore' )
            ] );
        },
        leadingHorizontalWhitespace: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'horizontalWhitespaceZeroOrMore' )
            ] );
        },
        trailingHorizontalWhitespace: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'horizontalWhitespaceOneOrMore' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        markdownTaskListPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'horizontalWhitespaceZeroOrMore' ),
                builder.fragment( 'markdownTaskListMarker' ),
                builder.fragment( 'whitespaceZeroOrMore' )
            ] );
        },
        markdownTaskCheckbox: '\\[[ xX]\\]',
        markdownTaskCheckboxLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.fragment( 'markdownTaskListMarker' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.fragment( 'markdownTaskCheckbox' )
            ] );
        },
        environmentVariable: function( builder )
        {
            return builder.sequence( [
                builder.literal( '${' ),
                builder.capture( builder.fragment( 'anyTextZeroOrMoreLazy' ) ),
                builder.literal( '}' )
            ] );
        },
        rgbColour: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                'rgba?',
                builder.literal( '(' ),
                builder.capture( builder.fragment( 'digitOneOrMore' ) ),
                builder.fragment( 'comma' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.capture( builder.fragment( 'digitOneOrMore' ) ),
                builder.fragment( 'comma' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.capture( builder.fragment( 'digitOneOrMore' ) ),
                builder.optional( builder.nonCapture( builder.sequence( [
                    builder.fragment( 'comma' ),
                    builder.fragment( 'whitespaceZeroOrMore' ),
                    builder.capture( builder.fragment( 'decimalNumber' ) )
                ] ) ) ),
                builder.literal( ')' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        labelPlaceholder: function( builder )
        {
            return builder.capture( builder.sequence( [
                builder.literal( '${' ),
                builder.fragment( 'anyTextZeroOrMore' ),
                builder.literal( '}' )
            ] ) );
        },
        regexSyntaxCharacter: REGEX_SYNTAX_CHARACTER_SOURCE,
        regexSyntaxCharacterWithoutBackslash: '[|{}()[\\]^$+*?.-]',
        globMagicCharacter: '[*?\\[\\]{}()!+@]',
        hexColourNoise: '[^\\da-fA-F]',
        iconNameNoise: '[^0-9a-zA-Z]',
        octiconNameNoise: '[^a-z0-9]',
        codiconName: '[a-z0-9-]+',
        codicon: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.literal( '$(' ),
                builder.capture( builder.fragment( 'codiconName' ) ),
                builder.literal( ')' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        optionalCarriageReturnLineBreak: function( builder )
        {
            return builder.sequence( [
                builder.optional( builder.fragment( 'carriageReturn' ) ),
                builder.fragment( 'lineFeed' )
            ] );
        },
        pathBackslash: '\\\\',
        colonSuffix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'colon' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        colonWhitespaceZeroOrMore: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'colon' ),
                builder.fragment( 'whitespaceZeroOrMore' )
            ] );
        },
        subTagPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'colonWhitespaceZeroOrMore' )
            ] );
        },
        subTagPrefixCapture: function( builder )
        {
            return builder.capture( builder.fragment( 'subTagPrefix' ) );
        },
        dashSubTagPrefixCapture: function( builder )
        {
            return builder.capture( builder.sequence( [
                builder.fragment( 'lineStart' ),
                '--',
                builder.fragment( 'whitespaceZeroOrMore' )
            ] ) );
        },
        leadingParenthesizedSubTag: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                '\\((.*)\\)'
            ] );
        },
        markdownFileExtension: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'escapedDot' ),
                'md',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        typescriptFileExtension: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'escapedDot' ),
                'ts',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        nodeModulesPath: 'node_modules',
        nlsToken: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'percent' ),
                builder.capture( '.+' ),
                builder.fragment( 'percent' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        workspaceFolderPlaceholder: function( builder )
        {
            return builder.literal( '${workspaceFolder}' );
        },
        foregroundLiteral: 'foreground',
        backgroundLiteral: 'background',
        themeColourReference: function( builder )
        {
            return builder.capture( builder.alternationFragments( [
                'foregroundLiteral',
                'backgroundLiteral'
            ] ) );
        },
        commentPatternsMissingDefinition: 'Cannot find language definition',
        endOffsetField: function( builder )
        {
            return builder.sequence( [
                'EndOffset',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        windowsPlatform: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                'win'
            ] );
        },
        digitsOnly: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'digitOneOrMore' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        leadingDoubleQuote: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'doubleQuote' )
            ] );
        },
        trailingDoubleQuote: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'doubleQuote' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        meminfoLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.capture( '[^:]+' ),
                builder.fragment( 'colon' ),
                builder.fragment( 'whitespaceOneOrMore' ),
                builder.capture( builder.fragment( 'digitOneOrMore' ) ),
                builder.fragment( 'whitespaceOneOrMore' ),
                'kB',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        environmentKey: '[A-Z0-9_]+',
        environmentAssignment: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.capture( builder.fragment( 'environmentKey' ) ),
                builder.fragment( 'equalsSign' ),
                builder.capture( builder.fragment( 'anyTextZeroOrMore' ) ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        todoLiteral: 'TODO',
        noteLiteral: 'NOTE',
        fixmeLiteral: 'FIXME',
        xxxLiteral: 'XXX',
        bugLiteral: 'BUG',
        secondLineLiteral: 'second line',
        followUpLiteral: 'follow up',
        itemLiteral: 'item',
        endLiteral: 'END',
        noTagsLiteral: 'notags',
        todoLinePrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'todoLiteral' ),
                builder.fragment( 'colonWhitespaceZeroOrMore' )
            ] );
        },
        slashTodoLiteral: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'escapedSlashCommentPrefix' ),
                builder.fragment( 'spaceCharacter' ),
                builder.fragment( 'todoLiteral' )
            ] );
        },
        todoFunctionPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'todoLiteral' ),
                '\\([^)]*\\)'
            ] );
        },
        tagNotIdentifierSuffix: function( builder )
        {
            return builder.negativeLookahead( builder.fragment( 'identifierCharacter' ) );
        },
        tagPositiveHashLookbehindPrefix: function( builder )
        {
            return builder.positiveLookbehind( builder.sequence( [
                builder.fragment( 'hashCommentPrefix' ),
                builder.fragment( 'spaceCharacter' )
            ] ) );
        },
        tagEscapedLookaheadLiteralPrefix: '\\(\\?=literal\\)',
        tagLookaroundSyntaxCharacterClassPrefix: '[()?=]+',
        tagColonAnyText: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'colon' ),
                builder.fragment( 'anyTextZeroOrMore' )
            ] );
        },
        tagWordBoundary: '\\b',
        tagBeforeColon: function( builder )
        {
            return builder.positiveLookahead( builder.fragment( 'colon' ) );
        },
        tagNegativeXLookahead: '(?!x)',
        tagBackreferenceOne: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'whitespaceOneOrMore' ),
                '\\1'
            ] );
        },
        tagWhitespaceBackreference: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'whitespaceOneOrMore' ),
                '\\g{1}'
            ] );
        },
        tagEscapedBackreferenceOne: '\\\\1',
        namedBackreferenceAngle: createNamedTodoBackreferenceFragment( '\\k<tag>' ),
        namedBackreferenceBrace: createNamedTodoBackreferenceFragment( '\\k{tag}' ),
        namedBackreferenceGBrace: createNamedTodoBackreferenceFragment( '\\g{tag}' ),
        namedBackreferencePython: createNamedTodoBackreferenceFragment( '(?P=tag)' ),
        tagCharacterClassBackreferenceSyntax: '[\\g{1}]',
        tagCharacterClassPlaceholder: function( builder )
        {
            return builder.sequence( [
                '[',
                builder.fragment( 'tagPlaceholder' ),
                ']'
            ] );
        },
        tagNewlineSecondLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineFeed' ),
                builder.fragment( 'secondLineLiteral' )
            ] );
        },
        tagColonFollowUp: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'colonWhitespaceZeroOrMore' ),
                builder.fragment( 'followUpLiteral' )
            ] );
        },
        tagParenSubTagCapture: '\\(([^)]+)\\)',
        subTagParenthesizedAnyText: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'anyTextZeroOrMore' ),
                '\\((.*)\\)',
                builder.fragment( 'anyTextZeroOrMore' )
            ] );
        },
        tagQuestionTail: '?',
        tagQuantifiedOneTail: '{1}',
        tagAlternationBugTail: function( builder )
        {
            return builder.sequence( [
                '|',
                builder.fragment( 'bugLiteral' )
            ] );
        },
        tagUncheckedTaskTail: '[ ]',
        tagWhitespaceItemTail: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'whitespaceOneOrMore' ),
                builder.fragment( 'itemLiteral' )
            ] );
        },
        tagNonCaptureItemTail: function( builder )
        {
            return builder.nonCapture( builder.sequence( [
                builder.fragment( 'spaceCharacter' ),
                builder.fragment( 'itemLiteral' )
            ] ) );
        },
        tagUnterminatedLookaheadTail: '(?=unterminated',
        tagUnbalancedCloseTail: '))',
        colonAnyTextUntilEndLazy: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'colon' ),
                builder.fragment( 'anyCharacterIncludingLineTerminatorZeroOrMoreLazy' ),
                builder.fragment( 'endLiteral' )
            ] );
        },
        linePrefixRemainder: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.capture( builder.fragment( 'horizontalWhitespaceZeroOrMore' ) ),
                builder.capture( builder.fragment( 'anyTextZeroOrMore' ) ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        leadingNonDefaultCommentPrefix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.capture( builder.alternationFragments( [
                    'escapedSlashCommentPrefix',
                    'hashCommentPrefix',
                    'htmlCommentStart',
                    'semicolonCommentPrefix',
                    'escapedBlockCommentStart'
                ] ) )
            ] );
        },
        leadingMarkdownHeading: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.fragment( 'hashCommentPrefix' )
            ] );
        },
        lookAroundDiagnostic: 'look-around',
        slashTodoLineNumber: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'slashTodoLiteral' ),
                ' line',
                builder.capture( builder.fragment( 'digitOneOrMore' ) )
            ] );
        },
        slashTodoFixmeWord: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'escapedSlashCommentPrefix' ),
                builder.fragment( 'spaceCharacter' ),
                builder.capture( builder.alternationFragments( [
                    'todoLiteral',
                    'fixmeLiteral'
                ] ) ),
                builder.fragment( 'spaceCharacter' ),
                builder.capture( builder.fragment( 'nonWhitespaceOneOrMore' ) )
            ] );
        },
        workflowUsesLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                'uses',
                builder.fragment( 'colonWhitespaceZeroOrMore' ),
                builder.capture( '[^\\s#]+' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        workflowJobHeaderLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                '  ',
                builder.oneOrMore( '[A-Za-z0-9_-]' ),
                builder.fragment( 'colon' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        workflowCodeqlInitInvalidMessage: 'workflow action revision invalid: github\\/codeql-action\\/init',
        workflowCodeqlUploadSarifCountMismatchMessage: 'workflow action reference count mismatch: github\\/codeql-action\\/upload-sarif',
        pinnedActionReference: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                '[^@]+@',
                builder.fragment( 'sha1LowercaseBody' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        sha1Lowercase: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'sha1LowercaseBody' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        oldJsFile: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                'old-',
                builder.fragment( 'anyTextZeroOrMore' ),
                builder.fragment( 'escapedDot' ),
                'js',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        backupFileSuffix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'escapedDot' ),
                'bak',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        tildeSuffix: function( builder )
        {
            return builder.sequence( [
                '~',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        releaseShaOutput: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                'release_sha=',
                builder.fragment( 'sha1LowercaseBody' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        releaseNotesBlankBullet: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineFeed' ),
                '- ',
                '\\[`?',
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.fragment( 'lineFeed' )
            ] );
        },
        negativeUppercaseLookbehindNote: function( builder )
        {
            return builder.sequence( [
                builder.negativeLookbehind( '[A-Z]' ),
                builder.fragment( 'noteLiteral' )
            ] );
        },
        instrumentProviderFunction: 'function instrumentProvider\\([\\s\\S]*?return provider;\\s*\\}',
        createProviderStubFunction: 'function createProviderStub\\(\\)[\\s\\S]*?return\\s*\\{[\\s\\S]*?\\};\\s*\\}',
        requireMainBlock: 'if\\(\\s*require\\.main\\s*===\\s*module\\s*\\)\\s*\\{[\\s\\S]*?\\}\\s*$',
        providerReplaceDocumentAliasesResults: 'provider\\.replaceDocument\\s*=\\s*function\\([^)]*\\)\\s*\\{[^}]*var entry\\s*=\\s*\\{\\s*uri:\\s*uri,\\s*results:\\s*results\\s*\\}',
        providerReplaceDocumentFreshEntry: 'provider\\.replaceDocument\\s*=\\s*function\\([^)]*\\)\\s*\\{[\\s\\S]*?var entry\\s*=\\s*\\{\\s*uri:\\s*uri,\\s*results:\\s*\\[\\]\\s*\\}',
        stubReplaceDocumentAliasesResults: 'replaceDocument:\\s*function\\([^)]*\\)\\s*\\{[^}]*var entry\\s*=\\s*\\{\\s*uri:\\s*uri,\\s*results:\\s*results\\s*\\}',
        stubReplaceDocumentCopiesResults: 'replaceDocument:\\s*function\\([^)]*\\)\\s*\\{[\\s\\S]*?results\\.slice\\(\\)',
        passthroughPatternDeclaration: "\\n        [A-Za-z0-9_]+: function\\( builder \\)\\n        \\{\\n            return builder\\.fragment\\( '[^']+' \\);\\n        \\}",
        perfTraceScenarioIndex: "\\[perf\\] \\(' \\+ \\( index \\+ 1 \\) \\+ '\\/' \\+ selectedDefinitions\\.length",
        perfTraceDone: "' done in ' \\+ elapsedMs \\+ 'ms\\\\n'",
        perfTraceLatency: "\\[perf\\]   ' \\+ definition\\.name \\+ ' latency '",
        perfTraceMemory: "\\[perf\\]   ' \\+ definition\\.name \\+ ' memory '",
        perfTraceWorkerEnv: "PERF_TRACE_SCENARIOS:\\s*'0'",
        sudoGetentPasswd: "getent passwd\\s+\"\\$SUDO_USER\"",
        linuxbrewNodePath: "\\/home\\/linuxbrew\\/\\.linuxbrew\\/bin\\/node",
        chunkBytesLiteral: 'chunkBytes',
        overlapBytesLiteral: 'overlapBytes',
        createReadStreamLiteral: 'createReadStream',
        jsonLiteral: 'JSON',
        unexpectedLiteral: 'Unexpected',
        jsonOrUnexpected: function( builder )
        {
            return builder.alternationFragments( [
                'jsonLiteral',
                'unexpectedLiteral'
            ] );
        },
        unlinkFailed: 'unlink failed',
        mustBeUserFlow: 'must be a user-flow',
        mustReferenceUserFlowScenario: 'must reference a user-flow scenario',
        mitLicense: 'MIT License',
        nigelScott: 'Nigel Scott',
        pathExtensionSuffix: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'escapedDot' ),
                '[a-z0-9]+',
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        gitmodulePathLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                'path',
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.fragment( 'equalsSign' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.capture( builder.fragment( 'anyTextOneOrMoreLazy' ) ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.fragment( 'tagEndAnchor' )
            ] );
        },
        decimalBackreferenceDigit: '[1-9]',
        zeroWidthEscapeCharacter: '[bB]',
        backreferenceDelimiters: '<\'{',
        countSuffix: function( builder )
        {
            return builder.sequence( [
                builder.capture( '[^(]*' ),
                builder.zeroOrMore( builder.capture( builder.sequence( [
                    '\\(',
                    builder.fragment( 'digitOneOrMore' ),
                    '\\)'
                ] ) ) )
            ] );
        }
    } ),
    patterns: Object.freeze( {
        defaultCommentPrefix: function( builder )
        {
            return builder.capture( builder.alternationFragments( [
                'lineStart',
                'slashCommentPrefix',
                'hashCommentPrefix',
                'htmlCommentStart',
                'semicolonCommentPrefix',
                'blockCommentStart',
                'markdownDefaultListPrefix'
            ] ) );
        },
        defaultCommentPrefixWithoutSemicolon: function( builder )
        {
            return builder.capture( builder.alternationFragments( [
                'lineStart',
                'slashCommentPrefix',
                'hashCommentPrefix',
                'htmlCommentStart',
                'blockCommentStart',
                'markdownDefaultListPrefix'
            ] ) );
        },
        defaultTagLeadBoundary: function( builder )
        {
            return builder.positiveLookahead( builder.alternationFragments( [
                'checkedTaskTag',
                'uncheckedTaskTag',
                'identifierCharacter'
            ] ) );
        },
        defaultTodo: function( builder )
        {
            return builder.sequence( [
                builder.pattern( 'defaultCommentPrefix' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.pattern( 'defaultTagLeadBoundary' ),
                builder.capture( builder.fragment( 'tagPlaceholder' ) ),
                builder.negativeLookahead( builder.fragment( 'identifierCharacter' ) )
            ] );
        },
        defaultTodoWithoutSemicolon: function( builder )
        {
            return builder.sequence( [
                builder.pattern( 'defaultCommentPrefixWithoutSemicolon' ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.pattern( 'defaultTagLeadBoundary' ),
                builder.capture( builder.fragment( 'tagPlaceholder' ) ),
                builder.negativeLookahead( builder.fragment( 'identifierCharacter' ) )
            ] );
        },
        legacyMarkdownTodo: function( builder )
        {
            return builder.sequence( [
                builder.capture( builder.alternationFragments( [
                    'slashCommentPrefix',
                    'hashCommentPrefix',
                    'htmlCommentStart',
                    'semicolonCommentPrefix',
                    'blockCommentStart',
                    'markdownMigrationListPrefix'
                ] ) ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.capture( builder.fragment( 'tagPlaceholder' ) )
            ] );
        },
        legacyMarkdownCompatibilityTodo: function( builder )
        {
            return builder.nonCapture( builder.alternation( [
                builder.sequence( [
                    builder.nonCapture( builder.alternationFragments( [
                        'slashCommentPrefix',
                        'hashCommentPrefix',
                        'htmlCommentStart',
                        'semicolonCommentPrefix',
                        'blockCommentStartOptionalApiDoc',
                        'blockCommentMiddleStar'
                    ] ) ),
                    builder.fragment( 'whitespaceZeroOrMore' ),
                    builder.capture( builder.fragment( 'tagPlaceholder' ) )
                ] ),
                builder.fragment( 'markdownMigrationListPrefix' )
            ] ) );
        },
        commentPrefixTagCapture: function( builder )
        {
            return builder.sequence( [
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
        },
        commentPrefixAnySixColumnTagCapture: function( builder )
        {
            return builder.sequence( [
                builder.capture( builder.alternationFragments( [
                    'slashCommentPrefix',
                    'hashCommentPrefix',
                    'htmlCommentStart',
                    'semicolonCommentPrefix',
                    'blockCommentStart',
                    'cobolCommentPrefix',
                    'cobolAnySixColumnCommentPrefix',
                    'sqlLineCommentPrefix'
                ] ) ),
                builder.fragment( 'whitespaceZeroOrMore' ),
                builder.capture( builder.fragment( 'tagPlaceholder' ) )
            ] );
        },
        markdownTaskListLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'lineStart' ),
                builder.capture( builder.fragment( 'markdownTaskListPrefix' ) ),
                builder.fragment( 'markdownTaskCheckbox' )
            ] );
        },
        tagCapturePlaceholder: function( builder )
        {
            return builder.capture( builder.fragment( 'tagPlaceholder' ) );
        },
        todoCapture: function( builder )
        {
            return builder.capture( builder.fragment( 'todoLiteral' ) );
        },
        noteCapture: function( builder )
        {
            return builder.capture( builder.fragment( 'noteLiteral' ) );
        },
        xxxCapture: function( builder )
        {
            return builder.capture( builder.fragment( 'xxxLiteral' ) );
        },
        todoFixmeCapture: function( builder )
        {
            return builder.capture( builder.alternationFragments( [
                'todoLiteral',
                'fixmeLiteral'
            ] ) );
        },
        todoColonLine: function( builder )
        {
            return builder.sequence( [
                builder.pattern( 'todoCapture' ),
                builder.fragment( 'colonWhitespaceZeroOrMore' ),
                builder.fragment( 'nonNewlineOneOrMore' )
            ] );
        },
        todoFunctionLine: function( builder )
        {
            return builder.sequence( [
                builder.fragment( 'todoFunctionPrefix' ),
                builder.fragment( 'colonWhitespaceZeroOrMore' ),
                builder.fragment( 'nonNewlineOneOrMore' )
            ] );
        },
    } )
} );

function createRegexRegistry()
{
    return new RegexRegistry( DEFAULT_DEFINITION );
}

var defaultRegistry = createRegexRegistry();

module.exports.RegexRegistry = RegexRegistry;
module.exports.RegexBuilder = RegexBuilder;
module.exports.RegexRegistryError = RegexRegistryError;
module.exports.createRegexRegistry = createRegexRegistry;
module.exports.createRegexBuilder = function()
{
    return defaultRegistry.createBuilder();
};
module.exports.fragment = function( name )
{
    return defaultRegistry.fragment( name );
};
module.exports.pattern = function( name )
{
    return defaultRegistry.pattern( name );
};
module.exports.createRegExp = function( name, flags )
{
    return defaultRegistry.createRegExp( name, flags );
};
module.exports.fragmentNames = function()
{
    return defaultRegistry.fragmentNames();
};
module.exports.patternNames = function()
{
    return defaultRegistry.patternNames();
};
module.exports.fragmentPatternNames = function()
{
    return defaultRegistry.fragmentPatternNames();
};
module.exports.escapeRegexLiteral = escapeRegexLiteral;
module.exports.captureSource = captureSource;
module.exports.buildEscapedAlternationSource = buildEscapedAlternationSource;
module.exports.buildEscapedAlternationCaptureSource = buildEscapedAlternationCaptureSource;
module.exports.captureLiteralSource = captureLiteralSource;
module.exports.buildFormatLabelSource = buildFormatLabelSource;
module.exports.TAG_PLACEHOLDER = TAG_PLACEHOLDER;
module.exports.TAG_CAPTURE_PLACEHOLDER = TAG_CAPTURE_PLACEHOLDER;
module.exports.DEFAULT_REGEX_SOURCE = defaultRegistry.pattern( 'defaultTodo' );
module.exports.LEGACY_MARKDOWN_TASK_FRAGMENT = defaultRegistry.fragment( 'legacyMarkdownTaskFragment' );
module.exports.LEGACY_MARKDOWN_REGEX_SOURCE = defaultRegistry.pattern( 'legacyMarkdownTodo' );
module.exports.BACKREFERENCE_DELIMITERS = defaultRegistry.fragment( 'backreferenceDelimiters' );
