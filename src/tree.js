/* jshint esversion:6 */

var vscode = require( 'vscode' );
var path = require( "path" );

var utils = require( './utils.js' );
var icons = require( './icons.js' );
var config = require( './config.js' );

var workspaceFolders;
var nodes = [];
var currentFilter;

const PATH = "path";
const TODO = "todo";

var buildCounter = 1;
var nodeCounter = 1;

var expandedNodes = {};

var treeHasSubTags = false;

var isVisible = function( e )
{
    return e.visible === true && e.hidden !== true;
};

var isTodoNode = function( e )
{
    return e.type === TODO;
};

var isPathNode = function( e )
{
    return e.type === PATH;
};

var findTagNode = function( node )
{
    if( config.isRegexCaseSensitive() )
    {
        return isPathNode( node ) && node.tag === this.toString();
    }
    return isPathNode( node ) && node.tag && node.tag.toLowerCase() === this.toString().toLowerCase();
};

var findSubTagNode = function( node )
{
    if( config.isRegexCaseSensitive() )
    {
        return node.type === PATH && node.subTag === this.toString();
    }
    return node.type === PATH && node.subTag && node.subTag.toLowerCase() === this.toString().toLowerCase();
};

var findExactPath = function( node )
{
    return isPathNode( node ) && node.fsPath === this.toString();
};

var findPathNode = function( node )
{
    return isPathNode( node ) && node.pathElement === this.toString();
};

var findTodoNode = function( node )
{
    return isTodoNode( node ) && node.label === this.label.toString() && node.fsPath === this.fsPath && node.line === this.line;
};

var sortFoldersFirst = function( a, b, same )
{
    if( a.isFolder === b.isFolder )
    {
        return same( a, b );
    }
    else
    {
        return b.isFolder ? 1 : -1;
    }
};

var sortByLineAndColumn = function( a, b )
{
    return a.line > b.line ? 1 : b.line > a.line ? -1 : a.column > b.column ? 1 : -1;
};

var sortByFilenameAndLine = function( a, b )
{
    return sortFoldersFirst( a, b, function( a, b )
    {
        if( a.isRootTagNode === true && b.isRootTagNode === true )
        {
            var tags = config.tags();
            return tags.indexOf( a.tag ) > tags.indexOf( b.tag ) ? 1 : tags.indexOf( b.tag ) > tags.indexOf( a.tag ) ? -1 : sortByLineAndColumn( a, b );
        }
        return a.fsPath > b.fsPath ? 1 : b.fsPath > a.fsPath ? -1 : sortByLineAndColumn( a, b );
    } );
};

var sortTagsOnlyViewByLabel = function( a, b )
{
    return sortFoldersFirst( a, b, function( a, b ) { return a.label > b.label ? 1 : b.label > a.label ? -1 : sortByLineAndColumn( a, b ); } );
};

var sortTagsOnlyViewByTagOrder = function( a, b )
{
    return sortFoldersFirst( a, b, function( a, b )
    {
        var tags = config.tags();
        var indexA = tags.indexOf( a.tag );
        var indexB = tags.indexOf( b.tag );
        return indexA > indexB ? 1 : ( indexB > indexA ? -1 : sortByFilenameAndLine( a, b ) );
    } );
};

function createWorkspaceRootNode( folder )
{
    var id = ( buildCounter * 1000000 ) + nodeCounter++;
    var node = {
        isWorkspaceNode: true,
        type: PATH,
        label: folder.uri.scheme === 'file' ? folder.name : folder.uri.authority,
        nodes: [],
        fsPath: folder.uri.scheme === 'file' ? folder.uri.fsPath : ( folder.uri.authority + folder.uri.fsPath ),
        id: id,
        visible: true,
        isFolder: true,
        parent: undefined
    };
    return node;
}

function createPathNode( folder, pathElements, isFolder, subTag )
{
    var id = ( buildCounter * 1000000 ) + nodeCounter++;
    var fsPath = pathElements.length > 0 ? path.join( folder, pathElements.join( path.sep ) ) : folder;

    return {
        type: PATH,
        fsPath: fsPath,
        pathElement: pathElements[ pathElements.length - 1 ],
        label: pathElements[ pathElements.length - 1 ],
        nodes: [],
        id: id,
        visible: true,
        isFolder: isFolder,
        subTag: subTag,
        parent: undefined
    };
}

function createFlatNode( fsPath, rootNode )
{
    var id = ( buildCounter * 1000000 ) + nodeCounter++;
    var pathLabel = path.dirname( rootNode === undefined ? fsPath : path.relative( rootNode.fsPath, fsPath ) );

    return {
        type: PATH,
        fsPath: fsPath,
        label: path.basename( fsPath ),
        pathLabel: pathLabel === '.' ? '' : '(' + pathLabel + ')',
        nodes: [],
        id: id,
        visible: true,
        parent: undefined
    };
}

