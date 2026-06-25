var micromatch = require( 'micromatch' );
var os = require( 'os' );
var path = require( 'path' );
var fs = require( 'fs' );
var strftime = require( 'fast-strftime' );
var commentPatterns = require( 'comment-patterns' );

var colourNames = require( './colourNames.js' );
var themeColourNames = require( './themeColourNames.js' );
var regexRegistry = require( './regexRegistry.js' );
var commentPatternAliases = require( './commentPatternAliases.json' );
var customLanguageConfiguration = require( './customLanguageConfiguration.js' );

var config;
var tagRegexSourceCache = new Map();
var submoduleExcludeGlobCache = new Map();
var regExpIndicesSupported;

var DEFAULT_REGEX_SOURCE = regexRegistry.DEFAULT_REGEX_SOURCE;
var TAG_PLACEHOLDER = regexRegistry.TAG_PLACEHOLDER;
var TAG_CAPTURE_PLACEHOLDER = regexRegistry.TAG_CAPTURE_PLACEHOLDER;
var COMMENT_PATTERN_FILE_ALIASES = Object.freeze( commentPatternAliases );

var envRegex = regexRegistry.createRegExp( 'environmentVariable', 'g' );
var rgbRegex = regexRegistry.createRegExp( 'rgbColour', 'gi' );
var placeholderRegex = regexRegistry.createRegExp( 'labelPlaceholder' );
var hexColourNoiseRegex = regexRegistry.createRegExp( 'hexColourNoise', 'g' );
var lineBreakRegex = regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' );
var pathBackslashRegex = regexRegistry.createRegExp( 'pathBackslash', 'g' );
var repeatedSlashRegex = regexRegistry.createRegExp( 'escapedSlashCommentPrefix', 'g' );
var gitmodulePathLineRegex = regexRegistry.createRegExp( 'gitmodulePathLine' );
var codiconRegex = regexRegistry.createRegExp( 'codicon', 'i' );
var commentPatternsMissingDefinitionRegex = regexRegistry.createRegExp( 'commentPatternsMissingDefinition' );
var windowsDrivePrefixRegex = regexRegistry.createRegExp( 'windowsDrivePrefix' );
var leadingSlashOneOrMoreRegex = regexRegistry.createRegExp( 'leadingSlashOneOrMore' );
var globMagicCharacterRegex = regexRegistry.createRegExp( 'globMagicCharacter' );

function init( configuration )
{
    config = configuration;
    tagRegexSourceCache = new Map();
    submoduleExcludeGlobCache = new Map();
    customLanguageConfiguration.init( configuration );
}

function supportsRegExpIndices()
{
    if( regExpIndicesSupported !== undefined )
    {
        return regExpIndicesSupported;
    }

    regExpIndicesSupported = Object.prototype.hasOwnProperty.call( RegExp.prototype, 'hasIndices' );

    return regExpIndicesSupported;
}

function isHexColour( colour )
{
    if( typeof ( colour ) !== 'string' )
    {
        return false;
    }
    var withoutHash = colour.indexOf( '#' ) === 0 ? colour.substring( 1 ) : colour;
    var hex = withoutHash.split( ' ' )[ 0 ].replace( hexColourNoiseRegex, '' );
    return ( typeof colour === "string" ) && hex.length === withoutHash.length && ( hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8 ) && !isNaN( parseInt( hex, 16 ) );
}

function isRgbColour( colour )
{
    return colour.match && colour.match( rgbRegex ) !== null;
}

function isNamedColour( colour )
{
    return colourNames.indexOf( colour.toLowerCase() ) > -1;
}

function isThemeColour( colour )
{
    return themeColourNames.indexOf( colour ) > -1;
}

