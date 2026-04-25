/**
 * Parity corpus consumed by test/parity/parity.test.js.
 *
 * Exports seven corpora:
 *   VENDORED_CORPUS        fixtures expanded from comment-patterns/db-generated/base.js.
 *   UNVENDORED_CORPUS      fixtures covering 114 extensions absent from the db.
 *   NEGATIVE_CORPUS        identifier-only inputs both detectors reject.
 *   EDGE_CASE_CORPUS       BOF/EOF/CRLF/empty/long-line/block-multiline boundaries.
 *   MULTI_TAG_CORPUS       multiple tags per line and per file across families.
 *   FUZZ_CORPUS            seeded-PRNG deterministic random tag placements.
 *   REALISTIC_CODE_CORPUS  curated multi-language source samples.
 *
 * Fixture shape: { id, fsPath, text, tier, commentFamily? }.
 */

var baseLanguages = require( '../../node_modules/comment-patterns/db-generated/base.js' );

var PARITY_TAG_LIST = Object.freeze( [ 'TODO', 'FIXME', 'HACK', 'BUG', 'XXX', '[ ]', '[x]' ] );
var PARITY_REGEX_SOURCE = '(^|//|#|<!--|;|/\\*|^[ \\t]*(-|\\d+.))\\s*(?=\\[x\\]|\\[ \\]|[A-Za-z0-9_])($TAGS)(?![A-Za-z0-9_])';
var FUZZ_SEED = 0xC0FFEE37;
var FUZZ_FIXTURES_PER_FAMILY = 8;

function firstFileName( nameMatchers )
{
    for( var index = 0; index < nameMatchers.length; ++index )
    {
        var matcher = nameMatchers[ index ];
        if( typeof ( matcher ) === 'string' && matcher.indexOf( '.' ) === 0 )
        {
            return 'fixture' + matcher;
        }
    }

    return nameMatchers[ 0 ];
}

function materializeTokenPattern( pattern )
{
    if( typeof ( pattern ) === 'string' )
    {
        return pattern;
    }

    switch( pattern.source )
    {
        case '\\/\\*':
            return '/*';
        case '\\/\\*\\*':
        case '\\/\\*\\*?':
            return '/**';
        default:
            throw new Error( 'materializeTokenPattern: unsupported start token regex ' + pattern.source );
    }
}

function buildVendoredSingleLineFixtures( language, fileName )
{
    var fixtures = [];

    if( !Array.isArray( language.singleLineComment ) )
    {
        return fixtures;
    }

    language.singleLineComment.forEach( function( entry, tokenIndex )
    {
        var token = entry.start;
        var fixtureId = 'vendored::' + language.name + '::single::' + tokenIndex;
        var text = [
            token + ' TODO ' + language.name.toLowerCase() + '-vendored-todo',
            token + ' FIXME ' + language.name.toLowerCase() + '-vendored-fixme',
            token + ' plain text without tag here'
        ].join( '\n' );

        fixtures.push( {
            id: fixtureId,
            fsPath: '/tmp/' + fileName,
            text: text,
            tier: 'vendored',
            commentFamily: 'singleLine:' + token
        } );
    } );

    return fixtures;
}

function buildVendoredMultiLineFixtures( language, fileName )
{
    var fixtures = [];

    if( !Array.isArray( language.multiLineComment ) )
    {
        return fixtures;
    }

    language.multiLineComment.forEach( function( entry, tokenIndex )
    {
        var startToken = materializeTokenPattern( entry.start );
        var endToken = entry.end;
        var fixtureId = 'vendored::' + language.name + '::multi::' + tokenIndex;
        var text = [
            startToken + ' TODO ' + language.name.toLowerCase() + '-vendored-ml-todo ' + endToken,
            startToken + ' FIXME ' + language.name.toLowerCase() + '-vendored-ml-fixme ' + endToken
        ].join( '\n' );

        fixtures.push( {
            id: fixtureId,
            fsPath: '/tmp/' + fileName,
            text: text,
            tier: 'vendored',
            commentFamily: 'multiLine:' + startToken + '...' + endToken
        } );
    } );

    return fixtures;
}