function createTagNode( fsPath, tag )
{
    var id = ( buildCounter * 1000000 ) + nodeCounter++;

    return {
        isRootTagNode: true,
        type: PATH,
        label: tag,
        fsPath: fsPath,
        nodes: [],
        id: id,
        tag: tag,
        visible: true,
        parent: undefined
    };
}

function createSubTagNode( subTag )
{
    var id = ( buildCounter * 1000000 ) + nodeCounter++;

    return {
        isRootTagNode: true,
        type: PATH,
        label: subTag,
        fsPath: subTag,
        nodes: [],
        id: id,
        subTag: subTag,
        visible: true,
        isFolder: true,
        parent: undefined
    };
}

function createTodoNode( result )
{
    var id = ( buildCounter * 1000000 ) + nodeCounter++;
    var joined = result.match.substr( result.column - 1 );
    if( result.extraLines )
    {
        result.extraLines.map( function( extraLine )
        {
            joined += "\n" + extraLine.match;
        } );
    }
    var text = utils.removeBlockComments( joined, result.uri.fsPath );
    var extracted = utils.extractTag( text, result.column );
    var label = ( extracted.withoutTag && extracted.withoutTag.length > 0 ) ? extracted.withoutTag : "line " + result.line;

    if( config.shouldGroupByTag() !== true )
    {
        if( result.extraLines )
        {
            label = extracted.tag;
        }
        else
        {
            label = extracted.tag + " " + label;
        }
    }

    var tagGroup = config.tagGroup( extracted.tag );

    var todo = {
        type: TODO,
        fsPath: result.uri.fsPath,
        uri: result.uri,
        label: label,
        tag: tagGroup ? tagGroup : extracted.tag,
        subTag: extracted.subTag,
        actualTag: extracted.tag,
        line: result.line - 1,
        column: result.column,
        endColumn: result.column + result.match.length,
        after: extracted.after ? extracted.after.trim() : "",
        before: extracted.before ? extracted.before.trim() : "",
        id: id,
        visible: true,
        extraLines: [],
        parent: undefined
    };

    if( result.extraLines )
    {
        var commentsRemoved = text.split( '\n' );
        commentsRemoved.shift();
        result.extraLines.map( function( extraLine, index )
        {
            extraLine.match = commentsRemoved[ index ];
            extraLine.uri = result.uri;
            if( extraLine.match )
            {
                var extraLineMatch = extraLine.match.trim();
                if( extraLineMatch && extraLineMatch != todo.tag )
                {
                    var extraLineNode = createTodoNode( extraLine );
                    extraLineNode.isExtraLine = true;
                    todo.extraLines.push( extraLineNode );
                }
            }
        } );
    }

    return todo;
}

function locateWorkspaceNode( filename )
{
    var result;
    nodes.map( function( node )
    {
        var workspacePath = node.fsPath + ( node.fsPath.indexOf( path.sep ) === node.fsPath.length - 1 ? "" : path.sep );
        if( node.isWorkspaceNode && ( filename === node.fsPath || filename.indexOf( workspacePath ) === 0 ) )
        {
            result = node;
        }
    } );
    return result;
}

function locateFlatChildNode( rootNode, result, tag, subTag )
{
    var parentNodes = ( rootNode === undefined ? nodes : rootNode.nodes );
    var parentNode;

    if( config.shouldGroupByTag() && tag )
    {
        var tagPath = tag;
        parentNode = parentNodes.find( findTagNode, tagPath );
        if( parentNode === undefined )
        {
            parentNode = createPathNode( rootNode ? rootNode.fsPath : JSON.stringify( result ), [ tagPath ], subTag );
            parentNode.tag = tagPath;
            parentNode.isRootTagNode = true;
            parentNode.parent = rootNode;
            parentNodes.push( parentNode );
        }
        parentNodes = parentNode.nodes;
    }
    else if( config.shouldGroupBySubTag() && subTag )
    {
        var subTagPath = subTag;
        parentNode = parentNodes.find( findSubTagNode, subTagPath );
        if( parentNode === undefined )
        {
            parentNode = createPathNode( rootNode ? rootNode.fsPath : JSON.stringify( result ), [ subTagPath ], subTag );
            parentNode.subTag = subTagPath;
            parentNode.parent = rootNode;
            parentNodes.push( parentNode );
        }
        parentNodes = parentNode.nodes;
    }

    var fullPath = result.uri.scheme === 'file' ? result.uri.fsPath : path.join( result.uri.authority, result.uri.fsPath );
    var nodePath = subTag ? path.join( fullPath, subTag ) : fullPath;
    var childNode = parentNodes.find( findExactPath, nodePath );
    if( childNode === undefined )
    {
        childNode = createFlatNode( nodePath, rootNode );
        childNode.parent = parentNode ? parentNode : rootNode;
        parentNodes.push( childNode );
    }

    return childNode;
}