function hexToRgba( hex, opacity )
{
    function toComponent( digits )
    {
        return ( digits.length == 1 ) ? parseInt( digits + digits, 16 ) : parseInt( digits, 16 );
    }

    if( hex !== undefined )
    {
        hex = hex.replace( '#', '' );

        var rgb = hex.substring( 0, ( hex.length == 3 || hex.length == 4 ) ? 3 : 6 );

        var r = toComponent( rgb.substring( 0, rgb.length / 3 ) );
        var g = toComponent( rgb.substring( rgb.length / 3, 2 * rgb.length / 3 ) );
        var b = toComponent( rgb.substring( 2 * rgb.length / 3, 3 * rgb.length / 3 ) );

        if( hex.length == 4 || hex.length == 8 )
        {
            opacity = parseInt( toComponent( hex.substring( 3 * hex.length / 4, 4 * hex.length / 4 ) ) * 100 / 255 );
        }

        return 'rgba(' + r + ',' + g + ',' + b + ',' + opacity / 100 + ')';
    }

    return '#0F0';
}

function normaliseCommentPatternFileName( fileName )
{
    var baseName = path.basename( fileName );
    var rawExtension = path.extname( baseName );
    var aliasedExtension = COMMENT_PATTERN_FILE_ALIASES[ rawExtension.toLowerCase() ];

    if( aliasedExtension )
    {
        return path.basename( baseName, rawExtension ) + aliasedExtension;
    }

    return baseName || fileName;
}

function getCommentPattern( fileName )
{
    var customPattern = customLanguageConfiguration.getCommentPattern( fileName );

    if( customPattern )
    {
        return customPattern;
    }

    var normalisedFileName = normaliseCommentPatternFileName( fileName );

    try
    {
        return commentPatterns( normalisedFileName );
    }
    catch( error )
    {
        if( commentPatternsMissingDefinitionRegex.test( error.message ) )
        {
            return undefined;
        }

        throw error;
    }
}

function getCommentPatternRegex( fileName )
{
    var customPatternRegex = customLanguageConfiguration.getCommentPatternRegex( fileName );

    if( customPatternRegex )
    {
        return customPatternRegex;
    }

    var normalisedFileName = normaliseCommentPatternFileName( fileName );

    try
    {
        return commentPatterns.regex( normalisedFileName );
    }
    catch( error )
    {
        if( commentPatternsMissingDefinitionRegex.test( error.message ) )
        {
            return undefined;
        }

        throw error;
    }
}

function resolveBlockCommentPattern( fileName )
{
    var extension = path.extname( fileName ).toLowerCase();
    var patternFileName = normaliseCommentPatternFileName( fileName );
    var pattern = getCommentPattern( fileName );

    if( extension === ".hs" )
    {
        patternFileName = ".cpp";
        pattern = getCommentPattern( patternFileName );
    }
    else if( pattern && pattern.name === 'Markdown' )
    {
        patternFileName = ".html";
        pattern = getCommentPattern( patternFileName );
    }

    return {
        extension: extension,
        fileName: patternFileName,
        pattern: pattern
    };
}

function createCommentPatternCatalog()
{
    return customLanguageConfiguration.createCommentPatternCatalog();
}

function resolveCommentPatternFileName( value )
{
    return customLanguageConfiguration.resolveCommentPatternFileName( value );
}

function getLanguageConfigurationSignature()
{
    return customLanguageConfiguration.getSignature();
}

function removeBlockComments( text, fileName )
{
    var blockCommentPattern = resolveBlockCommentPattern( fileName );
    var commentPattern = blockCommentPattern.pattern;

    if( commentPattern && commentPattern.multiLineComment && commentPattern.multiLineComment.length > 0 )
    {
        commentPattern = getCommentPatternRegex( blockCommentPattern.fileName );
        if( commentPattern && commentPattern.regex )
        {
            var regex = commentPattern.regex;
            if( blockCommentPattern.extension === ".hs" )
            {
                var source = regex.source;
                var flags = regex.flags;
                while( source.indexOf( "\\/\\*\\*" ) !== -1 )
                {
                    source = source.replace( "\\/\\*\\*", "{-" );
                }
                while( source.indexOf( "\\/\\*" ) !== -1 )
                {
                    source = source.replace( "\\/\\*", "{-" );
                }
                while( source.indexOf( "\\*\\/" ) !== -1 )
                {
                    source = source.replace( "\\*\\/", "-}" );
                }
                regex = new RegExp( source, flags );
                commentPattern.regex = regex;
            }
            var commentMatch = commentPattern.regex.exec( text );
            if( commentMatch )
            {
                for( var i = commentPattern.cg.contentStart; i < commentMatch.length; ++i )
                {
                    if( commentMatch[ i ] )
                    {
                        text = commentMatch[ i ];
                        break;
                    }
                }
            }
        }
    }

    return text;
}

