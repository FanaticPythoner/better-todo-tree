var packageJson = require( '../package.json' );
var baseLanguages = require( '../node_modules/comment-patterns/db-generated/base.js' );

var EXPECTED_LANGUAGE_NAMES = [
    'C',
    'Clojure',
    'CoffeeScript',
    'C++',
    'CSharp',
    'CSS',
    'Go',
    'Handlebars',
    'Haskell',
    'HTML',
    'Jade',
    'Jake',
    'Java',
    'JavaScript',
    'JSON',
    'JSP',
    'LaTeX',
    'LESS',
    'LiveScript',
    'Lua',
    'Make',
    'Markdown',
    'Mustache',
    'Objective-C',
    'Perl',
    'PHP',
    'Puppet',
    'Python',
    'Ruby',
    'Sass',
    'SCSS',
    'Shell',
    'SQL',
    'Swift',
    'TypeScript',
    'YAML'
];

function findConfigurationProperty( propertyName )
{
    var result;

    function visit( node )
    {
        if( result !== undefined || node === undefined || node === null )
        {
            return;
        }

        if( Array.isArray( node ) )
        {
            node.forEach( visit );
            return;
        }

        if( typeof ( node ) !== 'object' )
        {
            return;
        }

        if( node.properties && node.properties[ propertyName ] )
        {
            result = node.properties[ propertyName ];
            return;
        }

        Object.keys( node ).forEach( function( key )
        {
            visit( node[ key ] );
        } );
    }

    visit( packageJson.contributes.configuration );

    if( result === undefined )
    {
        throw new Error( 'Unable to find package.json configuration property ' + propertyName );
    }

    return result;
}

function matcherToFileName( matcher )
{
    if( typeof ( matcher ) === 'string' && matcher.indexOf( '.' ) === 0 )
    {
        return 'fixture' + matcher;
    }

    return matcher;
}

function cloneMultiLineEntry( entry )
{
    return {
        start: entry.start,
        middle: entry.middle,
        end: entry.end,
        apidoc: entry.apidoc === true
    };
}

var DEFAULT_TAGS = findConfigurationProperty( 'todo-tree.general.tags' ).default.slice();
var DEFAULT_REGEX_SOURCE = findConfigurationProperty( 'todo-tree.regex.regex' ).default;
var CURRENT_LANGUAGE_NAMES = baseLanguages.map( function( entry ) { return entry.name; } );
var LANGUAGES = baseLanguages.map( function( entry )
{
    return {
        name: entry.name,
        srcFile: entry.srcFile,
        fileName: matcherToFileName( entry.nameMatchers[ 0 ] ),
        nameMatchers: entry.nameMatchers.slice(),
        commentsOnly: entry.commentsOnly === true,
        singleLineTokens: ( entry.singleLineComment || [] ).map( function( comment ) { return comment.start; } ),
        multiLineEntries: ( entry.multiLineComment || [] ).map( cloneMultiLineEntry )
    };
} );

var HIGHLIGHT_TYPES = [
    'tag',
    'text',
    'tag-and-comment',
    'tag-and-subTag',
    'text-and-comment',
    'line',
    'whole-line',
    'capture-groups:1,2',
    'none'
];

module.exports.EXPECTED_LANGUAGE_NAMES = EXPECTED_LANGUAGE_NAMES;
module.exports.CURRENT_LANGUAGE_NAMES = CURRENT_LANGUAGE_NAMES;
module.exports.DEFAULT_TAGS = DEFAULT_TAGS;
module.exports.DEFAULT_REGEX_SOURCE = DEFAULT_REGEX_SOURCE;
module.exports.LANGUAGES = LANGUAGES;
module.exports.HIGHLIGHT_TYPES = HIGHLIGHT_TYPES;
