/* jshint esversion:6, node: true */

'use strict';

var regexRegistry = require( './regexRegistry.js' );

var BACKREFERENCE_DELIMITERS = regexRegistry.BACKREFERENCE_DELIMITERS;
var TAG_PLACEHOLDER = regexRegistry.TAG_PLACEHOLDER;
var decimalBackreferenceDigitRegex = regexRegistry.createRegExp( 'decimalBackreferenceDigit' );
var whitespaceCharacterRegex = regexRegistry.createRegExp( 'whitespaceCharacter' );
var zeroWidthEscapeCharacterRegex = regexRegistry.createRegExp( 'zeroWidthEscapeCharacter' );

function isEscaped( source, index )
{
    var slashCount = 0;
    var cursor = index - 1;

    while( cursor >= 0 && source[ cursor ] === '\\' )
    {
        slashCount++;
        cursor--;
    }

    return slashCount % 2 === 1;
}

function scanRegexSource( source, visitors )
{
    var inCharacterClass = false;
    var index;

    for( index = 0; index < source.length; index++ )
    {
        if( isEscaped( source, index ) )
        {
            continue;
        }

        if( source[ index ] === '[' )
        {
            inCharacterClass = true;
            continue;
        }

        if( source[ index ] === ']' )
        {
            inCharacterClass = false;
            continue;
        }

        if( inCharacterClass === true )
        {
            continue;
        }

        if( visitors( source, index ) === true )
        {
            return true;
        }
    }

    return false;
}

function containsLookAround( source )
{
    if( typeof source !== 'string' || source.length === 0 )
    {
        return false;
    }

    return scanRegexSource( source, function( value, index )
    {
        return value[ index ] === '(' &&
            value[ index + 1 ] === '?' &&
            (
                value[ index + 2 ] === '=' ||
                value[ index + 2 ] === '!' ||
                (
                    value[ index + 2 ] === '<' &&
                    ( value[ index + 3 ] === '=' || value[ index + 3 ] === '!' )
                )
            );
    } );
}

function containsBackreference( source )
{
    if( typeof source !== 'string' || source.length === 0 )
    {
        return false;
    }

    return scanRegexSource( source, function( value, index )
    {
        if( containsPythonStyleNamedBackreferenceAt( value, index ) === true )
        {
            return true;
        }

        if( value[ index ] !== '\\' )
        {
            return false;
        }

        return decimalBackreferenceDigitRegex.test( value[ index + 1 ] || '' ) ||
            hasDelimitedBackreferenceAt( value, index, 'k', BACKREFERENCE_DELIMITERS ) ||
            hasDelimitedBackreferenceAt( value, index, 'g', BACKREFERENCE_DELIMITERS );
    } );
}

function hasDelimitedBackreferenceAt( value, index, prefix, delimiters )
{
    return value[ index + 1 ] === prefix && delimiters.indexOf( value[ index + 2 ] || '' ) !== -1;
}

function containsPythonStyleNamedBackreferenceAt( value, index )
{
    return value[ index ] === '(' &&
        value[ index + 1 ] === '?' &&
        value[ index + 2 ] === 'P' &&
        value[ index + 3 ] === '=';
}

function containsJavaScriptIncompatibleBackreference( source )
{
    if( typeof source !== 'string' || source.length === 0 )
    {
        return false;
    }

    return scanRegexSource( source, function( value, index )
    {
        if( containsPythonStyleNamedBackreferenceAt( value, index ) === true )
        {
            return true;
        }

        if( value[ index ] !== '\\' )
        {
            return false;
        }

        return ( value[ index + 1 ] === 'k' && value[ index + 2 ] === '{' ) ||
            hasDelimitedBackreferenceAt( value, index, 'g', BACKREFERENCE_DELIMITERS );
    } );
}

function requiresPcre2( source )
{
    if( typeof source !== 'string' || source.length === 0 )
    {
        return false;
    }

    return containsLookAround( source ) || containsBackreference( source );
}

function hasTagPlaceholder( source )
{
    return findTagPlaceholderIndex( source ) !== -1;
}

function findTagPlaceholderIndex( source )
{
    var placeholderIndex = -1;

    if( typeof source !== 'string' || source.length === 0 )
    {
        return placeholderIndex;
    }

    scanRegexSource( source, function( value, index )
    {
        if( value.slice( index, index + TAG_PLACEHOLDER.length ) === TAG_PLACEHOLDER )
        {
            placeholderIndex = index;
            return true;
        }

        return false;
    } );

    return placeholderIndex;
}

