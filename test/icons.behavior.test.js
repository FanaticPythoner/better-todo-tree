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

        assert.equal( path.basename( treeIcon.dark ), 'todo-bug-ff4545.svg' );
        assert.equal( path.basename( gutterIcon.dark ), 'todo-bug-ff4545.svg' );
        assert.ok( fs.existsSync( treeIcon.dark ) );
        assert.ok( fs.existsSync( gutterIcon.dark ) );
    } );
} );
