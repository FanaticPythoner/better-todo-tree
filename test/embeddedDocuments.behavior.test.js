var commentPatternCatalog = require( '../src/commentPatternCatalog.js' );
var embeddedDocuments = require( '../src/embeddedDocuments.js' );

QUnit.module( 'behavioral embedded document descriptors' );

QUnit.test( 'default descriptor resolves Vue script, style, and typed regions from data', function( assert )
{
    var text = [
        '<script lang="ts">',
        '// TODO typed',
        '</script>',
        '<style lang="scss">',
        '/* FIXME styled */',
        '</style>'
    ].join( '\n' );
    var document = embeddedDocuments.resolveEmbeddedDocument( '/tmp/component.vue', text );

    assert.equal( document.descriptor.id, 'html-single-file-component' );
    assert.deepEqual(
        document.regions.map( function( region )
        {
            return {
                element: region.element,
                patternFileName: region.patternFileName,
                closed: region.closed
            };
        } ),
        [
            { element: 'script', patternFileName: '.ts', closed: true },
            { element: 'style', patternFileName: '.scss', closed: true }
        ]
    );
} );

QUnit.test( 'default descriptor resolves Svelte script and style regions from data', function( assert )
{
    var text = [
        '<script module>',
        '// TODO module',
        '</script>',
        '<script lang="ts">',
        '// TODO instance',
        '</script>',
        '<style lang="scss">',
        '// FIXME styled',
        '</style>',
        '<!-- TODO markup -->'
    ].join( '\n' );
    var document = embeddedDocuments.resolveEmbeddedDocument( '/tmp/component.svelte', text );

    assert.equal( document.descriptor.id, 'html-single-file-component' );
    assert.deepEqual(
        document.regions.map( function( region )
        {
            return {
                element: region.element,
                patternFileName: region.patternFileName,
                closed: region.closed
            };
        } ),
        [
            { element: 'script', patternFileName: '.js', closed: true },
            { element: 'script', patternFileName: '.ts', closed: true },
            { element: 'style', patternFileName: '.scss', closed: true }
        ]
    );
} );

QUnit.test( 'default descriptor resolves Astro frontmatter, scripts, styles, and expression comments', function( assert )
{
    var text = [
        '---',
        '// TODO frontmatter',
        '---',
        '<script>',
        '// TODO browser',
        '</script>',
        '<style>',
        '/* FIXME styled */',
        '</style>',
        '{/* TODO expression */}',
        '<!-- TODO markup -->'
    ].join( '\n' );
    var document = embeddedDocuments.resolveEmbeddedDocument( '/tmp/component.astro', text );

    assert.equal( document.descriptor.id, 'astro-component' );
    assert.deepEqual(
        document.regions.map( function( region )
        {
            return {
                element: region.element,
                patternFileName: region.patternFileName,
                closed: region.closed
            };
        } ),
        [
            { element: 'frontmatter', patternFileName: '.ts', closed: true },
            { element: 'script', patternFileName: '.js', closed: true },
            { element: 'style', patternFileName: '.css', closed: true },
            { element: 'astro-template-expression-comment', patternFileName: '.js', closed: true }
        ]
    );
} );

QUnit.test( 'custom descriptor applies the same parser to another compound extension', function( assert )
{
    var resolver = embeddedDocuments.createEmbeddedDocumentResolver( {
        catalog: commentPatternCatalog.createCommentPatternCatalog(),
        descriptors: [
            {
                id: 'fixture-compound',
                parser: 'html-like-element-regions',
                match: {
                    extensions: [ '.compound' ],
                    languageIds: [ 'compound' ]
                },
                baseLanguage: 'html',
                regions: [
                    {
                        element: 'logic',
                        languageAttribute: 'lang',
                        defaultLanguage: 'javascript'
                    }
                ]
            }
        ]
    } );
    var document = resolver.resolve( '/tmp/example.compound', '<logic lang="py">\n# TODO x\n</logic>' );

    assert.equal( document.descriptor.id, 'fixture-compound' );
    assert.equal( document.basePatternFileName, '.htm' );
    assert.equal( document.regions.length, 1 );
    assert.equal( document.regions[ 0 ].patternFileName, '.py' );
} );