function locateTreeChildNode( rootNode, pathElements, tag, subTag )
{
    var childNode;

    var parentNodes = rootNode.nodes;
    var parentNode;

    if( config.shouldGroupByTag() && tag )
    {
        parentNode = parentNodes.find( findTagNode, tag );
        if( parentNode === undefined )
        {
            var tagPathList = [];
            if( subTag )
            {
                tagPathList.push( subTag );
            }
            tagPathList.push( tag );
            parentNode = createPathNode( rootNode ? rootNode.fsPath : JSON.stringify( result ), tagPathList, subTag );
            parentNode.isRootTagNode = true;
            parentNode.tag = tag;
            parentNode.parent = rootNode;
            parentNodes.push( parentNode );
        }
        parentNodes = parentNode.nodes;
    }
    else if( config.shouldGroupBySubTag() && subTag )
    {
        parentNode = parentNodes.find( findSubTagNode, subTag );
        if( parentNode === undefined )
        {
            var subTagPathList = [];
            subTagPathList.push( subTag );
            parentNode = createPathNode( rootNode ? rootNode.fsPath : JSON.stringify( result ), subTagPathList, subTag );
            parentNode.subTag = subTag;
            parentNode.parent = rootNode;
            parentNodes.push( parentNode );
        }
        parentNodes = parentNode.nodes;
    }

    pathElements.map( function( element, level )
    {
        childNode = parentNodes.find( findPathNode, element );
        if( childNode === undefined )
        {
            childNode = createPathNode( rootNode.fsPath, pathElements.slice( 0, level + 1 ), level < pathElements.length - 1, subTag );
            childNode.parent = parentNode ? parentNode : rootNode;
            parentNodes.push( childNode );
            parentNodes = childNode.nodes;
            parentNode = childNode;
        }
        else
        {
            parentNodes = childNode.nodes;
            parentNode = childNode;
        }
    } );

    return childNode;
}

function countTags( child, tagCounts, forStatusBar, fileFilter )
{
    function countTag( node )
    {
        if( isTodoNode( node ) )
        {
            var tag = node.tag ? node.tag : "TODO";
            if( isVisible( node ) && ( !fileFilter || fileFilter === node.fsPath ) )
            {
                var hide = false;

                if( forStatusBar && config.shouldHideFromStatusBar( tag ) )
                {
                    hide = true;
                }

                if( !forStatusBar && config.shouldHideFromActivityBar( tag ) )
                {
                    hide = true;
                }

                if( !hide )
                {
                    tagCounts[ tag ] = tagCounts[ tag ] === undefined ? 1 : tagCounts[ tag ] + 1;
                }
            }
        }
    }

    countTag( child );

    if( child.nodes !== undefined )
    {
        countChildTags( child.nodes.filter( isPathNode ), tagCounts, forStatusBar, fileFilter );
        child.nodes.filter( isTodoNode ).map( function( node ) { countTag( node ); } );
    }
}

function countChildTags( children, tagCounts, forStatusBar, fileFilter )
{
    children.map( function( child ) { return countTags( child, tagCounts, forStatusBar, fileFilter ); } );
    return tagCounts;
}

function cloneTagCounts( counts )
{
    return Object.assign( {}, counts );
}

function addTagCounts( target, counts )
{
    Object.keys( counts ).forEach( function( tag )
    {
        target[ tag ] = ( target[ tag ] || 0 ) + counts[ tag ];
        if( target[ tag ] === 0 )
        {
            delete target[ tag ];
        }
    } );
}

function subtractTagCounts( target, counts )
{
    Object.keys( counts ).forEach( function( tag )
    {
        if( target[ tag ] !== undefined )
        {
            target[ tag ] -= counts[ tag ];
            if( target[ tag ] <= 0 )
            {
                delete target[ tag ];
            }
        }
    } );
}

function addWorkspaceFolders()
{
    if( workspaceFolders && config.shouldShowTagsOnly() === false )
    {
        workspaceFolders.map( function( folder )
        {
            nodes.push( createWorkspaceRootNode( folder ) );
        } );
    }
}

class TreeNodeProvider
{
    constructor( _context, debug, onTreeRefreshed )
    {
        this._context = _context;
        this._debug = debug;
        this.onTreeRefreshed = onTreeRefreshed;

        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;

        this.nodesToGet = 0;

        buildCounter = _context.workspaceState.get( 'buildCounter', 1 );
        expandedNodes = _context.workspaceState.get( 'expandedNodes', {} );
        this._documentEntries = new Map();
        this._statusBarCounts = {};
        this._activityBarCounts = {};
        this._statusBarCountsByFile = new Map();
        this._pendingCountUris = new Set();
        this._dirtyRoots = new Set();
        this._rootListDirty = false;
    }

