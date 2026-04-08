var utils = require( '../src/utils.js' );

var helpers = require( './moduleHelpers.js' );
var languageMatrix = require( './languageMatrix.js' );
var matrixHelpers = require( './matrixHelpers.js' );

function createVscodeStub()
{
    function EventEmitter()
    {
        this.event = function() {};
        this.fire = function() {};
    }

    function TreeItem( label )
    {
        this.label = label;
    }

    function ThemeIcon( name )
    {
        this.id = name;
    }

    ThemeIcon.Folder = new ThemeIcon( 'folder' );
    ThemeIcon.File = new ThemeIcon( 'file' );

    function Position( line, character )
    {
        this.line = line;
        this.character = character;
    }

    function Selection( start, end )
    {
        this.start = start;
        this.end = end;
    }

    return {
        EventEmitter: EventEmitter,
        TreeItem: TreeItem,
        ThemeIcon: ThemeIcon,
        Position: Position,
        Selection: Selection,
        Uri: {
            file: function( fsPath )
            {
                return { fsPath: fsPath };
            }
        },
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2
        },
        workspace: {
            getConfiguration: function()
            {
                return {
                    get: function( key, defaultValue )
                    {
                        if( key === 'revealBehaviour' )
                        {
                            return 'start of todo';
                        }
                        return defaultValue;
                    }
                };
            }
        }
    };
}

function createConfig( overrides )
{
    return Object.assign( {
        tags: function() { return languageMatrix.DEFAULT_TAGS.slice(); },
        shouldGroupByTag: function() { return false; },
        shouldGroupBySubTag: function() { return false; },
        shouldShowTagsOnly: function() { return false; },
        shouldFlatten: function() { return false; },
        shouldCompactFolders: function() { return false; },
        shouldExpand: function() { return false; },
        shouldShowScanModeInTree: function() { return false; },
        scanMode: function() { return 'workspace'; },
        showBadges: function() { return false; },
        shouldShowCounts: function() { return false; },
        shouldHideIconsWhenGroupedByTag: function() { return false; },
        tooltipFormat: function() { return '${filepath}, ${line}'; },
        labelFormat: function() { return '${tag} ${after}'; },
        subTagClickUrl: function() { return ''; },
        isRegexCaseSensitive: function() { return true; },
        shouldHideFromTree: function() { return false; },
        shouldHideFromStatusBar: function() { return false; },
        shouldHideFromActivityBar: function() { return false; },
        shouldSortTree: function() { return true; },
        shouldSortTagsOnlyViewAlphabetically: function() { return false; },
        showFilterCaseSensitive: function() { return false; },
        tagGroup: function() { return undefined; }
    }, overrides || {} );
}

function createResult( fsPath, actualTag, line, column, displayText, continuationText )
{
    return {
        uri: matrixHelpers.createUri( fsPath ),
        line: line,
        column: column,
        endLine: line + ( continuationText && continuationText.length > 0 ? 1 : 0 ),
        endColumn: 12,
        actualTag: actualTag,
        subTag: undefined,
        before: '',
        after: displayText,
        displayText: displayText,
        continuationText: continuationText || [],
        match: actualTag + ' ' + displayText
    };
}

function loadTreeModule( configStub )
{
    var vscodeStub = createVscodeStub();
    utils.init( Object.assign( createConfig(), {
        regex: function() { return { tags: languageMatrix.DEFAULT_TAGS.slice(), regex: '($TAGS)', caseSensitive: true, multiLine: false }; },
        subTagRegex: function() { return '(^:\\s*)'; },
        globs: function() { return []; },
        shouldUseColourScheme: function() { return false; },
        defaultHighlight: function() { return {}; },
        customHighlight: function() { return {}; },
        foregroundColourScheme: function() { return []; },
        backgroundColourScheme: function() { return []; }
    } ) );

    return helpers.loadWithStubs( '../src/tree.js', {
        vscode: vscodeStub,
        './config.js': configStub,
        './utils.js': utils,
        './icons.js': {
            getTreeIcon: function()
            {
                return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
            }
        }
    } );
}

QUnit.module( "tree matrix" );

QUnit.test( "tags-only roots preserve the full manifest tag order", function( assert )
{
    var configStub = createConfig( {
        shouldShowTagsOnly: function() { return true; },
        shouldGroupByTag: function() { return true; }
    } );
    var tree = loadTreeModule( configStub );
    var provider = new tree.TreeNodeProvider( { workspaceState: matrixHelpers.createWorkspaceState() }, function() {}, function() {} );

    provider.clear( [] );
    languageMatrix.DEFAULT_TAGS.forEach( function( tag, index )
    {
        provider.replaceDocument( matrixHelpers.createUri( '/tmp/all-tags-' + index + '-a.js' ), [
            createResult( '/tmp/all-tags-' + index + '-a.js', tag, index + 1, 1, 'item-' + index + '-a' ),
            createResult( '/tmp/all-tags-' + index + '-b.js', tag, index + 11, 1, 'item-' + index + '-b' )
        ] );
    } );
    provider.finalizePendingChanges( undefined, { fullSort: true } );

    assert.deepEqual( provider.getChildren().map( function( node ) { return node.label; } ), languageMatrix.DEFAULT_TAGS );
} );

QUnit.test( "todo ids preserve checklist tags and source positions", function( assert )
{
    var tree = loadTreeModule( createConfig() );
    var provider = new tree.TreeNodeProvider( { workspaceState: matrixHelpers.createWorkspaceState() }, function() {}, function() {} );
    var result = createResult( '/tmp/tasks.md', '[ ]', 7, 3, 'unchecked item' );

    provider.clear( [] );
    provider.replaceDocument( result.uri, [ result ] );
    provider.finalizePendingChanges( undefined, { fullSort: true } );

    var fileNode = provider.getChildren()[ 0 ];
    var todoNode = provider.getChildren( fileNode )[ 0 ];

    assert.equal( todoNode.id, 'todo:/tmp/tasks.md:7:3:[ ]' );
    assert.equal( todoNode.label, '[ ] unchecked item' );
} );

QUnit.test( "path node ids remain stable across rebuilds for unchanged files", function( assert )
{
    var tree = loadTreeModule( createConfig() );
    var provider = new tree.TreeNodeProvider( { workspaceState: matrixHelpers.createWorkspaceState() }, function() {}, function() {} );
    var result = createResult( '/tmp/stable.js', 'TODO', 3, 5, 'stable node' );

    provider.clear( [] );
    provider.replaceDocument( result.uri, [ result ] );
    provider.finalizePendingChanges( undefined, { fullSort: true } );
    var firstPathId = provider.getChildren()[ 0 ].id;

    provider.clear( [] );
    provider.rebuild();
    provider.replaceDocument( result.uri, [ result ] );
    provider.finalizePendingChanges( undefined, { fullSort: true } );
    var secondPathId = provider.getChildren()[ 0 ].id;

    assert.equal( firstPathId, secondPathId );
} );
