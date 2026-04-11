var matrixHelpers = require( './matrixHelpers.js' );

function createIssue888Text()
{
    return [
        "/***************************************************************************************************",
        " * Helpers",
        " **************************************************************************************************/"
    ].join( '\n' );
}

function createIssue888Config( overrides )
{
    return matrixHelpers.createConfig( Object.assign( {
        tagList: [ '@todo', '*' ],
        regexSource: '(//|/\\*{3,}\\n|/\\*|<!--|#)\\s+($TAGS)',
        shouldBeCaseSensitive: false,
        enableMultiLineFlag: false,
        subTagRegexString: '(^:\\s*)'
    }, overrides || {} ) );
}

function createIssue888RipgrepMatch( fsPath )
{
    return {
        fsPath: fsPath,
        line: 1,
        column: 1,
        match: createIssue888Text().split( /\r?\n/ )[ 0 ]
    };
}

module.exports.createIssue888Text = createIssue888Text;
module.exports.createIssue888Config = createIssue888Config;
module.exports.createIssue888RipgrepMatch = createIssue888RipgrepMatch;
