/**
 * Shared scan helpers consumed by the parity test files. Encapsulates
 * fixture-to-uri conversion, default-regex configuration, and detector
 * invocation. Single source of truth for both the parity comparison suite
 * and the robustness suite.
 */

var detection = require( '../../src/detection.js' );
var upstreamDetector = require( './upstreamDetector.js' );
var corpus = require( './corpus.js' );

function makeBetterTodoTreeConfig()
{
    return {
        tagList: corpus.PARITY_TAG_LIST.slice(),
        regexSource: corpus.PARITY_REGEX_SOURCE,
        caseSensitive: true,
        multiLine: false,
        subTagRegexString: '',
        tags: function() { return this.tagList; },
        regex: function()
        {
            return {
                tags: this.tagList,
                regex: this.regexSource,
                caseSensitive: this.caseSensitive,
                multiLine: this.multiLine
            };
        },
        subTagRegex: function() { return this.subTagRegexString; },
        isRegexCaseSensitive: function() { return this.caseSensitive; }
    };
}

function makeUpstreamConfig()
{
    return {
        tagList: corpus.PARITY_TAG_LIST.slice(),
        regexSource: corpus.PARITY_REGEX_SOURCE,
        caseSensitive: true,
        multiLine: false,
        subTagRegexString: ''
    };
}

function makeUri( fsPath )
{
    return {
        fsPath: fsPath,
        path: fsPath,
        toString: function() { return fsPath; }
    };
}

function scanBetterTodoTree( fixture )
{
    return detection.scanText( makeUri( fixture.fsPath ), fixture.text );
}

function scanUpstream( fixture )
{
    return upstreamDetector.runUpstreamDetector( makeUri( fixture.fsPath ), fixture.text, makeUpstreamConfig() );
}

function allCorpora()
{
    return [
        corpus.VENDORED_CORPUS,
        corpus.UNVENDORED_CORPUS,
        corpus.NEGATIVE_CORPUS,
        corpus.EDGE_CASE_CORPUS,
        corpus.MULTI_TAG_CORPUS,
        corpus.FUZZ_CORPUS,
        corpus.REALISTIC_CODE_CORPUS
    ];
}

function allFixtures()
{
    var fixtures = [];
    allCorpora().forEach( function( c )
    {
        c.forEach( function( fixture ) { fixtures.push( fixture ); } );
    } );
    return fixtures;
}

module.exports.makeBetterTodoTreeConfig = makeBetterTodoTreeConfig;
module.exports.makeUpstreamConfig = makeUpstreamConfig;
module.exports.makeUri = makeUri;
module.exports.scanBetterTodoTree = scanBetterTodoTree;
module.exports.scanUpstream = scanUpstream;
module.exports.allCorpora = allCorpora;
module.exports.allFixtures = allFixtures;
