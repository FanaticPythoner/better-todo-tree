var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );

var helpers = require( './moduleHelpers.js' );
var actualUtils = require( '../src/utils.js' );
var actualAttributes = require( '../src/attributes.js' );

function createVscodeStub()
{
    function ThemeColor( name )
    {
        this.name = name;
    }

    function ThemeIcon( id, color )
    {
        this.id = id;
        this.color = color;
    }

    return {
        ThemeColor: ThemeColor,
        ThemeIcon: ThemeIcon
    };
}

function createAttributeConfig( overrides )
{
    return Object.assign( {
        tagList: [ 'TODO', 'TODO:' ],
        tags: function()
        {
            return this.tagList;
        },
        isRegexCaseSensitive: function()
        {
            return true;
        },
        shouldUseColourScheme: function()
        {
            return false;
        },
        foregroundColourScheme: function()
        {
            return [];
        },
        backgroundColourScheme: function()
        {
            return [];
        },
        defaultHighlight: function()
        {
            return {};
        },
        customHighlight: function()
        {
            return {};
        }
    }, overrides || {} );
}

function createContext( storagePath )
{
    return {
        globalStorageUri: {
            fsPath: storagePath
        },
        asAbsolutePath: function( relativePath )
        {
            return path.join( '/extension-root', relativePath );
        }
    };
}

function createIdentityStub( settings )
{
    return {
        getSetting: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( settings, key ) ? settings[ key ] : defaultValue;
        }
    };
}