QUnit.test( 'custom parser plugins can parse non-HTML compound documents', function( assert )
{
    var parserRegistry = embeddedDocuments.createDefaultParserRegistry();

    parserRegistry.register( 'fixture-marker-regions', function( options )
    {
        return {
            parse: function( text )
            {
                var startToken = '@@begin ';
                var endToken = '@@end';
                var start = text.indexOf( startToken );
                var lineEnd = text.indexOf( '\n', start );
                var end = text.indexOf( endToken, lineEnd );

                if( start !== 0 || lineEnd < 0 || end < 0 )
                {
                    throw new Error( 'fixture-marker-regions: bounded region is required.' );
                }

                var language = text.slice( start + startToken.length, lineEnd ).trim();
                var patternFileName = options.catalog.resolvePatternFileName( language );

                if( typeof ( patternFileName ) !== 'string' )
                {
                    throw new Error( 'fixture-marker-regions: supported language is required.' );
                }

                return [
                    {
                        element: 'fixture',
                        patternFileName: patternFileName,
                        startOffset: lineEnd + 1,
                        endOffset: end,
                        rangeStartOffset: start,
                        rangeEndOffset: end + endToken.length,
                        closed: true,
                        text: text.slice( lineEnd + 1, end )
                    }
                ];
            }
        };
    } );

    var resolver = embeddedDocuments.createEmbeddedDocumentResolver( {
        parserRegistry: parserRegistry,
        catalog: commentPatternCatalog.createCommentPatternCatalog(),
        descriptors: [
            {
                id: 'fixture-marker-document',
                parser: 'fixture-marker-regions',
                match: {
                    extensions: [ '.marker' ]
                },
                baseLanguage: 'html',
                regions: []
            }
        ]
    } );
    var document = resolver.resolve(
        '/tmp/example.marker',
        [ '@@begin javascript', '// TODO from marker parser', '@@end' ].join( '\n' )
    );

    assert.equal( document.regions.length, 1 );
    assert.equal( document.regions[ 0 ].patternFileName, '.js' );
    assert.equal( document.regions[ 0 ].text.trim(), '// TODO from marker parser' );
} );

QUnit.test( 'descriptor validation requires explicit parser ids', function( assert )
{
    var error;

    try
    {
        embeddedDocuments.createEmbeddedDocumentResolver( {
            descriptors: [
                {
                    id: 'missing-parser',
                    match: {
                        extensions: [ '.bad' ]
                    },
                    regions: []
                }
            ]
        } );
    }
    catch( caught )
    {
        error = caught;
    }

    assert.ok( error instanceof Error );
    assert.ok( error.message.indexOf( 'descriptor.parser is required' ) >= 0 );
} );

QUnit.test( 'unknown parser ids fail before region scanning', function( assert )
{
    var resolver = embeddedDocuments.createEmbeddedDocumentResolver( {
        descriptors: [
            {
                id: 'unknown-parser',
                parser: 'fixture-unknown-parser',
                match: {
                    extensions: [ '.bad' ]
                },
                regions: []
            }
        ]
    } );

    var error;

    try
    {
        resolver.resolve( '/tmp/example.bad', 'TODO' );
    }
    catch( caught )
    {
        error = caught;
    }

    assert.ok( error instanceof Error );
    assert.ok( error.message.indexOf( 'unknown parser id fixture-unknown-parser' ) >= 0 );
} );

QUnit.test( 'malformed parser regions fail at the resolver boundary', function( assert )
{
    var parserRegistry = embeddedDocuments.createDefaultParserRegistry();

    parserRegistry.register( 'fixture-malformed-regions', function()
    {
        return {
            parse: function()
            {
                return [
                    {
                        element: 'fixture',
                        startOffset: 1,
                        endOffset: 0,
                        rangeStartOffset: 0,
                        rangeEndOffset: 1,
                        closed: true,
                        text: ''
                    }
                ];
            }
        };
    } );

    var resolver = embeddedDocuments.createEmbeddedDocumentResolver( {
        parserRegistry: parserRegistry,
        descriptors: [
            {
                id: 'malformed-parser',
                parser: 'fixture-malformed-regions',
                match: {
                    extensions: [ '.bad' ]
                },
                regions: []
            }
        ]
    } );

    var error;

    try
    {
        resolver.resolve( '/tmp/example.bad', 'x' );
    }
    catch( caught )
    {
        error = caught;
    }

    assert.ok( error instanceof Error );
    assert.ok( error.message.indexOf( 'has inconsistent offsets' ) >= 0 );
} );

QUnit.test( 'script MIME resolution keeps JSON regions commentless', function( assert )
{
    var text = [
        '<script type="application/json">',
        '{ "message": "// TODO not a comment" }',
        '</script>'
    ].join( '\n' );
    var document = embeddedDocuments.resolveEmbeddedDocument( '/tmp/component.vue', text );

    assert.equal( document.regions.length, 1 );
    assert.equal( document.regions[ 0 ].patternFileName, '.json' );
} );

QUnit.test( 'unsupported explicit script languages become mask-only regions', function( assert )
{
    var text = [
        '<script lang="fixture-unknown">',
        '<!-- TODO not markup -->',
        '</script>',
        '<template>',
        '<!-- FIXME markup -->',
        '</template>'
    ].join( '\n' );
    var document = embeddedDocuments.resolveEmbeddedDocument( '/tmp/component.vue', text );

    assert.equal( document.regions.length, 1 );
    assert.equal( document.regions[ 0 ].element, 'script' );
    assert.equal( document.regions[ 0 ].patternFileName, undefined );
} );

QUnit.test( 'open embedded regions expose the earliest retain offset', function( assert )
{
    var text = [
        '<template><!-- TODO visible --></template>',
        '<script>',
        '// TODO pending'
    ].join( '\n' );

    assert.equal( embeddedDocuments.findTrailingOpenRegionStart( '/tmp/component.vue', text ), text.indexOf( '<script>' ) );
} );