    getChildren( node )
    {
        if( node === undefined )
        {
            var result = [];

            var availableNodes = nodes.filter( function( node )
            {
                return node.nodes === undefined || ( node.nodes.length > 0 );
            } );
            var rootNodes = availableNodes.filter( isVisible );
            if( rootNodes.length > 0 )
            {
                result = rootNodes;

                this.nodesToGet = result.length;
            }

            var filterStatusNode = { label: "", notExported: true, isStatusNode: true };
            var includeGlobs = utils.toGlobArray( this._context.workspaceState.get( 'includeGlobs' ) );
            var excludeGlobs = utils.toGlobArray( this._context.workspaceState.get( 'excludeGlobs' ) );
            var totalFilters = includeGlobs.length + excludeGlobs.length;
            var tooltip = "";

            if( currentFilter )
            {
                tooltip += "Tree Filter: \"" + currentFilter + "\"\n";
                totalFilters++;
            }

            if( includeGlobs.length + excludeGlobs.length > 0 )
            {
                includeGlobs.map( function( glob )
                {
                    tooltip += "Include: " + glob + "\n";
                } );
                excludeGlobs.map( function( glob )
                {
                    tooltip += "Exclude: " + glob + "\n";
                } );
            }

            if( totalFilters > 0 )
            {
                filterStatusNode.label = totalFilters + " filter" + ( totalFilters === 1 ? '' : 's' ) + " active";
                filterStatusNode.tooltip = tooltip + "\nRight click for filter options";
                filterStatusNode.icon = "filter";
            }

            if( result.length === 0 )
            {
                if( filterStatusNode.label !== "" )
                {
                    filterStatusNode.label += ", ";
                }
                filterStatusNode.label += "Nothing found";
                filterStatusNode.icon = "issues";

                filterStatusNode.empty = availableNodes.length === 0;
            }

            if( filterStatusNode.label !== "" )
            {
                result.unshift( filterStatusNode );
            }

            if( config.shouldShowScanModeInTree() )
            {
                var scanMode = config.scanMode();
                if( scanMode === 'workspace' )
                {
                    scanMode += " and open files";
                }
                var scanModeNode = {
                    label: "Scan mode: " + scanMode, notExported: true, isStatusNode: true, icon: "search"
                };
                result.unshift( scanModeNode );
            }

            var compacted = [];
            result.map( function( child )
            {
                if( child.isRootTagNode === true && child.nodes.length === 1 )
                {
                    compacted.push( child.nodes[ 0 ] );
                }
                else
                {
                    compacted.push( child );
                }
            } );

            return compacted;
        }
        else if( isPathNode( node ) )
        {
            if( config.shouldCompactFolders() && node.tag === undefined )
            {
                while( node.nodes && node.nodes.length === 1 && node.nodes[ 0 ].nodes && node.nodes[ 0 ].nodes.length > 0 && node.nodes[ 0 ].isFolder )
                {
                    node = node.nodes[ 0 ];
                }
            }

            if( node.nodes && node.nodes.length > 0 )
            {
                return node.nodes.filter( isVisible );
            }
        }
        else if( isTodoNode( node ) )
        {
            if( node.extraLines && node.extraLines.length > 0 )
            {
                return node.extraLines.filter( isVisible );
            }
            else
            {
                return node.text;
            }
        }
    }

    getParent( node )
    {
        return node.parent;
    }