QUnit.module( 'behavioral icons', function( hooks )
{
    var tempDirectories = [];

    hooks.afterEach( function()
    {
        tempDirectories.forEach( function( directory )
        {
            fs.rmSync( directory, { recursive: true, force: true } );
        } );
        tempDirectories = [];
    } );

    QUnit.test( 'tree icons stay ThemeIcons while gutter icons become file-backed assets for codicon settings', function( assert )
    {
        var storagePath = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-icons-' ) );
        var config = createAttributeConfig( {
            customHighlight: function()
            {
                return {
                    TODO: {
                        icon: '$(beaker)',
                        iconColour: 'editor.foreground'
                    }
                };
            }
        } );

        tempDirectories.push( storagePath );
        actualUtils.init( config );
        actualAttributes.init( config );

        var icons = helpers.loadWithStubs( '../src/icons.js', {
            vscode: createVscodeStub()
        } );
        var context = createContext( storagePath );
        var treeIcon = icons.getTreeIcon( context, 'TODO' );
        var gutterIcon = icons.getGutterIcon( context, 'TODO' );

        assert.equal( treeIcon.id, 'beaker' );
        assert.equal( treeIcon.color.name, 'editor.foreground' );
        assert.ok( gutterIcon.dark.indexOf( storagePath ) === 0 );
        assert.equal( gutterIcon.dark, gutterIcon.light );
        assert.ok( fs.existsSync( gutterIcon.dark ) );
        assert.ok( fs.readFileSync( gutterIcon.dark, 'utf8' ).indexOf( '<svg' ) !== -1 );
    } );

    QUnit.test( 'punctuation-heavy custom tags from issue 898 resolve octicon gutter assets deterministically', function( assert )
    {
        var storagePath = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-icons-' ) );
        var config = createAttributeConfig( {
            customHighlight: function()
            {
                return {
                    'TODO:': {
                        icon: 'bug',
                        iconColour: '#ff4545'
                    }
                };
            }
        } );

        tempDirectories.push( storagePath );
        actualUtils.init( config );
        actualAttributes.init( config );

        var icons = helpers.loadWithStubs( '../src/icons.js', {
            vscode: createVscodeStub()
        } );
        var context = createContext( storagePath );
        var treeIcon = icons.getTreeIcon( context, 'TODO:' );
        var gutterIcon = icons.getGutterIcon( context, 'TODO:' );

        assert.equal( treeIcon.dark, gutterIcon.dark );
        assert.ok( fs.readFileSync( treeIcon.dark, 'utf8' ).includes( '#ff4545' ) );
        assert.ok( fs.existsSync( treeIcon.dark ) );
        assert.ok( fs.existsSync( gutterIcon.dark ) );
    } );

    QUnit.test( 'cache reset recreates removed icon storage and generated assets', function( assert )
    {
        var storagePath = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-icons-' ) );
        tempDirectories.push( storagePath );
        var config = createAttributeConfig( {
            customHighlight: function()
            {
                return { TODO: { icon: 'flame', iconColour: '#e85dba' } };
            }
        } );
        actualUtils.init( config );
        actualAttributes.init( config );
        var icons = helpers.loadWithStubs( '../src/icons.js', { vscode: createVscodeStub() } );
        var context = createContext( storagePath );
        var initial = icons.getGutterIcon( context, 'TODO' );
        var svg = fs.readFileSync( initial.dark, 'utf8' );
        fs.rmSync( storagePath, { recursive: true } );
        icons.resetCaches();
        var regenerated = icons.getGutterIcon( context, 'TODO' );
        assert.deepEqual( regenerated, initial );
        assert.equal( fs.readFileSync( regenerated.dark, 'utf8' ), svg );
        assert.deepEqual( icons.getTreeIcon( context, 'TODO' ), regenerated );
    } );

    QUnit.test( 'every codicon and product alias resolves an authoritative vector glyph', function( assert )
    {
        var aliases = require( '../src/codiconAliases.json' );
        var storagePath = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-glyphs-' ) );
        tempDirectories.push( storagePath );
        var custom = Object.fromEntries( Object.keys( aliases ).map( function( name )
        {
            return [ name, { icon: '$(' + name + ')', iconColour: '#ff4545' } ];
        } ) );
        var config = createAttributeConfig( { customHighlight: function() { return custom; } } );
        actualUtils.init( config );
        actualAttributes.init( config );
        var icons = helpers.loadWithStubs( '../src/icons.js', { vscode: createVscodeStub() } );
        var context = createContext( storagePath );
        var paths = new Map();
        Object.keys( aliases ).forEach( function( name )
        {
            var icon = icons.getGutterIcon( context, name );
            var svg = fs.readFileSync( icon.dark, 'utf8' );
            assert.ok( svg.includes( '<svg' ) && svg.includes( '#ff4545' ), name + ' has a colored SVG' );
            assert.notOk( svg.includes( '<text' ), name + ' has vector geometry without a letter badge' );
            if( paths.has( aliases[ name ] ) )
            {
                assert.equal( icon.dark, paths.get( aliases[ name ] ), name + ' shares its canonical asset' );
            }
            paths.set( aliases[ name ], icon.dark );
        } );
    } );

    QUnit.test( 'distinct RGB components cannot share a generated icon filename', function( assert )
    {
        var storagePath = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-colors-' ) );
        tempDirectories.push( storagePath );
        var colors = { TODO: 'rgb(1,23,4)', 'TODO:': 'rgb(12,3,4)' };
        var config = createAttributeConfig( {
            customHighlight: function()
            {
                return Object.fromEntries( Object.entries( colors ).map( function( pair )
                {
                    return [ pair[ 0 ], { icon: 'bug', iconColour: pair[ 1 ] } ];
                } ) );
            }
        } );
        actualUtils.init( config );
        actualAttributes.init( config );
        var icons = helpers.loadWithStubs( '../src/icons.js', { vscode: createVscodeStub() } );
        var context = createContext( storagePath );
        var first = icons.getGutterIcon( context, 'TODO' );
        var second = icons.getGutterIcon( context, 'TODO:' );
        assert.notEqual( first.dark, second.dark );
        assert.ok( fs.readFileSync( first.dark, 'utf8' ).includes( colors.TODO ) );
        assert.ok( fs.readFileSync( second.dark, 'utf8' ).includes( colors[ 'TODO:' ] ) );
    } );

    QUnit.test( 'prototype-named icons reject inherited properties', function( assert )
    {
        var storagePath = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-invalid-icons-' ) );
        tempDirectories.push( storagePath );
        var config = createAttributeConfig( {
            customHighlight: function() { return { TODO: { icon: 'constructor', iconColour: '#ff4545' } }; }
        } );
        actualUtils.init( config );
        actualAttributes.init( config );
        var icons = helpers.loadWithStubs( '../src/icons.js', {
            vscode: createVscodeStub(),
            './extensionIdentity.js': createIdentityStub( { 'highlights.defaultHighlight.icon': 'constructor' } )
        } );
        assert.throws( function() { icons.getGutterIcon( createContext( storagePath ), 'TODO' ); },
            { name: 'TypeError', message: 'Unknown octicon: constructor' } );
        assert.ok( icons.validateIcons().includes( 'defaultHighlight.icon(constructor)' ) );
    } );

    QUnit.test( 'issue #28 custom highlight codicon syntax validates current aliases', function( assert )
    {
        var icons = helpers.loadWithStubs( '../src/icons.js', {
            vscode: createVscodeStub(),
            './extensionIdentity.js': createIdentityStub( {
                'highlights.defaultHighlight.icon': '$(bug)',
                'highlights.customHighlight': {
                    '@bug': {},
                    '@flame': {}
                },
                'highlights.customHighlight.@bug.icon': '$(bug)',
                'highlights.customHighlight.@flame.icon': '$(flame)'
            } )
        } );

        assert.equal( icons.validateIcons(), '' );
    } );

    QUnit.test( 'issue #40 reported codicon aliases validate', function( assert )
    {
        var icons = helpers.loadWithStubs( '../src/icons.js', {
            vscode: createVscodeStub(),
            './extensionIdentity.js': createIdentityStub( {
                'highlights.customHighlight': {
                    BUG: {},
                    FIXME: {},
                    TODO: {},
                    MOMA: {},
                    '[ ]': {},
                    '[x]': {}
                },
                'highlights.customHighlight.BUG.icon': '$(bug)',
                'highlights.customHighlight.FIXME.icon': '$(tools)',
                'highlights.customHighlight.TODO.icon': '$(checklist)',
                'highlights.customHighlight.MOMA.icon': '$(unverified)',
                'highlights.customHighlight.[ ].icon': '$(unlock)',
                'highlights.customHighlight.[x].icon': '$(lock)'
            } )
        } );

        assert.equal( icons.validateIcons(), '' );
    } );

    QUnit.test( 'issue #28 malformed codicon syntax remains invalid', function( assert )
    {
        var icons = helpers.loadWithStubs( '../src/icons.js', {
            vscode: createVscodeStub(),
            './extensionIdentity.js': createIdentityStub( {
                'highlights.customHighlight': {
                    '@broken': {},
                    '@missing': {}
                },
                'highlights.customHighlight.@broken.icon': '$(bug',
                'highlights.customHighlight.@missing.icon': '$(not-a-real-codicon)'
            } )
        } );

        var message = icons.validateIcons();

        assert.ok( message.indexOf( 'customHighlight.@broken.icon($(bug)' ) >= 0 );
        assert.ok( message.indexOf( 'customHighlight.@missing.icon($(not-a-real-codicon))' ) >= 0 );
    } );
} );