function buildVendoredCorpus()
{
    var fixtures = [];

    baseLanguages.forEach( function( language )
    {
        var fileName = firstFileName( language.nameMatchers );
        fixtures = fixtures.concat( buildVendoredSingleLineFixtures( language, fileName ) );
        fixtures = fixtures.concat( buildVendoredMultiLineFixtures( language, fileName ) );
    } );

    fixtures.push( { id: 'vendored-alias::.jsonc', fsPath: '/tmp/sample.jsonc', text: '// TODO jsonc-alias-todo\n/* FIXME jsonc-alias-fixme */', tier: 'vendored', commentFamily: 'alias::jsonc' } );
    fixtures.push( { id: 'vendored-alias::.vue', fsPath: '/tmp/sample.vue', text: '<!-- TODO vue-alias-todo -->', tier: 'vendored', commentFamily: 'alias::vue' } );
    fixtures.push( { id: 'vendored-alias::.dart', fsPath: '/tmp/sample.dart', text: '// TODO dart-alias-todo\n/* FIXME dart-alias-fixme */', tier: 'vendored', commentFamily: 'alias::dart' } );

    return fixtures;
}

var UNVENDORED_SLASH_FAMILY = Object.freeze( [
    'fixture.rs',
    'fixture.jsx',
    'fixture.tsx',
    'fixture.mjs',
    'fixture.cjs',
    'fixture.kt',
    'fixture.kts',
    'fixture.scala',
    'fixture.sbt',
    'fixture.sc',
    'fixture.sol',
    'fixture.groovy',
    'fixture.gradle',
    'fixture.gvy',
    'fixture.zig',
    'fixture.zon',
    'fixture.v',
    'fixture.sv',
    'fixture.svh',
    'fixture.vala',
    'fixture.vapi',
    'fixture.proto',
    'fixture.thrift',
    'fixture.fbs',
    'fixture.capnp',
    'fixture.cairo',
    'fixture.move',
    'fixture.hx',
    'fixture.wat',
    'fixture.wast',
    'fixture.nim',
    'fixture.nims',
    'fixture.cr',
    'fixture.fs',
    'fixture.fsi',
    'fixture.fsx'
] );

var UNVENDORED_HASH_FAMILY = Object.freeze( [
    'fixture.ex',
    'fixture.exs',
    'fixture.eex',
    'fixture.leex',
    'fixture.heex',
    'fixture.ps1',
    'fixture.psm1',
    'fixture.psd1',
    'fixture.jl',
    'fixture.zsh',
    'fixture.fish',
    'fixture.nu',
    'fixture.toml',
    'fixture.tf',
    'fixture.tfvars',
    'fixture.hcl',
    'fixture.dockerfile',
    'Dockerfile',
    'Containerfile',
    'fixture.ini',
    'fixture.cfg',
    'fixture.conf',
    'fixture.properties',
    'fixture.env',
    'fixture.envrc',
    'fixture.bazel',
    'fixture.bzl',
    'BUILD',
    'WORKSPACE',
    'fixture.cmake',
    'CMakeLists.txt',
    'fixture.nix',
    'fixture.j2',
    'fixture.jinja',
    'fixture.jinja2',
    'fixture.njk',
    'Jenkinsfile',
    'Vagrantfile',
    'Rakefile',
    'Gemfile',
    'Procfile',
    'CODEOWNERS',
    'fixture.r',
    'fixture.R',
    'fixture.Rmd',
    'fixture.stan'
] );

var UNVENDORED_HTML_COMMENT_FAMILY = Object.freeze( [
    'fixture.xml',
    'fixture.xsd',
    'fixture.xsl',
    'fixture.xslt',
    'fixture.rng',
    'fixture.svg',
    'fixture.mjml',
    'fixture.liquid',
    'fixture.ejs',
    'fixture.twig'
] );

var UNVENDORED_SEMICOLON_FAMILY = Object.freeze( [
    'fixture.asm',
    'fixture.s',
    'fixture.scm',
    'fixture.rkt',
    'fixture.el',
    'fixture.lisp',
    'fixture.lsp'
] );

var UNVENDORED_BLOCK_COMMENT_FAMILY = Object.freeze( [
    'fixture.ml',
    'fixture.mli'
] );

var UNVENDORED_TEMPLATE_MIXED_FAMILY = Object.freeze( [
    'fixture.tmpl',
    'fixture.gotmpl',
    'fixture.gohtml',
    'fixture.gotxt',
    'fixture.pug',
    'fixture.vto'
] );

var UNVENDORED_PLAIN_TEXT_FAMILY = Object.freeze( [
    'fixture.txt',
    'fixture.log',
    'fixture.adoc',
    'fixture.asciidoc',
    'fixture.rst',
    'fixture.rest',
    'fixture.org',
    'fixture.typ',
    'fixture.mdx'
] );