    getTreeItem( node )
    {
        var treeItem;
        try
        {
            treeItem = new vscode.TreeItem( node.label + ( node.pathLabel ? ( " " + node.pathLabel ) : "" ) );
        }
        catch( e )
        {
            console.log( "Failed to create tree item: " + e );
        }

        treeItem.id = node.id;
        treeItem.fsPath = node.fsPath;

        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;

        if( node.fsPath )
        {
            treeItem.node = node;
            if( config.showBadges() && !node.tag && !node.subTag )
            {
                treeItem.resourceUri = vscode.Uri.file( node.fsPath );
            }

            if( isTodoNode( treeItem.node ) )
            {
                treeItem.tooltip = config.tooltipFormat();
                treeItem.tooltip = utils.formatLabel( config.tooltipFormat(), node );
            }
            else
            {
                treeItem.tooltip = treeItem.fsPath;
            }

            if( isPathNode( node ) )
            {
                if( config.shouldCompactFolders() && node.tag === undefined )
                {
                    var onlyChild = node.nodes.filter( isPathNode ).length === 1 ? node.nodes[ 0 ] : undefined;
                    var onlyChildParent = node;
                    while( onlyChild && onlyChild.nodes.filter( isPathNode ).length > 0 && onlyChildParent.nodes.filter( isPathNode ).length === 1 )
                    {
                        treeItem.label += "/" + onlyChild.label;
                        onlyChildParent = onlyChild;
                        onlyChild = onlyChild.nodes[ 0 ];
                    }
                }

                if( expandedNodes[ node.fsPath ] !== undefined )
                {
                    treeItem.collapsibleState = ( expandedNodes[ node.fsPath ] === true ) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                }
                else
                {
                    treeItem.collapsibleState = config.shouldExpand() ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                }

                if( treeItem.collapsibleState === vscode.TreeItemCollapsibleState.Expanded )
                {
                    this.nodesToGet += node.nodes.filter( isVisible ).length;
                }

                if( node.tag )
                {
                    treeItem.iconPath = icons.getIcon( this._context, node.tag ? node.tag : node.label, this._debug );
                }
                else if( node.isWorkspaceNode )
                {
                    treeItem.iconPath = new vscode.ThemeIcon( 'window' );
                }
                else if( node.isFolder )
                {
                    treeItem.iconPath = vscode.ThemeIcon.Folder;
                }
                else
                {
                    treeItem.iconPath = vscode.ThemeIcon.File;
                }

                if( node.subTag !== undefined )
                {
                    var url = config.subTagClickUrl();

                    if( url.trim() !== "" )
                    {
                        url = utils.formatLabel( url, node );
                        treeItem.command = {
                            command: "todo-tree.openUrl",
                            arguments: [
                                url
                            ]
                        };
                        treeItem.tooltip = "Click to open " + url;
                    }
                }
            }
            else if( isTodoNode( node ) )
            {
                if( node.extraLines && node.extraLines.length > 0 )
                {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }

                if( config.shouldHideIconsWhenGroupedByTag() !== true || ( config.shouldGroupByTag() !== true && config.shouldGroupBySubTag() !== true ) )
                {
                    if( node.isExtraLine !== true )
                    {
                        treeItem.iconPath = icons.getIcon( this._context, node.tag ? node.tag : node.label, this._debug );
                    }
                    else
                    {
                        treeItem.iconPath = "no-icon";
                    }
                }

                var format = config.labelFormat();
                if( format !== "" && ( node.extraLines === undefined || node.extraLines.length === 0 ) )
                {
                    treeItem.label = utils.formatLabel( format, node ) + ( node.pathLabel ? ( " " + node.pathLabel ) : "" );
                }

                var revealBehaviour = vscode.workspace.getConfiguration( 'todo-tree.general' ).get( 'revealBehaviour' );

                var todoSelection;
                if( revealBehaviour === 'end of todo' )
                {
                    var todoEnd = new vscode.Position( node.line, node.endColumn - 1 );
                    todoSelection = new vscode.Selection( todoEnd, todoEnd );
                }
                else if( revealBehaviour === 'start of line' )
                {
                    var lineStart = new vscode.Position( node.line, 0 );
                    todoSelection = new vscode.Selection( lineStart, lineStart );
                }
                else if( revealBehaviour === 'start of todo' )
                {
                    var todoStart = new vscode.Position( node.line, node.column - 1 );
                    todoSelection = new vscode.Selection( todoStart, todoStart );
                }

                treeItem.command = {
                    command: "todo-tree.revealInFile",
                    arguments: [
                        node.uri ? node.uri : vscode.Uri.file( node.fsPath ),
                        { selection: todoSelection }
                    ]
                };
            }
        }
        else
        {
            treeItem.description = node.label;
            treeItem.label = "";
            treeItem.tooltip = node.tooltip;
            treeItem.iconPath = new vscode.ThemeIcon( node.icon );
        }

        if( config.shouldShowCounts() && isPathNode( node ) )
        {
            var tagCounts = {};
            countTags( node, tagCounts, false );
            var total = Object.values( tagCounts ).reduce( function( a, b ) { return a + b; }, 0 );
            treeItem.description = total.toString();
        }

        if( node.isFolder === true )
        {
            treeItem.contextValue = "folder";
        }
        else if( !node.isRootTagNode && !node.isWorkspaceNode && !node.isStatusNode && node.type !== TODO && node.subTag === undefined )
        {
            treeItem.contextValue = "file";
        }

        if( node.subTag !== undefined )
        {
            treeHasSubTags = true;
        }

        if( !node.isStatusNode )
        {
            this.nodesToGet--;
        }

        if( this.nodesToGet === 0 && this.onTreeRefreshed )
        {
            this.onTreeRefreshed();
        }

        return treeItem;
    }

    _uriKey( uri )
    {
        return uri.toString();
    }

    _getDocumentEntry( uri )
    {
        var key = this._uriKey( uri );
        var entry = this._documentEntries.get( key );
        if( entry === undefined )
        {
            entry = {
                uri: uri,
                filePath: uri.fsPath,
                todos: [],
                statusBarCounts: {},
                activityBarCounts: {}
            };
            this._documentEntries.set( key, entry );
        }
        return entry;
    }

    _findRootNode( node )
    {
        var current = node;
        while( current && current.parent !== undefined )
        {
            current = current.parent;
        }
        return current;
    }

    _markRootDirty( node )
    {
        if( node === undefined )
        {
            this._rootListDirty = true;
            return;
        }

        var root = this._findRootNode( node );
        if( root === undefined || root.type === TODO )
        {
            this._rootListDirty = true;
        }
        else
        {
            this._dirtyRoots.add( root );
        }
    }

    _removeNodeFromParent( node )
    {
        if( node.parent && node.parent.nodes )
        {
            node.parent.nodes = node.parent.nodes.filter( function( child )
            {
                return child !== node;
            } );
            this._markRootDirty( node.parent );
        }
        else
        {
            nodes = nodes.filter( function( child )
            {
                return child !== node;
            } );
            this._rootListDirty = true;
        }
    }