function removeLineComments( text, fileName )
{
    var result = text.trim();

    var commentPattern = getCommentPattern( fileName );

    if( commentPattern && commentPattern.singleLineComment )
    {
        commentPattern.singleLineComment.map( function( comment )
        {
            if( result.indexOf( comment.start ) === 0 )
            {
                result = result.substr( comment.start.length );
            }
        } );
    }

    return result;
}

function getTagRegex()
{
    return getTagRegexSource();
}

function escapeRegexLiteral( value )
{
    return regexRegistry.escapeRegexLiteral( value );
}

function getTagRegexSource( uri, tagList )
{
    var tags = ( tagList || config.tags() ).slice().sort().reverse();
    var cacheKey = tags.join( '\u0000' );

    if( tagRegexSourceCache.has( cacheKey ) )
    {
        return tagRegexSourceCache.get( cacheKey );
    }

    tags = tags.map( function( tag )
    {
        return escapeRegexLiteral( tag );
    } );
    tags = tags.join( '|' );
    tagRegexSourceCache.set( cacheKey, tags );
    return tags;
}

function getResourceConfig( uri )
{
    var regexSettings = config.regex( uri );
    return {
        tags: regexSettings.tags,
        regex: regexSettings.regex,
        regexCaseSensitive: regexSettings.caseSensitive !== false,
        enableMultiLine: regexSettings.multiLine === true,
        subTagRegex: config.subTagRegex( uri ),
        isDefaultRegex: regexSettings.regex === DEFAULT_REGEX_SOURCE
    };
}

function resolveResourceConfig( uri, options )
{
    return options && options.resourceConfig ? options.resourceConfig : getResourceConfig( uri );
}

function resolveTagRegex( uri, resourceConfig, flags, options )
{
    if( options && options.tagRegex )
    {
        return options.tagRegex;
    }

    return new RegExp( regexRegistry.captureSource( getTagRegexSource( uri, resourceConfig.tags ) ), flags );
}

function resolveSubTagRegex( resourceConfig, flags, options )
{
    if( options && options.subTagRegex )
    {
        return options.subTagRegex;
    }

    return new RegExp( resourceConfig.subTagRegex, flags );
}

