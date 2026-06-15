var detection = require( '../src/detection.js' );
var utils = require( '../src/utils.js' );
var customLanguageConfiguration = require( '../src/customLanguageConfiguration.js' );
var matrixHelpers = require( './matrixHelpers.js' );

QUnit.module( 'behavioral custom language configuration', {
    afterEach: function()
    {
        utils.init( matrixHelpers.createConfig() );
    }
} );

function createConfigWithLanguages( customPatterns, embeddedDocuments )
{
    return matrixHelpers.createConfig( {
        customCommentPatterns: function()
        {
            return customPatterns || [];
        },
        customEmbeddedDocuments: function()
        {
            return embeddedDocuments || [];
        }
    } );
}

function scanCustomText( fsPath, text )
{
    return detection.scanText( matrixHelpers.createUri( fsPath ), text );
}

QUnit.test( 'custom comment patterns scan new file extensions without changing defaults', function( assert )
{
    utils.init( createConfigWithLanguages( [
        {
            id: 'fixturelogic',
            name: 'Fixture Logic',
            aliases: [ 'Fixture Logic Alias' ],
            languageIds: [ 'fixture-logic' ],
            extensions: [ '.flogic' ],
            filenameGlobs: [ '**/*.fixturelogic' ],
            singleLineComments: [ '%%' ],
            multiLineComments: [
                {
                    start: '{-',
                    middle: '|',
                    end: '-}'
                }
            ]
        }
    ] ) );

    var results = scanCustomText( '/workspace/src/example.flogic', [
        '%% TODO line item',
        '{-',
        '| FIXME block item',
        '-}'
    ].join( '\n' ) );

    assert.deepEqual( results.map( function( result )
    {
        return {
            tag: result.tag,
            displayText: result.displayText
        };
    } ), [
        { tag: 'TODO', displayText: 'line item' },
        { tag: 'FIXME', displayText: 'block item' }
    ] );
    assert.equal( utils.getCommentPattern( '/workspace/src/app.js' ).name, 'JavaScript' );
    assert.equal( utils.resolveCommentPatternFileName( 'fixture logic alias' ), 'fixturelogic' );
} );

QUnit.test( 'filename glob custom patterns cover extensionless generated files', function( assert )
{
    utils.init( createConfigWithLanguages( [
        {
            id: 'fixtureglob',
            filenameGlobs: [ '**/CODEOWNERS.fixture' ],
            singleLineComments: [ 'owner:' ]
        },
        {
            id: 'fixturegenerated',
            filenameGlobs: [ '**/GeneratedFixture' ],
            singleLineComments: [ 'gen:' ]
        }
    ] ) );

    var results = scanCustomText( '/workspace/.config/CODEOWNERS.fixture', 'owner: TODO assign owner' );
    var generatedResults = scanCustomText( '/workspace/build/GeneratedFixture', 'gen: FIXME generated owner' );

    assert.equal( results.length, 1 );
    assert.equal( results[ 0 ].displayText, 'assign owner' );
    assert.equal( generatedResults.length, 1 );
    assert.equal( generatedResults[ 0 ].displayText, 'generated owner' );
    assert.equal( utils.getCommentPattern( '/workspace/src/app.js' ).name, 'JavaScript' );
} );

QUnit.test( 'custom comment pattern cache refreshes from language settings', function( assert )
{
    var customPatterns = [
        {
            id: 'fixtureold',
            extensions: [ '.fixtureold' ],
            singleLineComments: [ 'old:' ]
        }
    ];

    utils.init( createConfigWithLanguages( customPatterns ) );

    assert.equal( utils.getCommentPattern( '/workspace/a.fixtureold' ).name, 'fixtureold' );
    assert.equal( utils.getCommentPattern( '/workspace/b.fixturenew' ), undefined );

    customPatterns = [
        {
            id: 'fixturenew',
            extensions: [ '.fixturenew' ],
            singleLineComments: [ 'new:' ]
        }
    ];

    utils.init( createConfigWithLanguages( customPatterns ) );

    assert.equal( utils.getCommentPattern( '/workspace/a.fixtureold' ), undefined );
    assert.equal( utils.getCommentPattern( '/workspace/b.fixturenew' ).name, 'fixturenew' );
    assert.equal( utils.getCommentPattern( '/workspace/src/app.js' ).name, 'JavaScript' );
} );

QUnit.test( 'custom embedded descriptors scan same-element regions by attributes', function( assert )
{
    utils.init( createConfigWithLanguages( [
        {
            id: 'fixturehash',
            singleLineComments: [ '@@' ]
        },
        {
            id: 'fixtureslash',
            singleLineComments: [ '//' ]
        }
    ], [
        {
            id: 'fixture-compound',
            parser: 'html-like-element-regions',
            match: {
                extensions: [ '.fixturecmp' ]
            },
            baseLanguage: 'html',
            regions: [
                {
                    element: 'part',
                    attributes: {
                        kind: 'hash'
                    },
                    defaultLanguage: 'fixturehash',
                    rawText: true
                },
                {
                    element: 'part',
                    attributeMatches: {
                        kind: '^slash$'
                    },
                    defaultLanguage: 'fixtureslash',
                    rawText: true
                },
                {
                    element: 'part',
                    attributePresent: [ 'ignore' ],
                    maskWhenUnresolved: true,
                    rawText: true
                }
            ]
        }
    ] ) );

    var results = scanCustomText( '/workspace/view.fixturecmp', [
        '<part kind="hash">@@ TODO hash region</part>',
        '<part kind="slash">// FIXME slash region</part>',
        '<part ignore><!-- TODO hidden region --></part>',
        '<!-- TODO base markup -->'
    ].join( '\n' ) );

    assert.deepEqual( results.map( function( result )
    {
        return result.displayText;
    } ), [
        'hash region',
        'slash region',
        'base markup'
    ] );
} );

QUnit.test( 'invalid custom comment patterns fail with typed errors', function( assert )
{
    var error;

    utils.init( createConfigWithLanguages( [
        {
            id: 'broken'
        }
    ] ) );

    try
    {
        customLanguageConfiguration.getCommentPattern( 'broken' );
    }
    catch( caught )
    {
        error = caught;
    }

    assert.ok( error instanceof customLanguageConfiguration.CustomLanguageConfigurationError );
    assert.equal( error.message, 'customLanguageConfiguration: customCommentPatterns[0] requires a comment delimiter.' );
} );
