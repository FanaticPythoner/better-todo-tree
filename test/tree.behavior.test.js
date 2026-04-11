var utils = require( '../src/utils.js' );
var helpers = require( './moduleHelpers.js' );

function createWorkspaceState()
{
    var store = {};
    return {
        get: function( key, defaultValue )
        {
            return Object.prototype.hasOwnProperty.call( store, key ) ? store[ key ] : defaultValue;
        },
        update: function( key, value )
        {
            store[ key ] = value;
            return Promise.resolve();
        }
    };
}

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
        tags: function() { return [ 'TODO', 'FIXME' ]; },
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

function createResult( fsPath, actualTag, displayText, continuationText )
{
    return {
        uri: {
            fsPath: fsPath,
            toString: function()
            {
                return fsPath;
            }
        },
        line: 3,
        column: 5,
        endLine: 4,
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

QUnit.module( "behavioral tree", function()
{
    function loadTreeModule( configStub )
    {
        var vscodeStub = createVscodeStub();
        utils.init( Object.assign( createConfig(), {
            regex: function() { return { tags: [ 'TODO', 'FIXME' ], regex: '($TAGS)', caseSensitive: true, multiLine: false }; },
            subTagRegex: function() { return '(^:\\s*)'; },
            isRegexCaseSensitive: function() { return true; },
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

    QUnit.test( "multiline todos stay as one logical node and preserve full text in tooltip", function( assert )
    {
        var configStub = createConfig();
        var tree = loadTreeModule( configStub );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

        provider.clear( [] );
        provider.replaceDocument( createResult( '/tmp/a.js', 'TODO', 'first line', [ 'second line' ] ).uri, [
            createResult( '/tmp/a.js', 'TODO', 'first line', [ 'second line' ] )
        ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var fileNode = provider.getChildren()[ 0 ];
        var todoNode = provider.getChildren( fileNode )[ 0 ];
        var treeItem = provider.getTreeItem( todoNode );

        assert.equal( provider.getChildren( todoNode ).length, 0 );
        assert.equal( todoNode.label, 'TODO first line' );
        assert.equal( treeItem.tooltip, 'first line\nsecond line' );
    } );

    QUnit.test( "todo ids remain stable across rebuilds for unchanged matches", function( assert )
    {
        var configStub = createConfig();
        var tree = loadTreeModule( configStub );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var result = createResult( '/tmp/a.js', 'TODO', 'stable item' );

        provider.clear( [] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );
        var firstId = provider.getChildren( provider.getChildren()[ 0 ] )[ 0 ].id;

        provider.clear( [] );
        provider.rebuild();
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );
        var secondId = provider.getChildren( provider.getChildren()[ 0 ] )[ 0 ].id;

        assert.equal( firstId, secondId );
    } );

    QUnit.test( "tag grouped roots follow configured tag order", function( assert )
    {
        var configStub = createConfig( {
            shouldShowTagsOnly: function() { return true; },
            shouldGroupByTag: function() { return true; }
        } );
        var tree = loadTreeModule( configStub );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );

        provider.clear( [] );
        provider.replaceDocument( createResult( '/tmp/a.js', 'FIXME', 'later' ).uri, [
            createResult( '/tmp/a.js', 'FIXME', 'later' ),
            createResult( '/tmp/c.js', 'FIXME', 'later again' )
        ] );
        provider.replaceDocument( createResult( '/tmp/b.js', 'TODO', 'first' ).uri, [
            createResult( '/tmp/b.js', 'TODO', 'first' ),
            createResult( '/tmp/d.js', 'TODO', 'second' )
        ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var rootLabels = provider.getChildren().map( function( node ) { return node.label; } );
        assert.deepEqual( rootLabels, [ 'TODO', 'FIXME' ] );
    } );

    QUnit.test( "grouped tree children follow configured tag order after incremental updates", function( assert )
    {
        var configStub = createConfig( {
            shouldGroupByTag: function() { return true; }
        } );
        var tree = loadTreeModule( configStub );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( createResult( '/workspace/b.js', 'FIXME', 'later' ).uri, [
            createResult( '/workspace/b.js', 'FIXME', 'later' )
        ] );
        provider.replaceDocument( createResult( '/workspace/a.js', 'TODO', 'first' ).uri, [
            createResult( '/workspace/a.js', 'TODO', 'first' )
        ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var workspaceRoot = provider.getChildren()[ 0 ];
        assert.deepEqual( provider.getChildren( workspaceRoot ).map( function( node ) { return node.label; } ), [ 'TODO', 'FIXME' ] );

        provider.replaceDocument( createResult( '/workspace/c.js', 'TODO', 'updated' ).uri, [
            createResult( '/workspace/c.js', 'TODO', 'updated' )
        ] );
        provider.finalizePendingChanges( undefined, { fullSort: false } );

        assert.deepEqual( provider.getChildren( workspaceRoot ).map( function( node ) { return node.label; } ), [ 'TODO', 'FIXME' ] );
    } );
} );