function extractTag( text, matchOffset, uri, preferredTagOffset, options )
{
    var resourceConfig = resolveResourceConfig( uri, options );
    var flags = resourceConfig.regexCaseSensitive ? '' : 'i';
    var tagMatch = null;
    var tagOffset;
    var originalTag;
    var before = text;
    var after = text;
    var subTag;
    var subTagOffset;

    if( resourceConfig.regex.indexOf( TAG_PLACEHOLDER ) > -1 )
    {
        var tagRegex = resolveTagRegex( uri, resourceConfig, flags, options );
        var subTagRegex = resolveSubTagRegex( resourceConfig, flags, options );
        if( preferredTagOffset !== undefined )
        {
            var globalTagRegex = new RegExp( tagRegex.source, flags + 'g' );
            var preferredMatch;

            while( ( preferredMatch = globalTagRegex.exec( text ) ) !== null )
            {
                if( preferredMatch.index === preferredTagOffset )
                {
                    tagMatch = preferredMatch;
                    break;
                }

                if( preferredMatch[ 0 ].length === 0 )
                {
                    globalTagRegex.lastIndex++;
                }
            }
        }

        if( tagMatch === null )
        {
            tagMatch = tagRegex.exec( text );
        }

        if( tagMatch )
        {
            tagOffset = tagMatch.index;
            var rightOfTagText = text.substr( tagMatch.index + tagMatch[ 0 ].length ).trim();
            var subTagMatch = subTagRegex.exec( rightOfTagText );
            if( subTagMatch && subTagMatch.length > 1 )
            {
                subTag = subTagMatch[ 1 ];
                subTagOffset = tagMatch.index + tagMatch[ 0 ].length + rightOfTagText.indexOf( subTag );
            }
            var rightOfTag = rightOfTagText.replace( subTagRegex, "" );
            if( rightOfTag.length === 0 )
            {
                text = text.substr( 0, matchOffset ? matchOffset - 1 : tagMatch.index ).trim();
                after = "";
                before = text;
            }
            else
            {
                before = text.substr( 0, matchOffset ? matchOffset - 1 : tagMatch.index ).trim();
                text = rightOfTag;
                after = rightOfTag;
            }
            resourceConfig.tags.map( function( tag )
            {
                if( resourceConfig.regexCaseSensitive )
                {
                    if( tag === tagMatch[ 0 ] )
                    {
                        originalTag = tag;
                    }
                }
                else if( tag.toLowerCase() === tagMatch[ 0 ].toLowerCase() )
                {
                    originalTag = tag;
                }
            } );
        }
    }
    if( tagMatch === null && resourceConfig.regex.trim() !== "" )
    {
        var regex = options && options.regex ? options.regex : new RegExp( resourceConfig.regex, flags );
        var match = regex.exec( text );
        if( match !== null )
        {
            tagMatch = true;
            originalTag = match[ 0 ];
            before = text.substring( 0, text.indexOf( originalTag ) );
            after = text.substring( before.length + originalTag.length );
            tagOffset = match.index;
            text = after;
        }
    }
    return {
        tag: tagMatch ? originalTag : "",
        withoutTag: text,
        before: before,
        after: after,
        tagOffset: tagOffset,
        subTag: subTag,
        subTagOffset: subTagOffset
    };
}

function updateBeforeAndAfter( result, text, matchOffset, uri, options )
{
    var resourceConfig = resolveResourceConfig( uri, options );
    var flags = resourceConfig.regexCaseSensitive ? '' : 'i';
    var tagMatch = null;

    var tagRegex = resolveTagRegex( uri, resourceConfig, flags, options );
    var subTagRegex = resolveSubTagRegex( resourceConfig, flags, options );
    tagMatch = tagRegex.exec( text );
    if( tagMatch )
    {
        result.tagOffset = tagMatch.index;
        var rightOfTagText = text.substr( tagMatch.index + tagMatch[ 0 ].length ).trim();
        var subTagMatch = subTagRegex.exec( rightOfTagText );
        if( subTagMatch && subTagMatch.length > 1 )
        {
            result.subTag = subTagMatch[ 1 ];
        }
        var rightOfTag = rightOfTagText.replace( subTagRegex, "" );
        if( rightOfTag.length === 0 )
        {
            result.text = text.substr( 0, matchOffset ? matchOffset - 1 : tagMatch.index ).trim();
            result.after = "";
            result.before = text;
        }
        else
        {
            result.before = text.substr( 0, matchOffset ? matchOffset - 1 : tagMatch.index ).trim();
            result.text = rightOfTag;
            result.after = rightOfTag;
        }
    }

    return result;
}

function getRegexSource( uri )
{
    var regex = resolveResourceConfig( uri ).regex;
    if( regex.indexOf( TAG_CAPTURE_PLACEHOLDER ) > -1 )
    {
        regex = regex.split( TAG_CAPTURE_PLACEHOLDER ).join(
            regexRegistry.captureSource( getTagRegexSource( uri, resolveResourceConfig( uri ).tags ) )
        );
    }

    return regex;
}

function getRegexForEditorSearch( global, uri, options )
{
    var flags = 'm';
    options = options || {};
    var resourceConfig = resolveResourceConfig( uri, options );
    if( global )
    {
        flags += 'g';
    }
    if( resourceConfig.regexCaseSensitive === false )
    {
        flags += 'i';
    }
    if( resourceConfig.enableMultiLine === true )
    {
        flags += 's';
    }
    if( options.includeIndices === true && supportsRegExpIndices() === true )
    {
        flags += 'd';
    }

    var source = options.regexSource || ( function()
    {
        var regex = resourceConfig.regex;
        if( regex.indexOf( TAG_CAPTURE_PLACEHOLDER ) > -1 )
        {
            regex = regex.split( TAG_CAPTURE_PLACEHOLDER ).join(
                regexRegistry.captureSource( getTagRegexSource( uri, resourceConfig.tags ) )
            );
        }
        return regex;
    }() );
    return RegExp( source, flags );
}