var UNVENDORED_FRAMEWORK_FAMILY = Object.freeze( [
    'fixture.svelte',
    'fixture.astro',
    'fixture.styl',
    'fixture.pcss',
    'fixture.json5',
    'fixture.jsonl',
    'fixture.ndjson',
    'fixture.graphql',
    'fixture.gql'
] );

var UNVENDORED_LABEL = 'unvendored';

function createUnvendoredFixture( fileName, comment )
{
    var suffix = comment.suffix || '';
    var text = [
        comment.prefix + ' TODO ' + UNVENDORED_LABEL + '-todo' + suffix,
        comment.prefix + ' FIXME ' + UNVENDORED_LABEL + '-fixme' + suffix,
        comment.prefix + ' plain ' + UNVENDORED_LABEL + ' comment without a tag' + suffix
    ].join( '\n' );

    return {
        id: 'unvendored::' + comment.family + '::' + fileName,
        fsPath: '/tmp/' + fileName,
        text: text,
        tier: 'unvendored',
        commentFamily: comment.family
    };
}

function buildUnvendoredCorpus()
{
    var fixtures = [];

    UNVENDORED_SLASH_FAMILY.forEach( function( fileName )
    {
        fixtures.push( createUnvendoredFixture( fileName, { prefix: '//', family: 'slash' } ) );
    } );

    UNVENDORED_HASH_FAMILY.forEach( function( fileName )
    {
        fixtures.push( createUnvendoredFixture( fileName, { prefix: '#', family: 'hash' } ) );
    } );

    UNVENDORED_HTML_COMMENT_FAMILY.forEach( function( fileName )
    {
        fixtures.push( createUnvendoredFixture( fileName, { prefix: '<!--', family: 'html-comment', suffix: ' -->' } ) );
    } );

    UNVENDORED_SEMICOLON_FAMILY.forEach( function( fileName )
    {
        fixtures.push( createUnvendoredFixture( fileName, { prefix: ';', family: 'semicolon' } ) );
    } );

    UNVENDORED_BLOCK_COMMENT_FAMILY.forEach( function( fileName )
    {
        fixtures.push( createUnvendoredFixture( fileName, { prefix: '/*', family: 'block', suffix: ' */' } ) );
    } );

    UNVENDORED_TEMPLATE_MIXED_FAMILY.forEach( function( fileName )
    {
        fixtures.push( {
            id: 'unvendored::template::' + fileName,
            fsPath: '/tmp/' + fileName,
            text: [
                '// TODO ' + fileName + '-slash-todo',
                '# TODO ' + fileName + '-hash-todo',
                '<!-- TODO ' + fileName + '-html-todo -->',
                '{{/* TODO ' + fileName + '-gotmpl-todo */}}',
                '/* TODO ' + fileName + '-block-todo */'
            ].join( '\n' ),
            tier: 'unvendored',
            commentFamily: 'template-mixed'
        } );
    } );

    UNVENDORED_PLAIN_TEXT_FAMILY.forEach( function( fileName )
    {
        fixtures.push( {
            id: 'unvendored::plain-text::' + fileName,
            fsPath: '/tmp/' + fileName,
            text: [
                '# TODO ' + fileName + '-hash-todo',
                '- [ ] ' + fileName + '-task-unchecked',
                '1. [x] ' + fileName + '-task-checked',
                'plain paragraph without a tag'
            ].join( '\n' ),
            tier: 'unvendored',
            commentFamily: 'plain-text'
        } );
    } );

    UNVENDORED_FRAMEWORK_FAMILY.forEach( function( fileName )
    {
        fixtures.push( createUnvendoredFixture( fileName, { prefix: '//', family: 'framework-slash' } ) );
    } );

    return fixtures;
}

var NEGATIVE_INPUTS = Object.freeze( [
    'const todoItem = 1;',
    'const fixmeCount = 2;',
    'let bugList = [];',
    'struct TODOHolder {}',
    'tag_TODO_placeholder = identifierOnly',
    'FIXMEX notAComment variable',
    'plain text with TODOItems identifier'
] );

function buildNegativeCorpus()
{
    var fixtures = [];
    var extensions = collectNegativeExtensions();

    extensions.forEach( function( extension )
    {
        NEGATIVE_INPUTS.forEach( function( input, inputIndex )
        {
            fixtures.push( {
                id: 'negative::' + extension + '::' + inputIndex,
                fsPath: '/tmp/negative-' + inputIndex + extension,
                text: input,
                tier: 'negative',
                commentFamily: 'negative'
            } );
        } );
    } );

    return fixtures;
}

