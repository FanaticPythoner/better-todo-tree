'use strict';

function createWorkspaceFileWatcher( workspace, onChange )
{
    var watcher;
    var activeGlob;
    function dispose()
    {
        if( watcher ) { watcher.dispose(); }
        watcher = undefined;
        activeGlob = undefined;
    }
    function configure( glob )
    {
        if( glob === activeGlob ) { return; }
        dispose();
        if( glob !== undefined )
        {
            watcher = workspace.createFileSystemWatcher( glob );
            var ownedWatcher = watcher;
            function notify( uri )
            {
                if( watcher === ownedWatcher ) { onChange( uri ); }
            }
            watcher.onDidCreate( notify );
            watcher.onDidChange( notify );
            watcher.onDidDelete( notify );
            activeGlob = glob;
        }
    }
    return { configure: configure, dispose: dispose };
}

module.exports.createWorkspaceFileWatcher = createWorkspaceFileWatcher;