function getRegexForRipGrep( uri )
{
    var flags = 'gm';
    if( getResourceConfig( uri ).regexCaseSensitive === false )
    {
        flags += 'i';
    }

    return RegExp( getRegexSource( uri ), flags );
}

function isIncluded( name, includes, excludes )
{
    var includeRules = createFilterRules( includes, false );
    var excludeRules = createFilterRules( excludes, true );
    var includeMatches = filterMatchingRules( name, includeRules );

    if( includeRules.length > 0 && includeMatches.length === 0 )
    {
        return false;
    }

    var excludeMatches = filterMatchingRules( name, excludeRules );

    if( excludeMatches.length === 0 )
    {
        return true;
    }

    if( includeMatches.length === 0 )
    {
        return false;
    }

    return excludeMatches.every( function( excludeRule )
    {
        return includeMatches.some( function( includeRule )
        {
            return pathPrefixContains( excludeRule.prefix, includeRule.prefix );
        } );
    } );
}

function formatLabel( template, node, unexpectedPlaceholders )
{
    var result = template;

    var tag = String( node.actualTag ).trim();
    var subTag = node.subTag ? String( node.subTag ).trim() : "";
    var filename = node.fsPath ? path.basename( node.fsPath ) : "";
    var filepath = node.fsPath ? node.fsPath : "";

    var formatLabelMap = {
        "line": node.line + 1,
        "column": node.column,
        "tag": tag,
        "tag:uppercase": tag.toUpperCase(),
        "tag:lowercase": tag.toLowerCase(),
        "tag:capitalize": tag.charAt( 0 ).toUpperCase() + tag.slice( 1 ),
        "subtag": subTag,
        "subtag:uppercase": subTag.toUpperCase(),
        "subtag:lowercase": subTag.toLowerCase(),
        "subtag:capitalize": ( subTag === "" ) ? "" : subTag.charAt( 0 ).toUpperCase() + subTag.slice( 1 ),
        "before": node.before,
        "after": node.after,
        "afterorbefore": ( node.after === "" ) ? node.before : node.after,
        "filename": filename,
        "filepath": filepath
    }

    var re = new RegExp( regexRegistry.buildFormatLabelSource( Object.keys( formatLabelMap ) ), "gi" );
    result = result.replace( re, function( matched )
    {
        return formatLabelMap[ matched.slice( 2, -1 ).toLowerCase() ];
    } );

    if( unexpectedPlaceholders )
    {
        var placeholderMatch = placeholderRegex.exec( result );
        if( placeholderMatch )
        {
            unexpectedPlaceholders.push( placeholderMatch[ 0 ] );
        }
    }

    return result;
}

function createFolderGlob( folderPath, rootPath, filter )
{
    var folder = normalizeGlobPath( folderPath );
    var root = normalizeGlobPath( rootPath );
    var suffix = normalizeGlobPath( filter || "" );
    var relativeFolder = relativeGlobPath( folder, root );

    if( relativeFolder.length === 0 )
    {
        return normalizeRepeatedSlashes( suffix.replace( leadingSlashOneOrMoreRegex, '' ) || "*" );
    }

    return normalizeRepeatedSlashes( "**/" + relativeFolder + suffix );
}

function normalizeRepeatedSlashes( value )
{
    return value.replace( repeatedSlashRegex, '/' );
}

function stripNegation( glob )
{
    var normalized = normalizeGlobPath( String( glob ) );

    return {
        negative: normalized.indexOf( '!' ) === 0,
        body: normalized.indexOf( '!' ) === 0 ? normalized.substring( 1 ) : normalized
    };
}

