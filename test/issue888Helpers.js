var matrixHelpers = require( './matrixHelpers.js' );
var regexRegistry = require( '../src/regexRegistry.js' );

function createIssue888Text()
{
    return [
        "/***************************************************************************************************",
        " * Helpers",
        " **************************************************************************************************/"
    ].join( '\n' );
}

function createIssue888RegexSource()
{
    var builder = regexRegistry.createRegexBuilder();

    return builder.sequence( [
        builder.capture( builder.alternation( [
            regexRegistry.fragment( 'slashCommentPrefix' ),
            regexRegistry.fragment( 'blockCommentBannerPrefix' ),
            regexRegistry.fragment( 'blockCommentStart' ),
            regexRegistry.fragment( 'htmlCommentStart' ),
            regexRegistry.fragment( 'hashCommentPrefix' )
        ] ) ),
        regexRegistry.fragment( 'whitespaceOneOrMore' ),
        regexRegistry.TAG_CAPTURE_PLACEHOLDER
    ] );
}

function createIssue888Config( overrides )
{
    return matrixHelpers.createConfig( Object.assign( {
        tagList: [ '@todo', '*' ],
        regexSource: createIssue888RegexSource(),
        shouldBeCaseSensitive: false,
        enableMultiLineFlag: false,
        subTagRegexString: regexRegistry.pattern( 'subTagPrefixCapture' )
    }, overrides || {} ) );
}

function createIssue888RipgrepMatch( fsPath )
{
    return {
        fsPath: fsPath,
        line: 1,
        column: 1,
        match: createIssue888Text().split(
            regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' )
        )[ 0 ]
    };
}

module.exports.createIssue888Text = createIssue888Text;
module.exports.createIssue888Config = createIssue888Config;
module.exports.createIssue888RipgrepMatch = createIssue888RipgrepMatch;