function hasBalancedRegexStructure( source )
{
    if( typeof source !== 'string' )
    {
        return false;
    }

    var depth = 0;
    var cursor = 0;

    while( cursor < source.length )
    {
        if( source[ cursor ] === '\\' )
        {
            cursor += 2;
            continue;
        }

        if( source[ cursor ] === '[' )
        {
            cursor = skipCharacterClass( source, cursor );
            if( cursor === undefined )
            {
                return false;
            }
            continue;
        }

        if( source[ cursor ] === '(' )
        {
            depth++;
        }
        else if( source[ cursor ] === ')' )
        {
            depth--;
            if( depth < 0 )
            {
                return false;
            }
        }

        cursor++;
    }

    return depth === 0;
}

function hasOnlyZeroWidthTailAfterTagPlaceholder( source )
{
    var placeholderIndex = findTagPlaceholderIndex( source );

    if( placeholderIndex === -1 )
    {
        return false;
    }

    var cursor = placeholderIndex + TAG_PLACEHOLDER.length;

    while( cursor < source.length )
    {
        var character = source[ cursor ];

        if( whitespaceCharacterRegex.test( character ) || character === ')' || character === '^' || character === '$' )
        {
            cursor++;
            continue;
        }

        if( isZeroWidthEscapeAt( source, cursor ) === true )
        {
            cursor += 2;
            continue;
        }

        if( isLookAroundStartAt( source, cursor ) === true )
        {
            var groupEnd = skipParenthesizedExpression( source, cursor );
            if( groupEnd === undefined )
            {
                return false;
            }
            cursor = groupEnd;
            continue;
        }

        return false;
    }

    return true;
}

function isZeroWidthEscapeAt( source, index )
{
    return source[ index ] === '\\' && zeroWidthEscapeCharacterRegex.test( source[ index + 1 ] || '' );
}

function isLookAroundStartAt( source, index )
{
    return source[ index ] === '(' &&
        source[ index + 1 ] === '?' &&
        (
            source[ index + 2 ] === '=' ||
            source[ index + 2 ] === '!' ||
            (
                source[ index + 2 ] === '<' &&
                ( source[ index + 3 ] === '=' || source[ index + 3 ] === '!' )
            )
        );
}

function skipCharacterClass( source, index )
{
    var cursor = index + 1;

    while( cursor < source.length )
    {
        if( source[ cursor ] === '\\' )
        {
            cursor += 2;
            continue;
        }

        if( source[ cursor ] === ']' )
        {
            return cursor + 1;
        }

        cursor++;
    }

    return undefined;
}

function skipParenthesizedExpression( source, index )
{
    var depth = 0;
    var cursor = index;

    while( cursor < source.length )
    {
        if( source[ cursor ] === '\\' )
        {
            cursor += 2;
            continue;
        }

        if( source[ cursor ] === '[' )
        {
            cursor = skipCharacterClass( source, cursor );
            if( cursor === undefined )
            {
                return undefined;
            }
            continue;
        }

        if( source[ cursor ] === '(' )
        {
            depth++;
        }
        else if( source[ cursor ] === ')' )
        {
            depth--;
            if( depth === 0 )
            {
                return cursor + 1;
            }
        }

        cursor++;
    }

    return undefined;
}

function hasRipgrepEngineArg( args )
{
    return ( args || [] ).some( function( arg, index )
    {
        return arg === '--pcre2' ||
            arg === '-P' ||
            arg === '--auto-hybrid-regex' ||
            arg === '--engine' ||
            arg.indexOf( '--engine=' ) === 0 ||
            ( index > 0 && args[ index - 1 ] === '--engine' );
    } );
}

function buildRegexEngineArgs( source, additionalArgs )
{
    if( requiresPcre2( source ) !== true || hasRipgrepEngineArg( additionalArgs ) === true )
    {
        return [];
    }

    return [ '--pcre2' ];
}

function shouldUseTagCandidateScan( resourceConfig )
{
    if( !resourceConfig )
    {
        return false;
    }

    return resourceConfig.isDefaultRegex === true ||
        (
            hasTagPlaceholder( resourceConfig.regex ) === true &&
            hasBalancedRegexStructure( resourceConfig.regex ) === true &&
            containsJavaScriptIncompatibleBackreference( resourceConfig.regex ) !== true &&
            hasOnlyZeroWidthTailAfterTagPlaceholder( resourceConfig.regex ) === true
        );
}

module.exports.containsLookAround = containsLookAround;
module.exports.containsBackreference = containsBackreference;
module.exports.containsJavaScriptIncompatibleBackreference = containsJavaScriptIncompatibleBackreference;
module.exports.requiresPcre2 = requiresPcre2;
module.exports.hasTagPlaceholder = hasTagPlaceholder;
module.exports.hasBalancedRegexStructure = hasBalancedRegexStructure;
module.exports.hasRipgrepEngineArg = hasRipgrepEngineArg;
module.exports.buildRegexEngineArgs = buildRegexEngineArgs;
module.exports.shouldUseTagCandidateScan = shouldUseTagCandidateScan;