function collectNegativeExtensions()
{
    var extensions = [];
    var seen = Object.create( null );

    function add( extension )
    {
        if( typeof( extension ) !== 'string' || extension.length === 0 || seen[ extension ] )
        {
            return;
        }
        seen[ extension ] = true;
        extensions.push( extension );
    }

    [
        UNVENDORED_SLASH_FAMILY, UNVENDORED_HASH_FAMILY, UNVENDORED_HTML_COMMENT_FAMILY,
        UNVENDORED_SEMICOLON_FAMILY, UNVENDORED_BLOCK_COMMENT_FAMILY,
        UNVENDORED_TEMPLATE_MIXED_FAMILY, UNVENDORED_PLAIN_TEXT_FAMILY,
        UNVENDORED_FRAMEWORK_FAMILY
    ].forEach( function( family )
    {
        family.forEach( function( fileName )
        {
            var dotIndex = fileName.lastIndexOf( '.' );
            if( dotIndex > 0 )
            {
                add( fileName.slice( dotIndex ) );
            }
        } );
    } );

    baseLanguages.forEach( function( language )
    {
        var fileName = firstFileName( language.nameMatchers );
        if( typeof ( fileName ) === 'string' )
        {
            var dotIndex = fileName.lastIndexOf( '.' );
            if( dotIndex > 0 )
            {
                add( fileName.slice( dotIndex ) );
            }
        }
    } );

    return extensions;
}