    _pruneEmptyAncestors( node )
    {
        var current = node;
        while( current && current.nodes !== undefined && current.nodes.length === 0 && current.isWorkspaceNode !== true )
        {
            var parent = current.parent;
            delete expandedNodes[ current.fsPath ];
            this._context.workspaceState.update( 'expandedNodes', expandedNodes );
            this._removeNodeFromParent( current );
            current = parent;
        }
        if( current )
        {
            this._markRootDirty( current );
        }
    }

    _subtractDocumentCounts( entry )
    {
        subtractTagCounts( this._statusBarCounts, entry.statusBarCounts );
        subtractTagCounts( this._activityBarCounts, entry.activityBarCounts );
        if( entry.filePath )
        {
            this._statusBarCountsByFile.delete( entry.filePath );
        }
    }

    _countTodoTag( todoNode, forStatusBar )
    {
        if( isVisible( todoNode ) !== true )
        {
            return undefined;
        }

        var tag = todoNode.tag ? todoNode.tag : "TODO";
        if( forStatusBar && config.shouldHideFromStatusBar( tag ) )
        {
            return undefined;
        }
        if( !forStatusBar && config.shouldHideFromActivityBar( tag ) )
        {
            return undefined;
        }
        return tag;
    }

    _recalculateDocumentCounts( uriKey )
    {
        var entry = this._documentEntries.get( uriKey );
        if( entry === undefined )
        {
            return;
        }

        this._subtractDocumentCounts( entry );

        var statusBarCounts = {};
        var activityBarCounts = {};

        entry.todos.forEach( function( todoNode )
        {
            var statusTag = this._countTodoTag( todoNode, true );
            if( statusTag )
            {
                statusBarCounts[ statusTag ] = ( statusBarCounts[ statusTag ] || 0 ) + 1;
            }

            var activityTag = this._countTodoTag( todoNode, false );
            if( activityTag )
            {
                activityBarCounts[ activityTag ] = ( activityBarCounts[ activityTag ] || 0 ) + 1;
            }
        }, this );

        entry.statusBarCounts = statusBarCounts;
        entry.activityBarCounts = activityBarCounts;

        addTagCounts( this._statusBarCounts, statusBarCounts );
        addTagCounts( this._activityBarCounts, activityBarCounts );

        if( entry.filePath )
        {
            this._statusBarCountsByFile.set( entry.filePath, cloneTagCounts( statusBarCounts ) );
        }
    }

    _markDocumentCountsDirty( uri )
    {
        this._pendingCountUris.add( this._uriKey( uri ) );
    }

    _markAllDocumentCountsDirty()
    {
        this._documentEntries.forEach( function( entry )
        {
            this._pendingCountUris.add( this._uriKey( entry.uri ) );
        }, this );
    }

    _recalculatePendingCounts()
    {
        Array.from( this._pendingCountUris ).forEach( function( uriKey )
        {
            this._recalculateDocumentCounts( uriKey );
        }, this );
        this._pendingCountUris.clear();
    }

    _clearBranchVisibility( roots )
    {
        if( roots.length === 0 )
        {
            return;
        }

        roots.forEach( function( root )
        {
            if( root === undefined )
            {
                this.clearTreeFilter();
            }
            else
            {
                this.clearTreeFilter( [ root ] );
            }
        }, this );
    }

    _applyBranchFilter( filterText, roots )
    {
        if( roots.length === 0 )
        {
            return;
        }

        roots.forEach( function( root )
        {
            if( root === undefined )
            {
                this.filter( filterText );
            }
            else
            {
                this.filter( filterText, [ root ] );
            }
        }, this );
    }

    _removeDocumentNodes( uri )
    {
        var key = this._uriKey( uri );
        var entry = this._documentEntries.get( key );
        if( entry === undefined )
        {
            return;
        }

        this._subtractDocumentCounts( entry );

        var affectedParents = new Set();
        entry.todos.forEach( function( todoNode )
        {
            if( todoNode.parent )
            {
                todoNode.parent.nodes = todoNode.parent.nodes.filter( function( child )
                {
                    return child !== todoNode;
                } );
                affectedParents.add( todoNode.parent );
            }
            else
            {
                nodes = nodes.filter( function( child )
                {
                    return child !== todoNode;
                } );
                this._rootListDirty = true;
            }
        }, this );

        affectedParents.forEach( function( parent )
        {
            this._pruneEmptyAncestors( parent );
        }, this );

        this._documentEntries.delete( key );
        this._statusBarCountsByFile.delete( entry.filePath );
        this._pendingCountUris.delete( key );
    }

    clear( folders )
    {
        nodes = [];

        workspaceFolders = folders;

        addWorkspaceFolders();
        this._documentEntries.clear();
        this._statusBarCounts = {};
        this._activityBarCounts = {};
        this._statusBarCountsByFile.clear();
        this._pendingCountUris.clear();
        this._dirtyRoots.clear();
        this._rootListDirty = false;
    }

