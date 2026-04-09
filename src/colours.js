var vscode = require( 'vscode' );
var utils = require( './utils.js' );
var identity = require( './extensionIdentity.js' );

function validateColours( workspace )
{
    function check( setting )
    {
        var definedColour = identity.getSetting( 'highlights.' + setting, undefined );
        if( definedColour !== undefined && !utils.isValidColour( definedColour ) )
        {
            invalidColours.push( setting + ' (' + definedColour + ')' );
        }
    }

    var invalidColours = [];
    var result = "";

    var attributeList = [ 'foreground', 'background', 'iconColour', 'rulerColour' ];
    attributeList.forEach( function( attribute ) { check( 'defaultHighlight.' + attribute ); } );

    var config = {
        customHighlight: identity.getSetting( 'highlights.customHighlight', {} )
    };
    Object.keys( config.customHighlight ).forEach( function( tag )
    {
        attributeList.forEach( function( attribute ) { check( 'customHighlight.' + tag + '.' + attribute ); } );
    } );

    if( invalidColours.length > 0 )
    {
        result = "Invalid colour settings: " + invalidColours.join( ', ' );
    }

    return result;
}

function validateIconColours( workspace )
{
    var hasInvalidCodiconColour = false;
    var hasInvalidOcticonColour = false;

    function checkIconColour( setting )
    {
        var icon = identity.getSetting( 'highlights.' + setting + ".icon", undefined );
        var iconColour = identity.getSetting( 'highlights.' + setting + ".iconColour", undefined );
        if( icon !== undefined && iconColour !== undefined )
        {
            if( utils.isCodicon( icon ) )
            {
                if( utils.isHexColour( iconColour ) || utils.isRgbColour( iconColour ) || utils.isNamedColour( iconColour ) )
                {
                    invalidIconColours.push( setting + '.iconColour (' + iconColour + ')' );
                    hasInvalidCodiconColour = true;
                }
            }
            else
            {
                if( utils.isThemeColour( iconColour ) )
                {
                    invalidIconColours.push( setting + '.iconColour (' + iconColour + ')' );
                    hasInvalidOcticonColour = true;
                }
            }
        }
    }

    var invalidIconColours = [];
    var result = "";

    checkIconColour( 'defaultHighlight' );

    var config = {
        customHighlight: identity.getSetting( 'highlights.customHighlight', {} )
    };
    Object.keys( config.customHighlight ).forEach( function( tag )
    {
        checkIconColour( 'customHighlight.' + tag );
    } );

    if( invalidIconColours.length > 0 )
    {
        result = "Invalid icon colour settings: " + invalidIconColours.join( ', ' ) + ".";
        if( hasInvalidCodiconColour )
        {
            result += " Codicons can only use theme colours.";
        }
        if( hasInvalidOcticonColour )
        {
            result += " Theme colours can only be used with Codicons.";
        }
    }

    return result;
}

module.exports.validateColours = validateColours;
module.exports.validateIconColours = validateIconColours;