function buildEdgeCaseCorpus()
{
    var fixtures = [];
    var baseExtensions = [ '.tmpl', '.rs', '.tsx', '.zig', '.ex', '.toml', '.xml' ];

    function push( id, extension, text, subfamily )
    {
        fixtures.push( {
            id: 'edge::' + subfamily + '::' + id,
            fsPath: '/tmp/edge-' + id + extension,
            text: text,
            tier: 'unvendored',
            commentFamily: 'edge::' + subfamily
        } );
    }

    baseExtensions.forEach( function( extension, index )
    {
        push( 'bof-only' + index, extension, '// TODO tag-at-beginning-of-file', 'bof' );
        push( 'eof-no-newline' + index, extension, 'first line\n// TODO tag-at-eof-without-newline', 'eof-no-newline' );
        push( 'eof-with-newline' + index, extension, 'first line\n// TODO tag-at-eof-with-newline\n', 'eof-with-newline' );
        push( 'crlf' + index, extension, '// TODO tag-one\r\n# TODO tag-two\r\n<!-- TODO tag-three -->\r\n', 'crlf' );
        push( 'single-line' + index, extension, '// TODO single-line-no-newline', 'single-line' );
        push( 'leading-blank' + index, extension, '\n\n\n// TODO after-blank-lines', 'leading-blank-lines' );
        push( 'trailing-blank' + index, extension, '// TODO before-blank-lines\n\n\n', 'trailing-blank-lines' );
        push( 'tab-indent' + index, extension, '\t// TODO tab-indented-comment', 'tab-indented' );
        push( 'space-indent' + index, extension, '    // TODO space-indented-comment', 'space-indented' );
        push( 'mixed-indent' + index, extension, ' \t // TODO mixed-indented-comment', 'mixed-indented' );
        push( 'long-line' + index, extension, '// TODO ' + 'x'.repeat( 2048 ), 'long-line' );
        push( 'multiple-prefixes' + index, extension, [
            '// TODO slash',
            '# TODO hash',
            '<!-- TODO html -->',
            '; TODO semicolon',
            '/* TODO block */'
        ].join( '\n' ), 'multi-prefix-stacked' );
        push( 'block-one-liner' + index, extension, '/* TODO inline-block-one-liner */', 'block-one-liner' );
        push( 'block-span-2' + index, extension, '/* TODO first-line\n   continuation-line */', 'block-span-2' );
        push( 'block-span-3' + index, extension, '/*\n * TODO on-second-line\n */', 'block-span-3' );
        push( 'adjacent-tags' + index, extension, '// TODO one\n// FIXME two\n// HACK three\n// BUG four\n// XXX five', 'adjacent-tags' );
        push( 'tag-with-colon' + index, extension, '// TODO: with-colon-subtag', 'tag-with-colon' );
        push( 'tag-with-parens' + index, extension, '// TODO(ref-ticket) with-parens-subtag', 'tag-with-parens' );
        push( 'tag-followed-by-punct' + index, extension, '// TODO, with-trailing-comma\n// FIXME! with-exclam\n// HACK. with-period', 'tag-punctuation' );
        push( 'task-list' + index, extension, '- [ ] unchecked-task\n1. [x] checked-task\n2. [ ] another-unchecked', 'task-list' );
        push( 'utf8-bom' + index, extension, '\uFEFF// TODO bom-prefixed-tag', 'utf8-bom' );
        push( 'mixed-line-endings' + index, extension, '// TODO crlf-line\r\n// FIXME lf-line\n// HACK cr-only-line\r// BUG final', 'mixed-line-endings' );
        push( 'trailing-whitespace' + index, extension, '// TODO trailing-spaces-on-line   \t  \n// FIXME also-trailing  ', 'trailing-whitespace' );
        push( 'tag-with-unicode-body' + index, extension, '// TODO unicode-body αβγ ✨ \u00e9 \u2603 emoji-and-greek\n// FIXME 漢字 also-non-ascii', 'tag-with-unicode-body' );
        push( 'tag-flush-column-zero' + index, extension, 'TODO column-zero-no-prefix\nFIXME also-column-zero', 'tag-flush-column-zero' );
        push( 'tag-followed-by-eof' + index, extension, 'leading\n// TODO', 'tag-followed-by-eof' );
        push( 'shebang-then-tag' + index, extension, '#!/usr/bin/env script\n// TODO after-shebang', 'shebang-then-tag' );
        push( 'multiple-tags-one-block' + index, extension, '/* TODO first FIXME second HACK third */', 'multiple-tags-one-block' );
        push( 'tag-then-non-tag-ident' + index, extension, '// TODOAPP not-a-real-tag\n// TODOSTORE also-not-a-real-tag\n// TODO real-tag', 'tag-then-non-tag-ident' );
        push( 'tag-with-tab-after' + index, extension, '// TODO\twith-tab-after-tag\n// FIXME\t\tdouble-tab', 'tag-with-tab-after' );
        push( 'consecutive-blank-line-runs' + index, extension, '// TODO before\n\n\n\n\n// FIXME after', 'consecutive-blank-line-runs' );
        push( 'embedded-cr' + index, extension, 'first line\r// TODO after-bare-cr', 'embedded-cr' );
        push( 'tag-after-utf8-bom-and-shebang' + index, extension, '\uFEFF#!/usr/bin/env demo\n// TODO after-bom-then-shebang', 'tag-after-utf8-bom-and-shebang' );
    } );

    fixtures.push( {
        id: 'edge::empty::empty-file',
        fsPath: '/tmp/edge-empty.tmpl',
        text: '',
        tier: 'negative',
        commentFamily: 'edge::empty'
    } );

    fixtures.push( {
        id: 'edge::empty::whitespace-only',
        fsPath: '/tmp/edge-whitespace.tmpl',
        text: '   \n\t\t\n   \n',
        tier: 'negative',
        commentFamily: 'edge::whitespace-only'
    } );

    fixtures.push( {
        id: 'edge::empty::comment-without-tag',
        fsPath: '/tmp/edge-comment-only.tmpl',
        text: '// plain comment with no tag at all\n# another plain comment\n<!-- html without tag -->\n',
        tier: 'negative',
        commentFamily: 'edge::comment-without-tag'
    } );

    return fixtures;
}

function buildMultiTagCorpus()
{
    var fixtures = [];
    var tagSets = [
        { id: 'two-tags-same-line', text: '// TODO one FIXME two' },
        { id: 'two-tags-same-line-html', text: '<!-- TODO first --> <!-- FIXME second -->' },
        { id: 'tag-plus-task-list', text: '- [ ] unchecked\n- [x] checked\n// TODO mixed-with-tasks' },
        { id: 'rapid-succession', text: [
            '// TODO t1',
            '// FIXME t2',
            '// HACK t3',
            '// BUG t4',
            '// XXX t5'
        ].join( '\n' ) },
        { id: 'interspersed-code', text: [
            'function demo() {',
            '  // TODO implement',
            '  var x = 1;',
            '  // FIXME missing',
            '  return x;',
            '}',
            '// HACK workaround',
            '// BUG tracked'
        ].join( '\n' ) }
    ];

    [ '.tmpl', '.rs', '.tsx', '.kt', '.zig' ].forEach( function( extension, index )
    {
        tagSets.forEach( function( entry )
        {
            fixtures.push( {
                id: 'multi-tag::' + extension + '::' + entry.id + '::' + index,
                fsPath: '/tmp/multi-tag-' + entry.id + extension,
                text: entry.text,
                tier: 'unvendored',
                commentFamily: 'multi-tag::' + entry.id
            } );
        } );
    } );

    return fixtures;
}