    rebuild()
    {
        buildCounter = ( buildCounter + 1 ) % 100;
    }

    refresh()
    {
        treeHasSubTags = false;
        this._onDidChangeTreeData.fire();
    }

    filter( text, children )
    {
        var matcher = new RegExp( text, config.showFilterCaseSensitive() ? "" : "i" );

        if( children === undefined )
        {
            currentFilter = text;
            children = nodes;
        }
        children.forEach( child =>
        {
            if( child.type === TODO )
            {
                var match = matcher.test( child.label );
                child.visible = !text || match;
            }

            if( child.nodes !== undefined )
            {
                this.filter( text, child.nodes );
            }
            if( child.extraLines !== undefined )
            {
                this.filter( text, child.extraLines );
            }
            if( ( child.nodes && child.nodes.length > 0 ) || ( child.extraLines && child.extraLines.length > 0 ) )
            {
                var visibleNodes = child.nodes ? child.nodes.filter( isVisible ).length : 0;
                var visibleExtraLines = child.extraLines ? child.extraLines.filter( isVisible ).length : 0;
                child.visible = visibleNodes + visibleExtraLines > 0;
            }
        } );
    }

    clearTreeFilter( children )
    {
        currentFilter = undefined;

        if( children === undefined )
        {
            children = nodes;
        }
        children.forEach( function( child )
        {
            child.visible = true;
            if( child.nodes !== undefined )
            {
                this.clearTreeFilter( child.nodes );
            }
            if( child.extraLines !== undefined )
            {
                this.clearTreeFilter( child.extraLines );
            }
        }, this );
    }

    finalizePendingChanges( filterText, options )
    {
        options = options || {};

        if( options.refilterAll === true )
        {
            if( filterText )
            {
                this.filter( filterText );
            }
            else
            {
                this.clearTreeFilter();
            }
            this._markAllDocumentCountsDirty();
        }
        else
        {
            var roots = Array.from( this._dirtyRoots );
            if( this._rootListDirty === true )
            {
                roots.unshift( undefined );
            }

            if( filterText )
            {
                this._applyBranchFilter( filterText, roots );
            }
            else
            {
                this._clearBranchVisibility( roots );
            }
        }

        if( options.fullSort === true || this._rootListDirty === true )
        {
            this.sort();
        }
        else
        {
            this._dirtyRoots.forEach( function( root )
            {
                if( root && root.nodes )
                {
                    this.sort( root.nodes );
                }
            }, this );
        }

        this._recalculatePendingCounts();
        this._dirtyRoots.clear();
        this._rootListDirty = false;
    }

    add( result )
    {
        if( nodes.length === 0 )
        {
            addWorkspaceFolders();
        }

        var fullPath = result.uri.scheme === 'file' ? result.uri.fsPath : path.join( result.uri.authority, result.uri.fsPath );

        var rootNode = locateWorkspaceNode( fullPath );
        var todoNode = createTodoNode( result );

        if( config.shouldHideFromTree( todoNode.tag ? todoNode.tag : todoNode.label ) )
        {
            todoNode.hidden = true;
        }
        var childNode;

        var tagPath = todoNode.subTag ? todoNode.tag + " (" + todoNode.subTag + ")" : todoNode.tag;

        if( config.shouldShowTagsOnly() )
        {
            if( config.shouldGroupByTag() )
            {
                if( todoNode.tag )
                {
                    childNode = nodes.find( findTagNode, tagPath );
                    if( childNode === undefined )
                    {
                        childNode = createTagNode( todoNode.fsPath, tagPath );
                        childNode.parent = undefined;
                        nodes.push( childNode );
                        this._rootListDirty = true;
                    }
                }
                else if( nodes.find( findTodoNode, todoNode ) === undefined )
                {
                    todoNode.parent = undefined;
                    nodes.push( todoNode );
                    this._rootListDirty = true;
                    this._getDocumentEntry( result.uri ).todos.push( todoNode );
                    this._markDocumentCountsDirty( result.uri );
                    return todoNode;
                }
            }
            else if( config.shouldGroupBySubTag() )
            {
                if( todoNode.subTag )
                {
                    childNode = nodes.find( findSubTagNode, todoNode.subTag );
                    if( childNode === undefined )
                    {
                        childNode = createSubTagNode( todoNode.subTag );
                        childNode.parent = undefined;
                        nodes.unshift( childNode );
                        this._rootListDirty = true;
                    }
                }
                else if( nodes.find( findTodoNode, todoNode ) === undefined )
                {
                    todoNode.parent = undefined;
                    nodes.push( todoNode );
                    this._rootListDirty = true;
                    this._getDocumentEntry( result.uri ).todos.push( todoNode );
                    this._markDocumentCountsDirty( result.uri );
                    return todoNode;
                }
            }
            else
            {
                if( nodes.find( findTodoNode, todoNode ) === undefined )
                {
                    todoNode.parent = undefined;
                    nodes.push( todoNode );
                    this._rootListDirty = true;
                    this._getDocumentEntry( result.uri ).todos.push( todoNode );
                    this._markDocumentCountsDirty( result.uri );
                    return todoNode;
                }
            }
        }
        else if( config.shouldFlatten() || rootNode === undefined )
        {
            childNode = locateFlatChildNode( rootNode, result, todoNode.tag, todoNode.subTag );
        }
        else if( rootNode )
        {
            var relativePath = path.relative( rootNode.fsPath, fullPath );
            var pathElements = [];
            if( relativePath !== "" )
            {
                pathElements = relativePath.split( path.sep );
            }
            if( todoNode.subTag )
            {
                if( config.shouldGroupBySubTag() !== true )
                {
                    pathElements.push( todoNode.subTag );
                }
            }
            childNode = locateTreeChildNode( rootNode, pathElements, todoNode.tag, todoNode.subTag );
        }

        if( childNode )
        {
            // needed?
            if( childNode.nodes === undefined )
            {
                childNode.nodes = [];
            }

            childNode.expanded = result.expanded;

            if( childNode.nodes.find( findTodoNode, todoNode ) === undefined )
            {
                todoNode.parent = childNode;
                childNode.nodes.push( todoNode );
                childNode.showCount = true;
                this._getDocumentEntry( result.uri ).todos.push( todoNode );
                this._markDocumentCountsDirty( result.uri );
                this._markRootDirty( childNode );
                return todoNode;
            }
        }

        return undefined;
    }