function normalizeDirectoryGlobBody( body )
{
    if( body.length > 0 && body[ body.length - 1 ] === '/' )
    {
        return body + '**/*';
    }

    return body;
}

function normalizeFilterGlobBody( body )
{
    return normalizeRepeatedSlashes( normalizeDirectoryGlobBody( body ) );
}

function hasWindowsDrivePrefix( value )
{
    return windowsDrivePrefixRegex.test( value );
}

function isAbsoluteGlobPath( value )
{
    return value.indexOf( '/' ) === 0 || hasWindowsDrivePrefix( value );
}

function removeDrivePrefix( value )
{
    return hasWindowsDrivePrefix( value ) ? value.substring( 2 ) : value;
}

function trimLeadingSlashes( value )
{
    return value.replace( leadingSlashOneOrMoreRegex, '' );
}

function trimTrailingSlashes( value )
{
    while( value.length > 1 && value[ value.length - 1 ] === '/' )
    {
        value = value.substring( 0, value.length - 1 );
    }

    return value;
}

function relativeGlobPath( value, root )
{
    var normalizedValue = trimLeadingSlashes( removeDrivePrefix( normalizeFilterGlobBody( value ) ) );
    var normalizedRoot = trimLeadingSlashes( removeDrivePrefix(
        trimTrailingSlashes( normalizeRepeatedSlashes( normalizeGlobPath( root ) ) )
    ) );

    if( normalizedRoot.length > 0 )
    {
        if( normalizedValue === normalizedRoot )
        {
            return "";
        }

        if( normalizedValue.indexOf( normalizedRoot + '/' ) === 0 )
        {
            return normalizedValue.substring( normalizedRoot.length + 1 );
        }
    }

    return normalizedValue;
}

function uniqueValues( values )
{
    var seen = {};

    return values.filter( function( value )
    {
        if( seen[ value ] === true )
        {
            return false;
        }

        seen[ value ] = true;
        return true;
    } );
}

function filterGlobBodies( glob )
{
    var parts = stripNegation( glob );
    var body = normalizeFilterGlobBody( parts.body );
    var bodies = [ body ];

    if( isAbsoluteGlobPath( body ) )
    {
        var workspaceRelative = trimLeadingSlashes( removeDrivePrefix( body ) );
        if( workspaceRelative.length > 0 )
        {
            bodies.push( workspaceRelative );
            bodies.push( "**/" + workspaceRelative );
        }
    }
    else if( body.indexOf( '**/' ) !== 0 && body.indexOf( '/' ) !== -1 )
    {
        bodies.push( "**/" + body );
    }

    return uniqueValues( bodies );
}

function globLiteralPrefix( body )
{
    var prefixParts = [];
    var parts = trimLeadingSlashes( removeDrivePrefix( body ) ).split( '/' );

    for( var index = 0; index < parts.length; index++ )
    {
        var part = parts[ index ];
        if( part === '**' )
        {
            continue;
        }
        if( globMagicCharacterRegex.test( part ) )
        {
            break;
        }
        if( part.length > 0 )
        {
            prefixParts.push( part );
        }
    }

    return prefixParts.join( '/' );
}

function createFilterRule( body, negative, index )
{
    return {
        body: body,
        negative: negative,
        prefix: globLiteralPrefix( body ),
        index: index
    };
}

function createFilterRules( globs, negative )
{
    var rules = [];

    ( globs || [] ).forEach( function( glob, index )
    {
        filterGlobBodies( glob ).forEach( function( body )
        {
            rules.push( createFilterRule( body, negative, index ) );
        } );
    } );

    return rules;
}

function filterMatchingRules( name, rules )
{
    var normalizedName = normalizeGlobPath( name );

    return rules.filter( function( rule )
    {
        return micromatch.isMatch( normalizedName, rule.body );
    } );
}

function pathPrefixContains( parentPrefix, childPrefix )
{
    if( parentPrefix.length === 0 || childPrefix.length === 0 )
    {
        return false;
    }

    return childPrefix === parentPrefix || childPrefix.indexOf( parentPrefix + '/' ) === 0;
}

