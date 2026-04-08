var testConfig = {
    shouldGroupByTagFlag: false,
    shouldBeCaseSensitive: false,
    regexSource: "($TAGS)",
    enableMultiLineFlag: false,
    tagList: [ "BUG", "HACK", "FIXME", "TODO", "XXX", "[ ]", "[x]" ],
    subTagRegexString: "(^:\\s*)",
    globsList: [],
    useColourScheme: false,
    foregroundColours: [],
    backgroundColours: [],
    uriOverrides: {},
};

function uriKey( uri )
{
    if( uri === undefined || uri === null )
    {
        return "";
    }

    if( typeof ( uri ) === 'string' )
    {
        return uri;
    }

    if( typeof ( uri.toString ) === 'function' )
    {
        return uri.toString();
    }

    return String( uri );
}

function getUriOverride( config, uri )
{
    return config.uriOverrides[ uriKey( uri ) ] || {};
}

testConfig.regex = function( uri )
{
    var uriOverride = getUriOverride( this, uri );

    return {
        tags: this.tagList,
        regex: uriOverride.regexSource !== undefined ? uriOverride.regexSource : this.regexSource,
        caseSensitive: uriOverride.shouldBeCaseSensitive !== undefined ? uriOverride.shouldBeCaseSensitive : this.shouldBeCaseSensitive,
        multiLine: uriOverride.enableMultiLineFlag !== undefined ? uriOverride.enableMultiLineFlag : this.enableMultiLineFlag
    };
};
testConfig.shouldGroupByTag = function()
{
    return this.shouldGroupByTagFlag;
};
testConfig.globs = function()
{
    return this.globsList;
};
testConfig.tags = function()
{
    return this.tagList;
};
testConfig.isRegexCaseSensitive = function()
{
    return this.shouldBeCaseSensitive;
};

testConfig.subTagRegex = function( uri )
{
    var uriOverride = getUriOverride( this, uri );

    return uriOverride.subTagRegexString !== undefined ? uriOverride.subTagRegexString : this.subTagRegexString;
};

testConfig.shouldUseColourScheme = function()
{
    return this.useColourScheme;
};
testConfig.defaultHighlight = function()
{
    return {};
};
testConfig.customHighlight = function()
{
    return [];
};
testConfig.foregroundColourScheme = function()
{
    return this.foregroundColours;
};
testConfig.backgroundColourScheme = function()
{
    return this.backgroundColours;
};

function getTestConfig()
{
    var config = Object.create( testConfig );
    config.tagList = testConfig.tagList.slice();
    config.globsList = testConfig.globsList.slice();
    config.foregroundColours = testConfig.foregroundColours.slice();
    config.backgroundColours = testConfig.backgroundColours.slice();
    config.uriOverrides = {};
    return config;
}

function setUriOverride( config, uri, override )
{
    config.uriOverrides[ uriKey( uri ) ] = Object.assign( {}, override );
}

module.exports.getTestConfig = getTestConfig;
module.exports.setUriOverride = setUriOverride;