function createSeededRng( seed )
{
    var state = ( seed >>> 0 ) || 1;

    return function()
    {
        state = ( state + 0x6D2B79F5 ) >>> 0;
        var value = state;
        value = Math.imul( value ^ ( value >>> 15 ), value | 1 );
        value ^= value + Math.imul( value ^ ( value >>> 7 ), value | 61 );
        return ( ( value ^ ( value >>> 14 ) ) >>> 0 ) / 4294967296;
    };
}

function choice( rng, values )
{
    return values[ Math.floor( rng() * values.length ) ];
}

var FUZZ_UNVENDORED_EXTENSIONS = Object.freeze( [
    '.tmpl', '.rs', '.tsx', '.jsx', '.kt', '.toml', '.tf', '.xml', '.zig', '.ini',
    '.txt', '.ps1', '.jl', '.nim', '.sol', '.ex', '.zsh', '.fish', '.hcl', '.proto',
    '.graphql', '.svelte', '.astro', '.nix', '.bazel', '.cmake', '.yaml-template'
] );

var FUZZ_COMMENT_FAMILIES = Object.freeze( [
    { prefix: '//', suffix: '' },
    { prefix: '#', suffix: '' },
    { prefix: '<!--', suffix: ' -->' },
    { prefix: ';', suffix: '' },
    { prefix: '/*', suffix: ' */' }
] );

function buildFuzzLine( rng, tagList )
{
    var family = choice( rng, FUZZ_COMMENT_FAMILIES );
    var tag = choice( rng, tagList );
    var padding = Math.floor( rng() * 4 );
    var after = Math.floor( rng() * 3 );
    var padSpaces = new Array( padding + 1 ).join( ' ' );
    var afterSpaces = new Array( after + 1 ).join( ' ' );
    var label = 'fuzz-' + Math.floor( rng() * 1000 );
    return family.prefix + padSpaces + tag + afterSpaces + ' ' + label + family.suffix;
}

function buildFuzzFixture( rng, tagList, descriptor )
{
    var lines = [];
    for( var lineIndex = 0; lineIndex < descriptor.lineCount; ++lineIndex )
    {
        lines.push( buildFuzzLine( rng, tagList ) );
    }

    return {
        id: descriptor.idPrefix + '::' + descriptor.extension + descriptor.idSuffix,
        fsPath: '/tmp/' + descriptor.idPrefix + '-' + descriptor.extensionIndex + descriptor.fsPathSuffix + descriptor.extension,
        text: lines.join( '\n' ),
        tier: 'unvendored',
        commentFamily: descriptor.idPrefix + '::' + descriptor.extension
    };
}

function buildFuzzCorpus()
{
    var fixtures = [];
    var rng = createSeededRng( FUZZ_SEED );
    var plainTagList = PARITY_TAG_LIST.filter( function( tag ) { return /^[A-Za-z]+$/.test( tag ); } );

    FUZZ_UNVENDORED_EXTENSIONS.forEach( function( extension, extensionIndex )
    {
        for( var variant = 0; variant < FUZZ_FIXTURES_PER_FAMILY; ++variant )
        {
            fixtures.push( buildFuzzFixture( rng, plainTagList, {
                extension: extension,
                extensionIndex: extensionIndex,
                idPrefix: 'fuzz',
                idSuffix: '::' + variant,
                fsPathSuffix: '-' + variant,
                lineCount: 1 + Math.floor( rng() * 8 )
            } ) );
        }
    } );

    FUZZ_UNVENDORED_EXTENSIONS.forEach( function( extension, extensionIndex )
    {
        fixtures.push( buildFuzzFixture( rng, plainTagList, {
            extension: extension,
            extensionIndex: extensionIndex,
            idPrefix: 'fuzz-stress',
            idSuffix: '',
            fsPathSuffix: '',
            lineCount: 256
        } ) );
    } );

    return fixtures;
}

