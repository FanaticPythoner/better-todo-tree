var QUnit = require( 'qunit' );
var childProcess = require( 'child_process' );
var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );

var repoRoot = path.resolve( __dirname, '..' );
var scriptPath = path.join( repoRoot, 'scripts', 'branch', 'issue-branch.sh' );
var issue28Url = 'https://github.com/FanaticPythoner/better-todo-tree/issues/28';
var issue36Url = 'https://github.com/FanaticPythoner/better-todo-tree/issues/36';
var upstreamIssueUrl = 'https://github.com/Gruntfuggly/todo-tree/issues/28';
var derivedIssueBranch = 'fix/issues-28-36-not-quite-a-drop-in-replacement-label-format-after-displays-before';

function runScript( cwd, args, extraEnv )
{
    return childProcess.spawnSync( 'bash', [ scriptPath ].concat( args ), {
        cwd: cwd,
        encoding: 'utf8',
        env: Object.assign( {}, process.env, {
            GIT_TERMINAL_PROMPT: '0'
        }, extraEnv || {} )
    } );
}

function runGit( cwd, args )
{
    var result = childProcess.spawnSync( 'git', args, {
        cwd: cwd,
        encoding: 'utf8',
        env: Object.assign( {}, process.env, {
            GIT_TERMINAL_PROMPT: '0'
        } )
    } );

    if( result.status !== 0 )
    {
        throw new Error( 'git ' + args.join( ' ' ) + ' failed: ' + result.stderr );
    }

    return result.stdout.trim();
}

function gitStatus( cwd, args )
{
    return childProcess.spawnSync( 'git', args, {
        cwd: cwd,
        encoding: 'utf8',
        env: Object.assign( {}, process.env, {
            GIT_TERMINAL_PROMPT: '0'
        } )
    } );
}

function remoteBranchExists( cwd, branch )
{
    return gitStatus( cwd, [ 'ls-remote', '--exit-code', '--heads', 'origin', branch ] ).status === 0;
}

function createFixtureRepository()
{
    var root = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-issue-branch-' ) );
    var bare = path.join( root, 'origin.git' );
    var work = path.join( root, 'work' );

    fs.mkdirSync( work );
    runGit( root, [ 'init', '--bare', bare ] );
    runGit( work, [ 'init', '--initial-branch=master' ] );
    runGit( work, [ 'config', 'user.name', 'Issue Branch Test' ] );
    runGit( work, [ 'config', 'user.email', 'issue-branch@example.invalid' ] );
    fs.writeFileSync( path.join( work, 'README.md' ), 'base\n' );
    runGit( work, [ 'add', 'README.md' ] );
    runGit( work, [ 'commit', '-m', 'base commit' ] );
    runGit( work, [ 'remote', 'add', 'origin', bare ] );
    runGit( work, [ 'push', '-u', 'origin', 'master' ] );

    return {
        root: root,
        bare: bare,
        work: work
    };
}

function createFakeGh( root )
{
    var binDir = path.join( root, 'bin' );
    var ghPath = path.join( binDir, 'gh' );
    var argsPath = path.join( root, 'gh-args.txt' );

    fs.mkdirSync( binDir );
    fs.writeFileSync( ghPath, [
        '#!/usr/bin/env sh',
        'set -eu',
        'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
        '  case "$3" in',
        "    *issues/28*) printf '28\\tNot quite a drop-in replacement\\n' ;;",
        "    *issues/36*) printf '36\\tLabel format - ${after} displays ${before}\\n' ;;",
        "    *) echo 'unknown issue' >&2; exit 1 ;;",
        '  esac',
        '  exit 0',
        'fi',
        'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
        '  printf "%s\\n" "$@" > "$GH_ARGS_FILE"',
        '  exit 0',
        'fi',
        "echo 'unknown gh command' >&2",
        'exit 1'
    ].join( '\n' ) + '\n' );
    fs.chmodSync( ghPath, 0o755 );

    return {
        argsPath: argsPath,
        env: {
            GH_ARGS_FILE: argsPath,
            PATH: binDir + path.delimiter + process.env.PATH
        }
    };
}

QUnit.module( 'issue branch script' );

