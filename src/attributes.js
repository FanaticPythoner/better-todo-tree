var config;
var compiledResolver;
var compiledResolverCaseSensitive;
var compiledResolverHighlights;

function init( configuration )
{
    config = configuration;
    compiledResolver = undefined;
    compiledResolverCaseSensitive = undefined;
    compiledResolverHighlights = undefined;
}

function buildResolver( customHighlight, caseSensitive )
{
    var exactMatches = new Map();
    var partialMatchers = [];

    Object.keys( customHighlight ).forEach( function( key )
    {
        var settings = customHighlight[ key ];
        exactMatches.set( caseSensitive ? key : key.toLowerCase(), settings );
        partialMatchers.push( {
            regex: new RegExp(
                key.replace( /\\/g, '\\\\' ).replace( /[|{}()[\]^$+*?.-]/g, '\\$&' ),
                caseSensitive ? '' : 'i'
            ),
            settings: settings
        } );
    } );

    return {
        caseSensitive: caseSensitive,
        exactMatches: exactMatches,
        partialMatchers: partialMatchers
    };
}

function getResolver()
{
    var caseSensitive = config.isRegexCaseSensitive() !== false;
    var customHighlight = config.customHighlight() || {};

    if( compiledResolver === undefined ||
        compiledResolverCaseSensitive !== caseSensitive ||
        compiledResolverHighlights !== customHighlight )
    {
        compiledResolver = buildResolver( customHighlight, caseSensitive );
        compiledResolverCaseSensitive = caseSensitive;
        compiledResolverHighlights = customHighlight;
    }

    return compiledResolver;
}

function getCustomHighlight( tag )
{
    var resolver = getResolver();
    var lookupKey = resolver.caseSensitive ? tag : tag.toLowerCase();
    var exactMatch = resolver.exactMatches.get( lookupKey );

    if( exactMatch !== undefined )
    {
        return exactMatch;
    }

    var partialMatch = resolver.partialMatchers.find( function( matcher )
    {
        return matcher.regex.test( tag );
    } );

    return partialMatch ? partialMatch.settings : undefined;
}

function hasCustomHighlight( tag )
{
    return getCustomHighlight( tag ) !== undefined;
}

function getAttribute( tag, attribute, defaultValue, ignoreDefaultHighlight )
{
    var tagSettings = getCustomHighlight( tag );

    if( tagSettings && tagSettings[ attribute ] !== undefined )
    {
        return tagSettings[ attribute ];
    }

    if( ignoreDefaultHighlight !== true )
    {
        var defaultHighlight = config.defaultHighlight();
        if( defaultHighlight[ attribute ] !== undefined )
        {
            return defaultHighlight[ attribute ];
        }
    }

    return defaultValue;
}

function getIcon( tag )
{
    return getAttribute( tag, 'icon', undefined );
}

function getSchemeColour( tag, colours )
{
    var index = config.tags().indexOf( tag );
    if( colours && colours.length > 0 )
    {
        return colours[ index % colours.length ];
    }
}

function getIconColour( tag )
{
    var useColourScheme = config.shouldUseColourScheme();

    var colour = getAttribute( tag, 'iconColor', undefined );
    if( colour === undefined )
    {
        colour = getAttribute( tag, 'iconColour', undefined, useColourScheme );
    }
    if( colour === undefined && useColourScheme )
    {
        colour = getSchemeColour( tag, config.backgroundColourScheme() );
    }

    if( colour === undefined )
    {
        var foreground = getAttribute( tag, 'foreground', undefined, useColourScheme );
        var background = getAttribute( tag, 'background', undefined, useColourScheme );

        colour = foreground ? foreground : ( background ? background : "green" );
    }

    return colour;
}

function getForeground( tag )
{
    var useColourScheme = config.shouldUseColourScheme();
    var colour = getAttribute( tag, 'foreground', undefined, useColourScheme );
    if( colour === undefined && useColourScheme )
    {
        colour = getSchemeColour( tag, config.foregroundColourScheme() );
    }
    return colour;
}

function getBackground( tag )
{
    var useColourScheme = config.shouldUseColourScheme();
    var colour = getAttribute( tag, 'background', undefined, useColourScheme );
    if( colour === undefined && useColourScheme )
    {
        colour = getSchemeColour( tag, config.backgroundColourScheme() );
    }
    return colour;
}

module.exports.init = init;
module.exports.getAttribute = getAttribute;
module.exports.getCustomHighlight = getCustomHighlight;
module.exports.hasCustomHighlight = hasCustomHighlight;
module.exports.getIcon = getIcon;
module.exports.getIconColour = getIconColour;
module.exports.getForeground = getForeground;
module.exports.getBackground = getBackground;