var REALISTIC_CODE_SAMPLES = Object.freeze( [
    {
        id: 'realistic::rust-service',
        fsPath: '/tmp/realistic-service.rs',
        text: [
            'use std::collections::HashMap;',
            '',
            '// TODO implement retry-with-backoff',
            'pub struct Service {',
            '    endpoints: HashMap<String, String>, // FIXME avoid cloning',
            '}',
            '',
            'impl Service {',
            '    /* HACK temporary unwrap; will surface panics */',
            '    pub fn new() -> Self { Self { endpoints: HashMap::new() } }',
            '',
            '    // BUG index out of bounds under empty route table',
            '    pub fn route(&self, key: &str) -> Option<&String> {',
            '        self.endpoints.get(key)',
            '    }',
            '}'
        ].join( '\n' )
    },
    {
        id: 'realistic::typescript-react',
        fsPath: '/tmp/realistic-react.tsx',
        text: [
            'import React from \'react\';',
            '',
            '// TODO localise strings',
            'export function Badge({ text }: { text: string }) {',
            '  /* XXX double render when parent re-mounts */',
            '  return <span className="badge">{text}</span>;',
            '}',
            '',
            '// FIXME add a11y props'
        ].join( '\n' )
    },
    {
        id: 'realistic::kotlin-utils',
        fsPath: '/tmp/realistic-utils.kt',
        text: [
            'package io.example.utils',
            '',
            '// TODO introduce logging',
            'object Utils {',
            '    /* FIXME clamp negative durations to zero */',
            '    fun millisToSeconds(ms: Long) = ms / 1_000',
            '',
            '    // HACK callers currently pass ints',
            '    fun clamp(value: Int, min: Int, max: Int) = value.coerceIn(min, max)',
            '}'
        ].join( '\n' )
    },
    {
        id: 'realistic::toml-config',
        fsPath: '/tmp/realistic-config.toml',
        text: [
            '[server]',
            '# TODO add TLS termination',
            'host = "0.0.0.0"',
            '# FIXME port collides with debugger',
            'port = 5000',
            '',
            '[database]',
            '# HACK pool size copied from old config',
            'pool_size = 10'
        ].join( '\n' )
    },
    {
        id: 'realistic::elixir-module',
        fsPath: '/tmp/realistic-module.ex',
        text: [
            'defmodule MyApp.Worker do',
            '  # TODO switch to GenServer.call/3 for backpressure',
            '  use GenServer',
            '',
            '  # FIXME handle :noproc exits',
            '  def init(_arg), do: {:ok, %{}}',
            'end'
        ].join( '\n' )
    },
    {
        id: 'realistic::zig-module',
        fsPath: '/tmp/realistic-module.zig',
        text: [
            'const std = @import("std");',
            '',
            '// TODO verify allocator contract',
            'pub fn addOne(x: u32) u32 {',
            '    // FIXME overflow on max u32',
            '    return x + 1;',
            '}'
        ].join( '\n' )
    },
    {
        id: 'realistic::tmpl-template',
        fsPath: '/tmp/realistic-page.tmpl',
        text: [
            '{{define "layout"}}',
            '{{/* TODO ensure layout is isomorphic */}}',
            '<html>',
            '<!-- FIXME meta description is stale -->',
            '<body>{{template "content"}}</body>',
            '</html>',
            '{{end}}'
        ].join( '\n' )
    },
    {
        id: 'realistic::xml-spec',
        fsPath: '/tmp/realistic-spec.xml',
        text: [
            '<?xml version="1.0"?>',
            '<root>',
            '  <!-- TODO validate against schema -->',
            '  <item id="a"/>',
            '  <!-- FIXME deduplicate ids -->',
            '  <item id="a"/>',
            '</root>'
        ].join( '\n' )
    },
    {
        id: 'realistic::yaml-pipeline',
        fsPath: '/tmp/realistic-pipeline.yaml-template',
        text: [
            'name: build',
            '# TODO migrate to reusable workflow',
            'jobs:',
            '  test:',
            '    # FIXME pin runner image hash',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - uses: actions/checkout@v4',
            '      - name: install',
            '        # HACK install rg from apt instead of source',
            '        run: sudo apt-get install -y ripgrep'
        ].join( '\n' )
    },
    {
        id: 'realistic::dockerfile-multistage',
        fsPath: '/tmp/realistic-Dockerfile',
        text: [
            'FROM node:22-alpine AS build',
            '# TODO multi-stage build to drop dev deps',
            'WORKDIR /app',
            'COPY package*.json ./',
            'RUN npm ci',
            'COPY . .',
            'RUN npm run build',
            '',
            'FROM nginx:1.27-alpine',
            '# FIXME serve compressed assets',
            'COPY --from=build /app/dist /usr/share/nginx/html'
        ].join( '\n' )
    },
    {
        id: 'realistic::shell-script',
        fsPath: '/tmp/realistic-script.fish',
        text: [
            '#!/usr/bin/env fish',
            '# TODO fall back to busybox find on minimal images',
            'function clean',
            '    # FIXME guard against missing $XDG_CACHE_HOME',
            '    rm -rf $XDG_CACHE_HOME/build',
            'end',
            '',
            '# HACK pin path to the dev profile',
            'set -gx CARGO_HOME ~/.cargo'
        ].join( '\n' )
    },
    {
        id: 'realistic::nim-module',
        fsPath: '/tmp/realistic-module.nim',
        text: [
            'import std/sequtils',
            '',
            '# TODO accept generic iterators',
            'proc squareAll*(xs: seq[int]): seq[int] =',
            '  # FIXME overflow on max int',
            '  result = xs.mapIt(it * it)',
            '',
            '# HACK skip negative values silently',
            'proc positiveOnly*(xs: seq[int]): seq[int] =',
            '  result = xs.filterIt(it >= 0)'
        ].join( '\n' )
    },
    {
        id: 'realistic::powershell-deploy',
        fsPath: '/tmp/realistic-deploy.ps1',
        text: [
            '# TODO sign the release manifest before upload',
            'param(',
            '    [string]$Version',
            ')',
            '',
            '<# FIXME the strict-mode block leaks variables across calls #>',
            'Set-StrictMode -Version Latest',
            '',
            '# HACK temporarily skip checksum validation',
            '$validateChecksums = $false'
        ].join( '\n' )
    },
    {
        id: 'realistic::julia-module',
        fsPath: '/tmp/realistic-module.jl',
        text: [
            'module Stats',
            '',
            '# TODO support weighted variance',
            'export mean, variance',
            '',
            '#= FIXME numerically unstable for huge inputs =#',
            'mean(xs) = sum(xs) / length(xs)',
            '',
            '# HACK assumes one-pass is acceptable',
            'variance(xs) = sum((xs .- mean(xs)) .^ 2) / length(xs)',
            '',
            'end'
        ].join( '\n' )
    },
    {
        id: 'realistic::solidity-token',
        fsPath: '/tmp/realistic-token.sol',
        text: [
            '// SPDX-License-Identifier: MIT',
            'pragma solidity ^0.8.20;',
            '',
            '// TODO add ERC20Permit support',
            'contract Token {',
            '    /* FIXME initial supply hardcoded */',
            '    uint256 public totalSupply = 1_000_000;',
            '',
            '    // HACK transfer ignores fee-on-transfer tokens',
            '    function transfer(address to, uint256 amount) external returns (bool) {',
            '        return amount > 0;',
            '    }',
            '}'
        ].join( '\n' )
    }
] );