QUnit.test( 'issue-branch name derives stable multi-issue branch names', function( assert )
{
    var root = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-issue-branch-gh-' ) );
    var fakeGh = createFakeGh( root );
    var result;

    try
    {
        result = runScript( repoRoot, [ 'name', issue28Url, issue36Url ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );
        assert.equal( result.stdout.trim(), derivedIssueBranch );

        result = runScript( repoRoot, [ 'name', issue36Url, issue28Url ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );
        assert.equal( result.stdout.trim(), derivedIssueBranch );
    }
    finally
    {
        fs.rmSync( root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch rejects protected branch names', function( assert )
{
    var result = runScript( repoRoot, [ 'name', '--branch', 'master', issue28Url ] );

    assert.notEqual( result.status, 0 );
    assert.ok( result.stderr.indexOf( "branch 'master' is protected" ) >= 0, result.stderr );
} );

QUnit.test( 'issue-branch rejects non-project issue URLs', function( assert )
{
    var result = runScript( repoRoot, [ 'name', upstreamIssueUrl ] );

    assert.notEqual( result.status, 0 );
    assert.ok( result.stderr.indexOf( 'issue URL must target FanaticPythoner/better-todo-tree' ) >= 0, result.stderr );
} );

QUnit.test( 'issue-branch rejects non-master base branches', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var result;

    try
    {
        result = runScript( fixture.work, [
            'create',
            '--remote', 'origin',
            '--base', 'main',
            issue28Url,
            issue36Url
        ], fakeGh.env );

        assert.notEqual( result.status, 0 );
        assert.ok( result.stderr.indexOf( "base branch 'main' is unsupported" ) >= 0, result.stderr );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch creates remote base branch before staging source changes', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var branch = derivedIssueBranch;
    var readmePath = path.join( fixture.work, 'README.md' );
    var extraPath = path.join( fixture.work, 'extra.txt' );
    var originMasterSha;
    var remoteBranchSha;
    var result;

    try
    {
        fs.writeFileSync( readmePath, 'base\nlocal change\n' );
        fs.writeFileSync( extraPath, 'new file\n' );
        runGit( fixture.work, [ 'add', 'README.md', 'extra.txt' ] );

        result = runScript( fixture.work, [
            'create',
            '--remote', 'origin',
            '--base', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );
        assert.equal( runGit( fixture.work, [ 'branch', '--show-current' ] ), 'master' );

        originMasterSha = runGit( fixture.work, [ 'rev-parse', 'origin/master' ] );
        remoteBranchSha = runGit( fixture.work, [ 'rev-parse', 'origin/' + branch ] );
        assert.equal( remoteBranchSha, originMasterSha );
        assert.equal( runGit( fixture.work, [ 'config', 'branch.' + branch + '.remote' ] ), 'origin' );
        assert.equal( runGit( fixture.work, [ 'config', 'branch.' + branch + '.merge' ] ), 'refs/heads/' + branch );

        result = runScript( fixture.work, [
            'stage',
            '--remote', 'origin',
            '--source', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );
        assert.equal( runGit( fixture.work, [ 'branch', '--show-current' ] ), branch );
        assert.ok( runGit( fixture.work, [ 'diff', '--cached', '--name-only' ] ).indexOf( 'README.md' ) >= 0 );
        assert.ok( runGit( fixture.work, [ 'diff', '--cached', '--name-only' ] ).indexOf( 'extra.txt' ) >= 0 );
        assert.equal( runGit( fixture.work, [ 'rev-parse', 'origin/' + branch ] ), originMasterSha );

        runGit( fixture.work, [ 'commit', '-m', 'fix issue branch fixture' ] );
        result = runScript( fixture.work, [
            'push',
            '--remote', 'origin',
            '--no-wait',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );
        runGit( fixture.work, [ 'fetch', 'origin', branch ] );
        assert.equal(
            runGit( fixture.work, [ 'rev-parse', 'origin/' + branch ] ),
            runGit( fixture.work, [ 'rev-parse', branch ] )
        );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch stage merges source patches onto updated base files', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var branch = derivedIssueBranch;
    var readmePath = path.join( fixture.work, 'README.md' );
    var result;

    try
    {
        fs.writeFileSync( readmePath, 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );
        runGit( fixture.work, [ 'commit', '-m', 'expand base fixture' ] );
        runGit( fixture.work, [ 'push', 'origin', 'master' ] );
        fs.writeFileSync( readmePath, 'remote one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );
        runGit( fixture.work, [ 'commit', '-m', 'advance remote fixture' ] );
        runGit( fixture.work, [ 'push', 'origin', 'master' ] );
        runGit( fixture.work, [ 'reset', '--hard', 'HEAD~1' ] );
        fs.writeFileSync( readmePath, 'one\ntwo\nthree\nfour\nfive\nsix\nseven\nlocal eight\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );

        result = runScript( fixture.work, [
            'create',
            '--remote', 'origin',
            '--base', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );

        result = runScript( fixture.work, [
            'stage',
            '--remote', 'origin',
            '--source', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );
        assert.equal( runGit( fixture.work, [ 'branch', '--show-current' ] ), branch );
        assert.equal(
            fs.readFileSync( readmePath, 'utf8' ),
            'remote one\ntwo\nthree\nfour\nfive\nsix\nseven\nlocal eight\n'
        );
        assert.equal( runGit( fixture.work, [ 'diff', '--cached', '--name-only' ] ), 'README.md' );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch flow stages source snapshot when patch transfer conflicts', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var readmePath = path.join( fixture.work, 'README.md' );
    var result;

    try
    {
        fs.writeFileSync( readmePath, 'remote base\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );
        runGit( fixture.work, [ 'commit', '-m', 'advance remote fixture' ] );
        runGit( fixture.work, [ 'push', 'origin', 'master' ] );
        runGit( fixture.work, [ 'reset', '--hard', 'HEAD~1' ] );
        fs.writeFileSync( readmePath, 'local base\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );

        result = runScript( fixture.work, [
            'flow',
            '--remote', 'origin',
            '--base', 'master',
            '--source', 'master',
            '--no-wait',
            issue28Url,
            issue36Url
        ], fakeGh.env );

        assert.notEqual( result.status, 0 );
        assert.ok( result.stderr.indexOf( 'has no local commits ahead' ) >= 0, result.stderr );
        assert.equal( runGit( fixture.work, [ 'branch', '--show-current' ] ), derivedIssueBranch );
        assert.equal( runGit( fixture.work, [ 'diff', '--cached', '--name-only' ] ), 'README.md' );
        assert.equal( fs.readFileSync( readmePath, 'utf8' ), 'local base\n' );
        assert.equal( remoteBranchExists( fixture.work, derivedIssueBranch ), false );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch flow reuses an empty branch at the remote base', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var readmePath = path.join( fixture.work, 'README.md' );
    var result;

    try
    {
        result = runScript( fixture.work, [
            'create',
            '--remote', 'origin',
            '--base', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );

        fs.writeFileSync( readmePath, 'base\nlocal change\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );

        result = runScript( fixture.work, [
            'flow',
            '--remote', 'origin',
            '--base', 'master',
            '--source', 'master',
            '--no-wait',
            issue28Url,
            issue36Url
        ], fakeGh.env );

        assert.notEqual( result.status, 0 );
        assert.ok( result.stderr.indexOf( 'has no local commits ahead' ) >= 0, result.stderr );
        assert.equal( runGit( fixture.work, [ 'branch', '--show-current' ] ), derivedIssueBranch );
        assert.equal( runGit( fixture.work, [ 'diff', '--cached', '--name-only' ] ), 'README.md' );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch stage includes unstaged tracked source changes', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var readmePath = path.join( fixture.work, 'README.md' );
    var result;

    try
    {
        result = runScript( fixture.work, [
            'create',
            '--remote', 'origin',
            '--base', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );

        fs.writeFileSync( readmePath, 'base\nstaged change\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );
        fs.writeFileSync( readmePath, 'base\nstaged change\nunstaged change\n' );

        result = runScript( fixture.work, [
            'stage',
            '--remote', 'origin',
            '--source', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );

        assert.equal( result.status, 0, result.stderr );
        assert.equal( runGit( fixture.work, [ 'branch', '--show-current' ] ), derivedIssueBranch );
        assert.equal( runGit( fixture.work, [ 'diff', '--cached', '--name-only' ] ), 'README.md' );
        assert.equal( fs.readFileSync( readmePath, 'utf8' ), 'base\nstaged change\nunstaged change\n' );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch stage refuses untracked source changes', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var readmePath = path.join( fixture.work, 'README.md' );
    var scratchPath = path.join( fixture.work, 'scratch.txt' );
    var result;

    try
    {
        result = runScript( fixture.work, [
            'create',
            '--remote', 'origin',
            '--base', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );
        assert.equal( result.status, 0, result.stderr );

        fs.writeFileSync( readmePath, 'base\nstaged change\n' );
        fs.writeFileSync( scratchPath, 'scratch\n' );
        runGit( fixture.work, [ 'add', 'README.md' ] );

        result = runScript( fixture.work, [
            'stage',
            '--remote', 'origin',
            '--source', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );

        assert.notEqual( result.status, 0 );
        assert.ok( result.stderr.indexOf( 'untracked paths are present' ) >= 0, result.stderr );
        assert.equal( runGit( fixture.work, [ 'branch', '--show-current' ] ), 'master' );
        assert.equal( runGit( fixture.work, [ 'diff', '--cached', '--name-only' ] ), 'README.md' );
        assert.ok( fs.existsSync( scratchPath ) );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );

QUnit.test( 'issue-branch pr derives branch name from issue URLs', function( assert )
{
    var fixture = createFixtureRepository();
    var fakeGh = createFakeGh( fixture.root );
    var result;

    try
    {
        result = runScript( fixture.work, [
            'pr',
            '--base', 'master',
            issue28Url,
            issue36Url
        ], fakeGh.env );

        assert.equal( result.status, 0, result.stderr );
        assert.deepEqual(
            fs.readFileSync( fakeGh.argsPath, 'utf8' ).trim().split( '\n' ),
            [
                'pr',
                'create',
                '--repo',
                'FanaticPythoner/better-todo-tree',
                '--base',
                'master',
                '--head',
                'FanaticPythoner:' + derivedIssueBranch,
                '--fill'
            ]
        );
    }
    finally
    {
        fs.rmSync( fixture.root, { recursive: true, force: true } );
    }
} );
