var QUnit = require( 'qunit' );
var fs = require( 'fs' );
var path = require( 'path' );
var regexRegistry = require( '../src/regexRegistry.js' );

var repoRoot = path.resolve( __dirname, '..' );
var scriptPath = path.join( repoRoot, 'scripts', 'branch', 'issue-branch.sh' );
var scriptText = fs.readFileSync( scriptPath, 'utf8' );

function escapedName( name )
{
    return regexRegistry.escapeRegexLiteral( name );
}

function functionBody( name )
{
    var pattern = new RegExp( '^' + escapedName( name ) + '\\(\\)\\n\\{\\n([\\s\\S]*?)\\n\\}', 'm' );
    var match = pattern.exec( scriptText );

    if( !match )
    {
        throw new Error( 'function missing: ' + name );
    }

    return match[ 1 ];
}

function indexOfLine( body, text )
{
    var index = body.indexOf( text );

    if( index < 0 )
    {
        throw new Error( 'line missing: ' + text );
    }

    return index;
}

QUnit.module( 'issue branch script static structure' );

QUnit.test( 'flow stages local patch before remote push', function( assert )
{
    var body = functionBody( 'flow' );
    var ensureIndex = indexOfLine( body, 'ensure_flow_branch' );
    var stageIndex = indexOfLine( body, 'stage_branch_changes' );
    var pushIndex = indexOfLine( body, 'push_after_commit' );

    assert.ok( ensureIndex < stageIndex );
    assert.ok( stageIndex < pushIndex );
    assert.equal( body.indexOf( 'create_branch' ), -1 );
} );

QUnit.test( 'flow branch preparation contains no remote push command', function( assert )
{
    var flowBranchBody = functionBody( 'ensure_flow_branch' );
    var explicitCreateBody = functionBody( 'create_branch' );

    assert.equal( flowBranchBody.indexOf( 'git push' ), -1 );
    assert.equal( flowBranchBody.indexOf( 'push_branch_ref' ), -1 );
    assert.ok( explicitCreateBody.indexOf( 'push_branch_ref' ) >= 0 );
} );

QUnit.test( 'patch transfer attempts exact apply before merge apply', function( assert )
{
    var body = functionBody( 'apply_source_patch_to_target' );
    var exactIndex = indexOfLine( body, 'apply_index_patch "$patch_file" exact' );
    var firstResetIndex = indexOfLine( body, 'git reset --hard HEAD' );
    var mergeIndex = indexOfLine( body, 'apply_index_patch "$patch_file" merge' );
    var snapshotIndex = indexOfLine(
        body,
        'apply_source_snapshot_to_target "$snapshot_dir" "$manifest_file"'
    );

    assert.ok( exactIndex < firstResetIndex );
    assert.ok( firstResetIndex < mergeIndex );
    assert.ok( mergeIndex < snapshotIndex );
} );

QUnit.test( 'stage preserves source index and worktree patches separately', function( assert )
{
    var body = functionBody( 'stage_branch_changes' );
    var trackedIndex = indexOfLine( body, 'git diff --binary HEAD > "$tracked_patch_file"' );
    var stagedIndex = indexOfLine( body, 'git diff --cached --binary > "$staged_patch_file"' );
    var unstagedIndex = indexOfLine( body, 'git diff --binary > "$unstaged_patch_file"' );
    var resetIndex = indexOfLine( body, 'git reset --hard HEAD' );

    assert.ok( trackedIndex < resetIndex );
    assert.ok( stagedIndex < resetIndex );
    assert.ok( unstagedIndex < resetIndex );
    assert.equal( body.indexOf( 'require_no_unstaged_source_changes' ), -1 );
} );

QUnit.test( 'remote branch ref check fetches only existing remote heads', function( assert )
{
    var body = functionBody( 'remote_branch_ref_exists' );
    var inspectIndex = indexOfLine( body, 'remote_branch_exists' );
    var fetchIndex = indexOfLine( body, 'fetch_branch >/dev/null' );

    assert.ok( inspectIndex < fetchIndex );
    assert.equal( body.indexOf( 'rev-parse --verify "refs/remotes' ), -1 );
} );