function buildRealisticCodeCorpus()
{
    return REALISTIC_CODE_SAMPLES.map( function( sample )
    {
        return Object.assign( {}, sample, {
            tier: 'unvendored',
            commentFamily: 'realistic-code'
        } );
    } );
}

var VENDORED_CORPUS = Object.freeze( buildVendoredCorpus() );
var UNVENDORED_CORPUS = Object.freeze( buildUnvendoredCorpus() );
var NEGATIVE_CORPUS = Object.freeze( buildNegativeCorpus() );
var EDGE_CASE_CORPUS = Object.freeze( buildEdgeCaseCorpus() );
var MULTI_TAG_CORPUS = Object.freeze( buildMultiTagCorpus() );
var FUZZ_CORPUS = Object.freeze( buildFuzzCorpus() );
var REALISTIC_CODE_CORPUS = Object.freeze( buildRealisticCodeCorpus() );

module.exports.PARITY_TAG_LIST = PARITY_TAG_LIST;
module.exports.PARITY_REGEX_SOURCE = PARITY_REGEX_SOURCE;
module.exports.VENDORED_CORPUS = VENDORED_CORPUS;
module.exports.UNVENDORED_CORPUS = UNVENDORED_CORPUS;
module.exports.NEGATIVE_CORPUS = NEGATIVE_CORPUS;
module.exports.EDGE_CASE_CORPUS = EDGE_CASE_CORPUS;
module.exports.MULTI_TAG_CORPUS = MULTI_TAG_CORPUS;
module.exports.FUZZ_CORPUS = FUZZ_CORPUS;
module.exports.REALISTIC_CODE_CORPUS = REALISTIC_CODE_CORPUS;
