var utils = require( '../src/utils.js' );
var regexRegistry = require( '../src/regexRegistry.js' );
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
    var eventFires = [];

    function EventEmitter()
    {
        this.event = function() {};
        this.fire = function( value ) { eventFires.push( value ); };
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
                    },
                    inspect: function( key )
                    {
                        return {
                            defaultValue: key === 'revealBehaviour' ? 'start of todo' : undefined,
                            globalValue: undefined,
                            workspaceValue: undefined,
                            workspaceFolderValue: undefined
                        };
                    }
                };
            }
        },
        __eventFires: eventFires
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
        shouldNotSortWorkspaceRootFolders: function() { return false; },
        shouldSortTagsOnlyViewAlphabetically: function() { return false; },
        showFilterCaseSensitive: function() { return false; },
        tagGroup: function() { return undefined; }
    }, overrides || {} );
}

function createResult( fsPath, actualTag, displayText, continuationText, options )
{
    options = options || {};

    return {
        uri: options.uri || {
            fsPath: fsPath,
            toString: function()
            {
                return fsPath;
            }
        },
        revealUri: options.revealUri,
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
        match: actualTag + ' ' + displayText,
        sourceId: options.sourceId
    };
}

QUnit.module( "behavioral tree", function()
{
    function loadTreeModule( configStub )
    {
        return loadTreeHarness( configStub ).tree;
    }

    function loadTreeHarness( configStub, iconsStub )
    {
        var vscodeStub = createVscodeStub();
        utils.init( Object.assign( createConfig(), {
            regex: function()
            {
                return {
                    tags: [ 'TODO', 'FIXME' ],
                    regex: regexRegistry.TAG_CAPTURE_PLACEHOLDER,
                    caseSensitive: true,
                    multiLine: false
                };
            },
            subTagRegex: function() { return regexRegistry.pattern( 'subTagPrefixCapture' ); },
            isRegexCaseSensitive: function() { return true; },
            globs: function() { return []; },
            shouldUseColourScheme: function() { return false; },
            defaultHighlight: function() { return {}; },
            customHighlight: function() { return {}; },
            foregroundColourScheme: function() { return []; },
            backgroundColourScheme: function() { return []; }
        } ) );

        return {
            tree: helpers.loadWithStubs( '../src/tree.js', {
                vscode: vscodeStub,
                './config.js': configStub,
                './utils.js': utils,
                './icons.js': iconsStub || {
                    getTreeIcon: function()
                    {
                        return { dark: '/tmp/icon.svg', light: '/tmp/icon.svg' };
                    }
                }
            } ),
            vscode: vscodeStub
        };
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

    QUnit.test( "issue #888 renders the multiline banner match as a single tree label", function( assert )
    {
        var configStub = createConfig( {
            tags: function() { return [ '@todo', '*' ]; }
        } );
        var tree = loadTreeModule( configStub );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var result = createResult( '/tmp/issue-888.js', '*', 'Helpers', [] );

        provider.clear( [] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var fileNode = provider.getChildren()[ 0 ];
        var todoNode = provider.getChildren( fileNode )[ 0 ];
        var treeItem = provider.getTreeItem( todoNode );

        assert.equal( todoNode.label, '* Helpers' );
        assert.deepEqual( todoNode.continuationText, [] );
        assert.equal( treeItem.label, '* Helpers' );
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

    QUnit.test( "notebook todos reveal the originating cell while remaining grouped under the notebook file", function( assert )
    {
        var configStub = createConfig();
        var tree = loadTreeModule( configStub );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var notebookUri = {
            fsPath: '/tmp/notebook.ipynb',
            toString: function() { return '/tmp/notebook.ipynb'; }
        };
        var cellUri = {
            fsPath: '/tmp/notebook.ipynb',
            toString: function() { return 'vscode-notebook-cell:///tmp/notebook.ipynb#cell-0'; }
        };
        var result = createResult( '/tmp/notebook.ipynb', 'TODO', 'cell item', [], {
            uri: notebookUri,
            revealUri: cellUri,
            sourceId: 'notebook-cell:0:' + cellUri.toString()
        } );

        provider.clear( [] );
        provider.replaceDocument( notebookUri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var fileNode = provider.getChildren()[ 0 ];
        var todoNode = provider.getChildren( fileNode )[ 0 ];
        var treeItem = provider.getTreeItem( todoNode );

        assert.equal( todoNode.fsPath, '/tmp/notebook.ipynb' );
        assert.equal( todoNode.uri, cellUri );
        assert.equal( treeItem.command.arguments[ 0 ], cellUri );
        assert.equal( todoNode.id.indexOf( 'notebook-cell:0:' ) > -1, true );
    } );

    [ 'tree', 'flat', 'grouped' ].forEach( function( view )
    {
        QUnit.test( view + " view can preserve workspace root order while sorting descendants", function( assert )
        {
            var preserveOrder = false;
            var configStub = createConfig( {
                shouldNotSortWorkspaceRootFolders: function() { return preserveOrder; },
                shouldFlatten: function() { return view === 'flat'; },
                shouldGroupByTag: function() { return view === 'grouped'; }
            } );
            var tree = loadTreeModule( configStub );
            var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
            var folders = [ '/projects/z-app', '/projects/a-lib' ].map( function( fsPath, index )
            {
                return {
                    name: index === 0 ? 'First project' : 'Second project',
                    uri: { scheme: 'file', fsPath: fsPath }
                };
            } );

            function replaceFile( filePath )
            {
                var result = createResult( filePath, 'TODO', 'item' );
                provider.replaceDocument( result.uri, [ result ] );
            }

            function rootPaths()
            {
                return provider.getChildren().map( function( node ) { return node.fsPath; } );
            }

            function assertDescendantOrder()
            {
                provider.getChildren().forEach( function( root )
                {
                    var parent = view === 'grouped' ? provider.getChildren( root )[ 0 ] : root;
                    assert.deepEqual( provider.getChildren( parent ).map( function( node ) { return node.label; } ),
                        [ 'a.js', 'b.js', 'c.js' ], root.label + ' files remain sorted' );
                } );
            }

            provider.clear( folders );
            folders.forEach( function( folder )
            {
                [ 'c.js', 'a.js', 'b.js' ].forEach( function( filename )
                {
                    replaceFile( folder.uri.fsPath + '/' + filename );
                } );
            } );
            provider.finalizePendingChanges( undefined, { fullSort: true } );
            assert.deepEqual( rootPaths(), [ '/projects/a-lib', '/projects/z-app' ], 'default path sorting' );

            preserveOrder = true;
            provider.sort();
            assert.deepEqual( rootPaths(), [ '/projects/z-app', '/projects/a-lib' ], 'workspace order restored after a previous sort' );
            assertDescendantOrder();

            replaceFile( '/projects/z-app/b.js' );
            provider.finalizePendingChanges( undefined, { fullSort: false } );
            assert.deepEqual( rootPaths(), [ '/projects/z-app', '/projects/a-lib' ], 'incremental update preserves workspace order' );
            assertDescendantOrder();

            replaceFile( '/external/z.js' );
            replaceFile( '/external/a.js' );
            provider.finalizePendingChanges( undefined, { fullSort: true } );
            var externalPaths = view === 'grouped' ? [ 'TODO' ] : [ '/external/a.js', '/external/z.js' ];
            assert.deepEqual( rootPaths(), [ '/projects/z-app', '/projects/a-lib' ].concat( externalPaths ),
                'files outside the workspace remain sorted after workspace roots' );
            if( view === 'grouped' )
            {
                assert.deepEqual( provider.getChildren( provider.getChildren()[ 2 ] ).map( function( node ) { return node.fsPath; } ),
                    [ '/external/a.js', '/external/z.js' ], 'external files remain sorted inside their tag group' );
            }

            preserveOrder = false;
            provider.sort();
            assert.deepEqual( rootPaths(), [ '/projects/a-lib', '/projects/z-app' ].concat( externalPaths ),
                'disabling the option restores path sorting' );
        } );
    } );

    QUnit.test( "workspace order option does not enable sorting when tree sorting is disabled", function( assert )
    {
        var tree = loadTreeModule( createConfig( {
            shouldSortTree: function() { return false; },
            shouldNotSortWorkspaceRootFolders: function() { return true; }
        } ) );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        provider.clear( [ { name: 'workspace', uri: { scheme: 'file', fsPath: '/workspace' } } ] );
        [ 'c.js', 'a.js', 'b.js' ].forEach( function( filename )
        {
            var result = createResult( '/workspace/' + filename, 'TODO', 'item' );
            provider.replaceDocument( result.uri, [ result ] );
        } );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        assert.deepEqual( provider.getChildren( provider.getChildren()[ 0 ] ).map( function( node ) { return node.label; } ),
            [ 'c.js', 'a.js', 'b.js' ] );
    } );

    QUnit.test( "tag grouped roots follow configured tag order", function( assert )
    {
        var configStub = createConfig( {
            shouldShowTagsOnly: function() { return true; },
            shouldNotSortWorkspaceRootFolders: function() { return true; },
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

    QUnit.test( "incremental document updates keep sibling files sorted by path", function( assert )
    {
        var configStub = createConfig();
        var tree = loadTreeModule( configStub );
        var provider = new tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };

        function replaceFile( filePath, tag, text )
        {
            var result = createResult( filePath, tag, text );
            provider.replaceDocument( result.uri, [ result ] );
        }

        function fileLabels()
        {
            var workspaceRoot = provider.getChildren()[ 0 ];
            var srcFolder = provider.getChildren( workspaceRoot )[ 0 ];
            return provider.getChildren( srcFolder ).map( function( node ) { return node.label; } );
        }

        provider.clear( [ workspaceFolder ] );
        replaceFile( '/workspace/src/c.cbl', 'TODO', 'third' );
        replaceFile( '/workspace/src/a.cbl', 'TODO', 'first' );
        replaceFile( '/workspace/src/b.cbl', 'FIXME', 'second' );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        assert.deepEqual( fileLabels(), [ 'a.cbl', 'b.cbl', 'c.cbl' ] );

        replaceFile( '/workspace/src/b.cbl', 'TODO', 'second updated' );
        provider.finalizePendingChanges( undefined, { fullSort: false } );

        assert.deepEqual( fileLabels(), [ 'a.cbl', 'b.cbl', 'c.cbl' ] );
    } );

    QUnit.test( "forceFullRefresh emits a full tree refresh for in-flight workspace updates", function( assert )
    {
        var configStub = createConfig();
        var harness = loadTreeHarness( configStub );
        var provider = new harness.tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };
        var result = createResult( '/workspace/a.js', 'TODO', 'streamed item' );

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: false, forceFullRefresh: true } );
        provider.refresh();

        assert.deepEqual( harness.vscode.__eventFires, [ undefined ] );
    } );

    QUnit.test( "switching from tags-only roots back to tree roots emits a full refresh and rebuilds workspace roots", function( assert )
    {
        var viewState = {
            tagsOnly: true,
            flat: false
        };
        var configStub = createConfig( {
            shouldShowTagsOnly: function() { return viewState.tagsOnly; },
            shouldFlatten: function() { return viewState.flat; }
        } );
        var harness = loadTreeHarness( configStub );
        var provider = new harness.tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };
        var result = createResult( '/workspace/a.js', 'TODO', 'root change item' );

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );
        provider.refresh();

        harness.vscode.__eventFires.length = 0;
        viewState.tagsOnly = false;
        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );
        provider.refresh();

        assert.deepEqual( harness.vscode.__eventFires, [ undefined ] );
        assert.equal( provider.getChildren()[ 0 ].label, 'workspace' );
        assert.equal( provider.getChildren( provider.getChildren()[ 0 ] )[ 0 ].label, 'a.js' );
    } );

    QUnit.test( "switching from tree roots to tags-only roots emits a full refresh and removes workspace roots", function( assert )
    {
        var viewState = {
            tagsOnly: false,
            flat: false
        };
        var configStub = createConfig( {
            shouldShowTagsOnly: function() { return viewState.tagsOnly; },
            shouldFlatten: function() { return viewState.flat; }
        } );
        var harness = loadTreeHarness( configStub );
        var provider = new harness.tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };
        var result = createResult( '/workspace/a.js', 'TODO', 'root change item' );

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );
        provider.refresh();

        harness.vscode.__eventFires.length = 0;
        viewState.tagsOnly = true;
        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );
        provider.refresh();

        assert.deepEqual( harness.vscode.__eventFires, [ undefined ] );
        assert.equal( provider.getChildren()[ 0 ].label, 'TODO root change item' );
    } );

    QUnit.test( "issue #29 file containers keep file theme icons and tag icons stay on todos", function( assert )
    {
        var configStub = createConfig( {
            showBadges: function() { return true; }
        } );
        var iconCalls = [];
        var harness = loadTreeHarness( configStub, {
            getTreeIcon: function( context, tag )
            {
                iconCalls.push( tag );
                return { dark: '/tmp/tag-' + tag + '.svg', light: '/tmp/tag-' + tag + '.svg' };
            }
        } );
        var provider = new harness.tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };
        var result = createResult( '/workspace/src/app.js', 'TODO', 'restore file theme icon' );

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var workspaceRoot = provider.getChildren()[ 0 ];
        var folderNode = provider.getChildren( workspaceRoot )[ 0 ];
        var fileNode = provider.getChildren( folderNode )[ 0 ];
        var todoNode = provider.getChildren( fileNode )[ 0 ];
        var folderItem = provider.getTreeItem( folderNode );
        var fileItem = provider.getTreeItem( fileNode );
        var todoItem = provider.getTreeItem( todoNode );

        assert.equal( folderItem.iconPath, harness.vscode.ThemeIcon.Folder );
        assert.equal( folderItem.resourceUri.fsPath, '/workspace/src' );
        assert.equal( fileItem.iconPath, harness.vscode.ThemeIcon.File );
        assert.equal( fileItem.resourceUri.fsPath, '/workspace/src/app.js' );
        assert.deepEqual( todoItem.iconPath, { dark: '/tmp/tag-TODO.svg', light: '/tmp/tag-TODO.svg' } );
        assert.deepEqual( iconCalls, [ 'TODO' ] );
    } );

    QUnit.test( "issue #29 file theme resource is gated by badge setting without tag icon bleed", function( assert )
    {
        var configStub = createConfig( {
            showBadges: function() { return false; }
        } );
        var iconCalls = [];
        var harness = loadTreeHarness( configStub, {
            getTreeIcon: function( context, tag )
            {
                iconCalls.push( tag );
                return { dark: '/tmp/tag-' + tag + '.svg', light: '/tmp/tag-' + tag + '.svg' };
            }
        } );
        var provider = new harness.tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };
        var result = createResult( '/workspace/app.js', 'TODO', 'no resource decorations' );

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var fileNode = provider.getChildren( provider.getChildren()[ 0 ] )[ 0 ];
        var fileItem = provider.getTreeItem( fileNode );

        assert.equal( fileItem.iconPath, harness.vscode.ThemeIcon.File );
        assert.equal( fileItem.resourceUri, undefined );
        assert.deepEqual( iconCalls, [] );
    } );

    QUnit.test( "issue #29 grouped tag roots keep tag icons while file children keep file theme icons", function( assert )
    {
        var configStub = createConfig( {
            shouldGroupByTag: function() { return true; },
            showBadges: function() { return true; }
        } );
        var iconCalls = [];
        var harness = loadTreeHarness( configStub, {
            getTreeIcon: function( context, tag )
            {
                iconCalls.push( tag );
                return { dark: '/tmp/tag-' + tag + '.svg', light: '/tmp/tag-' + tag + '.svg' };
            }
        } );
        var provider = new harness.tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };
        var result = createResult( '/workspace/src/app.js', 'TODO', 'grouped file theme icon' );

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var workspaceRoot = provider.getChildren()[ 0 ];
        var tagNode = provider.getChildren( workspaceRoot )[ 0 ];
        var folderNode = provider.getChildren( tagNode )[ 0 ];
        var fileNode = provider.getChildren( folderNode )[ 0 ];
        var tagItem = provider.getTreeItem( tagNode );
        var folderItem = provider.getTreeItem( folderNode );
        var fileItem = provider.getTreeItem( fileNode );

        assert.deepEqual( tagItem.iconPath, { dark: '/tmp/tag-TODO.svg', light: '/tmp/tag-TODO.svg' } );
        assert.equal( tagItem.resourceUri, undefined );
        assert.equal( folderItem.iconPath, harness.vscode.ThemeIcon.Folder );
        assert.equal( folderItem.resourceUri.fsPath, '/workspace/src' );
        assert.equal( fileItem.iconPath, harness.vscode.ThemeIcon.File );
        assert.equal( fileItem.resourceUri.fsPath, '/workspace/src/app.js' );
        assert.deepEqual( iconCalls, [ 'TODO' ] );
    } );

    QUnit.test( "issue #29 subtag containers keep the source file icon theme resource", function( assert )
    {
        var configStub = createConfig( {
            showBadges: function() { return true; }
        } );
        var harness = loadTreeHarness( configStub );
        var provider = new harness.tree.TreeNodeProvider( { workspaceState: createWorkspaceState() }, function() {}, function() {} );
        var workspaceFolder = {
            name: 'workspace',
            uri: {
                scheme: 'file',
                fsPath: '/workspace'
            }
        };
        var result = createResult( '/workspace/app.js', 'TODO', 'subtag source icon' );
        result.subTag = 'owner';

        provider.clear( [ workspaceFolder ] );
        provider.replaceDocument( result.uri, [ result ] );
        provider.finalizePendingChanges( undefined, { fullSort: true } );

        var fileNode = provider.getChildren( provider.getChildren()[ 0 ] )[ 0 ];
        var subTagNode = provider.getChildren( fileNode )[ 0 ];
        var fileItem = provider.getTreeItem( fileNode );
        var subTagItem = provider.getTreeItem( subTagNode );

        assert.equal( fileItem.iconPath, harness.vscode.ThemeIcon.File );
        assert.equal( fileItem.resourceUri.fsPath, '/workspace/app.js' );
        assert.equal( subTagItem.iconPath, harness.vscode.ThemeIcon.File );
        assert.equal( subTagItem.resourceUri, undefined );
    } );
} );