    replaceDocument( uri, results )
    {
        this._removeDocumentNodes( uri );

        results.forEach( function( result )
        {
            this.add( result );
        }, this );

        this._markDocumentCountsDirty( uri );
    }

    remove( callback, uri, children )
    {
        this._removeDocumentNodes( uri );
        this.finalizePendingChanges( currentFilter, { fullSort: false, refilterAll: false } );

        if( callback )
        {
            callback( uri.fsPath );
        }

        return children === undefined ? nodes : children;
    }

    getElement( filename, found, children )
    {
        if( children === undefined )
        {
            children = nodes;
        }
        children.forEach( function( child )
        {
            if( child.fsPath === filename )
            {
                found( child );
            }
            else if( child.nodes !== undefined )
            {
                return this.getElement( filename, found, child.nodes );
            }
        }, this );
    }

    setExpanded( path, expanded )
    {
        expandedNodes[ path ] = expanded;
        this._context.workspaceState.update( 'expandedNodes', expandedNodes );
    }

    clearExpansionState()
    {
        expandedNodes = {};
        this._context.workspaceState.update( 'expandedNodes', expandedNodes );
    }

    getTagCountsForStatusBar( fileFilter )
    {
        if( fileFilter )
        {
            return cloneTagCounts( this._statusBarCountsByFile.get( fileFilter ) || {} );
        }
        return cloneTagCounts( this._statusBarCounts );
    }

    getTagCountsForActivityBar()
    {
        return cloneTagCounts( this._activityBarCounts );
    }

    exportChildren( parent, children )
    {
        children.forEach( function( child )
        {
            if( child.type === PATH )
            {
                parent[ child.label ] = {};
                this.exportChildren( parent[ child.label ], this.getChildren( child ) );
            }
            else if( !child.notExported )
            {
                var format = config.labelFormat();
                var itemLabel = "line " + ( child.line + 1 );
                if( config.shouldShowTagsOnly() === true )
                {
                    itemLabel = child.fsPath + " " + itemLabel;
                }
                parent[ itemLabel ] = ( format !== "" ) ?
                    utils.formatLabel( format, child ) + ( child.pathLabel ? ( " " + child.pathLabel ) : "" ) :
                    child.label;
            }
        }, this );
        return parent;
    }

    exportTree()
    {
        var exported = {};
        var children = this.getChildren();
        exported = this.exportChildren( exported, children );
        return exported;
    }

    getFirstNode()
    {
        var availableNodes = nodes.filter( function( node )
        {
            return node.nodes === undefined || ( node.nodes.length > 0 );
        } );
        var rootNodes = availableNodes.filter( isVisible );
        if( rootNodes.length > 0 )
        {
            return rootNodes[ 0 ];
        }
        return undefined;
    }

    hasSubTags()
    {
        return treeHasSubTags;
    }

    sort( children )
    {
        if( config.shouldSortTree() )
        {
            if( children === undefined )
            {
                children = nodes;
            }
            children.forEach( function( child )
            {
                if( child.nodes !== undefined )
                {
                    this.sort( child.nodes );
                }
            }, this );

            if( config.shouldShowTagsOnly() )
            {
                if( config.shouldSortTagsOnlyViewAlphabetically() )
                {
                    children.sort( sortTagsOnlyViewByLabel );
                }
                else
                {
                    children.sort( sortTagsOnlyViewByTagOrder );
                }
            }
            else
            {
                children.sort( sortByFilenameAndLine );
            }
        }
    }
}

exports.TreeNodeProvider = TreeNodeProvider;
exports.locateWorkspaceNode = locateWorkspaceNode;
