/* jshint esversion:6, node: true */

'use strict';

var BACKREFERENCE_DELIMITERS = "<'{";

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

        return /[1-9]/.test( value[ index + 1 ] || '' ) ||
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
    return typeof source === 'string' && source.indexOf( '$TAGS' ) !== -1;
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
            requiresPcre2( resourceConfig.regex ) === true &&
            containsJavaScriptIncompatibleBackreference( resourceConfig.regex ) !== true
        );
}

module.exports.containsLookAround = containsLookAround;
module.exports.containsBackreference = containsBackreference;
module.exports.containsJavaScriptIncompatibleBackreference = containsJavaScriptIncompatibleBackreference;
module.exports.requiresPcre2 = requiresPcre2;
module.exports.hasTagPlaceholder = hasTagPlaceholder;
module.exports.hasRipgrepEngineArg = hasRipgrepEngineArg;
module.exports.buildRegexEngineArgs = buildRegexEngineArgs;
module.exports.shouldUseTagCandidateScan = shouldUseTagCandidateScan;