function ripgrepGlobBody( body, rootPath )
{
    var root = normalizeGlobPath( rootPath || "" );
    var normalizedBody = normalizeFilterGlobBody( body );

    if( isAbsoluteGlobPath( normalizedBody ) )
    {
        return relativeGlobPath( normalizedBody, root );
    }

    return normalizedBody;
}

function createRipgrepRule( glob, rootPath, index )
{
    var parts = stripNegation( glob );
    var body = ripgrepGlobBody( parts.body, rootPath );

    return createFilterRule( body, parts.negative, index );
}

function compareRipgrepRuleGroups( left, right )
{
    if( left.group !== right.group )
    {
        return left.group - right.group;
    }

    return left.index - right.index;
}

function toRipgrepGlobArray( globs, rootPath )
{
    var rules = ( globs || [] ).map( function( glob, index )
    {
        return createRipgrepRule( glob, rootPath, index );
    } );
    var includeRules = rules.filter( function( rule ) { return rule.negative !== true; } );

    return rules.filter( function( rule )
    {
        if( rule.negative !== true )
        {
            return true;
        }

        return includeRules.some( function( includeRule )
        {
            return pathPrefixContains( rule.prefix, includeRule.prefix );
        } ) !== true;
    } ).map( function( rule )
    {
        return {
            rule: rule,
            index: rule.index,
            group: rule.negative === true ? 2 : 1
        };
    } ).sort( compareRipgrepRuleGroups ).map( function( entry )
    {
        return ( entry.rule.negative === true ? '!' : '' ) + entry.rule.body;
    } );
}

function normalizeGlobPath( value )
{
    return value.replace( pathBackslashRegex, '/' );
}

function readGitmodulesPaths( rootPath )
{
    var gitmodulesPath = path.join( rootPath, '.gitmodules' );

    if( fs.existsSync( gitmodulesPath ) !== true )
    {
        return [];
    }

    return fs.readFileSync( gitmodulesPath, 'utf8' )
        .split( lineBreakRegex )
        .map( function( line )
        {
            var match = gitmodulePathLineRegex.exec( line );
            return match ? match[ 1 ] : undefined;
        } )
        .filter( function( submodulePath )
        {
            return typeof ( submodulePath ) === 'string' && submodulePath.length > 0;
        } );
}

function getSubmoduleExcludeGlobs( rootPath )
{
    if( submoduleExcludeGlobCache.has( rootPath ) )
    {
        return submoduleExcludeGlobCache.get( rootPath ).slice();
    }

    var submodules = readGitmodulesPaths( rootPath ).map( function( submodulePath )
    {
        return normalizeGlobPath( submodulePath ) + '/**';
    } );

    submoduleExcludeGlobCache.set( rootPath, submodules );
    return submodules.slice();
}

function clearSubmoduleExcludeGlobCache()
{
    submoduleExcludeGlobCache.clear();
}

function isHidden( filename )
{
    return path.basename( filename ).indexOf( '.' ) !== -1 && path.extname( filename ) === "";
}

function expandTilde( filePath )
{
    if( filePath && filePath[ 0 ] === '~' )
    {
        filePath = path.join( os.homedir(), filePath.slice( 1 ) );
    }

    return filePath;
}

function replaceEnvironmentVariables( text )
{
    text = text.replace( envRegex, function( match, name )
    {
        return process.env[ name ] ? process.env[ name ] : "";
    } );

    return text;
}

function formatExportPath( template, dateTime )
{
    var result = expandTilde( template );
    if( result )
    {
        result = strftime.strftime( result, dateTime );
    }
    return result;
}

function complementaryColour( colour )
{
    var hex = colour.split( ' ' )[ 0 ].replace( hexColourNoiseRegex, '' );
    var digits = hex.length / 3;
    var red = parseInt( hex.substr( 0, digits ), 16 );
    var green = parseInt( hex.substr( 1 * digits, digits ), 16 );
    var blue = parseInt( hex.substr( 2 * digits, digits ), 16 );
    var c = [ red / 255, green / 255, blue / 255 ];
    for( var i = 0; i < c.length; ++i )
    {
        if( c[ i ] <= 0.03928 )
        {
            c[ i ] = c[ i ] / 12.92;
        } else
        {
            c[ i ] = Math.pow( ( c[ i ] + 0.055 ) / 1.055, 2.4 );
        }
    }
    var l = 0.2126 * c[ 0 ] + 0.7152 * c[ 1 ] + 0.0722 * c[ 2 ];
    return l > 0.179 ? "#000000" : "#ffffff";
}

function isValidColour( colour )
{
    if( colour )
    {
        if( isNamedColour( colour ) || isThemeColour( colour ) || isHexColour( colour ) || isRgbColour( colour ) )
        {
            return true;
        }
    }

    return false;
}

function setRgbAlpha( rgb, alpha )
{
    rgbRegex.lastIndex = 0;
    var match = rgbRegex.exec( rgb );
    if( match !== null )
    {
        return "rgba(" + match[ 1 ] + "," + match[ 2 ] + "," + match[ 3 ] + "," + alpha + ")";
    }
    return rgb;
}

function getCodiconName( icon )
{
    if( typeof icon !== 'string' )
    {
        return undefined;
    }

    var match = icon.trim().match( codiconRegex );
    return match ? match[ 1 ] : undefined;
}

function isCodicon( icon )
{
    return getCodiconName( icon ) !== undefined;
}

function toGlobArray( globs )
{
    if( globs === undefined )
    {
        return [];
    }
    if( typeof ( globs ) === 'string' )
    {
        return globs.split( ',' );
    }
    return globs;
}

module.exports.init = init;
module.exports.isHexColour = isHexColour;
module.exports.isRgbColour = isRgbColour;
module.exports.isNamedColour = isNamedColour;
module.exports.isThemeColour = isThemeColour;
module.exports.hexToRgba = hexToRgba;
module.exports.removeBlockComments = removeBlockComments;
module.exports.removeLineComments = removeLineComments;
module.exports.getCommentPattern = getCommentPattern;
module.exports.getCommentPatternRegex = getCommentPatternRegex;
module.exports.resolveBlockCommentPattern = resolveBlockCommentPattern;
module.exports.createCommentPatternCatalog = createCommentPatternCatalog;
module.exports.resolveCommentPatternFileName = resolveCommentPatternFileName;
module.exports.getLanguageConfigurationSignature = getLanguageConfigurationSignature;
module.exports.getResourceConfig = getResourceConfig;
module.exports.getTagRegexSource = getTagRegexSource;
module.exports.supportsRegExpIndices = supportsRegExpIndices;
module.exports.DEFAULT_REGEX_SOURCE = DEFAULT_REGEX_SOURCE;
module.exports.LEGACY_MARKDOWN_TASK_FRAGMENT = regexRegistry.LEGACY_MARKDOWN_TASK_FRAGMENT;
module.exports.extractTag = extractTag;
module.exports.updateBeforeAndAfter = updateBeforeAndAfter;
module.exports.getRegexSource = getRegexSource;
module.exports.getRegexForRipGrep = getRegexForRipGrep;
module.exports.getRegexForEditorSearch = getRegexForEditorSearch;
module.exports.isIncluded = isIncluded;
module.exports.formatLabel = formatLabel;
module.exports.createFolderGlob = createFolderGlob;
module.exports.toRipgrepGlobArray = toRipgrepGlobArray;
module.exports.getSubmoduleExcludeGlobs = getSubmoduleExcludeGlobs;
module.exports.clearSubmoduleExcludeGlobCache = clearSubmoduleExcludeGlobCache;
module.exports.isHidden = isHidden;
module.exports.expandTilde = expandTilde;
module.exports.replaceEnvironmentVariables = replaceEnvironmentVariables;
module.exports.formatExportPath = formatExportPath;
module.exports.complementaryColour = complementaryColour;
module.exports.isValidColour = isValidColour;
module.exports.setRgbAlpha = setRgbAlpha;
module.exports.getCodiconName = getCodiconName;
module.exports.isCodicon = isCodicon;
module.exports.toGlobArray = toGlobArray;
